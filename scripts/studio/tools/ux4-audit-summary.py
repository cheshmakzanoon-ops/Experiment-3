"""Summarise a ux4dom.mjs audit (and focus) JSON: text under 11 px, contrast failures, missing focus rings.

usage: ux4-audit-summary.py AUDIT.json [FOCUS.json] [--detail]
Prints one row per scene (text elements judged, under 11 px, under WCAG AA) and, with --detail, the
offending elements grouped by selector and size. With a focus file, the interactive elements that showed
no focus ring under the keyboard or the pad.
"""
import collections
import json
import sys

args = [a for a in sys.argv[1:] if not a.startswith("--")]
detail = "--detail" in sys.argv
audit = json.load(open(args[0]))
print(f"{'scene':28} {'texts':>6} {'judged':>6} {'<11px':>6} {'<AA':>5} {'over scene':>10}")
tot = [0, 0, 0, 0]
for scene, v in audit.items():
    print(f"{scene:28} {v['texts']:6} {v['judged']:6} {len(v['small']):6} {len(v['low']):5} {v['unknown']:10}")
    tot[0] += v["texts"]
    tot[1] += v["judged"]
    tot[2] += len(v["small"])
    tot[3] += len(v["low"])
print(f"{'TOTAL':28} {tot[0]:6} {tot[1]:6} {tot[2]:6} {tot[3]:5}")
if detail:
    for scene, v in audit.items():
        if v["small"]:
            c = collections.Counter((s["name"], s["size"]) for s in v["small"])
            print("==", scene, "under 11 px")
            for (name, size), n in c.most_common(12):
                print(f"   {size:>6} {name} x{n}")
        for l in v["low"][:8]:
            print(f"== {scene} contrast {l['ratio']}: {l['name']} '{l['text']}' {l['fg']} on {l['bg']}")
if len(args) > 1:
    focus = json.load(open(args[1]))
    print()
    print(f"{'scene':28} {'checked':>7} {'keys fail':>9} {'pad fail':>8}")
    for scene, v in focus.items():
        print(f"{scene:28} {v['keys']['checked']:7} {len(v['keys']['failures']):9} {len(v['pad']['failures']):8}")
    if detail:
        for scene, v in focus.items():
            for mode in ("keys", "pad"):
                for f in v[mode]["failures"][:10]:
                    print(f"== {scene} {mode}: {f['el']} '{f['text']}' outline={f['outline']}")
