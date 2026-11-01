"""Offline mocks and real *copied /bin/sleep only* process ownership fixtures."""

import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


HELPER = Path(__file__).resolve().parents[2] / "scripts/electron-runtime-ab-process.py"
SPEC = importlib.util.spec_from_file_location("runtime_ab_process", HELPER)
helper = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = helper
SPEC.loader.exec_module(helper)


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="runtime-ab-process-tests-")
        self.base = Path(self.temporary.name)
        self.run = self.base / ("runtime-ab-" + secrets.token_hex(16))
        self.run.mkdir(mode=0o700)
        self.leg = self.run / "A"
        self.leg.mkdir(mode=0o700)
        self.runtime = self.leg / "desktop-out/linux-unpacked"
        self.runtime.mkdir(parents=True, mode=0o700)
        (self.leg / "desktop-out").chmod(0o700)
        for name in helper.NAMES:
            path = self.runtime / name
            path.write_bytes(b"offline mock; never executed\n")
            path.chmod(0o700)
        self.token = secrets.token_hex(32)
        self.payload = self.payload_for()
        self.request = helper.parse_request(json.dumps(self.payload).encode())

    def tearDown(self):
        self.temporary.cleanup()

    def payload_for(self, action="cleanup"):
        return {"action": action, "privateRoot": str(self.leg), "runtimeRoot": str(self.runtime),
                "token": self.token, "executables": {
                    name: {"dev": str((self.runtime / name).stat().st_dev),
                           "ino": str((self.runtime / name).stat().st_ino)}
                    for name in helper.NAMES}}

    def fake(self, action="cleanup"):
        request = helper.parse_request(json.dumps(self.payload_for(action)).encode())
        backend = FakeProc(request)
        return request, backend

    def run_fake(self, request, backend):
        result = helper.Cleaner(request, backend).run()
        self.assertEqual(set(result), {"schemaVersion", "ok", "reason", "scanned", "owned",
                                      "signaledTerm", "signaledKill", "settled", "emptyScans"})
        self.assertLessEqual(len(json.dumps(result).encode()), 4096)
        self.assertEqual(set(backend.fds), set(backend.closed))
        return result


class FakeProc:
    def __init__(self, request):
        self.request = request
        self.uid = os.getuid()
        self.procs = {}
        self.fds = {}
        self.closed = []
        self.signals = []
        self.env_reads = []
        self.elapsed = 0.0
        self.hooks = {}
        self.capability_error = None
        self.no_exit_proof = False
        self.scan_count = 0

    def add(self, pid=101, name="motobound", path=None, token=None, **changes):
        executable = path if path is not None else self.request.runtime_root + "/" + name
        dev, ino = self.request.executables.get(executable, (1, 2))
        self.procs[pid] = {"start": 100, "state": "S", "path": executable,
                           "dev": dev, "ino": ino, "uid": self.uid,
                           "env": helper.OWNER_KEY + (self.request.token if token is None else token) + b"\0",
                           "ignore_term": False, "ignore_kill": False, **changes}

    def hook(self, name, pid=None):
        callback = self.hooks.get(name)
        if callback:
            callback(self, pid)

    def get(self, pid):
        if pid not in self.procs:
            raise FileNotFoundError()
        return self.procs[pid]

    def capable(self):
        if self.capability_error:
            raise helper.Blocked(self.capability_error)

    def layout(self, request):
        self.hook("layout")
        helper.validate_layout(request, self.uid)

    def entries(self):
        self.scan_count += 1
        self.hook("entries")
        return sorted(self.procs)

    def uid_of(self, pid):
        self.hook("uid", pid)
        return self.get(pid)["uid"]

    def absent(self, pid):
        return pid not in self.procs

    def proc_stat(self, pid):
        self.hook("stat", pid)
        item = self.get(pid)
        return item["start"], item["state"]

    def exe(self, pid):
        self.hook("exe", pid)
        return self.get(pid)["path"]

    def exe_stat(self, pid):
        self.hook("exe_stat", pid)
        item = self.get(pid)
        return item["dev"], item["ino"]

    def environment(self, pid):
        self.env_reads.append(pid)
        self.hook("env", pid)
        return self.get(pid)["env"]

    def open_pidfd(self, pid):
        self.hook("before_open", pid)
        if pid not in self.procs:
            raise ProcessLookupError()
        fd = len(self.fds) + 10
        self.fds[fd] = (pid, self.procs[pid]["start"])
        self.hook("after_open", pid)
        return fd

    def exited(self, fd):
        self.hook("poll", fd)
        if self.no_exit_proof:
            return False
        pid, start = self.fds[fd]
        item = self.procs.get(pid)
        return item is None or item["start"] != start or item["state"] in helper.TERMINAL

    def send(self, fd, signum):
        self.hook("send", fd)
        self.signals.append((fd, signum, self.elapsed))
        pid, start = self.fds[fd]
        item = self.get(pid)
        assert item["start"] == start
        if signum == signal.SIGTERM and not item["ignore_term"]:
            item["state"] = "Z"
        if signum == signal.SIGKILL and not item["ignore_kill"]:
            item["state"] = "Z"

    def close(self, fd):
        self.closed.append(fd)

    def now(self):
        return self.elapsed

    def sleep(self, seconds):
        assert 0 <= seconds <= 0.05
        self.elapsed += seconds


