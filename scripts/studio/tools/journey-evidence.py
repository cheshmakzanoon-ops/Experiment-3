#!/usr/bin/env python3
"""Copy a journey tool output directory into the repo as committed evidence.

  python3 scripts/studio/tools/journey-evidence.py <journey-out-dir> <dest-dir> [--keep-profiles]

PNG screenshots become JPEG (quality 72) so the evidence stays small; result.json and
progress.log are copied as they are; CPU profiles are skipped unless --keep-profiles.
"""
import shutil
import sys
from pathlib import Path

from PIL import Image

args = [a for a in sys.argv[1:] if not a.startswith("--")]
keep_profiles = "--keep-profiles" in sys.argv
if len(args) != 2:
    sys.exit(__doc__)
src, dest = Path(args[0]), Path(args[1])
dest.mkdir(parents=True, exist_ok=True)
for f in sorted(src.iterdir()):
    if f.suffix == ".png":
        Image.open(f).convert("RGB").save(dest / (f.stem + ".jpg"), quality=72, optimize=True)
    elif f.name.endswith(".cpuprofile.gz"):
        if keep_profiles:
            shutil.copy2(f, dest / f.name)
    elif f.suffix in (".json", ".log"):
        shutil.copy2(f, dest / f.name)
print(f"{src} -> {dest}: {len(list(dest.iterdir()))} files, {sum(p.stat().st_size for p in dest.iterdir()) // 1024} KB")
