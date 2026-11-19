"""Reproduce source-specific CI evidence from verified original archives and logs.

No application execution, network requests, production edits or test changes.
Usage: python3 extract-geometry.py ARCHIVE_DIRECTORY COMPACT_OUTPUT_DIRECTORY
"""
from collections import Counter
from pathlib import Path
import base64, gzip, hashlib, io, json, re, shutil, sys, zipfile

src=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
meta=json.loads((src/'metadata.json').read_text());source=meta['source'];run=meta['runId']
assert meta['commit']['sha']==source and meta['commit']['tree']['sha']==meta['tree']
assert meta['workflow']['head_sha']==source and meta['workflow']['status']=='completed'
jobs=meta['jobs']['jobs'];assert len(jobs)==5
assert all(j['head_sha']==source and j['run_id']==run and j['status']=='completed' for j in jobs)
by_group={('menu' if j['name'].startswith('browser') else j['name']):j for j in jobs}
assert set(by_group)=={'build','gameplay','gpu','high','menu'}
names={'high':'graphics-advancement-high','gpu':'graphics-advancement-gpu','gameplay':'graphics-advancement-gameplay','menu':'motogp-menu-entry'}
receipts=[];cases=[];artifact_descriptors=[];job_results=[]

for group,job in by_group.items():
    receipt=json.loads((src/f'{group}-job.receipt.json').read_text());z=(src/receipt['logFile']).read_bytes();raw=gzip.decompress(z)
    assert receipt['jobId']==job['id'] and sha(raw)==receipt['decodedSha256'] and sha(z)==receipt['gzipSha256']
    text=raw.decode('utf-8-sig');text=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',text);text=re.sub(r'^\d{4}-\d\d-\d\dT[^ ]+ ','',text,flags=re.M)
    final=re.findall(r'^  (\d+) (passed|failed|skipped)(?: |$)',text,re.M)
    counts={status:int(next((n for n,s in final if s==status),0)) for status in ['passed','failed','skipped']}
    discovered=re.search(r'^Running (\d+) tests?',text,re.M)
    job_results.append({'group':group,'jobId':job['id'],'name':job['name'],'url':job['html_url'],'conclusion':job['conclusion'],
                        'runnerDiscovered':int(discovered[1]) if discovered else None,'runnerCounts':counts,
                        'failedSteps':[s['name'] for s in job['steps'] if s.get('conclusion')=='failure'],
                        'completeLog':receipt})
    for name in [receipt['logFile'],f'{group}-job.receipt.json']:shutil.copy2(src/name,out/name)

for artifact in meta['artifacts']['artifacts']:
    assert artifact['workflow_run']['id']==run and artifact['workflow_run']['head_sha']==source
    artifact_descriptors.append({k:artifact.get(k) for k in ['id','name','size_in_bytes','digest','expired','created_at','updated_at']})

