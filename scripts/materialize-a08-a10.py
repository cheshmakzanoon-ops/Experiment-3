#!/usr/bin/env python3
"""Materialize the checksum-sealed A08-A10 source and authored Blender exports."""
from __future__ import annotations

import hashlib
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = "f952d587fa9a3ccfae562611371bb18cea2987a4"
PACK = "8b393e9400995c7242b06e0e5bd97cf21ca77aacb2d4dbfe063da6917d4cf67c"
OBSERVER = "f67f01817bc07c4806b9f59720114fdb1b2123fc0e03db9c3a1f3897c47f7c8b"
N_PARTS = 7
BLENDER_VERSION = "5.2.2"
BLENDER_URL = "https://download.blender.org/release/Blender5.2/blender-5.2.2-linux-x64.tar.xz"
BLENDER_SHA256 = "84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168"
ASSETS = ("track-signal-hardware", "track-boards", "broadcast-cameras")
EXPECTED = {
  "3dmodels.md": "f5d5068ab39e78706c2fb9b4bf5826b81b2e1c96a922a98a8715fb35d614318d",
  "README.md": "1c4f12c4dbe5a1370ef8c3849d9f0b955fbb8ba9b505254e7f2a142a4aef0db3",
  "docs/DEVELOPMENT_STATUS.md": "ff06310a30175297729b548e59c318131e540a86ca8faecdc0c5df744de94cf5",
  "docs/START_FINISH_ENVIRONMENT.md": "bf5e9f69382f7362c3fee62dca1378e3cbfb2403155cffc530f9adc8ca6b6a07",
  "src/rendering/circuit.ts": "2561710b96b489835f86facc06f6a43774e52f61259fe4a42453dd9c616e7adb",
  "src/rendering/marshal-staff.ts": "107894cda95b5782e9aa25fd7e589e4c48fc84ee21d85ee581edecadf749d06c",
  "src/rendering/renderer.ts": "e4978feae5f042c312b6fdb64edea699179826d59c0a85a2552a61aea7ed65f9",
  "src/rendering/track-infrastructure.ts": "aed073605a6c16fc9e952b6cfba174b15d0f32d1ac8cf40876c51f1cbadb240c",
  "docs/TRACKSIDE_OPERATIONS_AUTHORING.json": "3108b74732f02a0c1c361abcd008738e2a016b22c07f1fe2a8fdee96bc85ba79",
  "docs/TRACKSIDE_OPERATIONS_KIT.md": "e1b1d3888ac8604363a6aea56e21b2d55c549cc89755120c763ddcbb0da1114d",
  "docs/TRACKSIDE_OPERATIONS_PROVENANCE.json": "8cfd7a78a4cf267067cfe1e2919d04447587b9c1aa5f17b06d27647a14a2eea1",
  "e2e/57-trackside-operations.spec.ts": "12d884ca3d1648dc8c3a3277bf2c5f5a034e0bbe7bbfe4cef380bd586dc37bd3",
  "e2e/fixtures/trackside-operations.ts": "93cd4c1731b954f8b12c59357e4ea99897998474e09afa2b11192e417a32cc33",
  "scripts/author-broadcast-cameras.py": "f4164ef30e2cec6c3c1b8d7d8aef2a9d4878231f820a3063715ab6c568a01800",
  "scripts/author-track-boards.py": "d78c142c26352d6f306ecce6337846023cd396e2f25b6e4635ac15aac0676661",
  "scripts/author-track-signal-hardware.py": "69f0d5f1ce2d07ecc90e47a78a82f59dbca4fc02276f1443836ca98ef3914d2a",
  "scripts/rebuild-trackside-operations.py": "f69c5b2eb36a704947e972269d77f5987d6a0a13f4f5cd037964f21b1fd339bc",
  "src/rendering/broadcast-camera-placement.ts": "4dd8c5670a34f266c57cbeea11b70866b73af4f04766ab04cce96ecede9cb24d",
  "src/rendering/broadcast-cameras.manifest.json": "e8343606d4718099a1b8b21c2517174d903d20b25104484d5bc149ca409600da",
  "src/rendering/broadcast-cameras.ts": "9fe1e9a8d275bb9a5e0e183849ef8cc72fc8da290b63b169e139f1f0a218a4f9",
  "src/rendering/recorded-signal-displays.ts": "f81f1a03e815ac9fd9cbe83e38e0d91a0595574b579676091a85e164717877c4",
  "src/rendering/track-board-plan.ts": "cb437c9444b3d644c8aa64312c644654d92a86943b803f35698dbce715b36e7c",
  "src/rendering/track-boards.manifest.json": "a5879007f08cb4a8239e41f46774aaa41d3ba5377735404e699259ffcc1ea2c5",
  "src/rendering/track-boards.ts": "0117fdfd6a475e70341d7320eb5b9540222da9b136bac7850f8642dfc9a98bab",
  "src/rendering/track-signal-hardware.manifest.json": "1b4b393b1d1e95063e3f00bfe39efde6c5f36dcc22f3e7368dee5166634f8a63",
  "src/rendering/track-signal-hardware.ts": "43ab3e88821f8216665528f464b63041671a86cfb9e670af3d1ac2dc19e94846",
  "src/rendering/track-signal-plan.ts": "1050d2ba13a3238c1d67853f39e0e4b5f053969807b5644ffe69c3c2d76af444",
  "tests/broadcast-cameras.test.ts": "b058f34b77937d72e98b2246ac1ade10600108421ce6bf7b28f270307e52f652",
  "tests/recorded-signal-displays.test.ts": "2d3cfba5ddeac62c0fa3726da33f4f81e765b88a55000cf3e4d34fb713936839",
  "tests/track-boards.test.ts": "beb6c3b22657d58265e424b95a00660d76562672dd1b985cc2ba5b48a61e204c",
  "tests/track-signal-hardware.test.ts": "fb4cb77723a21ee51e7f842d7b3df81add3cee3305de7ef960448d54d71164ac",
  "tests/trackside-operations.test.ts": "bd211d92e60f83717e5b9d074a486b60b504503bf2fad9748762190ffa58ec9f",
  "scripts/operations-render-budget.ts": "4f4414d614eaaadf0a8614b2887cc2b3196401c7e830501de19658dfe73b8bb8",
  "tests/operations-render-budget.test.ts": "a39663d732768df0a69ec4645a53409a71839aee587f3641bf77ed65de857a8f",
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_ready() -> bool:
    return all((ROOT / path).is_file() and sha(ROOT / path) == digest for path, digest in EXPECTED.items())


def safe_relative(name: str) -> Path:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise RuntimeError(f"Unsafe staged path: {name}")
    if path.parts[0] not in {"src", "scripts", "tests", "e2e", "docs", "3dmodels.md", "README.md"}:
        raise RuntimeError(f"Out-of-scope staged path: {name}")
    return ROOT / Path(*path.parts)


def materialize_source() -> None:
    if source_ready():
        print("A08-A10 source already matches the sealed candidate.")
        return
    data = b"".join((ROOT / f".github/operations-candidate.{i:02d}.xzpart").read_bytes() for i in range(N_PARTS))
    if hashlib.sha256(data).hexdigest() != PACK:
        raise RuntimeError("A08-A10 source transport checksum mismatch")
    payload = json.loads(lzma.decompress(data))
    if payload.get("base") != BASE or set(payload.get("paths", [])) - set(EXPECTED):
        raise RuntimeError("Unexpected A08-A10 source payload")
    with tempfile.TemporaryDirectory(prefix="a08-a10-source-") as folder:
        patch = Path(folder) / "source.patch"
        patch.write_text(payload["patch"])
        subprocess.run(["git", "apply", "--check", str(patch)], cwd=ROOT, check=True)
        subprocess.run(["git", "apply", str(patch)], cwd=ROOT, check=True)
    for name, text in payload["files"].items():
        target = safe_relative(name)
        if target.exists():
            raise RuntimeError(f"Refusing to overwrite unexpected source file: {name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    for name, digest in payload["hashes"].items():
        if sha(ROOT / name) != digest:
            raise RuntimeError(f"Initial A08-A10 source hash mismatch: {name}")

    observer = (ROOT / ".github/operations-observer.xz").read_bytes()
    if hashlib.sha256(observer).hexdigest() != OBSERVER:
        raise RuntimeError("A08-A10 observer checksum mismatch")
    correction = json.loads(lzma.decompress(observer))
    for name, digest in correction["before"].items():
        if sha(ROOT / name) != digest:
            raise RuntimeError(f"Observer base mismatch: {name}")
    with tempfile.TemporaryDirectory(prefix="a08-a10-observer-") as folder:
        patch = Path(folder) / "observer.patch"
        patch.write_text(correction["patch"])
        subprocess.run(["git", "apply", "--check", str(patch)], cwd=ROOT, check=True)
        subprocess.run(["git", "apply", str(patch)], cwd=ROOT, check=True)
    for name, text in correction["files"].items():
        target = safe_relative(name)
        if target.exists():
            raise RuntimeError(f"Refusing to overwrite observer source: {name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    if not source_ready():
        bad = [name for name, digest in EXPECTED.items() if not (ROOT / name).is_file() or sha(ROOT / name) != digest]
        raise RuntimeError("Materialized A08-A10 source differs from sealed candidate: " + ", ".join(bad))
    print(f"Materialized {len(EXPECTED)} checksum-verified A08-A10 source files.")


def assets_ready() -> bool:
    for name in ASSETS:
        manifest_path = ROOT / f"src/rendering/{name}.manifest.json"
        model_path = ROOT / f"public/models/aurel-{name}.glb"
        if not (manifest_path.is_file() and model_path.is_file()):
            return False
        manifest = json.loads(manifest_path.read_text())
        if model_path.stat().st_size != manifest["bytes"] or sha(model_path) != manifest["sha256"]:
            return False
    return True


def find_blender() -> Path:
    configured = os.environ.get("BLENDER_BIN")
    if configured and Path(configured).is_file():
        return Path(configured)
    found = shutil.which("blender")
    if found:
        return Path(found)
    cache = ROOT / ".cache" / f"blender-{BLENDER_VERSION}-linux-x64"
    binary = cache / "blender"
    if binary.is_file():
        return binary
    if platform.system() != "Linux" or platform.machine().lower() not in {"x86_64", "amd64"}:
        raise RuntimeError("Blender 5.2.2 is required. Install it or set BLENDER_BIN before building A08-A10.")
    cache.parent.mkdir(parents=True, exist_ok=True)
    archive = cache.parent / f"blender-{BLENDER_VERSION}-linux-x64.tar.xz"
    if not archive.is_file() or sha(archive) != BLENDER_SHA256:
        print(f"Downloading checksum-pinned Blender {BLENDER_VERSION}...")
        temporary = archive.with_suffix(archive.suffix + ".part")
        urllib.request.urlretrieve(BLENDER_URL, temporary)
        if sha(temporary) != BLENDER_SHA256:
            temporary.unlink(missing_ok=True)
            raise RuntimeError("Downloaded Blender checksum mismatch")
        temporary.replace(archive)
    cache.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:xz") as bundle:
        prefix = bundle.getmembers()[0].name.split("/", 1)[0]
        for member in bundle.getmembers():
            if not member.name.startswith(prefix + "/"):
                continue
            member.name = member.name[len(prefix) + 1 :]
            if not member.name or member.name.startswith("/") or ".." in PurePosixPath(member.name).parts:
                continue
            bundle.extract(member, cache, filter="data")
    if not binary.is_file():
        raise RuntimeError("Blender extraction did not produce the expected executable")
    return binary


def materialize_assets() -> None:
    if assets_ready():
        print("A08-A10 Blender exports already match their manifests.")
        return
    blender = find_blender()
    with tempfile.TemporaryDirectory(prefix="a08-a10-export-") as folder:
        output = Path(folder)
        subprocess.run(
            [sys.executable, str(ROOT / "scripts/rebuild-trackside-operations.py"), "--blender", str(blender), "--output-root", str(output)],
            cwd=ROOT,
            check=True,
        )
        for name in ASSETS:
            for relative in (
                f"public/models/aurel-{name}.glb",
                f"scripts/aurel-{name}.blend",
                f"src/rendering/{name}.manifest.json",
            ):
                target = ROOT / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(output / relative, target)
        shutil.copy2(output / "authoring-receipt.json", ROOT / "docs/TRACKSIDE_OPERATIONS_AUTHORING.json")
    if not assets_ready():
        raise RuntimeError("A08-A10 Blender exports failed integrity verification")
    print("Materialized three checksum-verified A08-A10 Blender/GLB families.")


def main() -> None:
    materialize_source()
    materialize_assets()


if __name__ == "__main__":
    main()
