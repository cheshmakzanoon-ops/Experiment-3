"""Verify the compact diagnostic from saved data only. No game imports or races."""
import csv
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import statistics
import sys

root = Path(sys.argv[1]).resolve()
p = json.loads(gzip.decompress((root / 'compact-analysis-inputs.json.gz').read_bytes()))
a = json.loads((root / 'analysis.json').read_bytes())
assert p['originalTrace']['sha256'] == a['traceSha256']
assert p['originalTrace']['bytes'] == a['traceBytes']
checks = {}
native = [dict(id=t['id'], lap=t['completed'], seconds=t['last'], valid=t['lastValid'],
               crossing=t['lastCrossingTime'], start=t['lastCrossingTime']-t['last'],
               sectors=t['lastSectors'], penalty=t['lastPenalty'])
          for t in p['timing'] if t['completed'] > 0 and t['sector'] == 0]
s = io.StringIO(newline='')
w = csv.writer(s)
w.writerow(['id','lap','seconds','valid','start','crossing','sector1','sector2','sector3','penalty'])
for row in native:
    w.writerow([row['id'],row['lap'],row['seconds'],row['valid'],row['start'],row['crossing'],*row['sectors'],row['penalty']])
checks['nativeLapsCsvByteExact'] = s.getvalue().encode() == (root/'native-laps.csv').read_bytes()
gp = next(t for t in native if t['id']==0 and t['seconds']==a['outcome']['gpBest'])
sbk = next(t for t in native if t['id']==1 and t['seconds']==a['outcome']['sbkBest'])
checks['nativeSectorDeltasExact'] = [x-y for x,y in zip(gp['sectors'],sbk['sectors'])] == a['fastestValidLaps']['sectorDeltasGpMinusSbk']
metrics = ['seconds','trafficBindingSeconds','planBindingSeconds','highDemandSeconds','driveCutSeconds',
           'steeringClipSeconds','lowFrontSeconds','slipThrottleSeconds','steeringThrottleSeconds','leverThrottleSeconds']
agg = {(row['id'],row['lapIndex'],row['stationBin']): row for row in p['aggregates']}
totals = []
for rider in range(6):
    rows = [row for row in p['aggregates'] if row['id']==rider and row['lapIndex']==1]
    totals.append({'id':rider, **{k:sum(row[k] for row in rows) for k in metrics}})
checks['Lap2TotalsExactFromStoredAggregates'] = totals == a['lap2Totals']
bins = []
for b in range(math.ceil(p['trackLength']/100)):
    g,sbkbin = agg[(0,1,b)],agg[(1,1,b)]
    bins.append({'stationStart':b*100,'stationEnd':min((b+1)*100,p['trackLength']),
       'gpSeconds':g['seconds'],'sbkSeconds':sbkbin['seconds'],
       'gpMinusSbkSeconds':g['seconds']-sbkbin['seconds'],
       'gpMeanSpeed':g['speedIntegral']/g['seconds'],'sbkMeanSpeed':sbkbin['speedIntegral']/sbkbin['seconds'],
       **{k:g[k] for k in metrics if k!='seconds'},
       'gpMeanThrottle':g['throttleIntegral']/g['seconds'],'gpMeanBrake':g['brakeIntegral']/g['seconds'],
       'gpMeanAppliedDrive':g['driveIntegral']/g['seconds'],
       'gpMeanRequestedDrive':g['requestedDriveIntegral']/g['seconds'],
       'gpMeanReaction':g['reactionIntegral']/g['seconds']})
s = io.StringIO(newline='')
w = csv.DictWriter(s,fieldnames=list(bins[0]));w.writeheader();w.writerows(bins)
checks['ResidenceCsvByteExactFromStoredAggregates'] = s.getvalue().encode() == (root/'lap2-100m-bins.csv').read_bytes()
ranges = []
for lo,hi in [(0,500),(500,1400),(1400,1800),(1800,2500),(2500,2900),(2900,3200),(3200,3600),(3600,p['trackLength'])]:
    pair=[]
    for rider in (0,1):
        rows=[row for row in p['aggregates'] if row['id']==rider and row['lapIndex']==1 and lo<=row['stationBin']*100<hi]
        pair.append({'id':rider,**{k:sum(row[k] for row in rows) for k in metrics}})
    ranges.append({'from':lo,'to':hi,'gpMinusSbkSeconds':pair[0]['seconds']-pair[1]['seconds'],'riders':pair})
checks['ResidenceRangesExactFromStoredAggregates'] = ranges == a['lap2Ranges']
phase,throttle_errors = {},[]
for rider in (0,2,4):
    rows=[row for row in p['analysisSamples'] if row['id']==rider]
    errors=[abs(row['ai']['final']['planRecovery']-abs(row['ai']['final']['steeringCorrection'])) for row in rows]
    phase[str(rider)]={'samples':len(errors),'meanAbsoluteDifference':statistics.mean(errors),
                      'maximumAbsoluteDifference':max(errors),'samplesAbovePoint1':sum(v>.1 for v in errors)}
    for row in rows:
        pedal=row['ai']['pedals'];steer=row['ai']['steeringThrottle']
        reconstructed=min(pedal['commandThrottle'],pedal['openingLimit'],pedal['slipLimit'],steer['result'],pedal['leverThrottleLimit'])
        throttle_errors.append(abs(reconstructed-pedal['actualThrottle']))
checks['PlanSteerPhaseStatisticsExact'] = phase == a['sampledPlanSteerPhaseDifferences']
checks['ThrottleReconstructionExact'] = max(throttle_errors) == a['sampledThrottleReconstructionMaxError'] == 0
profile_raw=gzip.decompress((root/'profile-window.json.gz').read_bytes())
profile=json.loads(profile_raw)
replay=json.loads((root/'offline-replay.json').read_bytes())
checks['ProfilePayloadMatchesNativeReplayHash'] = hashlib.sha256(profile_raw).hexdigest() == replay['captureSha256']
checks['OriginalNative96ComparisonsPreserved'] = len(profile['profiles']) == replay['profilesVerified'] == 96 and replay['allNativeExact']
checks['RecordedSevenTransitionMatchesPreserved'] = len(profile['comparisons']) == 7 and all(c['exact'] for c in profile['comparisons'])
result={'schema':'compact-data-verification-v1','scope':'Stored-data verification only; no game imports, native rerun or simulation',
        'checks':checks,'allPassed':all(checks.values()),'records':{'timing':len(p['timing']),
        'aggregates':len(p['aggregates']),'analysisSamples':len(p['analysisSamples']),'nativeProfiles':len(profile['profiles'])},
        'limitations':['Residence tables are recomputed from original observer substep aggregates. Individual 240 Hz state inputs were not stored, even in the full original trace; this is not independent reintegration.',
        'The 11,706-record full race trace and unselected planner/physical states are omitted. Full original observer reproduction requires the pinned source, patch, seed and observer command.',
        'The 96 native profile replay receipts are preserved; this verifier checks their payload hashes/results without rerunning native code.']}
print(json.dumps(result,indent=2))
if not result['allPassed']:
    raise SystemExit(1)
