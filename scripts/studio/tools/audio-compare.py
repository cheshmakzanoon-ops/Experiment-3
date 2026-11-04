#!/usr/bin/env python3
"""Before/after tables from two audio-analyze.py outputs (docs/studio/reports/audio.md).

    python3 -I scripts/studio/tools/audio-compare.py BEFORE/analysis.json AFTER/analysis.json [--stress B A] [--json OUT]

Prints Markdown. Every figure is a numeric proxy measured offline on the production graph; no one listened.
"""
import json
import sys

import numpy as np


def load(path):
    a = json.load(open(path))
    return a, {r['id']: r for r in a['files']}


def f1(x):
    return f'{x:.1f}'


def row(label, b, a, unit='', digits=1):
    d = a - b
    return f'| {label} | {b:.{digits}f} | {a:.{digits}f} | {d:+.{digits}f} {unit} |'


def main():
    args = sys.argv[1:]
    bj, bf = load(args[0])
    aj, af = load(args[1])
    stress = None
    if '--stress' in args:
        i = args.index('--stress')
        stress = (load(args[i + 1])[1], load(args[i + 2])[1])
    out = {}
    lines = []

    def table(title, header, rows):
        lines.append(f'\n#### {title}\n')
        lines.append(header)
        lines.append('|' + '---|' * (header.count('|') - 1))
        lines.extend(rows)

    # 1 engine loudness
    rows = []
    for k in ('idle', 'mid', 'redline', 'pull'):
        i = f'engine__apx01__{k}__cockpit'
        rows.append(row(f'APX-01 {k} (LUFS)', bf[i]['lufs'], af[i]['lufs'], 'dB'))
        out[f'apx01_{k}_lufs'] = [bf[i]['lufs'], af[i]['lufs']]
    for k in ('mid', 'redline'):
        key = f'engine_{k}'
        b, a = bj['aggregates'][key], aj['aggregates'][key]
        rows.append(row(f'all machines, {k}: median LUFS', b['median_lufs'], a['median_lufs'], 'dB'))
        rows.append(row(f'all machines, {k}: range (max - min)', b['max_lufs'] - b['min_lufs'], a['max_lufs'] - a['min_lufs'], 'dB'))
        rows.append(f"| all machines, {k}: outside median +-3 dB | {len(b['outliers_3db'])} | {len(a['outliers_3db'])} | |")
        out[f'spread_{k}'] = [b['max_lufs'] - b['min_lufs'], a['max_lufs'] - a['min_lufs']]
    swell_b = bj['aggregates']['engine_redline']['median_lufs'] - bj['aggregates']['engine_mid']['median_lufs']
    swell_a = aj['aggregates']['engine_redline']['median_lufs'] - aj['aggregates']['engine_mid']['median_lufs']
    rows.append(row('redline minus mid, median (dB; positive = louder with revs)', swell_b, swell_a, 'dB'))
    out['swell'] = [swell_b, swell_a]
    table('Engine loudness, cockpit, default volume (0.45)', '| metric | before | after | change |', rows)

    # 2 peaks
    def peaks(files):
        sel = [r for r in files.values() if r['group'] in ('engine', 'mix', 'tyre', 'surface', 'wind', 'weather', 'impact', 'airborne', 'ui')]
        worst = max(sel, key=lambda r: r['true_peak_dbfs'])
        return worst['true_peak_dbfs'], worst['id'], sum(1 for r in sel if r['true_peak_dbfs'] > -1.0), sum(1 for r in sel if r['clip_samples'] > 0)

    pb, pa = peaks(bf), peaks(af)
    rows = [
        f'| worst true peak, default volume (dBFS) | {pb[0]:.1f} ({pb[1]}) | {pa[0]:.1f} ({pa[1]}) | |',
        f'| renders above -1 dBFS / clipping, default volume | {pb[2]} / {pb[3]} | {pa[2]} / {pa[3]} | |',
    ]
    if stress:
        sb, sa = stress
        for label, files in (('before', sb), ('after', sa)):
            sel = [r for r in files.values() if r['group'] == 'mix']
            w = max(sel, key=lambda r: r['true_peak_dbfs'])
            out[f'stress_{label}'] = [w['true_peak_dbfs'], w['id'], sum(1 for r in sel if r['true_peak_dbfs'] > -1.0), sum(1 for r in sel if r['clip_samples'] > 0), len(sel)]
        b, a = out['stress_before'], out['stress_after']
        rows.append(f'| STRESS: master volume 1.0, all mix scenes, worst true peak (dBFS) | {b[0]:.1f} ({b[1]}) | {a[0]:.1f} ({a[1]}) | |')
        rows.append(f'| STRESS: scenes above -1 dBFS / clipped (of {b[4]}) | {b[2]} / {b[3]} | {a[2]} / {a[3]} | |')
        lufs_b = np.median([r['lufs'] for r in sb.values() if r['group'] == 'mix'])
        lufs_a = np.median([r['lufs'] for r in sa.values() if r['group'] == 'mix'])
        rows.append(row('STRESS: median mix loudness at volume 1.0 (LUFS)', lufs_b, lufs_a, 'dB'))
    table('Peaks and headroom', '| metric | before | after | |', rows)

    # 3 UI cues
    rows = []
    for cue in ('tick', 'select', 'confirm', 'open', 'close', 'deny'):
        b, a = bf[f'ui__{cue}'], af[f'ui__{cue}']
        rows.append(f"| {cue} | {b['active_rms_dbfs']:.1f} | {a['active_rms_dbfs']:.1f} | peak {a['true_peak_dbfs']:.1f} dBFS |")
    b, a = bf['ui__driving-cues'], af['ui__driving-cues']
    rows.append(f"| driving cue tones (accessibility) | {b['active_rms_dbfs']:.1f} | {a['active_rms_dbfs']:.1f} | peak {a['true_peak_dbfs']:.1f} dBFS |")
    table('Menu sounds, active-window RMS (dBFS) at the default volume (target -18 to -12)', '| cue | before | after | |', rows)

    # 4 stems per mix scene
    def scenes(files):
        s = sorted({r['id'].split('__stem-')[0] for r in files.values() if '__stem-' in r['id']})
        res = {}
        for sc in s:
            e, fx, am = (files.get(f'{sc}__stem-{k}') for k in ('engine', 'effects', 'ambience'))
            if e and fx and am and 'grid' not in sc and 'passby' not in sc:
                res[sc.replace('mix__', '')] = (am['lufs'] - e['lufs'], fx['lufs'] - e['lufs'])
        return res

    sb, sa = scenes(bf), scenes(af)
    rows = []
    for k in sb:
        if k in sa:
            rows.append(f'| {k} | {sb[k][0]:+.1f} | {sa[k][0]:+.1f} | {sb[k][1]:+.1f} | {sa[k][1]:+.1f} |')
    out['stems'] = {k: [sb[k], sa[k]] for k in sb if k in sa}
    table('Level balance per mix scene: stem minus engine stem (dB, pre-limiter; target ambience <= -12)', '| scene | ambience before | ambience after | effects before | effects after |', rows)

    # 5 effects
    rows = []
    for group, ids in (
        ('tyre', ['tyre__squeal__light', 'tyre__squeal__moderate', 'tyre__squeal__heavy', 'tyre__squeal__locked']),
        ('surface', [f'surface__{s}' for s in ('asphalt', 'kerb', 'grass', 'gravel', 'dirt', 'mud', 'sand', 'snow', 'ice')]),
        ('wind', ['wind__30', 'wind__60', 'wind__90']),
        ('weather', ['weather__rain-light', 'weather__rain-heavy', 'weather__storm', 'weather__gale', 'weather__dust', 'weather__snow', 'weather__fog']),
        ('impact', ['impact__light', 'impact__medium', 'impact__heavy']),
        ('airborne', ['airborne__landing2', 'airborne__landing5', 'airborne__landing8']),
    ):
        for i in ids:
            if i in bf and i in af:
                b, a = bf[i], af[i]
                rows.append(f"| {i} | {b['lufs']:.1f} | {a['lufs']:.1f} | {b['peak_dbfs']:.1f} | {a['peak_dbfs']:.1f} |")
    table('Effects and ambience rendered alone (engine silent), default volume', '| scene | before LUFS | after LUFS | before peak | after peak |', rows)

    # 6 cues and events
    rows = []
    for kind, label in (('limiter', 'rev limiter'), ('pit', 'pit limiter')):
        for v in ('apx01', 'gt8f', 'gpr1', 'sk125', 'mx450'):
            i = f'engine__{v}__{kind}__cockpit'
            if i in bf and i in af and bf[i].get('bounce'):
                rows.append(f"| {label}, {v}: envelope swing (dB) / rate (Hz) | {bf[i]['bounce']['swing_db']:.1f} / {bf[i]['bounce']['rate_hz']:.0f} | {af[i]['bounce']['swing_db']:.1f} / {af[i]['bounce']['rate_hz']:.0f} | |")
    sb_, sa_ = bf.get('mix__start-lights'), af.get('mix__start-lights')
    if sb_ and sa_ and sb_.get('events'):
        rows.append(f"| start lamps: rise over the idling engine (dB, mean of 5) | {np.mean([e['peak_db'] for e in sb_['events'][:5]]):.1f} | {np.mean([e['peak_db'] for e in sa_['events'][:5]]):.1f} | |")
    for i in ('engine__eh3__idle__cockpit', 'engine__xh3__idle__cockpit'):
        rows.append(f"| {i.split('__')[1]} standstill hum (LUFS) | {bf[i]['lufs']:.1f} | {af[i]['lufs']:.1f} | |")
    table('Cues that did not exist', '| metric | before | after | |', rows)

    # 7 counts
    def count(a, code):
        return next((len(f['data'].get('pairs', f['data'].get('worst', []))) for f in a['findings'] if f['code'] == code), 0)

    rows = [
        f"| gear changes dipping the engine > 9 dB | {sum(1 for r in bf.values() for e in (r.get('events') or []) if r['group'] == 'engine' and r['tags'].get('kind') in ('shift', 'pull') and e['dip_db'] < -9)} | {sum(1 for r in af.values() for e in (r.get('events') or []) if r['group'] == 'engine' and r['tags'].get('kind') in ('shift', 'pull') and e['dip_db'] < -9)} | |",
        f"| renders with unexplained clicks | {sum(1 for r in bf.values() if (r.get('clicks') or {}).get('unexplained'))} | {sum(1 for r in af.values() if (r.get('clicks') or {}).get('unexplained'))} | |",
        f"| near-identical engine pairs | {len(bj['near_duplicates'])} | {len(aj['near_duplicates'])} | |",
        f"| machines with pitch error > 60 cents (non-idle) | {sum(1 for r in bf.values() if r.get('tracking') and r['tags'].get('kind') not in ('idle', None) and r['tags'].get('stem') is None and r['tracking']['median_abs_cents'] > 60)} | {sum(1 for r in af.values() if r.get('tracking') and r['tags'].get('kind') not in ('idle', None) and r['tags'].get('stem') is None and r['tracking']['median_abs_cents'] > 60)} | |",
        f"| median pitch error, pulls (cents) | {np.median([r['tracking']['median_abs_cents'] for r in bf.values() if r.get('tracking') and r['tags'].get('kind') == 'pull']):.1f} | {np.median([r['tracking']['median_abs_cents'] for r in af.values() if r.get('tracking') and r['tags'].get('kind') == 'pull']):.1f} | |",
        f"| worst mono fold-down loss (dB) | {min(r['stereo']['mono_fold_db'] for r in bf.values() if r['rms_dbfs'] > -60):.1f} | {min(r['stereo']['mono_fold_db'] for r in af.values() if r['rms_dbfs'] > -60):.1f} | |",
        f"| worst DC offset (dBFS) | {max(r['dc_dbfs'] for r in bf.values() if r['rms_dbfs'] > -80):.1f} | {max(r['dc_dbfs'] for r in af.values() if r['rms_dbfs'] > -80):.1f} | |",
    ]
    table('Defect counts', '| metric | before | after | |', rows)

    print('\n'.join(lines))
    if '--json' in args:
        json.dump(out, open(args[args.index('--json') + 1], 'w'), indent=1, default=float)


if __name__ == '__main__':
    main()
