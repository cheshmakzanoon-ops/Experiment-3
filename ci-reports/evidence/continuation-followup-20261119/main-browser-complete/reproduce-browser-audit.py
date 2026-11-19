#!/usr/bin/env python3
"""Parse retained complete CI logs; does not run application tests or contact GitHub."""
from collections import Counter
from datetime import datetime
from pathlib import Path
import gzip
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent
SOURCE = 'ffd22598335dfa2a074ebd466e1d53830bb8bb41'
RUN = 44617126580
snapshot_path = sorted(ROOT.glob('jobs-snapshot-*.json'))[-1]
snapshot = json.loads(snapshot_path.read_text())
inventories = json.loads(gzip.decompress((ROOT / 'expected-inventories.json.gz').read_bytes()))
jobs = [j for j in snapshot['jobs'] if re.match(r'^(browser|owner-qa) \(\d+\)$',j['name'])]
assert all(j['run_id']==RUN and j['head_sha']==SOURCE for j in jobs), 'Mixed source or workflow run'

def clean(raw):
    s = raw.decode('utf-8-sig')
    s = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', s)
    return re.sub(r'^\d{4}-\d\d-\d\dT[^ ]+ ', '', s, flags=re.M)

def category(body):
    if '41-motogp-reference.spec.ts:230' in body and 'expect(hashes[0]).toBe(hashes[5])' in body: return 'fresh dry GP capture hash mismatch'
    if 'e.cast is not a function' in body: return 'missing road cast method'
    if 'Upright joint detached' in body: return 'upright joint geometry assertion'
    if "reading 'geometrySurvey'" in body: return 'undefined renderer geometrySurvey'
    if 'Expected: "cockpit"' in body and 'Received: "chase"' in body: return 'camera transition deadline'
    if 'Received: "loading"' in body or 'Received string:  "loading"' in body: return 'race readiness deadline'
    if 'toBeVisible() failed' in body: return 'visibility deadline'
    if 'page.screenshot:' in body: return 'screenshot deadline'
    if 'page.waitForEvent:' in body: return 'download event deadline'
    if 'locator.fill:' in body: return 'locator input deadline'
    if 'page.evaluate: Test timeout' in body: return 'page evaluation deadline'
    if 'Target page, context or browser has been closed' in body and 'Test timeout' in body: return 'test deadline and closed browser target'
    if 'toContainText' in body and 'timeout' in body.lower(): return 'text predicate deadline'
    if 'Timeout' in body or 'timeout' in body: return 'other execution or predicate deadline'
    return 'unclassified assertion or exception'

def inventory_key(case):
    file = 'e2e/' + case['file'].split('/e2e/',1)[1]
    title = case['title'].strip().removeprefix(Path(file).name+' ')
    return (file,title)

def observed_key(case):
    return (re.sub(r':\d+:\d+$','',case['location']),case['title'].replace(' › ',' '))

