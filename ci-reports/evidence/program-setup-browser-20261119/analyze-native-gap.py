"""Extract bounded native accounting gaps; no application execution."""
from pathlib import Path
import gzip,json,sys

p=Path(sys.argv[1]).resolve()
rows=[json.loads(s) for s in gzip.decompress((p/'native-console-records.jsonl.gz').read_bytes()).splitlines()]
a=[r for r in rows if r.get('kind')=='activity' and 'Warming shadows and scene reflections' in r.get('stage','')]
plateaus=[]
for prev,r in zip(a,a[1:]):
    if r['lastCompleted'] and r['lastCompleted']['method']=='useProgram' and prev.get('lastCompleted',{}).get('sequence')==r['lastCompleted']['sequence']:
        if not plateaus or plateaus[-1]['sequence']!=r['lastCompleted']['sequence']:
            plateaus.append({'sequence':r['lastCompleted']['sequence'],'from':prev['traceTime'],'to':r['traceTime'],
                             'method':'useProgram','returned':r['lastCompleted'].get('returned'),
                             'lastCpuMs':r['lastCompleted'].get('cpuCallMs'),'inFlight':r['inFlight']})
        else:plateaus[-1]['to']=r['traceTime']
for row in plateaus:row['observedPlateauMs']=row['to']-row['from']
diagnostic=json.loads(gzip.decompress((p/'high-gp-last-diagnostic.json.gz').read_bytes()))['lastDiagnostic']
stage=next(s for s in diagnostic['renderer']['preparation']['stages'] if 'Warming shadows and scene reflections' in s['label'])
d={'scope':'Bounded native API accounting during the labelled chase/shadow/reflection warmup; not isolated GPU execution timing.',
   'chaseStageElapsedMs':stage['elapsedMs'],'activitySamples':len(a),'firstTraceTime':a[0]['traceTime'],'lastTraceTime':a[-1]['traceTime'],
   'sampleSpanMs':a[-1]['traceTime']-a[0]['traceTime'],
   'firstInstrumentedCpuMs':sum(a[0]['cpuMs'].values()),'lastInstrumentedCpuMs':sum(a[-1]['cpuMs'].values()),
   'instrumentedCpuDeltaMs':sum(a[-1]['cpuMs'].values())-sum(a[0]['cpuMs'].values()),
   'returnedUseProgramPlateaus':[p for p in plateaus if p['observedPlateauMs']>=500],
   'interpretation':['Large elapsed gaps after returned useProgram calls are outside the wrapped API accounting; the trace does not identify their CPU/driver/GPU ownership.',
                     'The stage label changes before the first pit-service fence; production order confirms that this fence also covers the preceding whole chase submission. Its pending time cannot be attributed solely to pit-service work.',
                     'The sum uses the first and last observed activity samples within the stage, not an exact CPU profile of the entire stage.']}
(p/'chase-native-gap.json').write_text(json.dumps(d,indent=2)+'\n')
print(json.dumps({k:d[k] for k in ['chaseStageElapsedMs','activitySamples','sampleSpanMs','instrumentedCpuDeltaMs']}))
