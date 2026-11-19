from pathlib import Path
from collections import Counter
from datetime import datetime
import gzip, hashlib, json, re, subprocess

ROOT = Path(__file__).resolve().parent
REPO = Path('/workspace/scratch/0ab62d15db18/Experiment-3')
SOURCE = 'd8d87c73a8f3e921e865acdc02c61e84b8c877a7'

def clean(data):
    text = data.decode('utf-8-sig')
    text = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', text)
    return re.sub(r'^\d{4}-\d\d-\d\dT[^ ]+ ', '', text, flags=re.M)

def category(body):
    if 'e.cast is not a function' in body:
        return 'missing road cast method'
    if 'Upright joint detached' in body:
        return 'upright joint geometry assertion'
    if "reading 'geometrySurvey'" in body:
        return 'undefined renderer geometrySurvey'
    if 'Expected: "cockpit"' in body and 'Received: "chase"' in body:
        return 'camera transition deadline'
    if 'Received: "loading"' in body or 'Received string:  "loading"' in body:
        return 'race readiness deadline'
    if 'toBeVisible() failed' in body:
        return 'visibility deadline'
    if 'page.screenshot:' in body:
        return 'screenshot deadline'
    if 'page.waitForEvent:' in body:
        return 'download event deadline'
    if 'locator.fill:' in body:
        return 'locator input deadline'
    if 'page.evaluate: Test timeout' in body:
        return 'page evaluation deadline'
    if 'Timeout' in body or 'timeout' in body:
        return 'other execution or predicate deadline'
    return 'unclassified'

jobs = json.loads((ROOT/'jobs-final.json').read_text())['jobs']
run = json.loads((ROOT/'run-final.json').read_text())
out = {'schema': 1, 'sourceCommit': SOURCE, 'runId': run['id'], 'runConclusion': run['conclusion'], 'runAttempt': run['run_attempt'], 'runUrl': run['html_url'], 'completedAt': run['updated_at'], 'jobConclusions': dict(Counter(j['conclusion'] for j in jobs)), 'browserJobs': [], 'limitations': ['A cancelled job has no final test-runner summary; completed-case lines are partial observations.', 'Job elapsed times align with committed timeout caps, but the available job logs do not explicitly name the cancellation initiator.', 'Deadline failures establish the missed assertion boundary, not a shared native graphics cause.', 'No original assertions, timeouts, source files, workflow runs or remote state were changed by this audit.']}

