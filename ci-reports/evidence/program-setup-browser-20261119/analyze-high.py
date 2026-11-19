"""Read exact retained High artifact; no browser execution or source mutation."""
from pathlib import Path
from collections import Counter
import base64, gzip, hashlib, io, json, re, sys, zipfile

archive=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
def save(name,data):
    b=(json.dumps(data,indent=2)+'\n').encode()
    (out/(name+'.gz' if len(b)>50000 else name)).write_bytes(gzip.compress(b,mtime=0) if len(b)>50000 else b)

def decode(v,refs=None):
    if refs is None:refs={}
    if not isinstance(v,dict):return v
    if 'ref' in v:return refs[v['ref']]
    if 'o' in v:
        result={}
        if 'id' in v:refs[v['id']]=result
        for entry in v['o']:result[entry['k']]=decode(entry['v'],refs)
        return result
    if 'a' in v:
        result=[]
        if 'id' in v:refs[v['id']]=result
        result.extend(decode(x,refs) for x in v['a']);return result
    for key in ['s','n','b']:
        if key in v:return v[key]
    if 'v' in v:return None if v['v']=='null' else {'serializedValue':v['v']}
    return v

manifest=[];tests=[];native=[];test_events=[];browser_events=[];trace_bytes=None
with zipfile.ZipFile(archive) as z:
    html=z.read('playwright-report/index.html').decode()
    match=re.search(r'<script[^>]+id="playwrightReportBase64"[^>]*>(.*?)</script>',html,re.S)
    payload=match[1].strip().split('base64,',1)[-1]
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(payload))) as report:
        save('report-metadata.json',json.loads(report.read('report.json')))
        for name in report.namelist():
            if not name.endswith('.json') or name=='report.json':continue
            data=json.loads(report.read(name))
            if not isinstance(data,dict):continue
            selected=[t for t in data.get('tests',[]) if 'High production scene presents' in t.get('title','')]
            if not selected:continue
            tests.extend(selected);save('test-detail.json',data)
            for test in selected:
                for result in test.get('results',[]):
                    for a in result.get('attachments',[]):
                        row={'name':a.get('name'),'contentType':a.get('contentType')}
                        if a.get('contentType')=='application/json' and 'body' in a:
                            b=a['body'].encode();filename=Path(a['name']).name
                            if not filename.endswith('.json'):filename+='.json'
                            (out/(filename+'.gz' if len(b)>50000 else filename)).write_bytes(gzip.compress(b,mtime=0) if len(b)>50000 else b)
                            row.update({'file':filename+'.gz' if len(b)>50000 else filename,'bytes':len(b),'sha256':sha(b)})
                        elif a.get('path'):
                            target='playwright-report/'+a['path'];info=z.getinfo(target)
                            row.update({'archivePath':target,'bytes':info.file_size,'extracted':False})
                            if a.get('name')=='trace':
                                trace_bytes=z.read(target);row.update({'sha256':sha(trace_bytes),'analyzedInMemory':True})
                            elif a.get('contentType')=='image/png':
                                b=z.read(target);filename=Path(a['name']).name
                                (out/filename).write_bytes(b);row.update({'file':filename,'sha256':sha(b),'extracted':True})
                        manifest.append(row)
    for name in ['browser-backend.json','browser-progress.json']:
        if name in z.namelist():(out/name).write_bytes(z.read(name))

