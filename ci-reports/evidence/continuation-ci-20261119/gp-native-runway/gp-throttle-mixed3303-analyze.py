"""Offline analysis of the single frozen-source observer; never imports the game."""
import csv
import hashlib
import json
import math
import statistics
import sys
from pathlib import Path

trace_path = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2]).resolve()
out.mkdir(parents=True, exist_ok=True)
raw = trace_path.read_bytes()
d = json.loads(raw)
if not d['outcome']['numericReproduced'] or not d['source']['sourceStable']:
    raise RuntimeError('Cannot analyze an unreproduced or unstable source result')
def number(value):
    return float(value) if value in ('Infinity', '-Infinity', 'NaN') else value
def dump(name, value):
    (out / name).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
def source_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

native_laps = [
    dict(id=t['id'], lap=t['completed'], seconds=t['last'], valid=t['lastValid'],
         crossing=t['lastCrossingTime'], start=t['lastCrossingTime']-t['last'],
         sectors=t['lastSectors'], penalty=t['lastPenalty'])
    for t in d['timing'] if t['completed'] > 0 and t['sector'] == 0
]
with (out / 'native-laps.csv').open('w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['id', 'lap', 'seconds', 'valid', 'start', 'crossing', 'sector1', 'sector2', 'sector3', 'penalty'])
    for t in native_laps:
        writer.writerow([t['id'], t['lap'], t['seconds'], t['valid'], t['start'], t['crossing'], *t['sectors'], t['penalty']])
gp_lap = next(t for t in native_laps if t['id'] == 0 and t['seconds'] == d['outcome']['gpBest'])
sbk_lap = next(t for t in native_laps if t['id'] == 1 and t['seconds'] == d['outcome']['sbkBest'])
sector_deltas = [a-b for a,b in zip(gp_lap['sectors'], sbk_lap['sectors'])]
metrics = ['seconds', 'trafficBindingSeconds', 'planBindingSeconds', 'highDemandSeconds',
           'driveCutSeconds', 'steeringClipSeconds', 'lowFrontSeconds', 'slipThrottleSeconds',
           'steeringThrottleSeconds', 'leverThrottleSeconds']
aggregate = {(a['id'], a['lapIndex'], a['stationBin']): a for a in d['aggregates']}
lap_totals = []
for rider in range(6):
    rows = [a for a in d['aggregates'] if a['id'] == rider and a['lapIndex'] == 1]
    lap_totals.append({'id': rider, **{k: sum(a[k] for a in rows) for k in metrics}})
bins = []
for b in range(math.ceil(d['trackLength'] / 100)):
    gp, sbk = aggregate[(0,1,b)], aggregate[(1,1,b)]
    bins.append({'stationStart': b*100, 'stationEnd': min((b+1)*100, d['trackLength']),
                 'gpSeconds': gp['seconds'], 'sbkSeconds': sbk['seconds'],
                 'gpMinusSbkSeconds': gp['seconds']-sbk['seconds'],
                 'gpMeanSpeed': gp['speedIntegral']/gp['seconds'],
                 'sbkMeanSpeed': sbk['speedIntegral']/sbk['seconds'],
                 **{k: gp[k] for k in metrics if k != 'seconds'},
                 'gpMeanThrottle': gp['throttleIntegral']/gp['seconds'],
                 'gpMeanBrake': gp['brakeIntegral']/gp['seconds'],
                 'gpMeanAppliedDrive': gp['driveIntegral']/gp['seconds'],
                 'gpMeanRequestedDrive': gp['requestedDriveIntegral']/gp['seconds'],
                 'gpMeanReaction': gp['reactionIntegral']/gp['seconds']})
with (out / 'lap2-100m-bins.csv').open('w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=list(bins[0]))
    writer.writeheader(); writer.writerows(bins)
ranges = []
for lo,hi in [(0,500),(500,1400),(1400,1800),(1800,2500),(2500,2900),(2900,3200),
              (3200,3600),(3600,d['trackLength'])]:
    pair = []
    for rider in (0,1):
        rows = [a for a in d['aggregates'] if a['id'] == rider and a['lapIndex'] == 1 and lo <= a['stationBin']*100 < hi]
        pair.append({'id': rider, **{k: sum(a[k] for a in rows) for k in metrics}})
    ranges.append({'from': lo, 'to': hi, 'gpMinusSbkSeconds': pair[0]['seconds']-pair[1]['seconds'], 'riders': pair})

gp_plans = [p for p in d['planning'] if p['id'] == 0 and p['rider']['completed'] == 1]
transitions = []
for previous,current in zip(gp_plans, gp_plans[1:]):
    if current['after']['limitedBy'] != previous['after']['limitedBy']:
        transitions.append({'from': previous['after']['limitedBy'], 'to': current['after']['limitedBy'],
            'tick': current['tick'], 'raceTime': current['raceTime'], 'station': current['rider']['s'],
            'speed': current['rider']['speed'], 'previousCap': previous['result']['speedLimit'],
            'currentCap': current['result']['speedLimit'],
            'capChange': current['result']['speedLimit']-previous['result']['speedLimit'],
            'previousRunway': previous['pace']['runway'], 'currentRunway': current['pace']['runway'],
            'freeSpeed': current['pace']['freeSpeed'], 'blocker': current['after']['blocker']})
window = [p for p in gp_plans if 145.4 <= p['raceTime'] <= 146.05]
selected_states = [s for s in d['samples'] if s['id']==0 and s['completed']==1
                   and (145.4<=s['raceTime']<=146.15 or 180.5<=s['raceTime']<=181.3)]
dump('planner-transition-window.json', {'planning': window, 'samples': selected_states,
    'note': 'Actual original calls and last-substep samples, copied verbatim. The 10 Hz post-step sample AI phase precedes its physics phase; planner phase is explicitly timestamped.'})
dump('planner-rule-transitions.json', transitions)
passing_events = []
for p in gp_plans:
    if (p['after']['blocker'] != p['before']['blocker'] or p['after']['aborts'] != p['before']['aborts']):
        target = next(o for o in p['others'] if o['id'] == 1)
        gap = (target['s']-p['rider']['s']+d['trackLength']/2)%d['trackLength']-d['trackLength']/2
        passing_events.append({'raceTime': p['raceTime'], 'station': p['rider']['s'], 'gapToSbk1': gap,
            'speed': p['rider']['speed'], 'sbk1Speed': target['speed'], 'pace': p['pace'],
            'before': p['before'], 'after': p['after'], 'result': p['result']})

phase_errors, pedal_errors = {}, []
for rider in (0,2,4):
    samples = [s for s in d['samples'] if s['id']==rider and s['completed']==1 and s['finishTime']==0]
    errors = [abs(s['ai']['final']['planRecovery']-abs(s['ai']['final']['steeringCorrection'])) for s in samples]
    phase_errors[str(rider)] = {'samples': len(errors), 'meanAbsoluteDifference': statistics.mean(errors),
                               'maximumAbsoluteDifference': max(errors), 'samplesAbovePoint1': sum(e>.1 for e in errors)}
    for s in samples:
        pedals,steering = s['ai']['pedals'],s['ai']['steeringThrottle']
        reconstructed = min(pedals['commandThrottle'],pedals['openingLimit'],pedals['slipLimit'],
                            steering['result'],pedals['leverThrottleLimit'])
        pedal_errors.append(abs(reconstructed-pedals['actualThrottle']))
summary = {
    'scope': 'Offline analysis only; no simulation or game import',
    'traceSha256': hashlib.sha256(raw).hexdigest(), 'traceBytes': len(raw),
    'analysisScriptSha256': source_hash(__file__), 'source': d['source'],
    'outcome': d['outcome'], 'records': {'samples': len(d['samples']), 'planning': len(d['planning']),
        'nativeTimingEvents': len(d['timing']), 'incidents': len(d['incidents'])},
    'fastestValidLaps': {'gp': gp_lap, 'sbk': sbk_lap, 'sectorDeltasGpMinusSbk': sector_deltas},
    'lap2Totals': lap_totals, 'lap2Ranges': ranges,
    'lap2BinTimeQuantization': 'Residence sums use the native 1/240 s physical substep, keyed by pre-step centreline station and lap completion. They approximate crossing-based time; use native sectors for exact lap attribution.',
    'sampledPlanSteerPhaseDifferences': phase_errors,
    'sampledThrottleReconstructionMaxError': max(pedal_errors),
    'passingEventsGp0Lap2': passing_events,
    'keyPlannerTransition': [t for t in transitions if 145.4 <= t['raceTime'] <= 146.05],
    'disposition': 'Original race fails unchanged pace assertions. Observer exit 0 proves exact reproduction and source stability only. No corrective source change or broader acceptance run authorized by this diagnostic.',
}
dump('analysis.json', summary)
print(json.dumps({'traceSha256': summary['traceSha256'], 'nativeSectorDeltas': sector_deltas,
                  'pedalReconstructionMaxError': max(pedal_errors), 'records': summary['records'],
                  'sourceStable': d['source']['sourceStable'], 'raceAccepted': d['outcome']['originalRaceAccepted']}))
