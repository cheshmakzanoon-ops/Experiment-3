import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("runtime_archive", ROOT / "scripts/electron-runtime-ab-archive.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(extra=(), omit=(), compression=zipfile.ZIP_DEFLATED):
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", compression=compression) as archive:
        base = [("electron", b"not executed"), ("chrome_crashpad_handler", b"not executed"), ("version", b"45.2.1"), ("resources/default_app.asar", b"fixture")]
        for name, content in [*(item for item in base if item[0] not in omit), *extra]:
            if isinstance(name, zipfile.ZipInfo):
                info = name
            else:
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = ((stat.S_IFDIR | 0o755) if name.endswith("/") else (stat.S_IFREG | 0o755)) << 16
            archive.writestr(info, content, compress_type=compression)
    return result.getvalue()


def inspect(data, **overrides):
    # The production verifier deliberately rejects unlinked/hardlinked inputs.
    # NamedTemporaryFile supplies the same one-link regular-file precondition.
    with tempfile.NamedTemporaryFile() as handle:
        handle.write(data)
        handle.seek(0)
        return module.inspect_archive(handle, overrides.get("bytes", len(data)), overrides.get("sha", hashlib.sha256(data).hexdigest()))


class ArchiveTests(unittest.TestCase):
    def test_tiny_regular_archive(self):
        archive, entries, total, _ = inspect(fixture())
        self.assertEqual(len(entries), 4)
        self.assertEqual(total, len(b"not executed") * 2 + len(b"45.2.1") + len(b"fixture"))
        archive.close()

    def test_wrong_size_and_digest(self):
        for change in ({"bytes": 1}, {"sha": "0" * 64}):
            with self.subTest(change=change), self.assertRaises(module.Rejected):
                inspect(fixture(), **change)

    def test_path_traversal_absolute_backslash_empty_and_control(self):
        for name in ("../escape", "/absolute", "a/../escape", "a//b", "a\\b", "./a", "a\nb", "a:" + "b", "x" * 241):
            with self.subTest(name=name), self.assertRaisesRegex(module.Rejected, "member-path"):
                inspect(fixture([(name, b"x")]))

    def test_duplicate_and_file_directory_collision(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            for extra in ([("version", b"other")], [("electron/", b"")], [("parent", b"file"), ("parent/child", b"x")]):
                with self.subTest(extra=extra), self.assertRaises(module.Rejected):
                    inspect(fixture(extra))

    def test_symlink_fifo_and_socket(self):
        for kind in (stat.S_IFLNK, stat.S_IFIFO, stat.S_IFSOCK):
            info = zipfile.ZipInfo("linked"); info.create_system = 3; info.external_attr = (kind | 0o777) << 16
            with self.subTest(kind=kind), self.assertRaisesRegex(module.Rejected, "member-type"):
                inspect(fixture([(info, b"/private/path")]))

    def test_unexpected_payload_or_missing_executable(self):
        for data in (fixture([("resources/app.asar", b"old")]), fixture([("motobound", b"old")]), fixture(omit=("electron",))):
            with self.assertRaises(module.Rejected): inspect(data)

    def test_member_size_and_version_bounds(self):
        before = module.MAX_FILE
        try:
            module.MAX_FILE = 5
            with self.assertRaises(module.Rejected): inspect(fixture())
        finally:
            module.MAX_FILE = before
        with self.assertRaisesRegex(module.Rejected, "archive-version"): inspect(fixture([("version", b"v" * 33)], omit=("version",)))

    def test_count_and_total_bounds(self):
        for key, value in (("MAX_MEMBERS", 3), ("MAX_OUTPUT", 2)):
            before = getattr(module, key)
            try:
                setattr(module, key, value)
                with self.assertRaises(module.Rejected): inspect(fixture())
            finally:
                setattr(module, key, before)

    def test_unsupported_compression_and_truncation(self):
        with self.assertRaisesRegex(module.Rejected, "member-encoding"): inspect(fixture(compression=zipfile.ZIP_BZIP2))
        with self.assertRaises(zipfile.BadZipFile): inspect(fixture()[:-30])

    def test_cli_has_no_pin_override_or_dynamic_failure_output(self):
        inputs = [b"{}", b"x" * 16385, b'{"leg":"A","leg":"B","archive":"/secret","destination":"/secret"}', b'{"leg":"A","archive":"/secret","destination":"/secret","sha256":"0"}']
        for value in inputs:
            result = subprocess.run([sys.executable, str(ROOT / "scripts/electron-runtime-ab-archive.py")], input=value, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
            self.assertNotEqual(result.returncode, 0)
            self.assertLessEqual(len(result.stdout), 4096)
            self.assertEqual(result.stderr, b"")
            self.assertNotIn(b"secret", result.stdout)
            self.assertFalse(json.loads(result.stdout)["ok"])

    def test_interrupt_and_broken_output_never_emit_exception_text(self):
        class Input:
            buffer = None
            def read(self, _limit):
                raise KeyboardInterrupt("private interrupted text")
        source = Input(); source.buffer = source
        emitted = []
        with patch.object(module.sys, "stdin", source), patch.object(module.os, "write", side_effect=lambda _fd, data: emitted.append(data) or len(data)):
            self.assertNotEqual(module.main(), 0)
        self.assertEqual(len(emitted), 1)
        self.assertNotIn(b"private", emitted[0])
        with patch.object(module.sys, "stdin", source), patch.object(module.os, "write", side_effect=BrokenPipeError("private")):
            self.assertEqual(module.main(), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