assert len(tests)==1
test=tests[0];summary={'source':sys.argv[3],'run':int(sys.argv[4]),'job':int(sys.argv[5]),'title':test['title'],'outcome':test.get('outcome'),'durationMs':test.get('duration'),'results':[{k:r.get(k) for k in ['status','duration','retry','errors']} for r in test.get('results',[])],'traceAvailable':trace_bytes is not None}
if trace_bytes:
    with zipfile.ZipFile(io.BytesIO(trace_bytes)) as trace:
        for name in trace.namelist():
            if not name.endswith('.trace'):continue
            rows=[json.loads(line) for line in trace.read(name).splitlines()]
            if name=='test.trace':test_events.extend(rows)
            else:browser_events.extend(rows)
            for r in rows:
                if r.get('type')=='console' and r.get('text','').startswith('APEX_HIGH_STARTUP '):
                    native.append({'traceTime':r.get('time'),'pageId':r.get('pageId'),**json.loads(r['text'][len('APEX_HIGH_STARTUP '):])})
    (out/'native-console-records.jsonl.gz').write_bytes(gzip.compress((''.join(json.dumps(r)+'\n' for r in native)).encode(),mtime=0))
    before={r['callId']:r for r in test_events if r['type']=='before'}
    after={r['callId']:r for r in test_events if r['type']=='after'}
    predicates=[r for r in before.values() if r.get('title')=='Expect "poll toBe"' and r.get('params',{}).get('expected')=='paused']
    predicate=predicates[0] if predicates else None
    readiness_start=predicate['startTime'] if predicate else None
    summary['readinessPredicate']={'configuredTimeoutMs':90000,'before':predicate,'after':after.get(predicate['callId']) if predicate else None}
    stages=[{k:r.get(k) for k in ['traceTime','atMs','stage','active']}|{'relativeToReadinessMs':r['traceTime']-readiness_start if readiness_start is not None else None} for r in native if r.get('kind')=='stage']
    summary['stages']=stages
    summary['firstChase'] = next((r for r in stages if 'Warming shadows and scene reflections' in r.get('stage','')),None)
    activity=[r for r in native if r.get('kind')=='activity']
    summary['nativeConsoleRecords']=len(native);summary['activityRecords']=len(activity);summary['lastActivity']=activity[-1] if activity else None
    late=[r for r in native if r.get('kind')=='late-program']
    summary['latePrograms']=[]
    for r in late:
        seq=r['sequence'];starts=[a['lastStarted'] for a in activity if (a.get('lastStarted') or {}).get('sequence')==seq];ends=[a['lastCompleted'] for a in activity if (a.get('lastCompleted') or {}).get('sequence')==seq];slows=[s for a in activity for s in a.get('slowCalls',[]) if s.get('sequence')==seq]
        summary['latePrograms'].append({k:r.get(k) for k in ['sequence','traceTime','stage','program','framebuffer','cubeFace','viewport','stack']}|{shader:{k:(r.get(shader) or {}).get(k) for k in ['shader','hash','shaderName','sourceLength','truncated']} for shader in ['vertex','fragment']}|{'lastStart':starts[-1] if starts else None,'lastCompletion':ends[-1] if ends else None,'retainedSlowCall':slows[-1] if slows else None,'maxObservedInFlightMs':max([a.get('observedInFlightMs',0) for a in activity if (a.get('lastStarted') or {}).get('sequence')==seq]+[0])})
    save('late-program-identities.json',late)
    uploads=[r for r in native if r.get('kind')=='slow-upload'];save('slow-uploads.json',uploads);summary['retainedSlowUploads']=len(uploads)
    assertion_rows=[]
    for call,r in before.items():
        if r.get('method') not in ['expect','test.step']:continue
        locations=[s for s in r.get('stack',[]) if 'graphics-high-journey.spec.ts' in s.get('file','')]
        if not locations:continue
        ending=after.get(call)
        assertion_rows.append({'callId':call,'title':r.get('title'),'location':locations[0],'startTime':r.get('startTime'),'endTime':ending.get('endTime') if ending else None,'error':ending.get('error') if ending else None})
    save('assertion-timeline.json',assertion_rows)
    reads={r['callId']:r for r in browser_events if r.get('type')=='before' and r.get('method')=='evaluateExpression' and 'apexDiagnostics' in str(r.get('params'))}
    diagnostic_rows=[]
    for r in browser_events:
        if r.get('type')=='after' and r.get('callId') in reads and 'result' in r:
            d=decode(r['result'].get('value'));diagnostic_rows.append({'callId':r['callId'],'endTime':r.get('endTime'),'diagnostic':d})
    if diagnostic_rows:
        save('last-trace-diagnostic.json',diagnostic_rows[-1]);summary['lastTraceDiagnosticEndTime']=diagnostic_rows[-1]['endTime'];summary['lastTraceDiagnosticState']=diagnostic_rows[-1]['diagnostic'].get('state')
        save('diagnostic-timeline.json',[{'callId':r['callId'],'endTime':r['endTime'],'state':r['diagnostic'].get('state'),'renderer':{k:(r['diagnostic'].get('renderer') or {}).get(k) for k in ['preparation','construction','presentationPurpose','gpuFrameQueue']}} for r in diagnostic_rows])
    summary['consoleErrorsAndWarnings']=[{k:r.get(k) for k in ['time','messageType','text']} for r in browser_events if r.get('type')=='console' and r.get('messageType') in ['error','warning']]
summary['limitations']=['Native CPU call time may include queued earlier driver work; it is not isolated GPU execution time.','Bounded records may omit earlier completions or late resource owners.','The current program during an upload does not prove the uploaded resource owner.','A readiness deadline failure is not proof of an infinite stall.']
save('attachment-manifest.json',manifest);save('native-analysis.json',summary)
print(json.dumps({k:summary.get(k) for k in ['outcome','durationMs','traceAvailable','firstChase','lastActivity','latePrograms','retainedSlowUploads','lastTraceDiagnosticState']},indent=2))
