#!/usr/bin/env python3
"""Offline fixed-distribution verifier/extractor. Never executes a binary.

Only publisher-pinned local ZIPs are accepted by the command interface. Tiny
synthetic unit ZIPs call inspect_archive directly; the CLI has no pin override.
The bounds are input/output limits, not RSS caps. No ownership/sandbox change,
setuid/setgid bit, archive-supplied path, or archive-supplied symlink is applied.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import stat
import sys
import zipfile

MAX_INPUT = 16384
MAX_MEMBERS = 4096
MAX_FILE = 256 * 1024 * 1024
MAX_OUTPUT = 512 * 1024 * 1024
ARCHIVE_SECONDS = 60
PINS = {
    "A": (123777540, "616efc1ae4784af1a4f3f0e8774e73e7030e7bd1708da9d09bcf543dfa499beb"),
    "B": (123103802, "2be868b71b0aa71f30e6b5567a106a35a049385e963183c074aad1975ead5167"),
}


class Rejected(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Rejected(reason)


def no_links(path):
    require(path.is_absolute() and os.path.normpath(str(path)) == str(path), "path")
    for parent in reversed([path, *path.parents]):
        require(not stat.S_ISLNK(parent.lstat().st_mode), "symlink")


def inspect_archive(handle, expected_bytes, expected_hash):
    before = os.fstat(handle.fileno())
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size == expected_bytes, "archive-size")
    digest = hashlib.sha256()
    total = 0
    while chunk := handle.read(65536):
        total += len(chunk)
        require(total <= expected_bytes, "archive-size")
        digest.update(chunk)
    require(total == expected_bytes and digest.hexdigest() == expected_hash, "archive-hash")
    handle.seek(0)
    archive = zipfile.ZipFile(handle)
    entries = archive.infolist()
    require(0 < len(entries) <= MAX_MEMBERS, "member-count")
    names = set()
    uncompressed = 0
    for entry in entries:
        name = entry.filename
        plain = name[:-1] if name.endswith("/") else name
        require(bool(plain) and len(name) <= 240 and re.fullmatch(r"[A-Za-z0-9_./+-]+", name) is not None, "member-path")
        require(not name.startswith("/") and "\\" not in name and all(part not in ("", ".", "..") for part in plain.split("/")), "member-path")
        require(str(PurePosixPath(plain)) == plain and plain not in names, "member-path")
        names.add(plain)
        mode = entry.external_attr >> 16
        kind = stat.S_IFMT(mode)
        require(kind in (0, stat.S_IFREG, stat.S_IFDIR), "member-type")
        require((kind != stat.S_IFDIR or entry.is_dir()) and (kind != stat.S_IFREG or not entry.is_dir()), "member-type")
        require(not entry.flag_bits & 1 and entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), "member-encoding")
        require(0 <= entry.file_size <= MAX_FILE and (not entry.is_dir() or entry.file_size == 0), "member-size")
        uncompressed += entry.file_size
        require(uncompressed <= MAX_OUTPUT, "output-size")
    directories = {entry.filename.rstrip("/") for entry in entries if entry.is_dir()}
    for name in names:
        for parent in PurePosixPath(name).parents:
            if str(parent) != "." and str(parent) in names:
                require(str(parent) in directories, "member-parent")
    required = {"electron", "chrome_crashpad_handler", "version", "resources/default_app.asar"}
    require(required <= names and "motobound" not in names and "resources/app.asar" not in names, "layout")
    require(archive.getinfo("version").file_size <= 32, "archive-version")
    after = os.fstat(handle.fileno())
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), "archive-mutated")
    return archive, entries, uncompressed, before


def extract_archive(archive_path, destination, leg):
    require(leg in PINS, "leg")
    require(re.fullmatch(r"/[^\n\r]+/runtime-ab-[0-9a-f]{32}/" + leg + r"/desktop-out/linux-unpacked", str(destination)) is not None, "owned-path")
    no_links(archive_path)
    no_links(destination.parent)
    uid = os.getuid()
    require(uid != 0, "root")
    run_root = destination.parents[2]
    leg_root = destination.parents[1]
    for path in (run_root, leg_root, destination.parent):
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == uid and stat.S_IMODE(info.st_mode) == 0o700, "private-root")
    fd = os.open(archive_path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as handle:
        archive, entries, total, before = inspect_archive(handle, *PINS[leg])
        # Exclusive fresh destination; no extraction over stale runtime files.
        destination.mkdir(mode=0o700)
        for entry in entries:
            name = "motobound" if entry.filename == "electron" else entry.filename
            path = destination.joinpath(*PurePosixPath(name).parts)
            if entry.is_dir():
                path.mkdir(mode=0o700, parents=True, exist_ok=True)
                continue
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            out_fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            emitted = 0
            with os.fdopen(out_fd, "wb") as output, archive.open(entry, "r") as source:
                while chunk := source.read(65536):
                    emitted += len(chunk)
                    require(emitted <= entry.file_size, "member-size")
                    output.write(chunk)
            require(emitted == entry.file_size, "member-size")
            # Only ordinary owner execute is retained. Never install a privileged
            # sandbox helper or modify the host to accommodate an incompatible one.
            os.chmod(path, 0o700 if entry.external_attr >> 16 & 0o111 else 0o600)
        version_fd = os.open(destination / "version", os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(version_fd, "rb") as version_file:
            require(version_file.read(33).strip() == (b"45.2.1" if leg == "A" else b"44.10.1"), "archive-version")
        for name in ("motobound", "chrome_crashpad_handler"):
            info = (destination / name).lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_mode & 0o100 and info.st_nlink == 1, "executable")
        after = os.fstat(handle.fileno())
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), "archive-mutated")
        return {"schemaVersion": 1, "ok": True, "reason": "verified", "files": len(entries), "bytes": total, "archiveBytes": PINS[leg][0], "archiveSha256": PINS[leg][1]}


def main():
    prior_alarm = None
    try:
        require(sys.platform == "linux", "platform")
        def timeout(_signum, _frame):
            raise Rejected("deadline")
        prior_alarm = signal.signal(signal.SIGALRM, timeout)
        signal.setitimer(signal.ITIMER_REAL, ARCHIVE_SECONDS)
        require(len(sys.argv) == 1, "schema")
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        require(len(raw) <= MAX_INPUT, "input-size")
        def unique(pairs):
            result = {}
            for key, item in pairs:
                require(key not in result, "schema")
                result[key] = item
            return result
        value = json.loads(raw, object_pairs_hook=unique)
        require(isinstance(value, dict) and set(value) == {"leg", "archive", "destination"}, "schema")
        require(all(isinstance(value[key], str) for key in value), "schema")
        result = extract_archive(Path(value["archive"]), Path(value["destination"]), value["leg"])
    except Rejected as error:
        result = {"schemaVersion": 1, "ok": False, "reason": str(error)}
    except BaseException:
        # No archive member names, local paths, tokens or arbitrary traceback.
        result = {"schemaVersion": 1, "ok": False, "reason": "archive-invalid"}
    finally:
        if prior_alarm is not None:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, prior_alarm)
    encoded = (json.dumps(result, separators=(",", ":")) + "\n").encode("utf8")
    try:
        if len(encoded) > 4096 or os.write(sys.stdout.fileno(), encoded) != len(encoded):
            return 2
    except (OSError, ValueError):
        return 2
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
