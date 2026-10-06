"""Compare two capture directories shot by shot (QA tooling; not part of the game or CI).

    python3 -I scripts/studio/shotdiff.py <dirA> <dirB> [--montage out.jpg] [--json out.json]
        [--ref NN=<image> ...] [--only 10,11,20] [--width 640]

Shots are matched by their two-digit index (capture.mjs camera labels in file names can lag a
view; capture-matrix.mjs names are exact, but the index is the contract). Per shot it prints the
mean |A-B| (0-255), the share of pixels with any channel delta > 24, sRGB luma mean and p95 and
mean saturation of A and B, and the draw-call delta when both diag.json files carry per-shot
records (capture-matrix) or a top-level renderer.drawCalls (legacy capture.mjs).

Noise floor: two captures of the same build differ by mean |d| 1.0-4.2 on the static views
(00, 11, 12, 13; distant traffic moves) and by 9.5-18.8 on views with moving traffic (10, 20,
21). Rows above the floor (4.5 static, 19 moving) are flagged '*'. Judge looks with the montage, not with the numbers.

--montage writes A | B (| reference) rows with index labels; --ref NN=path adds a reference image
(any size, letterboxed) as a third column for that shot. Write montages to the scratchpad, never
into the repository (references must not be copied into the repo).
"""

import argparse
import json
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw


REPO = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def outside_repo(path, flag):
    """Outputs belong in the scratchpad: refuse to write into this repository (check:stable)."""
    real = os.path.realpath(os.path.abspath(path))
    if real == REPO or real.startswith(REPO + os.sep):
        sys.exit('%s %s is inside the repository; write it to the scratchpad instead' % (flag, path))
    return path

STATIC = {'00', '11', '12', '13'}
# Same build, two captures: TECH_TEST_MAP 9 measured 1.0-2.9 on the static views; capture.mjs vs
# capture-matrix.mjs on the baseline build measured 2.1-4.2 (distant traffic in 12 and 13).
FLOOR_STATIC = 4.5
FLOOR_MOVING = 19.0


def shots(directory):
    out = {}
    for name in sorted(os.listdir(directory)):
        m = re.match(r'^(\d\d)-.*\.png$', name)
        if m:
            out.setdefault(m.group(1), os.path.join(directory, name))
    return out


def rgb(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(np.float32)


def luma(a):
    return (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]) / 255.0


def saturation(a):
    mx, mn = a.max(-1), a.min(-1)
    return float(np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-5), 0).mean())


def draw_calls(directory):
    """{index: drawCalls} from a capture-matrix diag.json, or {'*': n} from a legacy one."""
    path = os.path.join(directory, 'diag.json')
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        diag = json.load(f)
    per = {('%02d' % s['index']): s.get('drawCalls') for s in diag.get('shots', [])
           if isinstance(s, dict) and 'index' in s}
    if not per and isinstance(diag.get('renderer'), dict):
        per['*'] = diag['renderer'].get('drawCalls')
    return per


