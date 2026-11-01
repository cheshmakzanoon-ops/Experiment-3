#!/usr/bin/env python3
"""Fail-closed, Linux-only ownership cleanup for an offline A/B coordinator.

Public interface: one <=16 KiB JSON request on stdin, no CLI arguments. Only
verify-empty and cleanup exist; no caller-selected signal, /proc root or timeout.
The coordinator MUST create the private run/leg directories freshly, keep them
private, stop launching before cleanup, and prevent concurrent hostile same-UID
writers. Freshness and hostile same-UID isolation cannot be proved by this helper.
Launcher and helper must share the PID namespace. A read-only /proc visibility
gate rejects filtering/overmounts and a mismatched mounted PID namespace.
No mount or namespace changes may occur during the helper lifetime. Visibility
is rechecked before every scan and signal; these are not atomic mount locks.
In particular, pidfds prevent PID-reuse signalling, not a target's concurrent exec.
This helper never removes files, reads argv, launches anything, or kills a group.
"""

import errno
import json
import os
import re
import select
import signal
import stat
import sys
import time
from dataclasses import dataclass


MAX_REQUEST = 16 * 1024
MAX_ENTRIES = 4096
MAX_SAME_UID = 1024
MAX_OWNED = 64
MAX_STAT = 4096
MAX_ENV = 64 * 1024
MAX_MOUNTINFO = 64 * 1024
MAX_SELF_STATUS = 8 * 1024
DEADLINE_SECONDS = 5.0
TERM_GRACE_SECONDS = 0.5
EMPTY_SPACING_SECONDS = 0.05
NAMES = ("motobound", "chrome_crashpad_handler")
OWNER_KEY = b"MOTOBOUND_RUNTIME_AB_OWNER="
TERMINAL = frozenset(("Z", "X", "x"))
REASONS = frozenset((
    "quiescent", "owned_present", "invalid_request", "unsupported_platform",
    "nonroot_uid_required", "unsafe_layout", "executable_changed", "missing_pidfd",
    "proc_limit", "same_uid_limit", "owned_limit", "identity_unreadable",
    "identity_changed", "invalid_proc_stat", "stat_limit", "environment_limit",
    "owner_token_mismatch", "pidfd_permission", "pidfd_error", "signal_failed",
    "proc_visibility", "deadline", "internal_error",
))


class Blocked(Exception):
    def __init__(self, reason):
        self.reason = reason if reason in REASONS else "internal_error"
        super().__init__(self.reason)


@dataclass(frozen=True)
class Request:
    action: str
    private_root: str
    runtime_root: str
    token: bytes
    executables: dict


@dataclass(frozen=True)
class Identity:
    pid: int
    start: int
    path: str
    dev: int
    ino: int


@dataclass
class Handle:
    identity: Identity
    fd: int
    settled: bool = False
    term_at: float | None = None
    killed: bool = False


def _unique_object(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise Blocked("invalid_request")
        obj[key] = value
    return obj


def parse_request(data):
    if not isinstance(data, bytes) or len(data) > MAX_REQUEST:
        raise Blocked("invalid_request")
    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_object,
                           parse_constant=lambda _value: (_ for _ in ()).throw(
                               Blocked("invalid_request")))
    except (ValueError, UnicodeError, RecursionError):
        raise Blocked("invalid_request") from None
    keys = {"action", "privateRoot", "runtimeRoot", "token", "executables"}
    if not isinstance(value, dict) or set(value) != keys:
        raise Blocked("invalid_request")
    action, private, runtime, token = (value[k] for k in
                                        ("action", "privateRoot", "runtimeRoot", "token"))
    if action not in ("verify-empty", "cleanup"):
        raise Blocked("invalid_request")
    for path in (private, runtime):
        if not isinstance(path, str) or len(path) > 4096 or "\x00" in path:
            raise Blocked("invalid_request")
        if not path.startswith("/") or path.startswith("//") or os.path.normpath(path) != path:
            raise Blocked("invalid_request")
    if not re.fullmatch(r"/.*/runtime-ab-[0-9a-f]{32}/[AB]", private):
        raise Blocked("invalid_request")
    if runtime != private + "/desktop-out/linux-unpacked":
        raise Blocked("invalid_request")
    if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{64}", token):
        raise Blocked("invalid_request")
    entries = value["executables"]
    if not isinstance(entries, dict) or set(entries) != set(NAMES):
        raise Blocked("invalid_request")
    executables = {}
    for name in NAMES:
        item = entries[name]
        if not isinstance(item, dict) or set(item) != {"dev", "ino"}:
            raise Blocked("invalid_request")
        numbers = []
        for key in ("dev", "ino"):
            number = item[key]
            if not isinstance(number, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,19})", number):
                raise Blocked("invalid_request")
            integer = int(number)
            if integer > 2**64 - 1 or (key == "ino" and integer == 0):
                raise Blocked("invalid_request")
            numbers.append(integer)
        executables[runtime + "/" + name] = tuple(numbers)
    return Request(action, private, runtime, token.encode("ascii"), executables)