for job in jobs:
    stem = job['name'].replace('(', '').replace(')', '').replace(' ', '-')
    path = ROOT/f'{stem}-{job["id"]}.log.gz'
    if not path.exists() or job['name'] == 'unit-tests':
        continue
    text = clean(gzip.decompress(path.read_bytes()))
    lines = text.splitlines()
    discovered = int(re.search(r'^Running (\d+) tests', text, re.M).group(1))
    row = {'name':job['name'], 'jobId':job['id'], 'conclusion':job['conclusion'], 'jobSeconds': (datetime.fromisoformat(job['completed_at']) - datetime.fromisoformat(job['started_at'])).total_seconds(), 'discovered': discovered, 'logFile':path.name, 'finalSummaryPresent': bool(re.search(r'^  \d+ passed(?: |$)', text, re.M)), 'cases': [], 'failures': []}
    for m in re.finditer(r'^\s*([✓✘-])\s+(\d+)\s+(e2e/\S+)\s+›\s+(.+)$', text, re.M):
        row['cases'].append({'number':int(m[2]),'status':{'✓':'passed','✘':'failed','-':'skipped'}[m[1]],'location':m[3],'title':re.sub(r' \([0-9.]+(?:ms|s|m|h)\)$','',m[4])})
    row['observedCompleted'] = dict(Counter(c['status'] for c in row['cases']))
    row['withoutCompletedResult'] = discovered - len(row['cases'])
    if row['finalSummaryPresent']:
        reported = {status:int(re.search(rf'^  (\d+) {status}(?: |$)',text,re.M)[1]) if re.search(rf'^  (\d+) {status}(?: |$)',text,re.M) else 0 for status in ['passed','failed','skipped']}
        assert reported == {k:row['observedCompleted'].get(k,0) for k in reported}, (job['name'], reported, row['observedCompleted'])
        assert row['withoutCompletedResult'] == 0
    blocks = list(re.finditer(r'^  (\d+)\) (.+)$',text,re.M))
    if blocks:
        for i,m in enumerate(blocks):
            body=text[m.end():blocks[i+1].start() if i+1<len(blocks) else len(text)]
            body=body.split('\n  Slow test file:')[0].split('\n    Error Context:')[0].split('\n    attachment #')[0].strip()
            row['failures'].append({'case':m[2].strip().rstrip('─').rstrip(),'category':category(body),'originalFailure':body})
    else:
        inline = {}
        for i,line in enumerate(lines):
            if not line.startswith('[browser-failure]'):
                continue
            key=line.removeprefix('[browser-failure]').strip()
            parts=[]
            for tail in lines[i+1:]:
                if tail.startswith('[browser-progress]') or tail.startswith('[browser-failure]') or re.match(r'^\s*[✓✘-]\s+\d+',tail):
                    break
                parts.append(tail)
            body='\n'.join(parts).strip()
            inline.setdefault(key,[]).append(body)
        for key,bodies in inline.items():
            body='\n'.join(dict.fromkeys(b for b in bodies if b))
            row['failures'].append({'case':key,'category':category(body),'originalFailure':body})
        row['activeCaseAtCancellation'] = re.findall(r'^\[browser-progress\] START (.+)$',text,re.M)[-1].strip()
        row['jobCapMinutes'] = 90
    assert len(row['failures'])==row['observedCompleted'].get('failed',0),(job['name'],len(row['failures']),row['observedCompleted'])
    row['failureCategories'] = dict(Counter(f['category'] for f in row['failures']))
    out['browserJobs'].append(row)

regular=[j for j in out['browserJobs'] if j['name'].startswith('browser')]
complete=[j for j in regular if j['finalSummaryPresent']]
out['regularBrowserTotals']={'discovered':sum(j['discovered'] for j in regular),'completedJobs':len(complete),'completedJobTotals':dict(sum((Counter(j['observedCompleted']) for j in complete),Counter())),'allObservedCompletedTotals':dict(sum((Counter(j['observedCompleted']) for j in regular),Counter())),'withoutCompletedResult':sum(j['withoutCompletedResult'] for j in regular),'failureCategories':dict(sum((Counter(j['failureCategories']) for j in regular),Counter()))}

unit=clean(gzip.decompress((ROOT/'unit-tests-135661597381.log.gz').read_bytes()))
files=[]
for m in re.finditer(r'^ [✓❯] (tests/\S+) \((\d+) tests?(?: \| (\d+) failed)?\) (\d+)ms',unit,re.M):
    files.append({'path':m[1],'tests':int(m[2]),'failed':int(m[3] or 0),'milliseconds':int(m[4])})
out['unit']={'jobId':135661597381,'conclusion':'cancelled','jobSeconds':2714,'jobCapMinutes':45,'finalSummaryPresent':False,'observedCompletedFiles':len(files),'observedPassedTests':sum(f['tests']-f['failed'] for f in files),'observedFailedTests':sum(f['failed'] for f in files),'failedFiles':[f for f in files if f['failed']],'logFile':'unit-tests-135661597381.log.gz'}
assert out['unit']['observedCompletedFiles']==528
(ROOT/'unit-observed-files.json.gz').write_bytes(gzip.compress((json.dumps(files,indent=2)+'\n').encode(),mtime=0))

workflow=subprocess.check_output(['git','show',SOURCE+':.github/workflows/ci.yml'],cwd=REPO)
(ROOT/'source-ci.yml.gz').write_bytes(gzip.compress(workflow,mtime=0))
out['workflowSourceSha256']=hashlib.sha256(workflow).hexdigest()
out['setupFailures']=0
(ROOT/'summary.json').write_text(json.dumps(out,indent=2)+'\n')