def fit(img, w, h):
    """Letterbox an image into w x h."""
    scale = min(w / img.width, h / img.height)
    resized = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))))
    canvas = Image.new('RGB', (w, h), (0, 0, 0))
    canvas.paste(resized, ((w - resized.width) // 2, (h - resized.height) // 2))
    return canvas


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('a')
    ap.add_argument('b')
    ap.add_argument('--montage')
    ap.add_argument('--json')
    ap.add_argument('--ref', action='append', default=[], help='NN=<image> reference column')
    ap.add_argument('--only', help='comma list of shot indices')
    ap.add_argument('--width', type=int, default=640, help='montage cell width')
    args = ap.parse_args(argv)
    for flag in ('montage', 'json'):
        if getattr(args, flag):
            outside_repo(getattr(args, flag), '--' + flag)

    A, B = shots(args.a), shots(args.b)
    keys = sorted(set(A) & set(B))
    if args.only:
        keys = [k for k in keys if k in set(args.only.split(','))]
    refs = {}
    for item in args.ref:
        k, _, path = item.partition('=')
        refs['%02d' % int(k)] = path
    calls_a, calls_b = draw_calls(args.a), draw_calls(args.b)

    print('%-3s %-30s %-30s %7s %6s %6s %6s %6s %6s %5s %5s %s' % (
        'id', 'A', 'B', 'meanAbs', '%chg', 'lumA', 'lumB', 'p95A', 'p95B', 'satA', 'satB',
        'calls A->B'))
    rows, report = [], []
    for k in keys:
        a, b = rgb(A[k]), rgb(B[k])
        entry = {'id': k, 'a': os.path.basename(A[k]), 'b': os.path.basename(B[k])}
        if a.shape != b.shape:
            entry['error'] = 'size mismatch %s vs %s' % (a.shape, b.shape)
            print(k, entry['error'])
            report.append(entry)
            continue
        d = np.abs(a - b)
        la, lb = luma(a), luma(b)
        floor = FLOOR_STATIC if k in STATIC else FLOOR_MOVING
        entry.update(
            mean_abs=float(d.mean()), changed=float((d.max(-1) > 24).mean()),
            luma_a=float(la.mean()), luma_b=float(lb.mean()),
            p95_a=float(np.percentile(la, 95)), p95_b=float(np.percentile(lb, 95)),
            sat_a=saturation(a), sat_b=saturation(b), above_noise=bool(d.mean() > floor),
            calls_a=calls_a.get(k), calls_b=calls_b.get(k))
        calls = ''
        if entry['calls_a'] is not None and entry['calls_b'] is not None:
            calls = '%d->%d (%+d)' % (entry['calls_a'], entry['calls_b'],
                                      entry['calls_b'] - entry['calls_a'])
        elif entry['calls_a'] is not None or entry['calls_b'] is not None:
            calls = '%s -> %s' % (entry['calls_a'] if entry['calls_a'] is not None else '-',
                                entry['calls_b'] if entry['calls_b'] is not None else '-')
        print('%-3s %-30s %-30s %6.2f%s %5.1f%% %6.3f %6.3f %6.3f %6.3f %5.3f %5.3f %s' % (
            k, entry['a'][:30], entry['b'][:30], entry['mean_abs'],
            '*' if entry['above_noise'] else ' ', 100 * entry['changed'], entry['luma_a'],
            entry['luma_b'], entry['p95_a'], entry['p95_b'], entry['sat_a'], entry['sat_b'], calls))
        report.append(entry)
        rows.append(k)
    if calls_a.get('*') is not None or calls_b.get('*') is not None:
        # legacy capture.mjs: one cockpit drawCalls for the whole run (after the last shot)
        print('diag.json renderer.drawCalls: A %s, B %s' % (
            calls_a.get('*', '-'), calls_b.get('*', '-')))
    only_a, only_b = sorted(set(A) - set(B)), sorted(set(B) - set(A))
    if only_a or only_b:
        print('only in A: %s; only in B: %s' % (' '.join(only_a) or '-', ' '.join(only_b) or '-'))
    print("'*' = above the same-build noise floor (static %.1f, moving %.0f)" % (FLOOR_STATIC,
                                                                               FLOOR_MOVING))

    if args.montage and rows:
        w = args.width
        h = w * 9 // 16
        cols = 3 if any(k in refs for k in rows) else 2
        label = 18
        sheet = Image.new('RGB', (cols * w, (h + label) * len(rows)), (16, 16, 16))
        draw = ImageDraw.Draw(sheet)
        for i, k in enumerate(rows):
            y = i * (h + label)
            draw.text((4, y + 3), '%s  A: %s' % (k, os.path.basename(A[k])), fill=(230, 230, 230))
            draw.text((w + 4, y + 3), 'B: %s' % os.path.basename(B[k]), fill=(230, 230, 230))
            sheet.paste(fit(Image.open(A[k]).convert('RGB'), w, h), (0, y + label))
            sheet.paste(fit(Image.open(B[k]).convert('RGB'), w, h), (w, y + label))
            if k in refs:
                draw.text((2 * w + 4, y + 3), 'ref: %s' % os.path.basename(refs[k]),
                          fill=(255, 210, 120))
                sheet.paste(fit(Image.open(refs[k]).convert('RGB'), w, h), (2 * w, y + label))
        sheet.save(args.montage, quality=88)
        print('montage (A | B%s): %s' % (' | ref' if cols == 3 else '', args.montage))
    if args.json:
        with open(args.json, 'w') as f:
            json.dump({'a': os.path.abspath(args.a), 'b': os.path.abspath(args.b),
                       'shots': report, 'only_a': only_a, 'only_b': only_b}, f, indent=1)
        print('json:', args.json)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