records=[]
for job in sorted(jobs,key=lambda j:(not j['name'].startswith('browser'),int(re.search(r'\d+',j['name'])[0]))):
    shard=int(re.search(r'\d+',job['name'])[0])
    group='ordinary' if job['name'].startswith('browser') else 'owner'
    expected=inventories[f'{group}-{shard}']
    expected_map={inventory_key(c):c for c in expected}
    assert len(expected_map)==len(expected), 'Duplicate file/title in expected inventory'
    stem=job['name'].replace('(','').replace(')','').replace(' ','-')+'-'+str(job['id'])
    logpath=ROOT/(stem+'.log.gz')
    row={'name':job['name'],'group':group,'shard':shard,'jobId':job['id'],
         'jobUrl':job['html_url'],'status':job['status'],'conclusion':job['conclusion'],
         'expectedCases':len(expected),'logRetained':logpath.exists()}
    if not logpath.exists():
        records.append(row); continue
    raw=gzip.decompress(logpath.read_bytes()); text=clean(raw); lines=text.splitlines()
    receipt=json.loads((ROOT/(stem+'.receipt.json')).read_text())
    assert receipt['decodedSha256']==hashlib.sha256(raw).hexdigest()
    assert receipt['gzipSha256']==hashlib.sha256(logpath.read_bytes()).hexdigest()
    discovered=re.search(r'^Running (\d+) tests?',text,re.M)
    row.update(logFile=logpath.name,discovered=int(discovered[1]) if discovered else 0,
               jobSeconds=(datetime.fromisoformat(job['completed_at'])-datetime.fromisoformat(job['started_at'])).total_seconds() if job['completed_at'] else None,
               cases=[],failures=[])
    for m in re.finditer(r'^\s*([✓✘-])\s+(\d+)\s+(e2e/\S+)\s+›\s+(.+)$',text,re.M):
        case={'number':int(m[2]),'status':{'✓':'passed','✘':'failed','-':'skipped'}[m[1]],
              'location':m[3],'title':re.sub(r' \([0-9.]+(?:ms|s|m|h)\)$','',m[4])}
        inventory_case=expected_map.get(observed_key(case))
        case['inventoryId']=inventory_case['id'] if inventory_case else None
        row['cases'].append(case)
    seen=Counter(observed_key(c) for c in row['cases'])
    row['inventoryMissing']=[{'file':k[0],'title':k[1],'id':v['id']} for k,v in expected_map.items() if seen[k]==0]
    row['inventoryUnexpected']=[{'file':k[0],'title':k[1],'count':v} for k,v in seen.items() if k not in expected_map]
    row['inventoryDuplicates']=[{'file':k[0],'title':k[1],'count':v} for k,v in seen.items() if v>1]
    row['observedCompleted']=dict(Counter(c['status'] for c in row['cases']))
    summary_matches=re.findall(r'^  (\d+) (passed|failed|skipped)(?: |$)',text,re.M)
    row['finalSummaryPresent']=bool(summary_matches)
    row['reportedCounts']={status:int(next((n for n,s in summary_matches if s==status),0)) for status in ['passed','failed','skipped']}
    row['withoutCompletedResult']=row['discovered']-len(row['cases'])
    if row['finalSummaryPresent']:
        assert row['reportedCounts']=={s:row['observedCompleted'].get(s,0) for s in ['passed','failed','skipped']},(job['name'],'summary count mismatch')
        assert row['withoutCompletedResult']==0,(job['name'],'missing completed case')
        assert row['discovered']==len(expected),(job['name'],'discovery mismatch')
        assert not any(row[k] for k in ['inventoryMissing','inventoryUnexpected','inventoryDuplicates']),(job['name'],'inventory mismatch')
    blocks=list(re.finditer(r'^  (\d+)\) (.+)$',text,re.M))
    for i,m in enumerate(blocks):
        body=text[m.end():blocks[i+1].start() if i+1<len(blocks) else len(text)]
        body=body.split('\n  Slow test file:')[0].split('\n    Error Context:')[0].split('\n    attachment #')[0]
        body=re.split(r'\n  \d+ (?:failed|passed|skipped)(?: |\n|$)',body)[0].strip()
        row['failures'].append({'case':m[2].strip().rstrip('─').rstrip(),'category':category(body),'originalFailure':body})
    if not blocks:
        inline={}
        for i,line in enumerate(lines):
            if not line.startswith('[browser-failure]'): continue
            key=line.removeprefix('[browser-failure]').strip(); parts=[]
            for tail in lines[i+1:]:
                if tail.startswith(('[browser-progress]','[browser-failure]')) or re.match(r'^\s*[✓✘-]\s+\d+',tail): break
                parts.append(tail)
            inline.setdefault(key,[]).append('\n'.join(parts).strip())
        for key,bodies in inline.items():
            body='\n'.join(dict.fromkeys(b for b in bodies if b))
            row['failures'].append({'case':key,'category':category(body),'originalFailure':body})
    assert len(row['failures'])==row['observedCompleted'].get('failed',0),(job['name'],'failure block count mismatch')
    row['failureCategories']=dict(Counter(f['category'] for f in row['failures']))
    row['failedSteps']=[{'name':s['name'],'conclusion':s['conclusion']} for s in job['steps'] if s.get('conclusion') not in ('success','skipped',None)]
    row['artifacts']=[]
    upload_digest=None
    for line in lines:
        digest=re.search(r'SHA256 digest of uploaded artifact zip is ([0-9a-f]{64})',line)
        if digest: upload_digest=digest[1]
        artifact=re.search(r'Artifact (.+) has been successfully uploaded! Final size is (\d+) bytes\. Artifact ID is (\d+)',line)
        if artifact:
            artifact_id=int(artifact[3])
            row['artifacts'].append({'name':artifact[1],'bytes':int(artifact[2]),'id':artifact_id,
                                     'zipSha256ReportedByUpload':upload_digest,
                                     'url':f'https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/{RUN}/artifacts/{artifact_id}'})
            upload_digest=None
    records.append(row)