for group,name in names.items():
    artifact=next(a for a in meta['artifacts']['artifacts'] if a['name']==name)
    archive=src/f'{group}-artifact.zip';raw=archive.read_bytes();digest=sha(raw)
    assert len(raw)==artifact['size_in_bytes'] and 'sha256:'+digest==artifact['digest']
    receipts.append({'group':group,'artifactId':artifact['id'],'name':name,'bytes':len(raw),'sha256':digest,
                     'matchesGitHubArtifactDigest':True,'source':source,'run':run,
                     'deliveryFileId':meta['deliveryFileIds'][str(artifact['id'])],
                     'archiveRetained':str(archive),'archiveIncludedInCompactEvidence':False})
    group_cases=[];details=[];attachments=[]
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for optional in ['browser-backend.json','browser-progress.json']:
            if optional in z.namelist():(out/f'{group}-{optional}').write_bytes(z.read(optional))
        html=z.read('playwright-report/index.html').decode()
        match=re.search(r'<script[^>]+id="playwrightReportBase64"[^>]*>(.*?)</script>',html,re.S)
        assert match
        payload=match[1].strip().split('base64,',1)[-1]
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(payload))) as report:
            metadata=json.loads(report.read('report.json'))
            (out/f'{group}-report-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
            for filename in report.namelist():
                if not filename.endswith('.json') or filename=='report.json':continue
                data=json.loads(report.read(filename));details.append({'file':filename,'content':data})
                for test in data.get('tests',[]):
                    row={k:test.get(k) for k in ['testId','title','projectName','location','duration','annotations','tags','outcome','path','ok']}
                    row['results']=[{k:r.get(k) for k in ['status','duration','retry','errors','startTime']} for r in test['results']]
                    row['group']=group;row['jobId']=by_group[group]['id'];row['artifactId']=artifact['id']
                    group_cases.append(row)
                    for result in test['results']:
                        for a in result.get('attachments',[]):
                            item={'testId':test['testId'],'name':a.get('name'),'contentType':a.get('contentType')}
                            if 'body' in a:
                                b=a['body'].encode();item.update({'inlineBytes':len(b),'sha256':sha(b),'retainedInFullReportDetails':True})
                            elif a.get('path'):
                                target='playwright-report/'+a['path'];info=z.getinfo(target)
                                item.update({'archivePath':target,'bytes':info.file_size,'retainedInOriginalArchive':True})
                            attachments.append(item)
            assert metadata['stats']['total']==len(group_cases)
        del raw
    statuses=Counter(r['status'] for c in group_cases for r in c['results'])
    job=next(j for j in job_results if j['group']==group)
    assert job['runnerDiscovered']==len(group_cases)
    assert job['runnerCounts']=={s:statuses.get(s,0) for s in ['passed','failed','skipped']}
    assert all(r['retry']==0 for c in group_cases for r in c['results'])
    (out/f'{group}-case-results.json').write_text(json.dumps(group_cases,indent=2)+'\n')
    (out/f'{group}-report-details.json.gz').write_bytes(gzip.compress((json.dumps(details)+'\n').encode(),mtime=0))
    (out/f'{group}-attachment-descriptors.json').write_text(json.dumps(attachments,indent=2)+'\n')
    cases.extend(group_cases)

assert len(cases)==16
assert Counter(r['status'] for c in cases for r in c['results'])=={'passed':15,'failed':1}
assert len({(c['group'],c['testId']) for c in cases})==16
assert next(c for c in cases if c['group']=='high')['results'][0]['status']=='failed'
shutil.copytree(src/'high',out/'high',dirs_exist_ok=True)
for name in ['metadata.json','base-commit.json','source-compare.json','source-order-excerpts.json','analyze-high.py','analyze-native-gap.py','extract-geometry.py']:
    shutil.copy2(src/name,out/name)
compare=json.loads((src/'source-compare.json').read_text())
assert compare['head']==source and compare['base']==meta['commit']['parents'][0]['sha']
changed={f['filename'] for f in compare['files']}
protected=['.github/workflows/graphics-high-diagnostic.yml','e2e/graphics-high-journey.spec.ts','e2e/36-compact-race-journey.spec.ts',
           'e2e/30-menu-access.spec.ts','e2e/settings-transition.spec.ts','e2e/gpu-frame-gate.spec.ts','playwright.config.ts','package-lock.json']
protected=sorted(set(protected+[meta['workflow']['path']]))
assert not changed.intersection(protected)
assert not compare.get('too_large') and compare['total_commits']==1
protected_receipt={'base':compare['base'],'head':source,'comparisonFile':'source-compare.json',
                   'changedPaths':sorted(changed),'protectedPathsUnchanged':protected,
                   'scope':'Exact GitHub one-commit comparison: the workflow, original browser gates, Playwright configuration and dependency lock listed here are absent from the complete six-path change list.'}
native=json.loads((out/'high/native-analysis.json').read_text())
assert native['source']==source and native['run']==run and native['job']==by_group['high']['id']
diagnostic=json.loads(gzip.decompress((out/'high/high-gp-last-diagnostic.json.gz').read_bytes()))['lastDiagnostic']
summary={'source':source,'tree':meta['tree'],'run':run,'runUrl':meta['workflow']['html_url'],
         'workflowStatus':meta['workflow']['status'],'workflowConclusion':meta['workflow']['conclusion'],
         'jobCount':5,'jobResults':job_results,'browserCases':{'total':16,'passed':15,'failed':1,'skipped':0,'retries':0},
         'caseGroups':dict(Counter(c['group'] for c in cases)),
         'highFailure':{'title':native['title'],'durationMs':native['durationMs'],'errors':native['results'][0]['errors'],
                       'readinessPredicate':native['readinessPredicate'],'firstChase':native['firstChase'],
                       'stages':native['stages'],'finalState':diagnostic['state'],
                       'finalPreparation':diagnostic['renderer']['preparation'],'finalGpuQueue':diagnostic['renderer']['gpuFrameQueue'],
                       'nativeConsoleRecords':native['nativeConsoleRecords'],'activityRecords':native['activityRecords'],
                       'latePrograms':native['latePrograms'],'slowUploads':native['retainedSlowUploads'],
                       'nativeAccountingGap':json.loads((out/'high/chase-native-gap.json').read_text()),
                       'consoleErrorsAndWarnings':native['consoleErrorsAndWarnings']},
         'limitations':native['limitations']+['High failed at its original readiness assertion before active chassis and photo-view acceptance. A later preparation stage is progress, not a passed High gate.',
                                           'Artifact ZIPs stay in the independent scratch collection; compact evidence retains verified receipts, original report details and all requested native diagnostics.']}
for name,data in [('artifact-receipts.json',receipts),('artifact-descriptors.json',artifact_descriptors),('all-case-results.json',cases),
                  ('protected-inputs.json',protected_receipt),('summary.json',summary)]:
    (out/name).write_text(json.dumps(data,indent=2)+'\n')
lines=['# Geometry preparation candidate: hosted CI evidence','',f"Source `{source}`, tree `{meta['tree']}`; [run {run}]({meta['workflow']['html_url']}).",'',
       '**Five jobs are terminal. Build, gameplay, GPU and menu passed; High failed.** All 16 original browser cases are accounted for: 15 passed, 1 failed, no skips or retries. Full job logs are retained losslessly; case counts cross-check against each original runner summary.','',
       '## High failure boundary','',
       'The original 90-second readiness poll expected `paused` and still observed `loading` at `graphics-high-journey.spec.ts:786`. It failed before the prepared-scene assertions, active GP chassis checks and two completed photo views. The whole case lasted 150.846 seconds; that is not the readiness allowance.','',
       'Shadow/reflection warmup began 35.634467 seconds after the readiness poll began and completed in 42.1871 seconds. Offscreen pit-service warmup began at 77.821567 seconds and was still incomplete after 12.1107 seconds in the last diagnostic. Preparation reported no error. The last GPU queue snapshot had 2 submissions, 0 completions, 703 deferred callbacks, 11 flush refreshes, 11.7331 seconds pending and no failure.','',
       'The first pit-service fence covers the preceding whole chase submission as well as the new offscreen work. Its pending time must not be attributed solely to pit-service rendering. The source-order excerpts and unchanged-source comparison preserve that ownership boundary.','',
       'The 42.1871-second labelled chase stage contains 84 observed activity samples spanning 41.499979 seconds. Between the first and last samples, summed wrapped API CPU counters increase only from 210.7 to 2072.9 ms, a delta of 1.8622 seconds. Repeated 1–1.5-second plateaus follow already-returned useProgram calls with no wrapped call in flight. Most elapsed time is therefore outside this API accounting; it is not identified by the retained slow upload or shader-query calls.','',
       'The last native activity was a returned `clientWaitSync`, with no call in flight. The retained late program 423 / fragment `26f0f279` had a 926.7 ms `getProgramInfoLog` CPU call during the earlier shadow/reflection stage. One 468.5 ms `bufferData` call for 144 bytes has a PMREM `_halfBlur` stack in that same earlier stage. These observations do not identify isolated GPU execution time or the owner of all pending work. No console error or warning was captured.','',
       '## Provenance and scope','',
       'All four browser artifact ZIPs match both the GitHub byte count and SHA-256 digest. Build artifact metadata is retained without downloading the 79 MB build archive. `all-case-results.json` preserves every original case ID/title/location/status, and compressed report details retain original result data. The exact one-commit source comparison records two rendering changes and four added native-test/helper files; the hosted workflow, original browser gates, Playwright configuration and dependency lock are unchanged.','',
       'The candidate remains unaccepted by the High gate. No test, timeout, fixture or production source was changed by this audit.','',
       'Reproduce the extraction with `python3 extract-geometry.py ARCHIVE_DIRECTORY OUTPUT_DIRECTORY`, after running the parameterized `analyze-high.py` on the verified High ZIP and `analyze-native-gap.py HIGH_OUTPUT_DIRECTORY`. The original archive filenames and hashes are recorded in `artifact-receipts.json`.']
(out/'README.md').write_text('\n'.join(lines)+'\n')
(out/'SHA256SUMS').write_text(''.join(sha(f.read_bytes())+'  '+f.relative_to(out).as_posix()+'\n' for f in sorted(out.rglob('*')) if f.is_file() and f.name!='SHA256SUMS'))
print(json.dumps({'source':source,'run':run,'jobs':5,'browserCases':summary['browserCases'],'groups':summary['caseGroups'],
                  'files':len([f for f in out.rglob('*') if f.is_file()]),'bytes':sum(f.stat().st_size for f in out.rglob('*') if f.is_file()),
                  'summarySha256':sha((out/'summary.json').read_bytes()),'manifestSha256':sha((out/'SHA256SUMS').read_bytes()),'output':str(out)},indent=2))
