"""Numeric image diff of two vehicle-shots directories (same file names, 1280x720 JPEG).

usage: vehicle-diff.py BASE_DIR NEW_DIR [--threshold 0.5] [--json out.json] [--ids a,b,c]

For every <id>.jpg present in both directories prints the mean absolute per-channel difference
(0..255) over the whole frame, the share of pixels that differ by more than 24 levels, and the
bounding box of those pixels. The showroom orbit is deterministic (an unchanged machine is
pixel-identical between two runs apart from JPEG noise, mean abs diff below 0.05), so a machine
whose mean abs diff is under the threshold did not change; anything above it is listed as CHANGED
and has to be looked at by eye. Machines missing on either side are listed, never skipped silently.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

args = sys.argv[1:]
base, new = args.pop(0), args.pop(0)
threshold, out, only = 0.5, None, None
while args:
    a = args.pop(0)
    if a == "--threshold":
        threshold = float(args.pop(0))
    elif a == "--json":
        out = args.pop(0)
    elif a == "--ids":
        only = args.pop(0).split(",")


def ids(d):
    return sorted(
        f[:-4]
        for f in os.listdir(d)
        if f.endswith(".jpg") and not f.startswith("before-") and not f.startswith("compare")
    )


a_ids, b_ids = set(ids(base)), set(ids(new))
rows = []
for i in sorted(a_ids & b_ids):
    if only and i not in only:
        continue
    a = np.asarray(Image.open(os.path.join(base, i + ".jpg")).convert("RGB"), dtype=np.int16)
    b = np.asarray(Image.open(os.path.join(new, i + ".jpg")).convert("RGB"), dtype=np.int16)
    if a.shape != b.shape:
        rows.append({"id": i, "error": f"size {a.shape} vs {b.shape}"})
        continue
    d = np.abs(a - b)
    mean = float(d.mean())
    mask = d.max(axis=2) > 24
    share = float(mask.mean())
    box = None
    if mask.any():
        ys, xs = np.where(mask)
        box = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
    rows.append(
        {
            "id": i,
            "meanAbsDiff": round(mean, 3),
            "changedShare": round(share, 4),
            "box": box,
            "status": "CHANGED" if mean > threshold else "same",
        }
    )
rows.sort(key=lambda r: -r.get("meanAbsDiff", 1e9))
for r in rows:
    if "error" in r:
        print(f"{r['id']:8} ERROR {r['error']}")
    else:
        print(f"{r['id']:8} {r['meanAbsDiff']:8.3f}  {r['changedShare'] * 100:6.2f}% px  {r['status']:8} {r['box']}")
missing = {"only_in_base": sorted(a_ids - b_ids), "only_in_new": sorted(b_ids - a_ids)}
print(json.dumps(missing))
if out:
    with open(out, "w") as f:
        json.dump({"threshold": threshold, "rows": rows, **missing}, f, indent=2)
        f.write("\n")
