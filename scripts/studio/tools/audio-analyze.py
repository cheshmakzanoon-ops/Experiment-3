#!/usr/bin/env python3
"""Offline audio analysis for the MOTOBOUND audio rig (numpy + Pillow only).

    python3 -I scripts/studio/tools/audio-analyze.py --in DIR --out DIR/analysis.json --shots DIR/shots

Reads DIR/wav/*.wav (32-bit float stereo, written by audio-render.mjs) and DIR/meta.json and
writes per-file metrics, aggregates, ranked findings and spectrogram PNGs.

Every number here is a PROXY: no person listened. K-weighted loudness follows ITU-R BS.1770-4
(applied in the frequency domain, ungated, over the settled part of a short clip), so it is
"LUFS-like", not a broadcast measurement.
"""
import argparse
import json
import math
import os
import struct
import sys

import numpy as np

SKIP_S = 0.6  # master fade-in (setTargetAtTime tau 0.06 s) has settled
DB_FLOOR = -120.0

# --------------------------------------------------------------------------- io


def read_wav(path):
    with open(path, 'rb') as fh:
        raw = fh.read()
    assert raw[:4] == b'RIFF' and raw[8:12] == b'WAVE'
    pos, fmt, data = 12, None, None
    while pos + 8 <= len(raw):
        tag = raw[pos:pos + 4]
        size = struct.unpack('<I', raw[pos + 4:pos + 8])[0]
        body = raw[pos + 8:pos + 8 + size]
        if tag == b'fmt ':
            fmt = struct.unpack('<HHIIHH', body[:16])
        elif tag == b'data':
            data = body
        pos += 8 + size + (size & 1)
    assert fmt and fmt[0] == 3 and fmt[5] == 32, 'expected float32 WAV'
    ch, sr = fmt[1], fmt[2]
    a = np.frombuffer(data, dtype='<f4').reshape(-1, ch).astype(np.float64)
    return sr, a


def db(x):
    return 20.0 * math.log10(max(float(x), 1e-6))


def pdb(x):
    return 10.0 * math.log10(max(float(x), 1e-12))


# ------------------------------------------------------------------ loudness