class RequestAndLayout(Fixture):
    def test_valid_layout_and_decimal_inode_strings(self):
        helper.validate_layout(self.request, os.getuid())
        self.assertEqual(set(self.request.executables), {
            str(self.runtime / name) for name in helper.NAMES})

    def test_malformed_and_expanded_authority_requests(self):
        invalid = [b"", b"null", b"[]", b"x" * (helper.MAX_REQUEST + 1),
                   b'{"action":"cleanup","action":"verify-empty"}',
                   b'{"value":NaN}', b"\xff"]
        mutations = [
            lambda p: p.update(action="kill"),
            lambda p: p.update(token="A" * 64),
            lambda p: p.update(privateRoot=str(self.leg) + "/.."),
            lambda p: p.update(privateRoot="relative/runtime-ab-" + "a" * 32 + "/A"),
            lambda p: p.update(runtimeRoot=str(self.runtime) + "-neighbor"),
            lambda p: p.update(timeout=5000),
            lambda p: p.update(procRoot="/tmp/proc"),
            lambda p: p.update(signal=9),
            lambda p: p["executables"].update(other={"dev": "1", "ino": "2"}),
            lambda p: p["executables"]["motobound"].update(dev=1),
            lambda p: p["executables"]["motobound"].update(ino="0"),
            lambda p: p["executables"]["motobound"].update(dev=str(2**64)),
            lambda p: p.pop("token"),
        ]
        for mutation in mutations:
            payload = copy.deepcopy(self.payload)
            mutation(payload)
            invalid.append(json.dumps(payload).encode())
        for data in invalid:
            with self.subTest(length=len(data)):
                with self.assertRaises(helper.Blocked) as raised:
                    helper.parse_request(data)
                self.assertEqual(raised.exception.reason, "invalid_request")

    def test_symlink_file_rejected(self):
        path = self.runtime / "motobound"
        path.unlink()
        path.symlink_to(self.runtime / "chrome_crashpad_handler")
        with self.assertRaises(helper.Blocked) as raised:
            helper.validate_layout(self.request, os.getuid())
        self.assertEqual(raised.exception.reason, "unsafe_layout")

    def test_symlink_ancestor_rejected(self):
        old = self.leg / "desktop-out"
        moved = self.leg / "moved"
        old.rename(moved)
        old.symlink_to(moved, target_is_directory=True)
        with self.assertRaises(helper.Blocked):
            helper.validate_layout(self.request, os.getuid())

    def test_layout_permissions_uid_and_changed_inode_rejected(self):
        self.run.chmod(0o755)
        with self.assertRaises(helper.Blocked):
            helper.validate_layout(self.request, os.getuid())
        self.run.chmod(0o700)
        with self.assertRaises(helper.Blocked):
            helper.validate_layout(self.request, os.getuid() + 1)
        path = self.runtime / "motobound"
        replacement = self.runtime / "replacement"
        replacement.write_bytes(b"replacement")
        replacement.chmod(0o700)
        replacement.replace(path)
        with self.assertRaises(helper.Blocked) as raised:
            helper.validate_layout(self.request, os.getuid())
        self.assertEqual(raised.exception.reason, "executable_changed")

    def test_stat_parser_limits_and_parenthesized_comm(self):
        tail = b"S " + b"0 " * 18 + b"123 0 0\n"
        self.assertEqual(helper.parse_stat(b"101 (a ) b\n c) " + tail, 101), (123, "S"))
        for data in (b"bad", b"102 (x) " + tail, b"101 (x) S", b"x" * 4097):
            with self.assertRaises(helper.Blocked):
                helper.parse_stat(data, 101)

    def test_no_root_or_missing_pidfd_fallback(self):
        with patch.object(helper.os, "getuid", return_value=0):
            with self.assertRaises(helper.Blocked) as raised:
                helper.LinuxProc().capable()
            self.assertEqual(raised.exception.reason, "nonroot_uid_required")
        with patch.object(helper.os, "pidfd_open", None):
            with self.assertRaises(helper.Blocked) as raised:
                helper.LinuxProc().capable()
            self.assertEqual(raised.exception.reason, "missing_pidfd")

    def test_proc_short_reads_are_completed_and_oversize_tail_is_rejected(self):
        class ShortReads(io.BytesIO):
            def read(self, size=-1):
                # The first short read is a complete, valid-looking owner token;
                # a later duplicate must not be hidden by accepting that prefix.
                return super().read(min(size, len(first)))
        first = helper.OWNER_KEY + self.request.token + b"\0"
        complete = first + helper.OWNER_KEY + b"f" * 64 + b"\0"
        with patch("builtins.open", return_value=ShortReads(complete)):
            self.assertEqual(helper.LinuxProc().environment(101), complete)
        with patch("builtins.open", return_value=ShortReads(b"x" * (helper.MAX_ENV + 1))):
            with self.assertRaises(helper.Blocked) as raised:
                helper.LinuxProc().environment(101)
            self.assertEqual(raised.exception.reason, "environment_limit")
        with patch("builtins.open", return_value=ShortReads(b"x" * (helper.MAX_STAT + 1))):
            with self.assertRaises(helper.Blocked) as raised:
                helper.LinuxProc().proc_stat(101)
            self.assertEqual(raised.exception.reason, "stat_limit")

    def test_proc_visibility_requires_unfiltered_aligned_pid_namespace(self):
        good = b"31 20 0:29 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw\n"
        status = b"Name:\tpython\nNSpid:\t101\n"
        fdinfo = b"pos:\t0\nflags:\t02300000\nmnt_id:\t31\n"
        helper.validate_proc_visibility(good, status, "101", 101, fdinfo, (0, 29))
        helper.validate_proc_visibility(good.replace(b"proc rw\n", b"proc rw,hidepid=0\n"),
                                        status, "101", 101, fdinfo, (0, 29))
        # Resolve a stacked mount via the retained directory fd, not list order.
        stacked = good + good.replace(b"31 20", b"32 31")
        helper.validate_proc_visibility(stacked, status, "101", 101, fdinfo, (0, 29))
        helper.validate_proc_visibility(stacked, status, "101", 101,
                                        fdinfo.replace(b"31", b"32"), (0, 29))
        invalid = [
            good.replace(b"proc rw\n", b"proc rw,hidepid=1\n"),
            good.replace(b"proc rw\n", b"proc rw,hidepid=2\n"),
            good.replace(b"proc rw\n", b"proc rw,hidepid=ptraceable\n"),
            good.replace(b"proc rw\n", b"proc rw,hidepid=0,hidepid=0\n"),
            good + b"32 31 0:30 / /proc/101 rw - tmpfs tmpfs rw\n",
            good + b"32 31 0:30 / /proc/101/exe rw - tmpfs tmpfs rw\n",
            good + good,
            good.replace(b" /proc ", b" /elsewhere "),
            good.replace(b"- proc ", b"- tmpfs "),
            b"malformed\n",
            b"x" * (helper.MAX_MOUNTINFO + 1),
        ]
        for mountinfo in invalid:
            with self.assertRaises(helper.Blocked) as raised:
                helper.validate_proc_visibility(mountinfo, status, "101", 101, fdinfo, (0, 29))
            self.assertEqual(raised.exception.reason, "proc_visibility")
        for status, link in ((b"Name: python\n", "101"),
                             (b"NSpid: 999 101\n", "999"),
                             (b"NSpid: 101\n", "999"),
                             (b"NSpid: 101\nNSpid: 101\n", "101")):
            with self.assertRaises(helper.Blocked):
                helper.validate_proc_visibility(good, status, link, 101, fdinfo, (0, 29))
        for descriptor_info, device in ((b"mnt_id: 99\n", (0, 29)),
                                        (b"mnt_id: 31\nmnt_id: 31\n", (0, 29)),
                                        (b"mnt_id: invalid\n", (0, 29)),
                                        (fdinfo, (0, 30)),
                                        (b"x" * (helper.MAX_STAT + 1), (0, 29))):
            with self.assertRaises(helper.Blocked):
                helper.validate_proc_visibility(good, b"NSpid: 101\n", "101", 101,
                                                descriptor_info, device)