out={'schema':1,'scope':'Retained terminal job logs; pending jobs have no case results yet.',
     'sourceCommit':SOURCE,'runId':RUN,'runUrl':f'https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/{RUN}',
     'snapshotFile':snapshot_path.name,'observedAt':snapshot['observedAt'],
     'jobCounts':dict(Counter(j['status'] for j in jobs)), 'jobs':records,
     'limitations':['Completed logs preserve the actual assertions and their original deadlines.',
                    'A missed deadline identifies the assertion boundary, not a common graphics cause.',
                    'No workflow run was cancelled, retried, or mutated by this audit.',
                    'Owner QA is a separate build and its cases are not added to ordinary-browser totals.']}
final_run_path=ROOT/'workflow-run-final.json'
if final_run_path.exists():
    final_run=json.loads(final_run_path.read_text())
    assert final_run['id']==RUN and final_run['head_sha']==SOURCE
    out['workflowRun']={k:final_run.get(k) for k in ['id','head_sha','status','conclusion','run_attempt','created_at','updated_at','html_url']}
    out['workflowRunReceipt']=final_run_path.name
if all(r['status']=='completed' and r['logRetained'] and r['finalSummaryPresent'] for r in records):
    out['scope']='Complete original 16-shard ordinary and 4-shard owner browser audit, with every expected case observed and matched to the committed inventory.'
    out['complete']=True
for group in ('ordinary','owner'):
    all_group=[r for r in records if r['group']==group]
    logs=[r for r in all_group if r['logRetained']]
    out[group+'Totals']={'expectedCases':len(inventories[group+'-all']), 'expectedJobs':len(all_group),
        'terminalJobs':sum(r['status']=='completed' for r in all_group),'retainedLogs':len(logs),
        'fullSummaryJobs':sum(r['finalSummaryPresent'] for r in logs),
        'reportedCases':sum(len(r['cases']) for r in logs),
        'observedCompleted':dict(sum((Counter(r['observedCompleted']) for r in logs),Counter())),
        'failureCategories':dict(sum((Counter(r['failureCategories']) for r in logs),Counter())),
        'inventoryUnobserved':len(inventories[group+'-all'])-sum(len(r['cases']) for r in logs)}
fresh = ROOT/'fresh-dry-capture'
if fresh.is_dir():
    metrics0=json.loads((fresh/'0-metrics.json').read_text())
    metrics5=json.loads((fresh/'5-metrics.json').read_text())
    out['freshDryCaptureEvidence']={
        'jobId':135890460489,'artifactId':14579711167,
        'case':'e2e/41-motogp-reference.spec.ts:230',
        'scope':'Final strict hash assertion between separately constructed high-detail dry gpr1 instances; earlier same-instance wet, held and rewind assertions completed before this line.',
        'originalMetricsDifferingTopLevelFields':[k for k in metrics0 if metrics0[k]!=metrics5[k]],
        'firstHash':metrics0['hash'],'lastHash':metrics5['hash'],
        'imageComparison':json.loads((fresh/'fresh-image-comparison.json').read_text()),
        'artifactReceipt':'fresh-dry-capture/artifact-receipt.json',
        'attachmentReceipt':'fresh-dry-capture/copy-receipt.json',
        'status':'Original strict assertion remains failed. No tolerance, fixture, source change or passed result is inferred from the small pixel difference.'}