def _k_response(freqs, sr):
    """|H|^2 of the two BS.1770-4 K-weighting stages at `freqs` (Hz)."""
    w = 2 * np.pi * freqs / sr
    z1 = np.exp(-1j * w)
    z2 = z1 * z1

    def stage(b, a):
        return (b[0] + b[1] * z1 + b[2] * z2) / (a[0] + a[1] * z1 + a[2] * z2)

    g, q, fc = 3.999843853973347, 0.7071752369554196, 1681.974450955533
    k = math.tan(math.pi * fc / sr)
    vh = 10 ** (g / 20)
    vb = vh ** 0.4996667741545416
    a0 = 1 + k / q + k * k
    b1 = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
    a1 = [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    q2, fc2 = 0.5003270373238773, 38.13547087602444
    k2 = math.tan(math.pi * fc2 / sr)
    a02 = 1 + k2 / q2 + k2 * k2
    b2 = [1.0, -2.0, 1.0]
    a2 = [1, 2 * (k2 * k2 - 1) / a02, (1 - k2 / q2 + k2 * k2) / a02]
    h = stage(b1, a1) * stage(b2, a2)
    return np.abs(h) ** 2


def lufs(x, sr):
    """Ungated K-weighted loudness of x[n, ch] (channels summed, G = 1 each)."""
    n = x.shape[0]
    if n < 256:
        return DB_FLOOR
    freqs = np.fft.rfftfreq(n, 1.0 / sr)
    weight = _k_response(freqs, sr)
    total = 0.0
    for c in range(x.shape[1]):
        spec = np.abs(np.fft.rfft(x[:, c])) ** 2
        scale = np.full_like(spec, 2.0)
        scale[0] = 1.0
        if n % 2 == 0:
            scale[-1] = 1.0
        total += float(np.sum(spec * weight * scale)) / (n * n)
    return -0.691 + pdb(total)


def true_peak(x):
    """4x oversampled peak (FFT zero-padding) over all channels."""
    best = 0.0
    for c in range(x.shape[1]):
        spec = np.fft.rfft(x[:, c])
        n = x.shape[0]
        up = np.fft.irfft(spec, n=4 * n) * 4
        best = max(best, float(np.max(np.abs(up))))
    return best


# ------------------------------------------------------------------ spectra


def avg_spectrum(mono, sr, nfft=4096):
    """Mean power spectrum (Hann, 50 % overlap) and its frequency axis."""
    win = np.hanning(nfft)
    if mono.shape[0] < nfft:
        mono = np.pad(mono, (0, nfft - mono.shape[0]))
    hop = nfft // 2
    acc = np.zeros(nfft // 2 + 1)
    count = 0
    for i in range(0, mono.shape[0] - nfft + 1, hop):
        acc += np.abs(np.fft.rfft(mono[i:i + nfft] * win)) ** 2
        count += 1
    return np.fft.rfftfreq(nfft, 1.0 / sr), acc / max(1, count)


BANDS = [('sub', 20, 100), ('low', 100, 500), ('mid', 500, 2000), ('high', 2000, 6000), ('air', 6000, 20000)]


def spectral_features(mono, sr):
    f, p = avg_spectrum(mono, sr)
    p = p.copy()
    p[f < 20] = 0
    tot = float(p.sum()) or 1e-20
    centroid = float((f * p).sum() / tot)
    cum = np.cumsum(p) / tot
    rolloff = float(f[min(len(f) - 1, int(np.searchsorted(cum, 0.85)))])
    nz = p[p > 0]
    flat = float(np.exp(np.mean(np.log(nz))) / np.mean(nz)) if nz.size else 0.0
    bands = {}
    for name, lo, hi in BANDS:
        bands[name] = float(p[(f >= lo) & (f < hi)].sum() / tot)
    return {'centroid_hz': centroid, 'rolloff85_hz': rolloff, 'flatness': flat, 'bands': bands}, f, p


def harmonic_profile(f, p, f_crank, n=12):
    """Peak level (dB re strongest) at the first n multiples of the crank frequency."""
    if f_crank <= 0:
        return [-60.0] * n
    out = []
    for k in range(1, n + 1):
        centre = k * f_crank
        if centre > f[-1] * 0.95:
            out.append(-60.0)
            continue
        sel = (f >= centre * 0.97) & (f <= centre * 1.03)
        out.append(float(p[sel].max()) if sel.any() else 1e-20)
    top = max(out) or 1e-20
    return [max(-60.0, pdb(v / top)) for v in out]


def track_f0(mono, sr, f0, step=0.05, nwin=4096, skip=SKIP_S, ignore=()):
    """Compare the measured spectral comb with the expected fundamental every `step` s.

    For each frame, the scale s in [0.88, 1.12] that maximises the comb salience at s*f0 gives the
    pitch error 1200*log2(s) cents. Frames inside `ignore` (t0, t1) spans are skipped."""
    win = np.hanning(nwin)
    nfft = 16384
    freqs = np.fft.rfftfreq(nfft, 1.0 / sr)
    scales = np.linspace(0.88, 1.12, 49)
    cents, quality = [], []
    nfft = max(nfft, nwin)
    freqs = np.fft.rfftfreq(nfft, 1.0 / sr)
    for i, base in enumerate(f0):
        t = i * step
        if t < skip or t > len(mono) / sr - nwin / sr / 2 - step:
            continue
        if any(a <= t <= b for a, b in ignore) or base < 45 or base > 3000:
            continue
        centre = int(t * sr)
        seg = mono[centre - nwin // 2:centre + nwin // 2]
        if seg.shape[0] < nwin:
            continue
        mag = np.abs(np.fft.rfft(seg * win, n=nfft))
        best, best_s = -1.0, 1.0
        for s in scales:
            sal = 0.0
            for k in range(1, 7):
                fk = k * s * base
                if fk > sr / 2 * 0.9:
                    break
                sal += np.interp(fk, freqs, mag) / math.sqrt(k)
            if sal > best:
                best, best_s = sal, float(s)
        floor = float(np.median(mag[(freqs > base * 0.5) & (freqs < base * 7)])) or 1e-12
        cents.append(1200.0 * math.log2(best_s))
        quality.append(best / (floor * 6))
    if not cents:
        return None
    a = np.abs(np.array(cents))
    return {
        'frames': len(cents),
        'median_abs_cents': float(np.median(a)),
        'p95_abs_cents': float(np.percentile(a, 95)),
        'comb_to_floor': float(np.median(quality)),
    }


# --------------------------------------------------------------- transients


def rms_track(mono, sr, win_ms, hop_ms):
    """Sliding RMS (window win_ms, hop hop_ms) via a cumulative sum of squares."""
    w, h = max(1, int(sr * win_ms / 1000)), max(1, int(sr * hop_ms / 1000))
    if mono.shape[0] < w + h:
        return np.array([math.sqrt(float(np.mean(mono ** 2)))]), h, w
    c = np.concatenate([[0.0], np.cumsum(mono ** 2)])
    starts = np.arange(0, mono.shape[0] - w + 1, h)
    return np.sqrt((c[starts + w] - c[starts]) / w), h, w


def find_clicks(mono, sr, events, skip=SKIP_S, spans=()):
    """Isolated sample-level discontinuities: a 30 ms window whose peak second difference is 4x the
    median of its neighbours' peaks (periodic waveform edges repeat every cycle and do not count)."""
    d2 = np.abs(mono[2:] - 2 * mono[1:-1] + mono[:-2])
    w = int(sr * 0.03)
    m = d2.shape[0] // w
    if m < 12:
        return {'count': 0, 'unexplained': 0, 'worst_ratio': 0.0, 'times': []}
    peaks = d2[:m * w].reshape(m, w).max(axis=1)
    arg = d2[:m * w].reshape(m, w).argmax(axis=1)
    times, worst = [], 0.0
    for i in range(m):
        t = (i * w + int(arg[i])) / sr
        if t < skip:
            continue
        lo, hi = max(0, i - 8), min(m, i + 9)
        around = np.concatenate([peaks[lo:i - 1], peaks[i + 2:hi]]) if hi - lo > 4 else peaks[lo:hi]
        if around.size == 0:
            continue
        ratio = float(peaks[i] / max(np.median(around), 1e-6))
        if ratio > 4.0 and peaks[i] > 0.0015:
            times.append(float(t))
            worst = max(worst, ratio)
    near = lambda t: any(abs(t - e) < 0.12 for e in events) or any(a <= t <= b for a, b in spans)  # noqa: E731
    unexplained = [t for t in times if not near(t)]
    return {
        'count': len(times),
        'unexplained': len(unexplained),
        'worst_ratio': worst,
        'times': [round(t, 3) for t in unexplained[:12]],
    }


def envelope_steps(mono, sr, events, skip=SKIP_S):
    """Largest level change (dB) between adjacent 25 ms windows (5 ms hop) away from known events."""
    env, h, w = rms_track(mono, sr, 25.0, 5.0)
    step_n = max(1, w // h)
    floor = 10 ** (-70 / 20)
    worst, at = 0.0, 0.0
    for i in range(step_n, env.shape[0] - 0):
        a, b = env[i - step_n], env[i]
        if max(a, b) < floor:
            continue
        step = abs(20 * math.log10(max(b, 1e-9) / max(a, 1e-9)))
        t = (i * h + w) / sr
        if t < skip:
            continue
        if step > worst and not any(abs(t - e) < 0.2 for e in events):
            worst, at = step, t
    return {'max_step_db': worst, 'at_s': at}


def shift_dip(mono, sr, events):
    """Level dip and overshoot of the 40 ms envelope around each event vs. the surrounding second."""
    env, h, w = rms_track(mono, sr, 40.0, 5.0)
    out = []
    for e in events:
        i = int(e * sr / h)
        span = int(0.6 * sr / h)
        lo, hi = max(0, i - span), min(env.shape[0], i + span)
        if hi <= lo:
            continue
        ref = float(np.median(env[lo:hi])) or 1e-9
        near = env[max(0, i - int(0.1 * sr / h)):min(env.shape[0], i + int(0.3 * sr / h))]
        if near.size == 0:
            continue
        out.append({'t': e, 'dip_db': pdb((near.min() / ref) ** 2), 'peak_db': pdb((near.max() / ref) ** 2)})
    return out


def bounce_metric(mono, sr):
    """Peak-to-peak swing (dB, 5th-95th percentile) of the 25 ms envelope and its dominant rate (Hz)."""
    env, h, _ = rms_track(mono, sr, 25.0, 5.0)
    env = env[int(SKIP_S * sr / h):]
    if env.shape[0] < 40:
        return {'swing_db': 0.0, 'rate_hz': 0.0}
    lev = 20 * np.log10(env + 1e-9)
    swing = float(np.percentile(lev, 95) - np.percentile(lev, 5))
    spec = np.abs(np.fft.rfft(lev - lev.mean()))
    freqs = np.fft.rfftfreq(lev.shape[0], h / sr)
    band = (freqs >= 2.0) & (freqs <= 40.0)
    rate = float(freqs[band][int(np.argmax(spec[band]))]) if band.any() else 0.0
    return {'swing_db': swing, 'rate_hz': rate}


def loop_seams(mono, sr, period=2.0):
    """Peak second difference within +-3 ms of each multiple of the 2 s noise-bed loop vs. its median."""
    d2 = np.abs(mono[2:] - 2 * mono[1:-1] + mono[:-2])
    med = float(np.median(d2[int(SKIP_S * sr):])) or 1e-9
    worst = 0.0
    t = period
    while t < mono.shape[0] / sr - 0.01:
        i = int(t * sr)
        worst = max(worst, float(d2[max(0, i - 150):i + 150].max()) / med)
        t += period
    return worst


# ---------------------------------------------------------------- per file


def analyse(path, meta):
    sr, x = read_wav(path)
    n = x.shape[0]
    start = min(int(SKIP_S * sr), n // 3) if meta['group'] != 'ui' else 0
    seg = x[start:]
    mono = seg.mean(axis=1)
    left, right = seg[:, 0], seg[:, 1]
    peak = float(np.max(np.abs(x)))
    tp = true_peak(x)
    rms = math.sqrt(float(np.mean(seg ** 2)))
    out = {
        'id': meta['id'],
        'group': meta['group'],
        'vehicle': meta.get('vehicle'),
        'family': meta.get('family'),
        'tags': meta.get('tags', {}),
        'seconds': n / sr,
        'peak_dbfs': db(peak),
        'true_peak_dbfs': db(tp),
        'rms_dbfs': db(rms),
        'lufs': lufs(seg, sr),
        'clip_samples': int(np.sum(np.abs(x) >= 0.999)),
        'over_samples': int(np.sum(np.abs(x) > 1.0)),
        'dc_dbfs': db(max(abs(float(left.mean())), abs(float(right.mean())))),
        'finite': bool(np.isfinite(x).all()),
    }
    if meta['group'] == 'ui':
        env, step, _ = rms_track(x.mean(axis=1), sr, 5.0, 5.0)
        active = env > env.max() * 10 ** (-30 / 20) if env.max() > 0 else env > 0
        mask = np.repeat(active, step)
        mask = np.pad(mask, (0, max(0, n - mask.shape[0])))[:n]
        act = x[mask]
        out['active_ms'] = 1000.0 * float(mask.sum()) / sr
        out['active_rms_dbfs'] = db(math.sqrt(float(np.mean(act ** 2)))) if act.size else DB_FLOOR
        out['lufs'] = lufs(act.reshape(-1, x.shape[1]), sr) if act.size > 512 else DB_FLOOR
    ll, rr = float(np.mean(left ** 2)), float(np.mean(right ** 2))
    cross = float(np.mean(left * right))
    out['stereo'] = {
        'balance_db': pdb(ll) - pdb(rr) if ll > 1e-14 and rr > 1e-14 else 0.0,
        'correlation': cross / math.sqrt(ll * rr) if ll > 1e-14 and rr > 1e-14 else 1.0,
        'mono_fold_db': pdb(float(np.mean(((left + right) / 2) ** 2)) / max((ll + rr) / 2, 1e-14)),
    }
    feats, f, p = spectral_features(mono, sr)
    out['spectrum'] = feats
    events = meta.get('events') or []
    if meta['group'] != 'ui':
        out['clicks'] = find_clicks(x.mean(axis=1), sr, events, spans=meta.get('transients') or [])
        out['steps'] = envelope_steps(x.mean(axis=1), sr, events)
    if events and (meta['group'] in ('engine',) or meta.get('tags', {}).get('scene') == 'start-lights'):
        out['events'] = shift_dip(x.mean(axis=1), sr, events)
    f0 = meta.get('f0')
    if f0:
        ignore = [(e - 0.05, e + 0.35) for e in events]
        steady = meta.get('tags', {}).get('kind') in ('idle', 'mid', 'redline')
        quiet = out['rms_dbfs'] < -70  # a silent voice has no pitch to track (judged separately)
        out['tracking'] = (
            None
            if quiet
            else track_f0(x.mean(axis=1), sr, f0, nwin=16384 if steady else 4096, ignore=ignore)
        )
        crank = float(np.median(f0)) / 2.0
        out['f0_median_hz'] = float(np.median(f0))
        out['harmonics_db'] = harmonic_profile(f, p, crank)
    if meta.get('tags', {}).get('kind') in ('limiter', 'pit', 'mid'):
        out['bounce'] = bounce_metric(x.mean(axis=1), sr)
    if meta['group'] in ('wind', 'weather', 'surface', 'tyre'):
        out['loop_seam_ratio'] = loop_seams(x.mean(axis=1), sr)
    return out, (sr, x)


# -------------------------------------------------------------- spectrogram

_STOPS = [
    (0.0, (4, 4, 18)),
    (0.2, (40, 20, 90)),
    (0.4, (110, 30, 120)),
    (0.6, (200, 60, 80)),
    (0.8, (250, 150, 30)),
    (1.0, (252, 245, 160)),
]


def _lut():
    pos = np.array([s[0] for s in _STOPS])
    lut = np.zeros((256, 3), dtype=np.uint8)
    for c in range(3):
        lut[:, c] = np.interp(np.linspace(0, 1, 256), pos, [s[1][c] for s in _STOPS])
    return lut


def spectrogram_png(path, sr, x, title, width=620, height=300, fmin=40, fmax=16000, events=()):
    from PIL import Image, ImageDraw

    mono = x.mean(axis=1)
    nwin, nfft = 2048, 4096
    hop = max(256, (mono.shape[0] - nwin) // width)
    win = np.hanning(nwin)
    cols = []
    for i in range(0, mono.shape[0] - nwin + 1, hop):
        cols.append(np.abs(np.fft.rfft(mono[i:i + nwin] * win, n=nfft)))
    if not cols:
        return False
    s = np.array(cols).T
    freqs = np.fft.rfftfreq(nfft, 1.0 / sr)
    rows = np.geomspace(fmin, min(fmax, sr / 2 * 0.98), height)
    img = np.empty((height, s.shape[1]))
    for j in range(s.shape[1]):
        img[:, j] = np.interp(rows, freqs, s[:, j])
    level = 20 * np.log10(img + 1e-9)
    top = level.max()
    norm = np.clip((level - (top - 78)) / 78, 0, 1)[::-1]
    rgb = _lut()[(norm * 255).astype(np.uint8)]
    pic = Image.fromarray(rgb).resize((width, height), Image.BILINEAR)
    margin_l, margin_b, margin_t = 46, 18, 16
    canvas = Image.new('RGB', (width + margin_l + 6, height + margin_b + margin_t), (14, 14, 18))
    canvas.paste(pic, (margin_l, margin_t))
    d = ImageDraw.Draw(canvas)
    d.text((margin_l, 2), title[:96], fill=(235, 235, 235))
    for hz in (100, 250, 500, 1000, 2000, 4000, 8000, 16000):
        if hz < fmin or hz > rows[-1]:
            continue
        y = margin_t + height - 1 - int(height * math.log(hz / fmin) / math.log(rows[-1] / fmin))
        d.line([(margin_l - 3, y), (margin_l, y)], fill=(200, 200, 200))
        d.text((2, y - 5), f'{hz / 1000:g}k' if hz >= 1000 else f'{hz}', fill=(200, 200, 200))
    dur = mono.shape[0] / sr
    for t in range(int(dur) + 1):
        xx = margin_l + int(width * t / dur)
        d.line([(xx, margin_t + height), (xx, margin_t + height + 3)], fill=(200, 200, 200))
        d.text((xx + 2, margin_t + height + 4), f'{t}s', fill=(200, 200, 200))
    for e in events:
        xx = margin_l + int(width * e / dur)
        d.line([(xx, margin_t), (xx, margin_t + 6)], fill=(120, 255, 160))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    canvas.quantize(colors=128, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)
    return True


def heatmap_png(path, dist, cell=22):
    from PIL import Image, ImageDraw

    labels, m = dist['vehicles'], np.array(dist['matrix'])
    n = len(labels)
    left, top = 58, 58
    canvas = Image.new('RGB', (left + n * cell + 8, top + n * cell + 20), (14, 14, 18))
    d = ImageDraw.Draw(canvas)
    hi = float(np.percentile(m[m > 0], 90)) if (m > 0).any() else 1.0
    lut = _lut()
    for i in range(n):
        for j in range(n):
            t = 1.0 - min(1.0, m[i, j] / hi)  # near = bright (a near-duplicate pair glows)
            c = tuple(int(v) for v in lut[int(t * 255)])
            d.rectangle([left + j * cell, top + i * cell, left + (j + 1) * cell - 2, top + (i + 1) * cell - 2], fill=c)
        d.text((4, top + i * cell + 5), labels[i], fill=(220, 220, 220))
        d.text((left + i * cell + 1, top - 12 - (i % 2) * 10), labels[i][:5], fill=(220, 220, 220))
    d.text((4, 4), 'Engine voice distance (bright = close = near-duplicate)', fill=(235, 235, 235))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    canvas.quantize(colors=96, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)


# Representative spectrograms written to docs/studio/reports/audio-screens/.
SHOTS = [
    'engine__apx01__pull__cockpit',
    'engine__apx01__shift__cockpit',
    'engine__apx01__lift__cockpit',
    'engine__gt8f__pull__cockpit',
    'engine__sc7__pull__cockpit',
    'engine__eh3__pull__cockpit',
    'engine__xh3__pull__cockpit',
    'engine__sk125__pull__cockpit',
    'engine__dx8__pull__cockpit',
    'engine__gpr1__pull__cockpit',
    'engine__mx450__pull__cockpit',
    'engine__mx250__pull__cockpit',
    'tyre__squeal__heavy',
    'surface__gravel',
    'wind__60',
    'weather__storm',
    'weather__rain-heavy',
    'impact__heavy',
    'airborne__landing5',
    'mix__formula-pull',
    'mix__grid-12-cars',
    'mix__passby',
    'ui__confirm',
    'ui__deny',
]


# ------------------------------------------------------------------ judging


def median(values):
    return float(np.median(values)) if values else 0.0


def build_aggregates(files):
    agg = {}
    # Engine loudness per kind across every machine.
    engine = [r for r in files if r['group'] == 'engine' and r['tags'].get('kind') in ('mid', 'redline')]
    for kind in ('mid', 'redline'):
        rows = [r for r in engine if r['tags'].get('kind') == kind and r['id'].endswith('__cockpit')]
        if not rows:
            continue
        med = median([r['lufs'] for r in rows])
        agg[f'engine_{kind}'] = {
            'median_lufs': med,
            'min_lufs': min(r['lufs'] for r in rows),
            'max_lufs': max(r['lufs'] for r in rows),
            'outliers_3db': [
                {'vehicle': r['vehicle'], 'family': r['family'], 'lufs': r['lufs'], 'delta': r['lufs'] - med}
                for r in sorted(rows, key=lambda r: abs(r['lufs'] - med), reverse=True)
                if abs(r['lufs'] - med) > 3.0
            ],
            'by_vehicle': {r['vehicle']: round(r['lufs'], 2) for r in rows},
        }
    # Peak across everything.
    agg['worst_true_peak'] = sorted(
        ({'id': r['id'], 'true_peak_dbfs': r['true_peak_dbfs']} for r in files),
        key=lambda r: -r['true_peak_dbfs'],
    )[:8]
    agg['over_minus1'] = [r['id'] for r in files if r['true_peak_dbfs'] > -1.0]
    agg['clipped'] = [r['id'] for r in files if r['clip_samples'] > 0 or r['over_samples'] > 0]
    return agg


def feature_vector(rec_mid, rec_red):
    """Columns for the distinctness distance (all in comparable units)."""
    v, names = [], []

    def add(name, value, weight=1.0):
        v.append(value * weight)
        names.append(name)

    for tag, rec in (('mid', rec_mid), ('red', rec_red)):
        add(f'{tag}_pitch_oct', math.log2(max(rec['f0_median_hz'], 20) / 100.0), 1.0)
        add(f'{tag}_centroid_oct', math.log2(max(rec['spectrum']['centroid_hz'], 20) / 500.0), 1.0)
        add(f'{tag}_flat', rec['spectrum']['flatness'] * 6, 1.0)
        for band, share in rec['spectrum']['bands'].items():
            add(f'{tag}_{band}', share * 3.0, 0.8)
        for k, h in enumerate(rec['harmonics_db'][:8]):
            add(f'{tag}_h{k + 1}', h / 20.0, 0.5)
    return np.array(v), names


def distinctness(files, reps):
    by_id = {r['id']: r for r in files}
    vecs, names, label = [], None, []
    for v in reps:
        mid = by_id.get(f'engine__{v}__mid__cockpit')
        red = by_id.get(f'engine__{v}__redline__cockpit')
        if not mid or not red or 'harmonics_db' not in mid or 'harmonics_db' not in red:
            continue
        vec, names = feature_vector(mid, red)
        vecs.append(vec)
        label.append(v)
    if len(vecs) < 3:
        return None
    m = np.array(vecs)
    n = len(label)
    dist = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            dist[i, j] = float(np.linalg.norm(m[i] - m[j]))
    pairs = sorted(
        ({'a': label[i], 'b': label[j], 'distance': float(dist[i, j])} for i in range(n) for j in range(i + 1, n)),
        key=lambda p: p['distance'],
    )
    med = median([p['distance'] for p in pairs])
    return {
        'vehicles': label,
        'matrix': np.round(dist, 3).tolist(),
        'median_pair_distance': med,
        'closest_pairs': pairs[:12],
        'features': names,
    }


def near_duplicates(files):
    """Vehicles whose engines are all but identical by simple perceptual criteria at mid and redline."""
    by_id = {r['id']: r for r in files}
    vehicles = sorted({r['vehicle'] for r in files if r['group'] == 'engine' and r['tags'].get('kind') == 'mid'})
    out = []

    def close(a, b):
        if 'harmonics_db' not in a or 'harmonics_db' not in b:
            return None
        dp = abs(math.log2(max(a['f0_median_hz'], 1) / max(b['f0_median_hz'], 1)))
        dc = abs(math.log2(max(a['spectrum']['centroid_hz'], 1) / max(b['spectrum']['centroid_hz'], 1)))
        dh = float(np.mean(np.abs(np.array(a['harmonics_db']) - np.array(b['harmonics_db']))))
        return dp, dc, dh

    for i, va in enumerate(vehicles):
        for vb in vehicles[i + 1:]:
            ra, rb = by_id.get(f'engine__{va}__mid__cockpit'), by_id.get(f'engine__{vb}__mid__cockpit')
            if not ra or not rb:
                continue
            c = close(ra, rb)
            if c and c[0] < 0.08 and c[1] < 0.12 and c[2] < 2.5:
                out.append({'a': va, 'b': vb, 'pitch_oct': c[0], 'centroid_oct': c[1], 'harmonic_db': c[2]})
    return out


def judge(files, agg, dist, dups, meta):
    """Findings ranked by severity, each with the measured numbers."""
    f = []
    by_id = {r['id']: r for r in files}

    def add(sev, code, title, detail, data=None):
        f.append({'severity': sev, 'code': code, 'title': title, 'detail': detail, 'data': data or {}})

    # 1 clipping / ceiling
    over = [r for r in files if r['true_peak_dbfs'] > -1.0 and r['group'] != 'ui']
    clipped = [r for r in files if r['clip_samples'] > 0 or r['over_samples'] > 0]
    if clipped or over:
        add('high', 'A1', 'Output above the -1 dBFS ceiling',
            f'{len(over)} renders exceed -1 dBFS true peak, {len(clipped)} clip.',
            {'worst': [(r['id'], round(r['true_peak_dbfs'], 1)) for r in sorted(over, key=lambda r: -r['true_peak_dbfs'])[:6]]})
    # 2 overall headroom use: is the game audibly quiet?
    eng = [r for r in files if r['group'] == 'engine' and r['id'].endswith('__cockpit') and r['tags'].get('kind') in ('mid', 'redline', 'pull')]
    if eng:
        med = median([r['lufs'] for r in eng])
        if med < -26:
            add('high', 'A2', 'Default master level is very quiet',
                f'Engine loudness in the cockpit at the default volume is {med:.1f} LUFS median '
                f'(target about -24 to -18 LUFS for the dominant sound), peaks {median([r["peak_dbfs"] for r in eng]):.1f} dBFS.',
                {'median_lufs': med})
    # 3 engine spread
    for kind in ('mid', 'redline'):
        a = agg.get(f'engine_{kind}')
        if a and a['outliers_3db']:
            add('medium', 'A3', f'Engine loudness spread at {kind} throttle',
                f'{len(a["outliers_3db"])} machines are more than 3 dB from the {a["median_lufs"]:.1f} LUFS median '
                f'(range {a["min_lufs"]:.1f} to {a["max_lufs"]:.1f}).',
                {'outliers': a['outliers_3db'][:10]})
    # 4 ambience and effects against the engine: the stems of each mix scene when they were
    # rendered (pre-limiter, one bus at a time), else the stand-alone scenes against the formula pull.
    scenes = sorted({r['id'].split('__stem-')[0] for r in files if '__stem-' in r['id']})
    rows = []
    for sc in scenes:
        e, fx, am = (by_id.get(f'{sc}__stem-{k}') for k in ('engine', 'effects', 'ambience'))
        if e and fx and am and 'grid' not in sc and 'passby' not in sc:
            rows.append((sc.replace('mix__', ''), am['lufs'] - e['lufs'], fx['lufs'] - e['lufs']))
    if rows:
        loud = [(s, d) for s, d, _ in rows if d > -12.0]
        if loud:
            add('high', 'A4', 'Ambience is not 12 dB below the engine',
                'Ambience stem minus engine stem (mix scenes): ' + ', '.join(f'{s} {d:+.1f} dB' for s, d in loud) + '.',
                {'rows': rows})
        # continuous effects (rolling, spray, rain) 6 dB under the engine; a squeal is a warning, 3 dB
        loudfx = [(s, d) for s, _, d in rows if 'start-lights' not in s and d > (-3.0 if 'squeal' in s else -6.0)]
        if loudfx:
            add('medium', 'A15', 'Tyre / surface / spray effects within 6 dB of the engine',
                'Effects stem minus engine stem: ' + ', '.join(f'{s} {d:+.1f} dB' for s, d in loudfx) + '.',
                {'rows': rows})
    else:
        ref = by_id.get('engine__apx01__pull__cockpit')
        if ref:
            rows = []
            for sid in ('wind__30', 'wind__60', 'wind__90', 'weather__rain-light', 'weather__rain-heavy', 'weather__storm', 'weather__gale', 'weather__snow', 'weather__dust', 'weather__fog'):
                r = by_id.get(sid)
                if r:
                    rows.append((sid, r['lufs'] - ref['lufs']))
            loud = [(s, d) for s, d in rows if d > -12.0]
            if loud:
                add('high', 'A4', 'Ambience is not 12 dB below the engine',
                    'Ambience beds against the formula pull (engine only): ' + ', '.join(f'{s} {d:+.1f} dB' for s, d in loud) + '.',
                    {'rows': rows})
    # 5 UI levels
    ui = [r for r in files if r['group'] == 'ui' and r['id'] != 'ui__driving-cues']
    bad = [r for r in ui if not (-18.0 <= r['active_rms_dbfs'] <= -12.0)]
    if bad:
        add('medium', 'A5', 'UI cue level outside -18..-12 dBFS RMS',
            f'{len(bad)} of {len(ui)} cues: ' + ', '.join(f'{r["tags"].get("cue")} {r["active_rms_dbfs"]:.1f}' for r in bad) + ' (active-window RMS at the default volume).',
            {'cues': {r['tags'].get('cue'): round(r['active_rms_dbfs'], 1) for r in ui}})
    # 6 clicks
    clicky = [r for r in files if r.get('clicks') and r['clicks']['unexplained'] > 0]
    if clicky:
        add('medium', 'A6', 'Discontinuities away from any scheduled event',
            f'{len(clicky)} renders have sample-level clicks that no gear/impact event explains.',
            {'worst': [(r['id'], r['clicks']['unexplained'], round(r['clicks']['worst_ratio'], 1)) for r in sorted(clicky, key=lambda r: -r['clicks']['worst_ratio'])[:8]]})
    steps = [r for r in files if r.get('steps') and r['steps']['max_step_db'] > 6.0 and r['group'] in ('engine', 'mix')
             and r['tags'].get('kind') not in ('limiter', 'pit')]  # the limiter bounce is intended modulation
    if steps:
        add('medium', 'A7', 'Abrupt level steps',
            f'{len(steps)} renders step more than 6 dB between adjacent 25 ms windows away from events.',
            {'worst': [(r['id'], round(r['steps']['max_step_db'], 1), round(r['steps']['at_s'], 2)) for r in sorted(steps, key=lambda r: -r['steps']['max_step_db'])[:8]]})
    # 7 gear-change dips
    dips = [(r['id'], e['dip_db']) for r in files if r.get('events') for e in r['events'] if r['tags'].get('kind') in ('shift', 'pull') and e['dip_db'] < -9.0]
    if dips:
        add('medium', 'A8', 'Gear changes dip the engine by more than 9 dB',
            f'{len(dips)} gear changes: ' + ', '.join(f'{i} {d:.1f}' for i, d in dips[:6]),
            {'dips': dips[:20]})
    # 8 pitch tracking
    bad_track = [r for r in files if r.get('tracking') and r['tags'].get('kind') != 'idle' and r['tags'].get('stem') is None and r['tracking']['median_abs_cents'] > 60]
    if bad_track:
        add('medium', 'A9', 'Engine pitch does not follow the RPM',
            f'{len(bad_track)} renders have median pitch error above 60 cents.',
            {'worst': [(r['id'], round(r['tracking']['median_abs_cents'])) for r in sorted(bad_track, key=lambda r: -r['tracking']['median_abs_cents'])[:6]]})
    # 9 distinctness
    if dups:
        add('low', 'A10', 'Machines with near-identical engine voices',
            f'{len(dups)} pairs closer than 0.08 octave in pitch, 0.12 octave in centroid and 2.5 dB in harmonic profile at mid throttle.',
            {'pairs': dups[:12]})
    # 9b limiter / pit limiter bounce
    for kind, code, what in (('limiter', 'A16', 'rev limiter'), ('pit', 'A17', 'pit limiter')):
        # electric and fuel-cell drive have no rev limiter to bounce
        rows = [r for r in files if r['tags'].get('kind') == kind and r.get('bounce') and r['rms_dbfs'] > -70
                and not (kind == 'limiter' and r.get('family') in ('electric', 'fuel-cell'))]
        flat = [r for r in rows if r['bounce']['swing_db'] < 3.0]
        if rows and flat:
            add('medium', code, f'No audible {what} cue',
                f'{len(flat)} of {len(rows)} machines hold a steady note on the {what} (envelope swing under 3 dB): '
                + ', '.join(r['vehicle'] for r in flat[:8]) + '.', {})
    # 9c start sequence audible: each lamp tick must rise at least 4 dB over the engine bed
    start = by_id.get('mix__start-lights')
    if start and start.get('events'):
        lamps = start['events'][:5]
        weak = [round(e['peak_db'], 1) for e in lamps if e['peak_db'] < 4.0]
        if weak:
            add('medium', 'A18', 'The start lamps are inaudible',
                f'{len(weak)} of 5 lamp events rise less than 4 dB over the idling engine ({weak}).', {})
    # 10 mono / DC / silence
    mono_bad = [r for r in files if r['stereo']['mono_fold_db'] < -3.0 and r['rms_dbfs'] > -60]
    if mono_bad:
        add('low', 'A11', 'Mono fold-down loses more than 3 dB',
            f'{len(mono_bad)} renders: ' + ', '.join(f'{r["id"]} {r["stereo"]["mono_fold_db"]:.1f}' for r in mono_bad[:6]),
            {})
    dc = [r for r in files if r['dc_dbfs'] > -60 and r['rms_dbfs'] > -80]
    if dc:
        add('low', 'A12', 'DC offset above -60 dBFS', ', '.join(f'{r["id"]} {r["dc_dbfs"]:.1f}' for r in dc[:6]), {})
    silent = [r for r in files if r['group'] in ('engine',) and r['rms_dbfs'] < -70]
    if silent:
        add('high', 'A13', 'Engine renders that are silent', ', '.join(r['id'] for r in silent[:8]), {})
    seams = [r for r in files if r.get('loop_seam_ratio', 0) > 40]
    if seams:
        add('low', 'A14', 'Audible loop seams in noise beds',
            ', '.join(f'{r["id"]} x{r["loop_seam_ratio"]:.0f}' for r in seams[:6]), {})
    order = {'high': 0, 'medium': 1, 'low': 2}
    f.sort(key=lambda x: (order[x['severity']], x['code']))
    return f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--shots', default=None)
    ap.add_argument('--no-shots', action='store_true')
    ap.add_argument('--reps', default=None, help='comma list for the distinctness matrix')
    args = ap.parse_args()
    meta = json.load(open(os.path.join(args.src, 'meta.json')))
    files, audio_for_shots = [], {}
    for m in meta['scenarios']:
        path = os.path.join(args.src, 'wav', m['file'])
        rec, data = analyse(path, m)
        files.append(rec)
        if m['id'] in SHOTS:
            audio_for_shots[m['id']] = (data, m)
    # the distinctness matrix covers the machines that have the full engine suite (the representatives)
    reps = args.reps.split(',') if args.reps else sorted(
        {r['vehicle'] for r in files if r['group'] == 'engine' and r['tags'].get('kind') == 'pull' and r['id'].endswith('__cockpit')}
    )
    agg = build_aggregates(files)
    dist = distinctness(files, reps)
    dups = near_duplicates(files)
    findings = judge(files, agg, dist, dups, meta)
    result = {
        'label': meta.get('label'),
        'volume': meta.get('volume'),
        'files': files,
        'aggregates': agg,
        'distinctness': dist,
        'near_duplicates': dups,
        'findings': findings,
    }
    json.dump(result, open(args.out, 'w'), indent=1, default=float)
    if args.shots and not args.no_shots and dist:
        heatmap_png(os.path.join(args.shots, 'distinctness-matrix.png'), dist)
    if args.shots and not args.no_shots:
        for sid, ((sr, x), m) in audio_for_shots.items():
            spectrogram_png(os.path.join(args.shots, f'{sid}.png'), sr, x, f'{m["label"]}  [{sid}]', events=m.get('events') or [])
    print(f'analysed {len(files)} files -> {args.out}')
    for item in findings:
        print(f'  [{item["severity"].upper():6}] {item["code"]:4} {item["title"]}: {item["detail"]}')


if __name__ == '__main__':
    sys.exit(main())