def validate_layout(request, uid):
    """No symlinks in the complete path; ownership starts at the run root."""
    run_root = os.path.dirname(request.private_root)
    paths = [request.runtime_root, *request.executables]
    try:
        for target in paths:
            current = "/"
            parts = target.split("/")[1:]
            for index, part in enumerate(parts):
                current = os.path.join(current, part)
                item = os.lstat(current)
                is_executable = index == len(parts) - 1 and target in request.executables
                if stat.S_ISLNK(item.st_mode):
                    raise Blocked("unsafe_layout")
                if is_executable:
                    if not stat.S_ISREG(item.st_mode) or not item.st_mode & stat.S_IXUSR:
                        raise Blocked("unsafe_layout")
                elif not stat.S_ISDIR(item.st_mode):
                    raise Blocked("unsafe_layout")
                if current == run_root or current.startswith(run_root + "/"):
                    if item.st_uid != uid or item.st_mode & 0o022:
                        raise Blocked("unsafe_layout")
                if current in (run_root, request.private_root) and stat.S_IMODE(item.st_mode) != 0o700:
                    raise Blocked("unsafe_layout")
            if target in request.executables and (item.st_dev, item.st_ino) != request.executables[target]:
                raise Blocked("executable_changed")
    except OSError:
        raise Blocked("unsafe_layout") from None


def parse_stat(data, expected_pid):
    if len(data) > MAX_STAT:
        raise Blocked("stat_limit")
    try:
        # comm may contain spaces, ')' and newlines. The final ') ' ends it.
        boundary = data.rfind(b") ")
        prefix = str(expected_pid).encode() + b" ("
        if boundary < 0 or not data.startswith(prefix):
            raise ValueError()
        fields = data[boundary + 2:].split()
        state = fields[0].decode("ascii")
        if len(fields) < 20 or state not in "RSDZTtXxKWPI" or len(state) != 1:
            raise ValueError()
        if not fields[19].isdigit() or len(fields[19]) > 20:
            raise ValueError()
        start = int(fields[19])
        if start <= 0:
            raise ValueError()
        return start, state
    except (ValueError, IndexError, UnicodeError):
        raise Blocked("invalid_proc_stat") from None


