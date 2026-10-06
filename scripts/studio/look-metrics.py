"""Studio look metrics: measures the PRODUCTION_PLAN section 5 KPIs on a capture directory.

QA tooling only (not part of the game, CI or any test). Run it with the isolated interpreter:

    python3 -I scripts/studio/look-metrics.py <captureDir> [--targets look-targets.json]
        [--json out.json] [--overlay outDir] [--noblur <captureDir>] [--kpi 1,4,9] [--strict]

<captureDir> is a capture-matrix.mjs (or legacy capture.mjs) output: NN-*.png files matched by their
two-digit index, plus diag.json. Every check in look-targets.json names a shot index, a crop
(fractions of the frame, or a polygon), an optional pixel filter and a target. A check reports
PASS, FAIL, INVALID (the crop no longer shows the surface it was calibrated on: too few pixels pass
the filter, a heuristic could not lock on, the shot shows another camera view than look-targets
'views' names, a drive shot was taken outside its 'compositions' window, or the capture state
misses a check's 'requires') or N/A (shot, diag value or comparison missing).
All colours are display-referred sRGB 0-255, measured after tone mapping, like the art bibles.
--overlay writes <shot>-overlay.png with every crop outlined in its result colour, so a reviewer can
confirm that the crops still sit on the intended surfaces after camera or layout changes.
Requires PIL and numpy only. Exit code: 0, or 1 with --strict when any check FAILs.
"""

import argparse
import json
import math
import os
import re
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw


REPO = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def outside_repo(path, flag):
    """Outputs belong in the scratchpad: refuse to write into this repository (check:stable)."""
    real = os.path.realpath(os.path.abspath(path))
    if real == REPO or real.startswith(REPO + os.sep):
        sys.exit('%s %s is inside the repository; write it to the scratchpad instead' % (flag, path))
    return path

HERE = os.path.dirname(os.path.abspath(__file__))
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float64)


# --------------------------------------------------------------------------------------------
# Pixel helpers
# --------------------------------------------------------------------------------------------
def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def luma(rgb):
    """sRGB (display) luma in 0-1 of an (..., 3) 0-255 array."""
    return (np.asarray(rgb, dtype=np.float64) @ LUMA) / 255.0


def linear_luminance(rgb):
    return srgb_to_linear(rgb) @ LUMA


def saturation(rgb):
    rgb = np.asarray(rgb, dtype=np.float64)
    mx, mn = rgb.max(-1), rgb.min(-1)
    return np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)


def hexcol(rgb):
    return '#%02x%02x%02x' % tuple(int(max(0, min(255, round(v)))) for v in rgb)