class MockedProcesses(Fixture):
    def test_empty_requires_two_scans_separated_by_50ms(self):
        request, backend = self.fake("verify-empty")
        result = self.run_fake(request, backend)
        self.assertTrue(result["ok"])
        self.assertEqual(result["emptyScans"], 2)
        self.assertGreaterEqual(backend.elapsed, 0.05)
        self.assertEqual(backend.signals, [])

    def test_visibility_uncertainty_before_success_still_blocks(self):
        request, backend = self.fake("verify-empty")
        checks = 0
        def lose_visibility(_current, _pid):
            nonlocal checks
            checks += 1
            if checks == 4:
                raise helper.Blocked("proc_visibility")
        backend.hooks["layout"] = lose_visibility
        result = self.run_fake(request, backend)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "proc_visibility")
        self.assertEqual(backend.signals, [])

    def test_verify_empty_never_signals_owned_process(self):
        request, backend = self.fake("verify-empty")
        backend.add()
        result = self.run_fake(request, backend)
        self.assertEqual(result["reason"], "owned_present")
        self.assertEqual(result["owned"], 1)
        self.assertEqual(backend.signals, [])

    def test_term_closure_requires_ready_descriptors_and_empty_scans(self):
        request, backend = self.fake()
        backend.add()
        backend.add(102, name="chrome_crashpad_handler")
        result = self.run_fake(request, backend)
        self.assertTrue(result["ok"])
        self.assertEqual((result["signaledTerm"], result["signaledKill"], result["settled"],
                          result["owned"], result["emptyScans"]), (2, 0, 2, 0, 2))

    def test_unrelated_same_uid_and_neighbor_prefix_never_have_env_read(self):
        request, backend = self.fake()
        backend.add(101, path="/usr/bin/sleep")
        backend.add(102, path=request.runtime_root + "-neighbor/motobound")
        backend.add(103, path=request.runtime_root + "/motobound-other")
        backend.add(104, uid=backend.uid + 1)
        result = self.run_fake(request, backend)
        self.assertTrue(result["ok"])
        self.assertEqual(backend.env_reads, [])
        self.assertEqual(backend.signals, [])

    def test_wrong_token_blocks_before_any_signal_in_full_scan(self):
        request, backend = self.fake()
        backend.add(101)
        backend.add(102, token=b"f" * 64)
        result = self.run_fake(request, backend)
        self.assertEqual(result["reason"], "owner_token_mismatch")
        self.assertEqual(backend.signals, [])

    def test_missing_duplicate_and_oversized_environment_fail_closed(self):
        for raw, expected in ((b"OTHER=1\0", "owner_token_mismatch"),
                              (helper.OWNER_KEY + self.request.token + b"\0" +
                               helper.OWNER_KEY + self.request.token + b"\0", "owner_token_mismatch"),
                              (b"x" * (helper.MAX_ENV + 1), "environment_limit")):
            request, backend = self.fake()
            backend.add(env=raw)
            result = self.run_fake(request, backend)
            self.assertEqual(result["reason"], expected)
            self.assertEqual(backend.signals, [])

    def test_inode_mismatch_prevents_environment_read(self):
        request, backend = self.fake()
        backend.add(ino=999999)
        result = self.run_fake(request, backend)
        self.assertEqual(result["reason"], "executable_changed")
        self.assertEqual(backend.env_reads, [])

    def test_unreadable_same_uid_live_exe_or_owned_environment_blocks(self):
        for name in ("exe", "env"):
            request, backend = self.fake()
            backend.add()
            def deny(_backend, _pid):
                raise PermissionError()
            backend.hooks[name] = deny
            result = self.run_fake(request, backend)
            self.assertEqual(result["reason"], "identity_unreadable")
            self.assertEqual(backend.signals, [])

    def test_pid_reuse_between_observation_and_pidfd_open_blocks(self):
        request, backend = self.fake()
        backend.add()
        def reuse(current, pid):
            current.procs[pid]["start"] += 1
            current.hooks.pop("before_open")
        backend.hooks["before_open"] = reuse
        result = self.run_fake(request, backend)
        self.assertEqual(result["reason"], "identity_changed")
        self.assertEqual(backend.signals, [])

    def test_executable_and_token_change_after_pidfd_open_block(self):
        for field, replacement, expected in (
            ("path", "/usr/bin/sleep", "identity_changed"),
            ("env", helper.OWNER_KEY + b"f" * 64 + b"\0", "owner_token_mismatch"),
        ):
            request, backend = self.fake()
            backend.add()
            backend.hooks["after_open"] = lambda current, pid: current.procs[pid].update({field: replacement})
            result = self.run_fake(request, backend)
            self.assertEqual(result["reason"], expected)
            self.assertEqual(backend.signals, [])

    def test_natural_exit_before_or_after_pidfd_open_does_not_signal(self):
        for timing in ("before_open", "after_open"):
            request, backend = self.fake()
            backend.add()
            backend.hooks[timing] = lambda current, pid: current.procs.pop(pid, None)
            result = self.run_fake(request, backend)
            self.assertTrue(result["ok"])
            self.assertEqual(backend.signals, [])
            self.assertGreaterEqual(backend.scan_count, 4)
            self.assertGreaterEqual(backend.elapsed, 0.075)
            self.assertEqual(result["emptyScans"], 2)

    def test_exit_during_first_owned_identity_still_needs_two_later_empty_scans(self):
        request, backend = self.fake()
        backend.add()
        reads = 0
        def exit_during_identity(current, pid):
            nonlocal reads
            reads += 1
            if reads == 2:
                current.procs[pid]["state"] = "Z"
        backend.hooks["stat"] = exit_during_identity
        result = self.run_fake(request, backend)
        self.assertTrue(result["ok"])
        self.assertEqual(backend.signals, [])
        self.assertGreaterEqual(backend.scan_count, 4)
        self.assertGreaterEqual(backend.elapsed, 0.075)
        self.assertEqual(result["emptyScans"], 2)

    def test_stat_start_time_changes_during_identity_read_block(self):
        request, backend = self.fake()
        backend.add()
        backend.hooks["env"] = lambda current, pid: current.procs[pid].update(start=101)
        result = self.run_fake(request, backend)
        self.assertEqual(result["reason"], "identity_changed")
        self.assertEqual(backend.signals, [])

    def test_zombie_needs_pidfd_exit_proof_not_just_leader_state(self):
        for ready in (False, True):
            request, backend = self.fake()
            backend.add(state="Z")
            backend.no_exit_proof = not ready
            result = self.run_fake(request, backend)
            self.assertEqual(result["ok"], ready)
            self.assertEqual(backend.env_reads, [])
            self.assertEqual(backend.signals, [])

    def test_missing_pidfd_and_permission_fail_closed(self):
        request, backend = self.fake()
        backend.capability_error = "missing_pidfd"
        self.assertEqual(self.run_fake(request, backend)["reason"], "missing_pidfd")
        request, backend = self.fake()
        backend.add()
        def deny(_current, _pid):
            raise helper.Blocked("pidfd_permission")
        backend.hooks["before_open"] = deny
        self.assertEqual(self.run_fake(request, backend)["reason"], "pidfd_permission")
        self.assertEqual(backend.signals, [])

    def test_signal_permission_failure_is_not_closure(self):
        request, backend = self.fake()
        backend.add()
        def deny(_current, _fd):
            raise PermissionError()
        backend.hooks["send"] = deny
        result = self.run_fake(request, backend)
        self.assertEqual(result["reason"], "signal_failed")
        self.assertEqual((result["owned"], result["settled"]), (1, 0))

    def test_signal_esrch_without_pidfd_exit_proof_is_not_closure(self):
        request, backend = self.fake()
        backend.add()
        def disappeared(_current, _fd):
            raise ProcessLookupError()
        backend.hooks["send"] = disappeared
        result = self.run_fake(request, backend)
        self.assertEqual(result["reason"], "signal_failed")
        self.assertEqual((result["owned"], result["settled"]), (1, 0))

    def test_executable_change_before_signal_is_rechecked(self):
        request, backend = self.fake()
        backend.add()
        calls = 0
        def change_before_signal(current, _pid):
            nonlocal calls
            calls += 1
            if calls == 2:
                current.procs[101]["path"] = "/usr/bin/sleep"
        backend.hooks["layout"] = change_before_signal
        result = self.run_fake(request, backend)
        self.assertEqual(result["reason"], "identity_changed")
        self.assertEqual(backend.signals, [])

    def test_pidfd_poll_failure_does_not_count_as_settled(self):
        request, backend = self.fake()
        backend.add()
        def unavailable(_current, _fd):
            raise helper.Blocked("pidfd_error")
        backend.hooks["poll"] = unavailable
        result = self.run_fake(request, backend)
        self.assertEqual(result["reason"], "pidfd_error")
        self.assertEqual((result["owned"], result["settled"]), (1, 0))
        self.assertEqual(backend.signals, [])

    def test_term_ignored_kill_waits_at_least_500ms(self):
        request, backend = self.fake()
        backend.add(ignore_term=True)
        result = self.run_fake(request, backend)
        self.assertTrue(result["ok"])
        self.assertEqual((result["signaledTerm"], result["signaledKill"]), (1, 1))
        self.assertGreaterEqual(backend.signals[1][2] - backend.signals[0][2], 0.5)

    def test_token_change_after_term_blocks_kill_and_never_claims_closure(self):
        request, backend = self.fake()
        backend.add(ignore_term=True)
        def change_token(current, _pid):
            if current.scan_count == 2:
                current.procs[101]["env"] = helper.OWNER_KEY + b"f" * 64 + b"\0"
        backend.hooks["entries"] = change_token
        result = self.run_fake(request, backend)
        self.assertEqual(result["reason"], "owner_token_mismatch")
        self.assertEqual((result["signaledTerm"], result["signaledKill"], result["owned"]), (1, 0, 1))

    def test_reused_pid_after_term_does_not_signal_unrelated_replacement(self):
        request, backend = self.fake()
        backend.add(ignore_term=True)
        def reuse_after_term(current, _pid):
            if current.scan_count == 2:
                current.procs[101].update(start=200, path="/usr/bin/sleep", dev=1, ino=2)
        backend.hooks["entries"] = reuse_after_term
        result = self.run_fake(request, backend)
        self.assertTrue(result["ok"])
        self.assertEqual((result["signaledTerm"], result["signaledKill"], result["settled"]), (1, 0, 1))
        self.assertEqual(backend.procs[101]["state"], "S")

    def test_deleted_private_exe_blocks_but_unrelated_deleted_exe_is_ignored(self):
        for private in (False, True):
            request, backend = self.fake()
            path = (request.runtime_root + "/motobound" if private else "/tmp/unrelated") + " (deleted)"
            backend.add(path=path)
            result = self.run_fake(request, backend)
            self.assertEqual(result["ok"], not private)
            self.assertEqual(backend.env_reads, [])
            self.assertEqual(backend.signals, [])
            if private:
                self.assertEqual(result["reason"], "executable_changed")

    def test_signals_and_kill_attempts_do_not_imply_closure_at_deadline(self):
        request, backend = self.fake()
        backend.add(ignore_term=True, ignore_kill=True)
        result = self.run_fake(request, backend)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "deadline")
        self.assertEqual((result["owned"], result["settled"], result["emptyScans"]), (1, 0, 0))
        self.assertEqual(backend.elapsed, 5.0)

    def test_new_owned_process_between_empty_scans_is_not_missed(self):
        request, backend = self.fake("verify-empty")
        def appear(current, _pid):
            if current.scan_count == 2:
                current.add()
        backend.hooks["entries"] = appear
        result = self.run_fake(request, backend)
        self.assertEqual(result["reason"], "owned_present")
        self.assertEqual(result["emptyScans"], 0)
        self.assertEqual(backend.signals, [])

    def test_owned_same_uid_and_proc_bounds(self):
        for total, owned, expected in ((65, True, "owned_limit"),
                                       (1025, False, "same_uid_limit"),
                                       (4097, False, "proc_limit")):
            request, backend = self.fake()
            for pid in range(1, total + 1):
                backend.add(pid, path=None if owned else "/usr/bin/sleep")
            result = self.run_fake(request, backend)
            self.assertEqual(result["reason"], expected)
            self.assertEqual(backend.signals, [])

    def test_layout_is_revalidated_before_signalling(self):
        request, backend = self.fake()
        backend.add()
        calls = 0
        def change_layout(_current, _pid):
            nonlocal calls
            calls += 1
            if calls == 2:
                self.leg.chmod(0o777)
        backend.hooks["layout"] = change_layout
        result = self.run_fake(request, backend)
        self.assertEqual(result["reason"], "unsafe_layout")
        self.assertEqual(backend.signals, [])
        self.leg.chmod(0o700)