md=['# Completed original CI audit — 19 November 2026','',f"Source: `{SOURCE}`. [Build and validation run {run['id']}]({run['html_url']}); attempt {run['run_attempt']}; terminal conclusion **{run['conclusion']}**. All 19 jobs are terminal. This audit changes no repository or remote state.",'','## Executed case counts','','| Job | Outcome | Discovered | Observed passed | Observed failed | Existing skips | Without completed result |','| --- | --- | ---: | ---: | ---: | ---: | ---: |']
for j in sorted(out['browserJobs'],key=lambda j:(not j['name'].startswith('browser'),int(re.search(r'\d+',j['name'])[0]) if re.search(r'\d+',j['name']) else 0)):
    c=j['observedCompleted'];md.append(f"| {j['name']} | {j['conclusion']} | {j['discovered']} | {c.get('passed',0)} | {c.get('failed',0)} | {c.get('skipped',0)} | {j['withoutCompletedResult']} |")
md+=['', 'The eleven completed ordinary browser shards report **'+', '.join(f'{v} {k}' for k,v in out['regularBrowserTotals']['completedJobTotals'].items())+'**. Shard 2 adds 21 completed passes and six failures; its final runner summary is absent. Across all twelve ordinary shards, 353 cases were discovered and 351 have completed result lines. Owner QA is a separate build and is not included in those totals.','', 'The unit job retains **528 completed file summaries, 5,958 passing tests and two failing tests**, without a full-suite summary. Its existing mixed GP/Superbike lap comparison and wet GP zero-impact failures remain real failures; scheduling changes do not repair them.','', '## Failure boundaries','','| Ordinary-browser category | Observed failed cases |','| --- | ---: |']
for k,v in out['regularBrowserTotals']['failureCategories'].items():md.append(f'| {k} | {v} |')
md+=['','Two ordinary-browser failures are direct exceptions or geometry assertions: `gp-contact-effects.spec.ts` throws `TypeError: e.cast is not a function`; `22-apx01-assembly.spec.ts` throws `Upright joint detached: 0.060000004698496916 != 0`. Owner QA also throws `Cannot read properties of undefined (reading geometrySurvey)` in `09-reference-depth.spec.ts`. These are separate from deadline failures. Exact original messages, locations and assertion excerpts are retained in summary.json.','', 'The remaining observed ordinary-browser failures are deadlines in readiness, UI visibility/input, camera transition, screenshots or scene evaluation. They do not prove a common graphics root cause. Downstream visual assertions were not reached when preparation or evaluation timed out.','', '## Cancellations and setup','','Unit elapsed 45m14s against its committed 45-minute cap. Owner QA elapsed 90m29s and browser shard 2 elapsed 90m33s against their committed 90-minute caps. Each log reports `The operation was canceled` without naming the initiator. Timing is consistent with job caps; this audit does not assert an independently proven initiator. Owner QA was in A31 sunset after 24 completed results; shard 2 was in A12 night after 27 completed results. No agent cancelled or retried a job during this audit.','', 'Every relevant setup/install/build-download step succeeded. The failed browser jobs reached actual tests. Browser matrix fail-fast is false. Publication was skipped. Validate, scenarios, offroad scenarios and wet presentation succeeded.','', '## Evidence','','Fourteen complete decoded job logs are losslessly retained as deterministic gzip, with decoded UTF-8 and compressed SHA-256 values in log-provenance.json. Final run/jobs API payloads, the exact source workflow, extracted complete-case records and this reproducible summarizer are retained. No large browser artifact archives were downloaded.']
(ROOT/'SUMMARY.md').write_text('\n'.join(md)+'\n')
manifest=[]
for f in sorted(ROOT.iterdir()):
    if f.is_file() and f.name!='SHA256SUMS':manifest.append(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+f.name)
(ROOT/'SHA256SUMS').write_text('\n'.join(manifest)+'\n')
print(json.dumps({'regularBrowserTotals':out['regularBrowserTotals'],'unit':out['unit'],'jobConclusions':out['jobConclusions']},indent=2))