def parse_hex(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def load(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(np.float64)


def region_mask(shape, check):
    """Boolean mask of the check's crop box or polygon (fractions of the frame)."""
    h, w = shape[:2]
    if 'poly' in check:
        mask = Image.new('L', (w, h), 0)
        ImageDraw.Draw(mask).polygon([(x * w, y * h) for x, y in check['poly']], fill=255)
        return np.asarray(mask) > 0
    x0, y0, x1, y1 = check.get('crop', [0, 0, 1, 1])
    mask = np.zeros((h, w), dtype=bool)
    mask[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = True
    return mask


def crop_box(shape, box):
    h, w = shape[:2]
    x0, y0, x1, y1 = box
    return int(y0 * h), int(y1 * h), int(x0 * w), int(x1 * w)


def classify(rgb, kind):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    s = saturation(rgb)
    y = luma(rgb)
    if kind == 'vegetation':
        # olive to green; excludes sky, asphalt, sand (r >> g), warm concrete (bright, low sat)
        return ((g > b * 1.08) & (g >= r * 0.92) & (s > 0.12) & (y > 0.04)
                & ~((s < 0.25) & (y > 0.45)))
    if kind == 'sky':
        return (b >= g * 0.92) & (b > r) & (y > 0.3)
    if kind == 'red':
        return (r > g * 1.6) & (r > b * 1.5) & (r > 70)
    if kind == 'neutral':
        return s < 0.25
    raise ValueError('unknown class ' + kind)


def apply_filter(rgb, spec):
    """Rows of rgb (N, 3) that pass the filter spec; the second value is the pass mask."""
    keep = np.ones(len(rgb), dtype=bool)
    if not spec or not len(rgb):
        return rgb, keep
    s = saturation(rgb)
    y = luma(rgb)
    if 'class' in spec:
        keep &= classify(rgb, spec['class'])
    if 'sat_max' in spec:
        keep &= s <= spec['sat_max']
    if 'sat_min' in spec:
        keep &= s >= spec['sat_min']
    if 'luma' in spec:
        keep &= (y >= spec['luma'][0]) & (y <= spec['luma'][1])
    if 'luma_rel' in spec and keep.any():
        med = np.median(y[keep])
        keep &= (y >= spec['luma_rel'][0] * med) & (y <= spec['luma_rel'][1] * med)
    if 'trim' in spec and keep.any():
        lo, hi = np.percentile(y[keep], spec['trim'])
        keep &= (y >= lo) & (y <= hi)
    return rgb[keep], keep


# --------------------------------------------------------------------------------------------
# Measures. Each returns (values: dict, info: dict); info may carry 'coverage', 'invalid',
# and 'draw' (overlay primitives in frame fractions).
# --------------------------------------------------------------------------------------------
def m_stats(img, check, ctx):
    """Colour statistics of the filtered crop pixels. With `alternates` (more crops), the first
    crop whose filter coverage reaches min_coverage is used (else the best one), e.g. road right
    of the car, or left of it when the car rides the right-hand kerb."""
    best = None
    for crop in [check.get('crop', [0, 0, 1, 1])] + check.get('alternates', []):
        sub = dict(check, crop=crop)
        pixels = img[region_mask(img.shape, sub)]
        kept, _ = apply_filter(pixels, check.get('filter'))
        coverage = len(kept) / max(1, len(pixels))
        if best is None or coverage > best[1]:
            best = (kept, coverage, crop)
        if coverage >= check.get('min_coverage', 0.5):
            best = (kept, coverage, crop)
            break
    kept, coverage, crop = best
    info = {'coverage': coverage}
    if check.get('alternates'):
        info['draw'] = [('box', crop, 'used')]
    if len(kept) < 16:
        info['invalid'] = 'no pixels pass the filter'
        return {}, info
    mean = kept.mean(0)
    y = luma(kept) * 255.0
    values = {
        'hex': hexcol(mean),
        'rgb': [round(v, 1) for v in mean],
        'br': mean[2] / max(mean[0], 1e-6),
        'gb': mean[1] / max(mean[2], 1e-6),
        'b_minus_g': mean[2] - mean[1],
        'luma': float(luma(mean)),
        'luma_std': float(y.std()),
        'rgb_std': float(kept.std(0).mean()),
        'sat': float(saturation(kept).mean()),
        'sat_of_mean': float(saturation(mean)),
        'lin': float(linear_luminance(mean)),
    }
    return values, info


def m_percentiles(img, check, ctx):
    pixels = img[region_mask(img.shape, check)]
    y = luma(pixels)
    p = np.percentile(y, [1, 5, 50, 95, 99])
    return {
        'p1': p[0], 'p5': p[1], 'p50': p[2], 'p95': p[3], 'p99': p[4],
        'mean': float(y.mean()), 'sat': float(saturation(pixels).mean()),
    }, {'coverage': 1.0}


def m_dark_share(img, check, ctx):
    pixels = img[region_mask(img.shape, check)]
    y = luma(pixels)
    thr = check.get('threshold', 0.06)
    return {'share': float((y < thr).mean())}, {'coverage': 1.0}


def m_ratio(img, check, ctx):
    """Linear-luminance ratio of crop `a` over crop `b` (lit:shadow), plus each crop's colour."""
    out, info, cov = {}, {'draw': []}, []
    lums = []
    for key in ('a', 'b'):
        sub = dict(check[key])
        pixels = img[region_mask(img.shape, sub)]
        kept, _ = apply_filter(pixels, sub.get('filter'))
        cov.append(len(kept) / max(1, len(pixels)))
        if len(kept) < 16:
            return {}, {'coverage': min(cov), 'invalid': f'crop {key}: no pixels pass the filter'}
        mean = kept.mean(0)
        lums.append(float(linear_luminance(mean)))
        out[f'{key}_hex'] = hexcol(mean)
        out[f'{key}_br'] = mean[2] / max(mean[0], 1e-6)
        info['draw'].append(('box', sub.get('crop'), key))
    out['ratio'] = lums[0] / max(lums[1], 1e-6)
    info['coverage'] = min(cov)
    return out, info


def smooth(v, n):
    if n <= 1 or len(v) < n:
        return v
    k = np.ones(n) / n
    return np.convolve(np.pad(v, (n // 2, n - 1 - n // 2), mode='edge'), k, mode='valid')


def lateral_profile(img, box, spec):
    """Per-column mean linear luminance of the filtered pixels in a band; None if mostly filtered."""
    y0, y1, x0, x1 = box
    band = img[y0:y1, x0:x1]
    _, keep = apply_filter(band.reshape(-1, 3), spec)
    keep = keep.reshape(band.shape[:2])
    lin = linear_luminance(band)
    counts = keep.sum(0)
    valid = counts >= max(2, 0.4 * band.shape[0])
    if valid.sum() < 0.5 * band.shape[1]:
        return None, float(valid.mean())
    profile = np.where(valid, (lin * keep).sum(0) / np.maximum(counts, 1), np.nan)
    idx = np.arange(len(profile))
    return np.interp(idx, idx[valid], profile[valid]), float(valid.mean())


def line_dip(profile, check):
    """Detrended dip: (ratio, index). The wide trend (vignette, light falloff) is divided out,
    then the darkest smoothed column is compared with the off-line percentile."""
    n = len(profile)
    trend = smooth(profile, max(5, int(check.get('trend', 0.35) * n)))
    detr = profile / np.maximum(trend, 1e-9)
    sm = smooth(detr, max(3, int(check.get('smooth', 0.03) * n)))
    edge = int(0.04 * n)  # band ends: kerb transition
    core = sm[edge:n - edge] if n > 4 * edge else sm
    offline = float(np.percentile(core, check.get('offline_pct', 75)))
    i = int(np.argmin(core))
    return float(core[i] / max(offline, 1e-9)), edge + i


def m_line_profile(img, check, ctx):
    """Racing line vs off-line: lateral linear-luminance profile across a road band.

    A uniform road reads about 0.9-1.0. When the dip is deep enough to pass, it must also sit
    where a longitudinal stripe would in the upper and lower half of the band (converging on
    `vanish` [x, y] when given), so a car or a shadow blob cannot pass as a racing line."""
    y0, y1, x0, x1 = crop_box(img.shape, check['crop'])
    spec = check.get('filter')
    profile, coverage = lateral_profile(img, (y0, y1, x0, x1), spec)
    if profile is None:
        return {}, {'coverage': coverage, 'invalid': 'road band mostly filtered out'}
    ratio, i = line_dip(profile, check)
    w = img.shape[1]
    lx = (x0 + i) / w
    info = {'coverage': coverage,
            'draw': [('vline', lx, (check['crop'][1], check['crop'][3]), 'line')]}
    mid = (y0 + y1) // 2
    halves = [lateral_profile(img, (a, b, x0, x1), spec)[0] for a, b in ((y0, mid), (mid, y1))]
    if all(h is not None for h in halves) and ratio < check.get('consistency_below', 0.7):
        upper, lower = (x0 + line_dip(h, check)[1] for h in halves)
        expected = upper
        if 'vanish' in check:  # a longitudinal line converges on the vanishing point
            vx, vy = check['vanish'][0] * w, check['vanish'][1] * img.shape[0]
            yu, yl = (y0 + mid) / 2, (mid + y1) / 2
            expected = vx + (lower - vx) * (yu - vy) / max(yl - vy, 1e-6)
        if abs(upper - expected) > check.get('consistency', 0.1) * len(profile):
            info['invalid'] = 'dark band is not longitudinal (car, shadow or marking)'
    return {'ratio': ratio, 'line_x': lx}, info


def dark_runs(row_dark, gap):
    """Closed (gap-bridged) runs of True in a boolean row: list of (start, end_exclusive)."""
    runs, start, last = [], None, None
    for i, d in enumerate(row_dark):
        if d:
            if start is None:
                start = i
            elif i - last - 1 > gap:
                runs.append((start, last + 1))
                start = i
            last = i
    if start is not None:
        runs.append((start, last + 1))
    return runs


def m_dark_span(img, check, ctx):
    """Width of the car in a chase view: dark (sRGB luma < threshold) runs per row, chained
    outward from the run nearest the centre while the gaps stay below `chain` (body highlights
    between the tyres); width = `pct` percentile of the per-row spans, as a frame fraction."""
    h, w = img.shape[:2]
    y0, y1, _, _ = crop_box(img.shape, check['crop'])
    thr = check.get('threshold', 0.11)
    gap = int(check.get('gap', 0.012) * w)
    chain = int(check.get('chain', 0.04) * w)
    min_run = int(check.get('min_run', 0.012) * w)
    cx = int(check.get('center', 0.5) * w)
    search = int(check.get('search', 0.08) * w)
    widths, spans = [], []
    for y in range(y0, y1):
        runs = [r for r in dark_runs(luma(img[y]) < thr, gap) if r[1] - r[0] >= min_run]
        if not runs:
            continue
        dist = [0 if s <= cx < e else min(abs(s - cx), abs(e - 1 - cx)) for s, e in runs]
        k = int(np.argmin(dist))
        if dist[k] > search:
            continue
        lo, hi = k, k
        while lo > 0 and runs[lo][0] - runs[lo - 1][1] <= chain:
            lo -= 1
        while hi < len(runs) - 1 and runs[hi + 1][0] - runs[hi][1] <= chain:
            hi += 1
        widths.append(runs[hi][1] - runs[lo][0])
        spans.append((runs[lo][0], runs[hi][1]))
    if len(widths) < 0.25 * (y1 - y0):
        return {}, {'coverage': len(widths) / max(1, y1 - y0), 'invalid': 'no dark object at centre'}
    width = float(np.percentile(widths, check.get('pct', 85)))
    s, e = spans[int(np.argmin([abs(v - width) for v in widths]))]
    info = {
        'coverage': len(widths) / (y1 - y0),
        'draw': [('hspan', (s / w, e / w), (y0 + y1) / 2 / h, 'span')],
    }
    if s <= 1 or e >= w - 1:
        info['invalid'] = 'dark run reaches the frame edge (background or shadow merged)'
    return {'width': width / w, 'left': s / w, 'right': e / w}, info


def m_marker_span(img, check, ctx):
    """Object width from saturated marker blobs at its sides (the steering wheel's coloured
    buttons): outermost marker columns in the band times `scale` (calibrated on the baseline,
    where the wheel spans about 23 % of the width)."""
    h, w = img.shape[:2]
    y0, y1, x0, x1 = crop_box(img.shape, check['crop'])
    band = img[y0:y1, x0:x1]
    marker = (saturation(band) > check.get('sat', 0.45)) & (luma(band) > check.get('luma', 0.12))
    cols = np.nonzero(marker.sum(0) >= check.get('min_px', 3))[0]
    if len(cols) < 2:
        return {}, {'coverage': 0.0, 'invalid': 'no markers found'}
    left, right = (x0 + cols[0]) / w, (x0 + cols[-1] + 1) / w
    centre = (left + right) / 2
    width = (right - left) * check.get('scale', 1.0)
    return {'width': width, 'marker_span': right - left, 'centre': centre}, {
        'coverage': 1.0,
        'draw': [('hspan', (centre - width / 2, centre + width / 2), (y0 + y1) / 2 / h, 'span')],
    }


def m_edge_span(img, check, ctx):
    """Outer extent of a dark object bounded by its strongest vertical edges (cockpit wheel).

    Column profile of |d luma / dx| averaged over the band; the strongest edge on each side of
    the centre within [min_half, max_half] of the frame width gives the span."""
    h, w = img.shape[:2]
    y0, y1, _, _ = crop_box(img.shape, check['crop'])
    y = luma(img[y0:y1])
    grad = np.abs(np.diff(y, axis=1)).mean(0)
    grad = smooth(grad, 3)
    cx = int(check.get('center', 0.5) * w)
    lo, hi = int(check.get('min_half', 0.06) * w), int(check.get('max_half', 0.25) * w)
    left = cx - lo - int(np.argmax(grad[max(0, cx - hi):cx - lo][::-1]))
    right = cx + lo + int(np.argmax(grad[cx + lo:min(len(grad), cx + hi)]))
    strength = min(grad[left], grad[right]) / max(1e-6, np.median(grad))
    info = {
        'coverage': 1.0,
        'draw': [('hspan', (left / w, right / w), (y0 + y1) / 2 / h, 'span')],
    }
    if strength < check.get('min_contrast', 2.0):
        info['invalid'] = 'edges too weak to locate the object'
    return {'width': (right - left) / w, 'left': left / w, 'right': right / w,
            'edge_contrast': float(strength)}, info


def m_horizon(img, check, ctx):
    """Vanishing line of the road straight ahead: the highest row, scanning up from `start`,
    where the asphalt (filter) still covers `min_fill` of the centre columns. With `luma_ref`
    [lo, hi] the asphalt is also the luma band lo-hi times the median of the filtered pixels in
    the `ref_rows` rows above `start` (the near road), so the detector follows the asphalt tone
    instead of a fixed luma window (a lighter road must not read as a lower horizon)."""
    h, w = img.shape[:2]
    _, _, x0, x1 = crop_box(img.shape, check['crop'])
    start = int(check.get('start', 0.75) * h)
    stop = int(check.get('stop', 0.25) * h)
    fill = check.get('min_fill', 0.5)
    band = None
    if 'luma_ref' in check:
        rows = img[max(0, start - int(check.get('ref_rows', 0.02) * h)):start + 1, x0:x1]
        near, _ = apply_filter(rows.reshape(-1, 3), check.get('filter'))
        if len(near) < 16:
            return {}, {'coverage': 0.0, 'invalid': 'no road at the start row'}
        ref = float(np.median(luma(near)))
        band = (check['luma_ref'][0] * ref, check['luma_ref'][1] * ref)
    misses = 0
    top = None
    for y in range(start, stop, -1):
        row = img[y, x0:x1]
        _, keep = apply_filter(row, check.get('filter'))
        if band:
            yl = luma(row)
            keep &= (yl >= band[0]) & (yl <= band[1])
        if keep.mean() >= fill:
            top, misses = y, 0
        else:
            misses += 1
            if misses > check.get('max_gap', 0.02) * h and top is not None:
                break
    if top is None:
        return {}, {'coverage': 0.0, 'invalid': 'no road found in the centre columns'}
    return {'y': top / h}, {'coverage': 1.0,
                            'draw': [('hline', top / h, (x0 / w, x1 / w), 'horizon')]}


def m_stripes(img, check, ctx):
    """Kerb: red stripe colour plus stripe count along a polyline (`line`, frame fractions).

    Each step along the line looks across it (+-`band` px); the step is red when a third of
    that cross-section is red. period_m = segment_m / red runs, with segment_m calibrated on the
    baseline framing (3 m stripes, 6 m per pair)."""
    h, w = img.shape[:2]
    pts = [(x * w, y * h) for x, y in check['line']]
    half = int(check.get('band', 6))
    flags, reds = [], []
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        n = int(max(abs(bx - ax), abs(by - ay)))
        if not n:
            continue
        length = math.hypot(bx - ax, by - ay)
        nx, ny = -(by - ay) / length, (bx - ax) / length
        for t in range(n):
            x = ax + (bx - ax) * t / n
            y = ay + (by - ay) * t / n
            xs = np.clip((x + nx * np.arange(-half, half + 1)).astype(int), 0, w - 1)
            ys = np.clip((y + ny * np.arange(-half, half + 1)).astype(int), 0, h - 1)
            cross = img[ys, xs]
            red = classify(cross, 'red')
            flags.append(red.mean() >= 1 / 3)
            if red.any():
                reds.append(cross[red].mean(0))
    flags = np.array(flags)
    runs = [r for r in dark_runs(flags, int(check.get('gap', 1)))
            if r[1] - r[0] >= check.get('min_run', 2)]
    values = {'pairs': len(runs)}
    info = {'coverage': float(flags.mean()) if len(flags) else 0.0,
            'draw': [('poly', check['line'], 'kerb')]}
    if reds:
        values['red_hex'] = hexcol(np.mean(reds, 0))
    if runs and check.get('segment_m'):
        values['period_m'] = check['segment_m'] / len(runs)
    if not runs:
        info['invalid'] = 'no red stripes along the kerb line'
    return values, info


def m_board_coverage(img, check, ctx):
    """Share of the barrier (polygon) length that carries boards rather than plain concrete.

    The polygon is cut into `slices` along `axis` (x or y). Vegetation pixels are ignored (grass
    or trees caught by the polygon edge). A slice is a board when enough of its pixels are
    strongly coloured: chroma (max-min of 255) above `chroma`, share above `chroma_share`.
    Chroma rather than saturation, so the sky-tinted shadow face of concrete does not count.
    Optional `edge_share` also accepts monochrome lettering (|Laplacian| of sRGB luma above
    `edge`); it is off by default because fences and concrete texture trigger it on the
    baseline."""
    mask = region_mask(img.shape, check)
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return {}, {'coverage': 0.0, 'invalid': 'empty polygon'}
    lum = luma(img)
    lap = np.zeros_like(lum)
    lap[1:-1, 1:-1] = np.abs(4 * lum[1:-1, 1:-1] - lum[:-2, 1:-1] - lum[2:, 1:-1]
                             - lum[1:-1, :-2] - lum[1:-1, 2:])
    coord = xs if check.get('axis', 'x') == 'x' else ys
    n = int(check.get('slices', 24))
    edges = np.linspace(coord.min(), coord.max() + 1, n + 1)
    boards = total = 0
    flags = []
    for i in range(n):
        sel = (coord >= edges[i]) & (coord < edges[i + 1])
        px = img[ys[sel], xs[sel]]
        barrier = ~classify(px, 'vegetation') if len(px) else np.zeros(0, dtype=bool)
        if barrier.sum() < max(8, 0.3 * len(px)):
            flags.append(None)
            continue
        px = px[barrier]
        e = lap[ys[sel], xs[sel]][barrier]
        chroma = px.max(-1) - px.min(-1)
        colourful = (chroma > check.get('chroma', 50)).mean() > check.get('chroma_share', 0.25)
        lettered = 'edge_share' in check and (e > check.get('edge', 0.15)).mean() > check['edge_share']
        total += 1
        boards += bool(colourful or lettered)
        flags.append(bool(colourful or lettered))
    if total < 0.5 * n:
        return {}, {'coverage': total / n, 'invalid': 'polygon mostly misses the barrier'}
    return {'coverage': boards / total, 'slices': total,
            'pattern': ''.join('-' if f is None else ('B' if f else '.') for f in flags)}, {
        'coverage': total / n}


def m_crowd(img, check, ctx):
    """Crowd colour noise: mean per-channel sRGB std-dev, and the largest connected block of one
    quantised colour (levels per channel, 4-connected) as a share of the whole frame."""
    y0, y1, x0, x1 = crop_box(img.shape, check['crop'])
    crop = img[y0:y1, x0:x1]
    levels = check.get('levels', 4)
    radius = int(check.get('blur', 1))  # judge blocks at viewing scale, not single pixels
    if radius:
        k = 2 * radius + 1
        padded = np.pad(crop, ((radius, radius), (radius, radius), (0, 0)), mode='edge')
        acc = np.zeros_like(crop)
        for dy in range(k):
            for dx in range(k):
                acc += padded[dy:dy + crop.shape[0], dx:dx + crop.shape[1]]
        blurred = acc / (k * k)
    else:
        blurred = crop
    q = np.clip((blurred / 256.0 * levels).astype(np.int32), 0, levels - 1)
    code = (q[..., 0] * levels + q[..., 1]) * levels + q[..., 2]
    hh, ww = code.shape
    seen = np.zeros_like(code, dtype=bool)
    largest = 0
    flat = code.ravel()
    for start in range(hh * ww):
        if seen.flat[start]:
            continue
        colour = flat[start]
        seen.flat[start] = True
        queue = deque([start])
        size = 0
        while queue:
            p = queue.popleft()
            size += 1
            py, px = divmod(p, ww)
            for ny, nx in ((py - 1, px), (py + 1, px), (py, px - 1), (py, px + 1)):
                if 0 <= ny < hh and 0 <= nx < ww:
                    k = ny * ww + nx
                    if not seen.flat[k] and flat[k] == colour:
                        seen.flat[k] = True
                        queue.append(k)
        largest = max(largest, size)
    frame = img.shape[0] * img.shape[1]
    return {'rgb_std': float(crop.reshape(-1, 3).std(0).mean()),
            'largest_block': largest / frame,
            'largest_block_crop': largest / max(1, hh * ww),
            'hex': hexcol(crop.reshape(-1, 3).mean(0))}, {'coverage': 1.0}


def flow_anisotropy(img, check, crop, vanish):
    """Mean |luma gradient| along the image-space flow direction (from the vanishing point
    through the crop centre) over the mean across it, on the filtered (road) pixels."""
    y0, y1, x0, x1 = crop_box(img.shape, crop)
    h, w = img.shape[:2]
    lum = luma(img[y0:y1, x0:x1])
    gy, gx = np.gradient(lum)
    _, keep = apply_filter(img[y0:y1, x0:x1].reshape(-1, 3), check.get('filter'))
    keep = keep.reshape(lum.shape)
    if keep.mean() < check.get('min_coverage', 0.5):
        return None, float(keep.mean())
    ux, uy = (x0 + x1) / 2 - vanish[0] * w, (y0 + y1) / 2 - vanish[1] * h
    n = math.hypot(ux, uy) or 1.0
    ux, uy = ux / n, uy / n
    along = np.abs(gx * ux + gy * uy)[keep].mean()
    across = np.abs(-gx * uy + gy * ux)[keep].mean()
    return float(along / max(across, 1e-9)), float(keep.mean())


def m_flow(img, check, ctx):
    """Motion blur on the near road: flow anisotropy (gradient along / across the road's
    screen-space motion) of this shot against the same crop of the same shot in a 0-blur
    capture (--noblur; every quality preset has motionBlur 0, so the blurred capture needs e.g.
    capture-matrix --drive-mode auto --graphics motionBlur=0.35). Same-view captures of a road
    crop agree within about 4 %, so a 35 % reduction is well above the noise. The KPI 8 checks
    'require' a live (not held) frame with blur on and frames fast enough for the blur pass."""
    vanish = check.get('vanish', [0.5, 0.45])
    value, coverage = flow_anisotropy(img, check, check['crop'], vanish)
    if value is None:
        return {}, {'coverage': coverage, 'invalid': 'crop is not road'}
    values = {'anisotropy': value}
    ref_img = ctx.get('compare_img')
    if ref_img is None:
        return values, {'coverage': coverage, 'na': 'needs --noblur <0-blur capture dir>'}
    ref, ref_coverage = flow_anisotropy(ref_img, check, check['crop'], vanish)
    if ref is None:
        return values, {'coverage': ref_coverage, 'invalid': '0-blur crop is not road'}
    values.update(reference=ref, reduction=1.0 - value / max(ref, 1e-9))
    return values, {'coverage': coverage}


def m_gradient(img, check, ctx):
    """Directional gradient energy (mean |d luma|) along `direction` (y or x) in the crop;
    with ctx['compare_img'] (a 0-blur capture) it reports the change against that capture."""
    def energy(a):
        y0, y1, x0, x1 = crop_box(a.shape, check['crop'])
        lum = luma(a[y0:y1, x0:x1])
        d = np.diff(lum, axis=0 if check.get('direction', 'y') == 'y' else 1)
        return float(np.abs(d).mean())
    values = {'energy': energy(img)}
    ref = ctx.get('compare_img')
    if ref is None:
        return values, {'coverage': 1.0, 'na': 'needs --noblur <0-blur capture dir>'}
    values['reference'] = energy(ref)
    values['reduction'] = 1.0 - values['energy'] / max(values['reference'], 1e-9)
    values['change'] = abs(values['energy'] / max(values['reference'], 1e-9) - 1.0)
    return values, {'coverage': 1.0}


MEASURES = {
    'stats': m_stats,
    'percentiles': m_percentiles,
    'dark_share': m_dark_share,
    'ratio': m_ratio,
    'line_profile': m_line_profile,
    'dark_span': m_dark_span,
    'marker_span': m_marker_span,
    'edge_span': m_edge_span,
    'horizon': m_horizon,
    'stripes': m_stripes,
    'board_coverage': m_board_coverage,
    'crowd': m_crowd,
    'gradient': m_gradient,
    'flow': m_flow,
}


# --------------------------------------------------------------------------------------------
# Targets
# --------------------------------------------------------------------------------------------
def judge(value, target):
    """True/False against a target spec; None when the spec cannot apply to the value."""
    if value is None:
        return None
    if 'range' in target:
        lo, hi = target['range']
        return lo <= value <= hi
    if 'min' in target:
        return value >= target['min']
    if 'max' in target:
        return value <= target['max']
    if 'hex_box' in target:
        a, b = parse_hex(target['hex_box'][0]), parse_hex(target['hex_box'][1])
        tol = target.get('tol', 0)
        v = parse_hex(value)
        return bool(np.all(v >= np.minimum(a, b) - tol) and np.all(v <= np.maximum(a, b) + tol))
    if 'hex_near' in target:
        v, c = parse_hex(value), parse_hex(target['hex_near'])
        return bool(np.all(np.abs(v - c) <= target.get('tol', 20)))
    return None


def describe(target):
    if 'range' in target:
        return '%s-%s' % tuple(fmt(v) for v in target['range'])
    if 'min' in target:
        return '>= ' + fmt(target['min'])
    if 'max' in target:
        return '<= ' + fmt(target['max'])
    if 'hex_box' in target:
        tol = target.get('tol', 0)
        return '%s..%s%s' % (target['hex_box'][0], target['hex_box'][1], f' +-{tol}' if tol else '')
    if 'hex_near' in target:
        return '%s +-%d' % (target['hex_near'], target.get('tol', 20))
    return '-'


def fmt(v):
    if v is None:
        return '-'
    if isinstance(v, str):
        return v
    if isinstance(v, float):
        return ('%.3f' % v) if abs(v) < 10 else ('%.1f' % v)
    return str(v)


def state_mismatch(window, record, strict=False):
    """First field of `window` (dotted diag.json shot-record path -> [lo, hi] or an exact value)
    that the record contradicts, as text; None when it matches. Without a record (legacy
    capture.mjs diag.json) nothing is judged; a field the record lacks is judged only when
    `strict` (then it is a mismatch: the capture cannot show it matches)."""
    if not isinstance(window, dict) or not record:
        return None
    for field, want in window.items():
        if field.startswith('_'):
            continue
        value = dig(record, field)
        if value is None:
            if strict:
                return '%s not recorded (older capture-matrix run)' % field
            continue
        if isinstance(want, list):
            if not isinstance(value, (int, float)) or not want[0] <= value <= want[1]:
                return '%s %s outside %s-%s' % (field, fmt(value), fmt(want[0]), fmt(want[1]))
        elif value != want:
            return '%s is %s, not %s' % (field, json.dumps(value), json.dumps(want))
    return None


def composition_mismatch(targets, record, shot):
    """Driving shots are taken at a recorded place on the lap (driveElapsed: simulated seconds of
    the deterministic autopilot drive from the grid). A shot outside the calibrated window
    (targets['compositions'][shot]) has its position-dependent checks INVALID instead of a verdict
    measured on the wrong surface. Checks marked "gate": false use car-relative crops or whole-frame
    statistics and are always measured. A capture-matrix record without the field (a run from
    before drive positions were recorded, e.g. the live drive of $S/shots/baseline-matrix) is
    INVALID too; legacy capture.mjs captures carry no shot records and are not gated."""
    reason = state_mismatch(targets.get('compositions', {}).get(shot), record, strict=True)
    return reason and 'composition differs from the calibration: ' + reason


def view_mismatch(targets, record, shot):
    """The crops of a shot index belong to one camera view (targets['views']); a capture that put
    another view in that slot (e.g. --drive-views pod,chase) must not be measured with them."""
    want = targets.get('views', {}).get(shot)
    got = (record or {}).get('presentedCamera')
    if want and got and got != want:
        return 'shot %s shows the %s view; its crops are calibrated on %s' % (shot, got, want)
    return None


def dig(obj, path):
    for key in path.split('.'):
        if not isinstance(obj, dict) or key not in obj:
            return None
        obj = obj[key]
    return obj


def shots_in(directory):
    found = {}
    for name in sorted(os.listdir(directory)):
        m = re.match(r'^(\d\d)-.*\.png$', name)
        if m:
            found.setdefault(m.group(1), os.path.join(directory, name))
    return found


# --------------------------------------------------------------------------------------------
# Overlay
# --------------------------------------------------------------------------------------------
COLOURS = {'PASS': (40, 220, 90), 'FAIL': (255, 60, 60), 'INVALID': (255, 200, 0), 'N/A': (160, 160, 160)}


def overlay(path, results, out_path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    d = ImageDraw.Draw(im)
    for r in results:
        col = COLOURS.get(r['result'], (255, 255, 255))
        label = '%s %s' % (r['kpi'], r['id'].split('.', 1)[-1])
        check = r['_check']
        if 'poly' in check:
            pts = [(x * w, y * h) for x, y in check['poly']]
            d.line(pts + [pts[0]], fill=col, width=2)
            d.text((pts[0][0] + 3, pts[0][1] + 2), label, fill=col)
        elif 'crop' in check and check.get('measure') not in ('percentiles',):
            x0, y0, x1, y1 = check['crop']
            d.rectangle([x0 * w, y0 * h, x1 * w, y1 * h], outline=col, width=2)
            d.text((x0 * w + 3, y0 * h + 2), label, fill=col)
        for prim in r.get('_draw', []):
            kind = prim[0]
            if kind == 'box' and prim[1]:
                x0, y0, x1, y1 = prim[1]
                d.rectangle([x0 * w, y0 * h, x1 * w, y1 * h], outline=col, width=2)
                d.text((x0 * w + 3, y0 * h + 2), f'{label} {prim[2]}', fill=col)
            elif kind == 'vline':
                x = prim[1] * w
                d.line([(x, prim[2][0] * h), (x, prim[2][1] * h)], fill=(255, 0, 255), width=2)
            elif kind == 'hline':
                y = prim[1] * h
                d.line([(prim[2][0] * w, y), (prim[2][1] * w, y)], fill=(255, 0, 255), width=2)
            elif kind == 'hspan':
                y = prim[2] * h
                d.line([(prim[1][0] * w, y), (prim[1][1] * w, y)], fill=(255, 0, 255), width=3)
            elif kind == 'poly':
                d.line([(x * w, y * h) for x, y in prim[1]], fill=col, width=2)
        for gauge in check.get('gauge', []):  # target band drawn for geometric KPIs
            if gauge[0] == 'width':
                cx, frac_lo, frac_hi, yy = gauge[1:]
                for frac, shade in ((frac_lo, (0, 200, 255)), (frac_hi, (0, 120, 255))):
                    d.line([((cx - frac / 2) * w, yy * h), ((cx + frac / 2) * w, yy * h)],
                           fill=shade, width=1)
            elif gauge[0] == 'y':
                for yy in gauge[1:]:
                    d.line([(0, yy * h), (w, yy * h)], fill=(0, 160, 255), width=1)
    im.save(out_path)


# --------------------------------------------------------------------------------------------
def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('capture', help='capture directory (NN-*.png + diag.json)')
    ap.add_argument('--targets', default=os.path.join(HERE, 'look-targets.json'))
    ap.add_argument('--json', help='write the full results as JSON to this file')
    ap.add_argument('--overlay', help='write annotated <shot>-overlay.png files to this directory')
    ap.add_argument('--noblur', help='0-blur capture directory for KPI 8 (same views)')
    ap.add_argument('--kpi', help='comma list of KPI ids to run (default all)')
    ap.add_argument('--strict', action='store_true', help='exit 1 when any check FAILs')
    args = ap.parse_args(argv)
    for flag in ('json', 'overlay'):
        if getattr(args, flag):
            outside_repo(getattr(args, flag), '--' + flag)

    with open(args.targets) as f:
        targets = json.load(f)
    shots = shots_in(args.capture)
    noblur = shots_in(args.noblur) if args.noblur else {}
    diag = None
    diag_path = os.path.join(args.capture, 'diag.json')
    if os.path.exists(diag_path):
        with open(diag_path) as f:
            diag = json.load(f)
    wanted = set(args.kpi.split(',')) if args.kpi else None
    records = {'%02d' % rec['index']: rec for rec in (diag or {}).get('shots', [])
               if isinstance(rec, dict) and 'index' in rec}
    cache = {}

    def image(path):
        if path not in cache:
            cache[path] = load(path)
        return cache[path]

    results = []
    for kpi in targets['kpis'] + targets.get('extras', []):
        if wanted and kpi['id'] not in wanted:
            continue
        for check in kpi['checks']:
            r = {'kpi': kpi['id'], 'id': check['id'], 'shot': check.get('shot'),
                 'value_key': check.get('value'), 'target': describe(check.get('target', {})),
                 'baseline': check.get('baseline'), '_check': check, 'note': check.get('note')}
            measure = check['measure']
            if measure == 'diag':
                value = dig(diag, check['path']) if diag else None
                r['measured'] = value
                ok = judge(value, check['target']) if isinstance(value, (int, float)) else None
                r['result'] = 'N/A' if ok is None else ('PASS' if ok else 'FAIL')
                if ok is None:
                    r['reason'] = 'diag.json or %s missing' % check['path']
                results.append(r)
                continue
            path = shots.get(check['shot'])
            if not path:
                r.update(result='N/A', measured=None, reason='shot %s not in capture' % check['shot'])
                results.append(r)
                continue
            record = records.get(check['shot'])
            mismatch = view_mismatch(targets, record, check['shot'])
            if not mismatch and check.get('gate', True):
                mismatch = composition_mismatch(targets, record, check['shot'])
            if not mismatch and 'requires' in check:
                reason = state_mismatch(check['requires'], record)
                mismatch = reason and '%s (%s)' % (check.get('requires_note', 'capture state'), reason)
            if mismatch:
                r.update(result='INVALID', measured=None, reason=mismatch, _path=path)
                results.append(r)
                continue
            img = image(path)
            ctx = {}
            if measure in ('gradient', 'flow') and check['shot'] in noblur:
                ctx['compare_img'] = image(noblur[check['shot']])
            values, info = MEASURES[measure](img, check, ctx)
            value = values.get(check.get('value'))
            r['measured'] = value
            r['values'] = {k: v for k, v in values.items() if k != check.get('value')}
            r['coverage'] = info.get('coverage')
            r['_draw'] = info.get('draw', [])
            r['_path'] = path
            if info.get('na') and value is None:
                r.update(result='N/A', reason=info['na'])
            elif info.get('invalid'):
                r.update(result='INVALID', reason=info['invalid'])
            elif r['coverage'] is not None and r['coverage'] < check.get('min_coverage', 0.5):
                r.update(result='INVALID', reason='only %.0f%% of the crop passes the filter'
                         % (100 * r['coverage']))
            else:
                ok = judge(value, check.get('target', {}))
                r['result'] = 'N/A' if ok is None else ('PASS' if ok else 'FAIL')
                if ok is None:
                    r['reason'] = 'no target / value'
            results.append(r)

    # Table
    print('look-metrics: %s  (targets %s)' % (args.capture, os.path.relpath(args.targets)))
    if diag and diag.get('shots'):
        build = (diag.get('buildIdentity') or {}).get('commit') or '?'
        print('build %s; quality %s' % (str(build)[:12], (diag.get('options') or {}).get('quality')))
        used = {r['shot'] for r in results if r.get('shot')}
        for rec in diag['shots']:
            key = '%02d' % rec['index']
            if key in used:
                drive = ''
                if rec.get('driveElapsed') is not None:
                    later = dig(rec, 'after.driveElapsed')
                    drive = '  drive +%.1f s' % rec['driveElapsed']
                    if later is not None and abs(later - rec['driveElapsed']) >= 0.05:
                        drive = '  drive +%.1f..%.1f s' % (rec['driveElapsed'], later)
                held = ' held' if rec.get('held') else ''
                print('  shot %s %-26s %-9s %-7s %5s km/h  %s calls%s%s' % (
                    key, rec.get('file', '')[3:-4][:26], rec.get('presentedCamera'),
                    rec.get('lighting'), rec.get('speedKmh'), rec.get('drawCalls'), drive, held))
    print('%-3s %-26s %-4s %-12s %-22s %-14s %s' % ('KPI', 'check', 'shot', 'measured', 'target',
                                                    'baseline', 'result'))
    for r in results:
        extra = r.get('reason') or ''
        print('%-3s %-26s %-4s %-12s %-22s %-14s %-7s %s' % (
            r['kpi'], r['id'][:26], r.get('shot') or '-', fmt(r.get('measured'))[:12],
            r['target'][:22], fmt(r.get('baseline'))[:14], r['result'], extra))
    counts = {k: sum(1 for r in results if r['result'] == k) for k in COLOURS}
    judged = counts['PASS'] + counts['FAIL']
    print('summary: %d PASS, %d FAIL, %d INVALID, %d N/A; pass rate %s of judged checks' % (
        counts['PASS'], counts['FAIL'], counts['INVALID'], counts['N/A'],
        ('%.0f%%' % (100.0 * counts['PASS'] / judged)) if judged else '-'))

    if args.overlay:
        os.makedirs(args.overlay, exist_ok=True)
        by_shot = {}
        for r in results:
            if r.get('_path'):
                by_shot.setdefault(r['_path'], []).append(r)
        for path, rs in by_shot.items():
            name = os.path.basename(path)[:-4] + '-overlay.png'
            overlay(path, rs, os.path.join(args.overlay, name))
        print('overlays:', args.overlay)

    if args.json:
        clean = []
        for r in results:
            c = {k: v for k, v in r.items() if not k.startswith('_')}
            clean.append(json.loads(json.dumps(c, default=lambda o: float(o))))
        with open(args.json, 'w') as f:
            json.dump({'capture': os.path.abspath(args.capture), 'targets': os.path.abspath(args.targets),
                       'summary': counts, 'results': clean}, f, indent=1)
        print('json:', args.json)
    return 1 if args.strict and counts['FAIL'] else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