class BenignProcesses(Fixture):
    """Only /bin/sleep copies are launched. No Electron/browser/native app runs."""

    def setUp(self):
        super().setUp()
        self.children = []
        for name in helper.NAMES:
            shutil.copyfile("/bin/sleep", self.runtime / name)
            (self.runtime / name).chmod(0o700)

    def tearDown(self):
        for process, fd in self.children:
            try:
                if process.poll() is None:
                    signal.pidfd_send_signal(fd, signal.SIGTERM, None, 0)
                try:
                    process.wait(timeout=0.25)
                except subprocess.TimeoutExpired:
                    signal.pidfd_send_signal(fd, signal.SIGKILL, None, 0)
                    process.wait(timeout=2)
            finally:
                os.close(fd)
        super().tearDown()

    def launch(self, path, token=None, ignore_term=False):
        environment = dict(os.environ)
        environment["MOTOBOUND_RUNTIME_AB_OWNER"] = self.token if token is None else token
        process = subprocess.Popen([str(path), "20"], stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   env=environment, start_new_session=True,
                                   preexec_fn=(lambda: signal.signal(signal.SIGTERM, signal.SIG_IGN))
                                   if ignore_term else None)
        fd = os.pidfd_open(process.pid, 0)
        self.children.append((process, fd))
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if os.readlink("/proc/" + str(process.pid) + "/exe") == str(path.resolve()):
                break
            time.sleep(0.01)
        self.assertEqual(os.getpgid(process.pid), process.pid)
        self.assertNotEqual(os.getpgid(process.pid), os.getpgrp())
        return process

    def invoke(self, action="cleanup", payload=None):
        value = self.payload_for(action) if payload is None else payload
        completed = subprocess.run([sys.executable, "-B", str(HELPER)],
                                   input=json.dumps(value).encode(), stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, timeout=7)
        self.assertEqual(completed.stderr, b"")
        self.assertLessEqual(len(completed.stdout), 4096)
        self.assertNotIn(self.token.encode(), completed.stdout)
        self.assertNotIn(str(self.leg).encode(), completed.stdout)
        result = json.loads(completed.stdout)
        self.assertEqual(completed.returncode, 0 if result["ok"] else 2)
        return result

    def test_detached_owned_children_close_unrelated_and_neighbor_survive(self):
        first = self.launch(self.runtime / "motobound")
        second = self.launch(self.runtime / "chrome_crashpad_handler")
        neighbor = Path(str(self.runtime) + "-neighbor")
        neighbor.mkdir(mode=0o700)
        shutil.copyfile("/bin/sleep", neighbor / "motobound")
        (neighbor / "motobound").chmod(0o700)
        outside = self.launch(Path("/bin/sleep"))
        neighboring = self.launch(neighbor / "motobound")
        before = self.invoke("verify-empty")
        self.assertEqual(before["reason"], "owned_present")
        self.assertEqual(before["signaledTerm"], 0)
        self.assertIsNone(first.poll())
        self.assertIsNone(second.poll())
        result = self.invoke()
        self.assertTrue(result["ok"], result["reason"])
        self.assertEqual((result["settled"], result["owned"], result["emptyScans"]), (2, 0, 2))
        first.wait(timeout=1)
        second.wait(timeout=1)
        self.assertIsNone(outside.poll())
        self.assertIsNone(neighboring.poll())

    def test_wrong_token_same_private_executable_blocks_and_preserves_both(self):
        owned = self.launch(self.runtime / "motobound")
        wrong = self.launch(self.runtime / "chrome_crashpad_handler", "f" * 64)
        result = self.invoke()
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "owner_token_mismatch")
        self.assertEqual(result["signaledTerm"], 0)
        self.assertIsNone(owned.poll())
        self.assertIsNone(wrong.poll())

    def test_public_cli_rejects_extra_authority_and_keeps_output_nonidentifying(self):
        payload = self.payload_for()
        payload["procRoot"] = str(self.base)
        result = self.invoke(payload=payload)
        self.assertEqual(result["reason"], "invalid_request")

    def test_real_ignored_term_is_followed_by_delayed_pidfd_kill_and_exit_proof(self):
        process = self.launch(self.runtime / "motobound", ignore_term=True)
        started = time.monotonic()
        result = self.invoke()
        elapsed = time.monotonic() - started
        self.assertTrue(result["ok"], result["reason"])
        self.assertGreaterEqual(elapsed, 0.5)
        self.assertLess(elapsed, 5.0)
        self.assertEqual((result["signaledTerm"], result["signaledKill"], result["settled"]), (1, 1, 1))
        self.assertEqual(process.wait(timeout=1), -signal.SIGKILL)

    def test_public_cli_bounds_stalled_stdin_without_leaking_diagnostics(self):
        process = subprocess.Popen([sys.executable, "-B", str(HELPER)],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE)
        fd = os.pidfd_open(process.pid, 0)
        started = time.monotonic()
        try:
            process.stdin.write(b"{")
            process.stdin.flush()  # Deliberately leave the pipe open.
            self.assertEqual(process.wait(timeout=6), 2)
            elapsed = time.monotonic() - started
            self.assertGreaterEqual(elapsed, 4.9)
            self.assertLess(elapsed, 6)
            self.assertEqual(process.stderr.read(), b"")
            output = process.stdout.read()
            self.assertLessEqual(len(output), 4096)
            self.assertEqual(json.loads(output)["reason"], "deadline")
        finally:
            if process.poll() is None:
                signal.pidfd_send_signal(fd, signal.SIGKILL, None, 0)
                process.wait(timeout=1)
            os.close(fd)
            process.stdin.close()
            process.stdout.close()
            process.stderr.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
