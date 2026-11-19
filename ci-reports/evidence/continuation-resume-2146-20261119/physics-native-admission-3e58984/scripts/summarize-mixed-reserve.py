from pathlib import Path
import json, hashlib
base=Path(__file__).parent
records={k:json.loads((base/f'mixed{k}-reserve.json').read_text()) for k in ('7ac','3e')}
fields=('historicalWins','currentHistoryLarger','currentHistorySmaller','extraCurrentSamples','sampledCurrentWouldWin','trialSamples','trialPedalChanged','trialReleasedNetForce','trialReducedNetForce','tractionCut','trafficLimited','planLimited','throttleBelowHalf','braking','driveRequestedImpulse','driveAppliedImpulse')
def digest(path):
 raw=path.read_bytes();return {'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
def totals(source,id):
 bins=[b for b in records[source]['bins']if b['id']==id]
 return {k:sum(b[k]for b in bins)for k in fields}
def window(id,lo,hi):
 result={'id':id,'lap':1,'stationFrom':lo,'stationToExclusive':hi,'sources':{}}
 for source,a in records.items():
  bins=[b for b in a['bins']if b['id']==id and b['lap']==1 and lo<=b['stationStart']<hi]
  samples=sum(b['trajectorySamples']for b in bins)
  result['sources'][source]={'timeSeconds':sum(b['timeSeconds']for b in bins),'means':{k:sum(b[k+'Sum']for b in bins)/samples for k in ('speed','target','free','traffic','plan','planNext')},'control':{k:sum(b[k]for b in bins)for k in fields},'bins':bins}
 result['timeDifferenceSeconds']=result['sources']['3e']['timeSeconds']-result['sources']['7ac']['timeSeconds']
 return result
summary={'status':'Diagnostic only;3e remains unaccepted. No reserve policy changed.','sourceCommits':{'7ac':'7ac509f9198ae5d5b06c9a17edd2177caa799115','3e':'3e58984936a9e1ba2821580688a723fb93053fa4'},'sources':{},'windows':[window(2,1850,2150),window(2,1950,2150),window(2,1800,2300),window(0,1000,1100),window(0,3000,3200)],'files':{},'limitations':['Station bins are50m and sample residence time at1/120s; they do not follow identical trajectories across sources.','The final-finisher lap event is not appended because the exact original loop exits after PHASE.FINISHED; final best/classification values and native control bins are still retained. No sector value is invented for that omitted event.','This collector does not hook fall(); incident lap/station attribution from its residence bins and yellow response remains inference until a bounded onset capture.','Current force is queried at actual committed bar/current contacts/prior Fx. Allocation trials freeze existing controller demand/target/trim/bar and do not prove future arrest or final-force fixed-point adequacy.','Allocation replays cover a10Hz subset of historical-winning states. Nonwinning10Hz samples separately retain current-would-win counts and strongest states.','Positive net longitudinal-force delta is not a time-gain estimate; it may mean more drive or less braking. Negative delta may mean more braking or less drive.','JSON represents nonfinite diagnostic aggregates as null; these are not used as finite means. All native acceptance/replay comparisons occurred before serialization.']}
for source,a in records.items():
 summary['sources'][source]={k:a[k]for k in ('gpBest','sbkBest','margin','crashes','longestStop','originalConditions','observations','allLiveQueryHashesEqual','trialPairs','originalAllocationReplaysExact','final','laps','sourcesBefore','scriptSha256')}
 summary['sources'][source]['perRider']={str(id):totals(source,id)for id in (0,2,4)}
 for suffix in ('.json','-guard.json','-guard.log','-guard-manifest.json'):
  name=f'mixed{source}-reserve'+suffix;summary['files'][name]=digest(base/name)
summary['files']['record-mixed-reserve.mjs']=digest(base/'record-mixed-reserve.mjs')
summary['files']['summarize-mixed-reserve.py']=digest(Path(__file__))
(base/'mixed-reserve-comparison.json').write_text(json.dumps(summary,indent=2)+'\n')
compact={'scope':'Selected native pre-pedal states from the two complete external recordings; no live counterfactual was applied.','sources':{source:{'trace':digest(base/f'mixed{source}-reserve.json'),'sourceHashes':a['sourcesBefore'],'fixtures':a['fixtures']}for source,a in records.items()}}
(base/'mixed-reserve-native-fixtures.json').write_text(json.dumps(compact,indent=2)+'\n')
print(json.dumps({'summary':digest(base/'mixed-reserve-comparison.json'),'fixtures':digest(base/'mixed-reserve-native-fixtures.json')},indent=2))