def validate_proc_visibility(mountinfo, status, self_link, own_pid, fdinfo, proc_device):
    """Fail closed if a scan could hide tasks or refer to a different PID ns.

    Linux hidepid can omit same-UID nondumpable tasks (not merely deny readlink).
    See kernel Documentation/filesystems/proc.rst, mount options. No mount or
    security setting is changed; mount/status contents are never returned.
    """
    if len(mountinfo) > MAX_MOUNTINFO or len(status) > MAX_SELF_STATUS or len(fdinfo) > MAX_STAT:
        raise Blocked("proc_visibility")
    roots = []
    try:
        mount_ids = [line.split()[1:] for line in fdinfo.splitlines()
                     if line.startswith(b"mnt_id:")]
        if len(mount_ids) != 1 or len(mount_ids[0]) != 1 or not mount_ids[0][0].isdigit():
            raise ValueError()
        active_id = mount_ids[0][0]
        active_device = (str(proc_device[0]) + ":" + str(proc_device[1])).encode("ascii")
        for line in mountinfo.splitlines():
            fields = line.split()
            separator = fields.index(b"-")
            if separator < 6 or len(fields) != separator + 4:
                raise ValueError()
            mountpoint = fields[4]
            # A numeric-PID submount could hide or substitute an executable.
            if re.match(rb"/proc/(?:[0-9]+|self|thread-self)(?:/|$)", mountpoint):
                raise ValueError()
            if mountpoint == b"/proc":
                if fields[3] != b"/" or fields[separator + 1] != b"proc":
                    raise ValueError()
                if fields[0] == active_id:
                    if fields[2] != active_device:
                        raise ValueError()
                    roots.append(fields[5].split(b",") + fields[separator + 3].split(b","))
        if len(roots) != 1:
            raise ValueError()
        hidden = [option for option in roots[0] if option.startswith(b"hidepid")]
        if len(hidden) > 1 or (hidden and hidden != [b"hidepid=0"]):
            raise ValueError()
        expected = str(own_pid).encode("ascii")
        namespace_pids = [line.split()[1:] for line in status.splitlines()
                          if line.startswith(b"NSpid:")]
        # A procfs mounted for an ancestor PID namespace exposes multiple NSpid
        # entries. Require the sole PID to agree with getpid() and /proc/self.
        if namespace_pids != [[expected]] or self_link != str(own_pid):
            raise ValueError()
    except (ValueError, IndexError, UnicodeError):
        raise Blocked("proc_visibility") from None


