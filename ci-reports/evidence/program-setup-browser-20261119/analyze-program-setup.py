"""Analyze the passive program-setup records in one retained High artifact.

Usage: python analyze-program-setup.py HIGH_OUTPUT_DIRECTORY
Reads only extracted original trace/attachment data. No browser execution.
"""
from pathlib import Path
from collections import Counter
import gzip, hashlib, json, sys

p = Path(sys.argv[1]).resolve()

def read_json(name):
    path = p / name
    if path.exists():
        return json.loads(path.read_bytes())
    path = p / (name + '.gz')
    return json.loads(gzip.decompress(path.read_bytes()))

def save(name, data):
    (p / name).write_text(json.dumps(data, indent=2) + '\n')

native_bytes = gzip.decompress((p / 'native-console-records.jsonl.gz').read_bytes())
records = [json.loads(line) for line in native_bytes.splitlines()]
attachment = read_json('high-gp-startup-commands.json')
analysis = read_json('native-analysis.json')
setup = attachment.get('programSetup')
assert isinstance(setup, dict), 'New programSetup attachment is required for this source.'
summaries = [r for r in records if r.get('kind') == 'program-setup-summary']
slows = [r for r in records if r.get('kind') == 'slow-program-setup']
assert len(slows) <= 16 and len(setup['slowCalls']) <= 16

# Console wrappers add traceTime/pageId; retain the original payload for equality.
payload = lambda r: {k:v for k,v in r.items() if k not in ['traceTime','pageId']}
assert [payload(r) for r in slows[:len(setup['slowCalls'])]] == setup['slowCalls'], 'Attachment is not a prefix of original trace calls.'
attachment_summary_indices = [i for i,r in enumerate(summaries) if payload(r) == setup['summary']]
if setup['summary'] is not None:
    assert attachment_summary_indices, 'Attachment summary is absent from original trace.'

methods = summaries[-1]['methods'] if summaries else {}
assert len(methods) <= 29
timeline = []
previous = {}
previous_time = None
for row in summaries:
    deltas = {}
    for name, values in row['methods'].items():
        old = previous.get(name, {})
        delta = {key:values[key] - old.get(key, 0) for key in ['calls','cpuCallMs','slowCalls','throws']}
        assert delta['calls'] >= 0 and delta['slowCalls'] >= 0 and delta['throws'] >= 0
        assert delta['cpuCallMs'] >= -1e-6
        if delta['calls']:
            deltas[name] = delta
    timeline.append({
        'stage':row['stage'], 'atMs':row['atMs'], 'traceTime':row.get('traceTime'),
        'reason':row['reason'], 'sincePreviousSummaryMs':None if previous_time is None else row['atMs'] - previous_time,
        'deltaCalls':sum(v['calls'] for v in deltas.values()),
        'deltaCpuCallMs':sum(v['cpuCallMs'] for v in deltas.values()),
        'methodDeltas':deltas,
        'scope':'Cumulative-counter difference since the preceding emitted summary; a stage label alone does not make this an exact stage-duration profile.',
    })
    previous, previous_time = row['methods'], row['atMs']

slow_summary = [{k:r.get(k) for k in [
    'traceTime','stage','atMs','method','cpuCallMs','returned','program','fragmentHash',
    'framebuffer','cubeFace','viewport','uniform','texture','numericArguments','sourceBufferBytes','stack'
]} for r in slows]
method_rows = [dict(method=name, **values,
                    meanCpuCallMs=values['cpuCallMs']/values['calls'] if values['calls'] else 0)
               for name, values in methods.items()]
