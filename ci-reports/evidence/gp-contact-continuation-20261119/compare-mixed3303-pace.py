from pathlib import Path
import gzip, json, math, hashlib

base = Path(__file__).resolve().parent
labels = ['contact-throttle', 'history-only']
sources = {}
for label in labels:
    prefix = base / f'{label}-mixed3303-pace'
    summary = json.loads(prefix.with_name(prefix.name + '-summary.json').read_text())
    data = json.loads(gzip.decompress(prefix.with_name(prefix.name + '-rows.json.gz').read_bytes()))
    sources[label] = (summary, [[dict(zip(data['columns'], row)) for row in rider] for rider in data['rows']])

def best_lap(summary, rider):
    result = summary['result'][rider]
    best = result['lap']['best']
    events = [e for e in summary['events'] if e['id'] == rider and e['lap']['last'] == best]
    assert events, (rider, best)
    event = events[0]
    # Outer race time also includes the pre-racing clock. The native lap
    # counter stores its own timestamp; translate the exact timed start so
    # lap-index zero excludes the grid run before the first timing crossing.
    clock_offset = event['time'] - event['lap']['lastTime']
    start = event['lap']['lapStart'] - event['lap']['last'] + clock_offset
    return event['lap']['completed'] - 1, start

def numeric(v):
    return isinstance(v, (int, float)) and math.isfinite(v)

def describe(rows):
    numeric_fields = ['speed','targetSpeed','throttle','brake','driveForce','frontBrakeForce','rearBrakeForce',
                      'longitudinal','frontLoad','rearLoad','gpDemand','rollDemand','frontUse','rearUse']
    out = {'samples': len(rows)}
    for field in numeric_fields:
        vals = [r[field] for r in rows if numeric(r[field])]
        out[field] = {'mean': sum(vals) / len(vals), 'min': min(vals), 'max': max(vals)} if vals else None
    for field in ['lean','leanRate','lateral','rawPath','gpAy','rollStoredAy']:
        vals = [abs(r[field]) for r in rows if numeric(r[field])]
        out['abs_' + field] = {'mean': sum(vals) / len(vals), 'max': max(vals)} if vals else None
    counts = {}
    for r in rows:
        key = str(r['limitedBy'])
        counts[key] = counts.get(key, 0) + 1
    out['limitedByCounts'] = counts
    out['blockerFraction'] = sum(r['blocker'] >= 0 for r in rows) / len(rows) if rows else 0
    out['airborneFraction'] = sum(bool(r['airborne']) for r in rows) / len(rows) if rows else 0
    out['frontUnloadedFraction'] = sum(r['frontLoad'] <= 0 for r in rows) / len(rows) if rows else 0
    out['rearUnloadedFraction'] = sum(r['rearLoad'] <= 0 for r in rows) / len(rows) if rows else 0
    out['brakingFraction'] = sum(r['brake'] > 0.01 for r in rows) / len(rows) if rows else 0
    out['throttleFraction'] = sum(r['throttle'] > 0.01 for r in rows) / len(rows) if rows else 0
    return out

length = sources[labels[0]][0]['trackLength']
by_rider = {}
for rider in range(6):
    item = {}
    for label, (summary, rows) in sources.items():
        lap, start = best_lap(summary, rider)
        selected = [r for r in rows[rider] if r['lap'] == lap and r['time'] >= start]
        result = summary['result'][rider]
        item[label] = {'bestLapIndex': lap, 'bestTimedStart': start, 'bestTime': result['lap']['best'],
                       'crashes': result['crashes'], 'overall': describe(selected), 'segments': []}
        reference = result['lap']['reference']['best']
        assert abs(reference['256'] - result['lap']['best']) < 1e-10
        for n in range(16):
            lo, hi = n * length / 16, (n + 1) * length / 16
            segment = [r for r in selected if lo <= r['station'] < hi]
            item[label]['segments'].append({'start': lo, 'end': hi,
                'nativeElapsed': reference[str((n+1)*16)] - reference[str(n*16)],
                'nativeCumulative': reference[str((n+1)*16)], **describe(segment)})
    item['bestTimeDelta'] = item[labels[1]]['bestTime'] - item[labels[0]]['bestTime']
    item['segmentDeltas'] = [{'start': a['start'], 'end': a['end'], 'delta': b['nativeElapsed']-a['nativeElapsed'],
        'aElapsed': a['nativeElapsed'], 'bElapsed': b['nativeElapsed'],
        'aSpeed': a['speed']['mean'] if a['speed'] else None, 'bSpeed': b['speed']['mean'] if b['speed'] else None,
        'aBlocker': a['blockerFraction'], 'bBlocker': b['blockerFraction'],
        'aLimitedBy': a['limitedByCounts'], 'bLimitedBy': b['limitedByCounts'],
        'aThrottle': a['throttle']['mean'] if a['throttle'] else None, 'bThrottle': b['throttle']['mean'] if b['throttle'] else None,
        'aBrake': a['brake']['mean'] if a['brake'] else None, 'bBrake': b['brake']['mean'] if b['brake'] else None,
        'aDemand': a['gpDemand']['mean'] if a['gpDemand'] else None, 'bDemand': b['gpDemand']['mean'] if b['gpDemand'] else None}
        for a,b in zip(item[labels[0]]['segments'],item[labels[1]]['segments'])]
    by_rider[rider] = item

out = {'diagnostic': True, 'sources': {k: {'commit': s['sourceCommit'], 'gpBest': s['gpBest'], 'sbkBest': s['sbkBest'],
       'originalChecks': s['originalChecks'], 'sourceSummarySha256': hashlib.sha256((base / f'{k}-mixed3303-pace-summary.json').read_bytes()).hexdigest()}
       for k,(s,_) in sources.items()}, 'trackLength': length, 'byRider': by_rider,
       'limitations': ['Segment elapsed times are exact native stored best-lap references, in 16 equal-station bins.',
         'Other segment statistics are unweighted 30 Hz samples, with extra lap/fall samples. They describe different executed trajectories, not one-step counterfactuals.',
         'The fastest GP rider differs between sources. Crash-induced field separation may alter traffic; the lap time difference is not by itself a physical pace difference.',
         'Unstamped steeringThrottle outputs are excluded from comparisons. Last live gpSteer fields may precede a later airborne substep in the same outer tick.',
         'Observer stop counter also visits the terminal FINISHED tick, where all riders have finished; this is immaterial to the recorded max stop.']}
(base/'mixed3303-history-pace-comparison.json').write_text(json.dumps(out,indent=2)+'\n')
for rider in [0,2,4]:
    item=by_rider[rider]
    print(json.dumps({'id':rider,'oldBest':item[labels[0]]['bestTime'],'newBest':item[labels[1]]['bestTime'],
                     'oldBestLap':item[labels[0]]['bestLapIndex'],'newBestLap':item[labels[1]]['bestLapIndex'],
                     'delta':item['bestTimeDelta'],'largestLosses':sorted(item['segmentDeltas'],key=lambda r:r['delta'],reverse=True)[:6]},indent=2))