(ROOT/'summary.json').write_text(json.dumps(out,indent=2)+'\n')
(ROOT/'artifact-descriptors.json').write_text(json.dumps({
    'sourceCommit':SOURCE,'runId':RUN,'observedAt':snapshot['observedAt'],
    'scope':'Upload descriptors parsed from complete original job logs. Archive digests are upload-reported, not independently reverified downloads except the separately retained browser-11 receipt.',
    'jobs':[{'jobId':r['jobId'],'name':r['name'],'artifacts':r.get('artifacts',[])} for r in records if r['logRetained']]
},indent=2)+'\n')
md=['# Original main browser CI audit','',f"Source `{SOURCE}`; [run {RUN}]({out['runUrl']}). Latest observation: {out['observedAt']}.",'',
    'Terminal logs are complete and losslessly compressed. Pending jobs have no result inferred. Owner QA uses its separate build.','',
    '| Job | Status | Conclusion | Expected | Passed | Failed | Skipped | Complete summary |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |']
if out.get('complete'):
    ordinary=out['ordinaryTotals']['observedCompleted'];owner=out['ownerTotals']['observedCompleted']
    md[4:4]=[f"**Complete:** all 353 ordinary cases have results ({ordinary.get('passed',0)} passed, {ordinary.get('failed',0)} failed, {ordinary.get('skipped',0)} skipped), as do all 42 owner cases ({owner.get('passed',0)} passed, {owner.get('failed',0)} failed, {owner.get('skipped',0)} skipped). Every job retains its full original runner summary, with zero missing, extra or duplicate inventory cases.",'']
for r in records:
    c={s:r.get('observedCompleted',{}).get(s,0 if r['logRetained'] else '—') for s in ['passed','failed','skipped']}
    md.append(f"| {r['name']} | {r['status']} | {r['conclusion'] or '—'} | {r['expectedCases']} | {c.get('passed','—')} | {c.get('failed','—')} | {c.get('skipped','—')} | {'yes' if r.get('finalSummaryPresent') else '—'} |")
md+=['','Each completed case is matched by exact file/title to the committed Playwright partition inventory, with its inventory ID retained in summary.json. Final test-runner counts are cross-checked against completed-case lines. Exact failure messages and assertion excerpts are preserved in summary.json; full logs include all setup and artifact-upload output.','',
     'Reproduce this report by running `python3 reproduce-browser-audit.py`. This parses retained evidence only; it does not execute tests.']
if 'freshDryCaptureEvidence' in out:
    md+=['','## Original GP reference hash failure','',
         'The final assertion compares two separately constructed high-detail dry gpr1 captures. The earlier same-instance wet/held/rewind assertions completed before this failure. The original verified artifact supplies all six metrics, the two dry PNGs and the full failing-case record in `fresh-dry-capture/`.',
         '',
         'The original images differ at exactly four of 1,024,000 pixels, with maximum channel difference one (bounding box x 644–647, y 253–255). No pixel differs by more than one channel level. The two metrics objects differ only in instance UUID and pixel hash. This narrow result does not clear the original exact-hash assertion, identify its graphics cause, or justify changing its tolerance. The original failure remains recorded.']
(ROOT/'README.md').write_text('\n'.join(md)+'\n')
(ROOT/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(ROOT).as_posix()+'\n' for p in sorted(ROOT.rglob('*')) if p.is_file() and p.name!='SHA256SUMS'))
print(json.dumps({k:out[k] for k in ['observedAt','jobCounts','ordinaryTotals','ownerTotals']},indent=2))