method_rows.sort(key=lambda r:r['cpuCallMs'], reverse=True)
diagnostic = read_json('high-gp-last-diagnostic.json')['lastDiagnostic']
chase_stage = (analysis.get('firstChase') or {}).get('stage')
chase_boundary = next((r for r in summaries if r['reason']=='stage-transition' and r['stage']==chase_stage), None)
chase_preparation = next((r for r in (diagnostic.get('renderer') or {}).get('preparation',{}).get('stages',[]) if r['label']==chase_stage), None)
chase = None
if chase_boundary:
    values = chase_boundary['methods']
    total = sum(v['cpuCallMs'] for v in values.values())
    retained = [r for r in slows if r['stage']==chase_stage]
    chase = {
        'stage':chase_stage, 'startAtMs':analysis['firstChase']['atMs'],
        'transitionSummaryAtMs':chase_boundary['atMs'],
        'preparationStageElapsedMs':chase_preparation['elapsedMs'] if chase_preparation else None,
        'calls':sum(v['calls'] for v in values.values()), 'cpuCallMs':total,
        'slowCalls':sum(v['slowCalls'] for v in values.values()),
        'throws':sum(v['throws'] for v in values.values()),
        'retainedSlowRecords':len(retained),
        'retainedSlowCpuCallMs':sum(r['cpuCallMs'] for r in retained),
        'lastRetainedSlowReturnedAtMs':max((r['atMs']+r['cpuCallMs'] for r in retained),default=None),
        'callsAfterChaseInFinalSummary':sum(v['calls'] for v in methods.values())-sum(v['calls'] for v in values.values()),
        'cpuMsAfterChaseInFinalSummary':sum(v['cpuCallMs'] for v in methods.values())-total,
        'methods':values,
        'scope':'The reviewed helper activates only when chaseStarted is true and is flushed before this stage transition. Counters begin at zero; this is the full returned-call setup accounting up to the chase-to-pit boundary, not a GPU execution profile.',
    }
summary = {
    'source':analysis['source'], 'run':analysis['run'], 'job':analysis['job'],
    'nativeTraceDecodedSha256':hashlib.sha256(native_bytes).hexdigest(),
    'attachmentSlowCallsExactlyMatchTracePrefix':True,
    'traceExtraSlowRecordsAfterAttachment':len(slows)-len(setup['slowCalls']),
    'attachmentSummaryTraceIndex':attachment_summary_indices[-1] if attachment_summary_indices else None,
    'attachmentSummary':setup['summary'],
    'summaryRecords':len(summaries), 'slowRecords':len(slows),
    'slowRecordLimit':16, 'slowThresholdMs':100,
    'observedMethodCount':len(methods),
    'totalCalls':sum(v['calls'] for v in methods.values()),
    'totalCpuCallMs':sum(v['cpuCallMs'] for v in methods.values()),
    'totalSlowCalls':sum(v['slowCalls'] for v in methods.values()),
    'totalThrows':sum(v['throws'] for v in methods.values()),
    'totalsBoundary':'Final emitted trace summary; this may postdate the attachment snapshot or readiness failure. The attachment summary is retained separately.',
    'methodsByCpuTime':method_rows,
    'slowCalls':slow_summary,
    'slowRecordStages':dict(Counter(r['stage'] for r in slows)),
    'chaseBoundary':chase,
    'finalSummary':summaries[-1] if summaries else None,
    'limitations':[
        'Only returned tracked calls are timed; clock/wrapper/driver overhead is included. These are not isolated GPU execution durations.',
        'The slow-record cap can omit later identities even while cumulative method counters continue.',
        'Current program, framebuffer and texture-unit arguments are cached observations, not new GL queries or complete ownership proof.',
        'The helper covers the listed 29 APIs and excludes nonsquare matrix setters and uniformBlockBinding.',
        'Counter deltas are emitted-boundary intervals; do not infer exact per-stage totals or sum potentially overlapping instrument layers as a GPU profile.',
        'Timing of a pending pit-service fence can include the preceding chase submission.',
    ],
}
save('program-setup-analysis.json', summary)
save('program-setup-timeline.json', timeline)
print(json.dumps({k:summary[k] for k in ['source','run','summaryRecords','slowRecords','totalCalls','totalCpuCallMs','totalSlowCalls','totalThrows','methodsByCpuTime','slowCalls']}, indent=2))
