#!/usr/bin/env python3
"""Read-only verification of the unmerged experiment's portable source identity.
Does not install dependencies, execute simulation, alter sources or qualify a release.
"""
import hashlib
import json
import pathlib
import sys

checkpoint = pathlib.Path(__file__).resolve().parent
source = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
manifest = json.loads((checkpoint / "verification.json").read_text())

def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def check_relative(path):
    value = pathlib.PurePosixPath(path)
    if value.is_absolute() or ".." in value.parts:
        raise ValueError("Non-relative manifest path")
    return source / path

assert digest(checkpoint / manifest["patch"]["file"]) == manifest["patch"]["sha256"], "Patch differs"
expected = manifest["runtimeSource"]["files"]
actual_paths = sorted(["package.json", "package-lock.json"] + [str(p.relative_to(source)).replace("\\", "/") for p in (source / "src").rglob("*") if p.is_file()])
assert actual_paths == sorted(expected), "Runtime source file set differs"
actual = {name: digest(check_relative(name)) for name in actual_paths}
assert actual == expected, "Runtime source bytes differ"
fingerprint = hashlib.sha256(json.dumps(actual, sort_keys=True).encode()).hexdigest()
assert fingerprint == manifest["runtimeSource"]["fingerprint"], "Runtime fingerprint differs"
for row in manifest["changedFiles"]:
    assert digest(check_relative(row["path"])) == row["candidateSha256"], "Changed file differs: " + row["path"]
for name, expected_hash in manifest["verificationInputFiles"].items():
    assert digest(check_relative(name)) == expected_hash, "Verification input differs: " + name
print(json.dumps({"verified": True, "runtimeInputs": len(actual), "changedFiles": len(manifest["changedFiles"]), "verificationInputs": len(manifest["verificationInputFiles"]), "fingerprint": fingerprint, "status": manifest["status"], "scope": "file identity only; no simulation or acceptance run"}, indent=2))