class LinuxProc:
    """Production backend. /proc is deliberately not configurable."""

    def __init__(self):
        self.uid = os.getuid()

    def capable(self):
        if sys.platform != "linux":
            raise Blocked("unsupported_platform")
        if self.uid == 0 or os.geteuid() != self.uid:
            raise Blocked("nonroot_uid_required")
        if not callable(getattr(os, "pidfd_open", None)) or not callable(getattr(signal, "pidfd_send_signal", None)):
            raise Blocked("missing_pidfd")
        fd = self.open_pidfd(os.getpid())
        os.close(fd)
        self.visibility()

    def visibility(self):
        pid = os.getpid()
        proc_fd = None
        try:
            # Stacked mounts are resolved by the kernel's fdinfo mount ID, never
            # by guessing mountinfo ordering or accepting all matching paths.
            proc_fd = os.open("/proc", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            device = os.fstat(proc_fd).st_dev
            validate_proc_visibility(
                self._read(pid, "mountinfo", MAX_MOUNTINFO, "proc_visibility"),
                self._read(pid, "status", MAX_SELF_STATUS, "proc_visibility"),
                os.readlink("/proc/self"), pid,
                self._read(pid, "fdinfo/" + str(proc_fd), MAX_STAT, "proc_visibility"),
                (os.major(device), os.minor(device)))
        except OSError:
            raise Blocked("proc_visibility") from None
        finally:
            if proc_fd is not None:
                os.close(proc_fd)

    def layout(self, request):
        self.visibility()
        validate_layout(request, self.uid)

    def entries(self):
        values = []
        count = 0
        with os.scandir("/proc") as entries:
            for entry in entries:
                count += 1
                if count > MAX_ENTRIES:
                    raise Blocked("proc_limit")
                if entry.name.isascii() and entry.name.isdecimal():
                    values.append(int(entry.name))
        return sorted(values)

    def uid_of(self, pid):
        return os.stat("/proc/" + str(pid), follow_symlinks=False).st_uid

    def absent(self, pid):
        try:
            self.uid_of(pid)
        except FileNotFoundError:
            return True
        return False

    @staticmethod
    def _read(pid, name, limit, reason):
        # /proc's own pseudo-files only, never a caller-provided path.
        data = bytearray()
        with open("/proc/" + str(pid) + "/" + name, "rb", buffering=0) as source:
            # FileIO.read may return short. A valid-looking prefix is not the
            # complete ownership environment; read to EOF, never past limit+1.
            while len(data) <= limit:
                chunk = source.read(limit + 1 - len(data))
                if not chunk:
                    return bytes(data)
                data.extend(chunk)
        raise Blocked(reason)

    def proc_stat(self, pid):
        return parse_stat(self._read(pid, "stat", MAX_STAT, "stat_limit"), pid)

    def exe(self, pid):
        path = "/proc/" + str(pid) + "/exe"
        target = os.readlink(path)
        # stat is needed only after readlink establishes an exact allowlisted path.
        return target

    def exe_stat(self, pid):
        item = os.stat("/proc/" + str(pid) + "/exe")
        if item.st_uid != self.uid or not stat.S_ISREG(item.st_mode):
            raise Blocked("identity_changed")
        return item.st_dev, item.st_ino

    def environment(self, pid):
        return self._read(pid, "environ", MAX_ENV, "environment_limit")

    def open_pidfd(self, pid):
        try:
            return os.pidfd_open(pid, 0)
        except ProcessLookupError:
            raise
        except OSError as error:
            if error.errno in (errno.ENOSYS, errno.EINVAL):
                raise Blocked("missing_pidfd") from None
            if error.errno in (errno.EPERM, errno.EACCES):
                raise Blocked("pidfd_permission") from None
            raise Blocked("pidfd_error") from None

    def exited(self, fd):
        poller = select.poll()
        poller.register(fd, select.POLLIN)
        events = poller.poll(0)
        if not events:
            return False
        flags = events[0][1]
        if flags & (select.POLLNVAL | select.POLLERR):
            raise Blocked("pidfd_error")
        # POLLHUP alone is not substituted for the documented POLLIN exit proof.
        if not flags & select.POLLIN:
            raise Blocked("pidfd_error")
        return True

    def send(self, fd, signum):
        # Exclusively descriptor-addressed: no os.kill / process-group fallback.
        signal.pidfd_send_signal(fd, signum, None, 0)

    def close(self, fd):
        os.close(fd)

    @staticmethod
    def now():
        return time.monotonic()

    @staticmethod
    def sleep(seconds):
        time.sleep(seconds)


class Cleaner:
    def __init__(self, request, backend=None):
        self.request = request
        self.backend = backend if backend is not None else LinuxProc()
        self.deadline = self.backend.now() + DEADLINE_SECONDS
        self.handles = {}
        self.scanned = 0
        self.signaled_term = 0
        self.signaled_kill = 0
        self.empty_scans = 0
        self.scan_saw_owned = False

    def budget(self):
        if self.backend.now() >= self.deadline:
            raise Blocked("deadline")

    def settled(self, handle):
        if not handle.settled and self.backend.exited(handle.fd):
            handle.settled = True
        return handle.settled

    def gone_or_terminal(self, pid, expected_start=None):
        """An absent proc directory or a ready pidfd proves non-execution now."""
        try:
            if self.backend.absent(pid):
                return True
            start, state = self.backend.proc_stat(pid)
            if expected_start is not None and start != expected_start:
                raise Blocked("identity_changed")
            if state not in TERMINAL:
                return False
            fd = self.backend.open_pidfd(pid)
        except (FileNotFoundError, ProcessLookupError):
            if self.backend.absent(pid):
                return True
            raise Blocked("identity_changed") from None
        try:
            second = self.backend.proc_stat(pid)
            if second[0] != start:
                raise Blocked("identity_changed")
            return second[1] in TERMINAL and self.backend.exited(fd)
        except FileNotFoundError:
            return self.backend.exited(fd)
        finally:
            self.backend.close(fd)

    def identity(self, pid, observe=False):
        """Never read environ unless exact executable path AND inode match."""
        self.budget()
        try:
            if self.backend.uid_of(pid) != self.backend.uid:
                return None
            start, state = self.backend.proc_stat(pid)
            if state in TERMINAL:
                if self.gone_or_terminal(pid, start):
                    return None
                raise Blocked("identity_unreadable")
            path = self.backend.exe(pid)
            if path not in self.request.executables:
                if path.endswith(" (deleted)") and path[:-10] in self.request.executables:
                    raise Blocked("executable_changed")
                return None
            dev, ino = self.backend.exe_stat(pid)
            if (dev, ino) != self.request.executables[path]:
                raise Blocked("executable_changed")
            environment = self.backend.environment(pid)
            if len(environment) > MAX_ENV:
                raise Blocked("environment_limit")
            tokens = [item[len(OWNER_KEY):] for item in environment.split(b"\0")
                      if item.startswith(OWNER_KEY)]
            if tokens != [self.request.token] or not environment.endswith(b"\0"):
                raise Blocked("owner_token_mismatch")
            if observe:
                # Even a natural exit later in this pass makes it nonempty.
                self.scan_saw_owned = True
            second_start, second_state = self.backend.proc_stat(pid)
            if second_start != start:
                raise Blocked("identity_changed")
            if second_state in TERMINAL:
                if self.gone_or_terminal(pid, start):
                    return None
                raise Blocked("identity_unreadable")
            if self.backend.uid_of(pid) != self.backend.uid or self.backend.exe(pid) != path:
                raise Blocked("identity_changed")
            if self.backend.exe_stat(pid) != (dev, ino):
                raise Blocked("identity_changed")
            return Identity(pid, start, path, dev, ino)
        except (FileNotFoundError, ProcessLookupError):
            if self.gone_or_terminal(pid):
                return None
            raise Blocked("identity_unreadable") from None
        except PermissionError:
            if self.gone_or_terminal(pid):
                return None
            raise Blocked("identity_unreadable") from None

    def scan(self):
        self.budget()
        self.scan_saw_owned = False
        self.backend.layout(self.request)
        same_uid = 0
        entries = self.backend.entries()
        if len(entries) > MAX_ENTRIES:
            raise Blocked("proc_limit")
        for pid in entries:
            self.budget()
            try:
                uid = self.backend.uid_of(pid)
            except (FileNotFoundError, ProcessLookupError):
                if self.backend.absent(pid):
                    continue
                raise Blocked("identity_changed") from None
            except PermissionError:
                raise Blocked("identity_unreadable") from None
            if uid != self.backend.uid:
                continue
            same_uid += 1
            self.scanned += 1
            if same_uid > MAX_SAME_UID:
                raise Blocked("same_uid_limit")
            identity = self.identity(pid, observe=True)
            if identity is None:
                continue
            key = (identity.pid, identity.start)
            existing = self.handles.get(key)
            if existing is not None:
                if self.settled(existing):
                    # Natural exit between the snapshot and poll is safe; a still
                    # live numeric identity beside a ready old pidfd is not.
                    if self.gone_or_terminal(pid, identity.start):
                        continue
                    raise Blocked("identity_changed")
                if existing.identity != identity:
                    raise Blocked("identity_changed")
                continue
            if len(self.handles) >= MAX_OWNED:
                raise Blocked("owned_limit")
            try:
                fd = self.backend.open_pidfd(pid)
            except ProcessLookupError:
                if self.gone_or_terminal(pid, identity.start):
                    continue
                raise Blocked("identity_changed") from None
            handle = Handle(identity, fd)
            self.handles[key] = handle
            # Open pidfd BEFORE the second complete PID/start/exe/token check.
            if self.settled(handle):
                continue
            second = self.identity(pid)
            if self.settled(handle):
                continue
            if second != identity:
                raise Blocked("identity_changed")
        self.budget()
        return self.scan_saw_owned

    def checked_signal(self, handle, signum):
        self.budget()
        if self.settled(handle):
            return False
        self.backend.layout(self.request)
        identity = self.identity(handle.identity.pid)
        if self.settled(handle):
            return False
        if identity != handle.identity:
            raise Blocked("identity_changed")
        self.budget()
        try:
            self.backend.send(handle.fd, signum)
        except ProcessLookupError:
            if self.settled(handle):
                return False
            raise Blocked("signal_failed") from None
        except (PermissionError, OSError):
            raise Blocked("signal_failed") from None
        return True

    def result(self, ok, reason):
        # Fixed, non-identifying fields only. 'owned' means unsettled observed fds.
        return {"schemaVersion": 1, "ok": ok, "reason": reason,
                "scanned": self.scanned,
                "owned": sum(not h.settled for h in self.handles.values()),
                "signaledTerm": self.signaled_term, "signaledKill": self.signaled_kill,
                "settled": sum(h.settled for h in self.handles.values()),
                "emptyScans": self.empty_scans}

    def run(self):
        last_empty = None
        try:
            self.backend.capable()
            while True:
                # Entire scan must succeed BEFORE signalling anything.
                saw_owned = self.scan()
                alive = [h for h in self.handles.values() if not self.settled(h)]
                if alive:
                    self.empty_scans = 0
                    last_empty = None
                    if self.request.action == "verify-empty":
                        return self.result(False, "owned_present")
                    for handle in alive:
                        self.budget()
                        now = self.backend.now()
                        if handle.term_at is None:
                            if self.checked_signal(handle, signal.SIGTERM):
                                self.signaled_term += 1
                                handle.term_at = self.backend.now()
                        elif not handle.killed and now - handle.term_at >= TERM_GRACE_SECONDS:
                            if self.checked_signal(handle, signal.SIGKILL):
                                self.signaled_kill += 1
                                handle.killed = True
                elif saw_owned:
                    # A scan which observed ownership and then natural exit is
                    # not one of the two subsequent wholly empty scans.
                    self.empty_scans = 0
                    last_empty = None
                else:
                    now = self.backend.now()
                    if last_empty is None or now - last_empty >= EMPTY_SPACING_SECONDS:
                        self.empty_scans += 1
                        last_empty = now
                    if self.empty_scans >= 2:
                        self.backend.layout(self.request)
                        self.budget()
                        return self.result(True, "quiescent")
                self.budget()
                self.backend.sleep(min(0.025, self.deadline - self.backend.now()))
        except Blocked as error:
            return self.result(False, error.reason)
        except (OSError, ValueError, RuntimeError):
            return self.result(False, "identity_unreadable")
        finally:
            for handle in self.handles.values():
                try:
                    self.backend.close(handle.fd)
                except OSError:
                    pass


def _minimal_result(reason):
    return {"schemaVersion": 1, "ok": False, "reason": reason, "scanned": 0,
            "owned": 0, "signaledTerm": 0, "signaledKill": 0, "settled": 0,
            "emptyScans": 0}


def main():
    result = _minimal_result("internal_error")
    try:
        if sys.platform != "linux":
            raise Blocked("unsupported_platform")
        def timeout(_signum, _frame):
            raise Blocked("deadline")
        signal.signal(signal.SIGALRM, timeout)
        # Also bounds stalled stdin and a blocking proc read. It is never sent to
        # another process. Cooperative checks enforce the same fixed run budget.
        signal.setitimer(signal.ITIMER_REAL, DEADLINE_SECONDS)
        if len(sys.argv) != 1:
            raise Blocked("invalid_request")
        request = parse_request(sys.stdin.buffer.read(MAX_REQUEST + 1))
        result = Cleaner(request).run()
    except Blocked as error:
        result = _minimal_result(error.reason)
    except BaseException:
        # Includes KeyboardInterrupt: exception details must never reach stderr.
        result = _minimal_result("internal_error")
    finally:
        if sys.platform == "linux":
            signal.setitimer(signal.ITIMER_REAL, 0)
    encoded = json.dumps(result, separators=(",", ":")) + "\n"
    # No exception text, paths, PIDs, token, environment or argv is emitted.
    if len(encoded.encode("utf-8")) > 4096:
        encoded = json.dumps(_minimal_result("internal_error")) + "\n"
    try:
        # Unbuffered, bounded output avoids shutdown tracebacks on a closed pipe.
        data = encoded.encode("utf-8")
        if os.write(sys.stdout.fileno(), data) != len(data):
            return 2
    except (OSError, ValueError):
        return 2
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
