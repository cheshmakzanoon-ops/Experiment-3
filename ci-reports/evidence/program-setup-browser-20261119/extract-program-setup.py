"""Reproduce source-specific CI evidence from verified original archives and logs.

No application execution, network requests, production edits or test changes.
Usage: python3 extract-program-setup.py ARCHIVE_DIRECTORY COMPACT_OUTPUT_DIRECTORY
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
assert len({(c['group'],c['testId']) for c in cases})==16
expected=json.loads((src/'original-case-inventory.json').read_text())
case_identity=lambda c:(c['group'],c['testId'],c['title'],c['projectName'],c['location']['file'])
assert {case_identity(c) for c in cases}=={case_identity(c) for c in expected}
shutil.copytree(src/'high',out/'high',dirs_exist_ok=True)
for name in ['metadata.json','commit.json','source-compare.json','source-equivalence.json','production-order-from-b8.json','original-case-inventory.json',
             'analyze-high.py','analyze-native-gap.py','analyze-program-setup.py','extract-program-setup.py']:
    shutil.copy2(src/name,out/name)
shutil.copytree(src/'independent-review',out/'independent-review',dirs_exist_ok=True)

compare=json.loads((src/'source-compare.json').read_text())
review=json.loads((out/'independent-review/receipt.json').read_text())
assert compare['head']==source and compare['base']==meta['commit']['parents'][0]['sha']
assert review['sourceTree']==meta['tree']
assert all(row['equal'] for row in review['byteComparisons'].values())
changed={f['filename'] for f in compare['files']}
assert changed=={'e2e/fixtures/program-setup-diagnostic.ts','e2e/graphics-high-journey.spec.ts','tests/program-setup-diagnostic.test.ts'}
assert not compare.get('too_large') and compare['total_commits']==1
protected=['.github/workflows/graphics-high-diagnostic.yml','e2e/36-compact-race-journey.spec.ts',
           'e2e/30-menu-access.spec.ts','e2e/settings-transition.spec.ts','e2e/gpu-frame-gate.spec.ts',
           'playwright.config.ts','package-lock.json']
assert not changed.intersection(protected)
protected_receipt={
    'base':compare['base'],'head':source,'comparisonFile':'source-compare.json','changedPaths':sorted(changed),
    'protectedPathsUnchanged':sorted(protected),'reviewedLocalCommit':review['sourceCommit'],
    'reviewedLocalTreeEqualsPublishedTree':True,'originalHighByteComparisons':review['byteComparisons'],
    'readiness':review['readiness'],
    'scope':'Complete three-path one-commit comparison changes only High diagnostic setup/attachments and their new helper/tests; all production files and workflow are unchanged. The original High workload/assertion body and fragment observer are independently byte-identical.'}
def readjson(path):
    if path.exists():return json.loads(path.read_bytes())
    return json.loads(gzip.decompress(Path(str(path)+'.gz').read_bytes()))
native=readjson(out/'high/native-analysis.json')
setup=readjson(out/'high/program-setup-analysis.json')
chase=setup['chaseBoundary'];assert chase is not None
assert native['source']==setup['source']==source and native['run']==setup['run']==run
assert native['job']==setup['job']==by_group['high']['id']
last=readjson(out/'high/high-gp-last-diagnostic.json')['lastDiagnostic']
status_counts=Counter(r['status'] for c in cases for r in c['results'])
case_counts={'total':len(cases),**{k:status_counts.get(k,0) for k in ['passed','failed','skipped']},
             'retries':sum(r['retry']>0 for c in cases for r in c['results'])}
summary={
    'source':source,'tree':meta['tree'],'run':run,'runUrl':meta['workflow']['html_url'],
    'workflowStatus':meta['workflow']['status'],'workflowConclusion':meta['workflow']['conclusion'],
    'jobCount':len(jobs),'jobResults':job_results,'browserCases':case_counts,
    'originalInventoryExactlyMatches':True,'caseGroups':dict(Counter(c['group'] for c in cases)),
    'highResult':{
        'title':native['title'],'outcome':native['outcome'],'durationMs':native['durationMs'],
        'results':native['results'],'readinessPredicate':native['readinessPredicate'],
        'firstChase':native['firstChase'],'stages':native['stages'],'finalState':last.get('state'),
        'finalPreparation':(last.get('renderer') or {}).get('preparation'),
        'finalGpuQueue':(last.get('renderer') or {}).get('gpuFrameQueue'),
        'nativeConsoleRecords':native['nativeConsoleRecords'],'activityRecords':native['activityRecords'],
        'latePrograms':native['latePrograms'],'slowUploads':native['retainedSlowUploads'],
        'programSetup':setup,'consoleErrorsAndWarnings':native['consoleErrorsAndWarnings'],
    },
    'limitations':native['limitations']+setup['limitations']+[
        'This is a diagnostic-only candidate with unchanged production source and original acceptance assertions.',
        'Exact artifact ZIPs are retained in the independent scratch collection; compact evidence retains verified receipts, complete original result metadata and native diagnostics.',
    ],
}
for name,data in [('artifact-receipts.json',receipts),('artifact-descriptors.json',artifact_descriptors),
                  ('all-case-results.json',cases),('protected-inputs.json',protected_receipt),('summary.json',summary)]:
    (out/name).write_text(json.dumps(data,indent=2)+'\n')
rows=['# Passive program-setup diagnostic: hosted evidence','',
      f"Source `{source}`, tree `{meta['tree']}`; [run {run}]({meta['workflow']['html_url']}).",'',
      f"All {len(jobs)} jobs are terminal. Original browser inventory: {case_counts['total']} cases, {case_counts['passed']} passed, {case_counts['failed']} failed, {case_counts['skipped']} skipped, {case_counts['retries']} retries. Exact original case identities match the preceding b8 source.",'',
      '## Original evidence','',
      'All five complete original job logs are retained losslessly with byte counts and SHA-256 receipts. All four browser archives match their GitHub sizes and artifact digests. Every original case/result and attachment descriptor is retained; compressed report details preserve the original result payloads. The build artifact descriptor is retained without downloading its large archive.','',
      '## High and passive native timing','',
      f"High outcome: `{native['outcome']}`, {native['durationMs']} ms whole-case duration. Readiness is identified by the original expected-paused poll, independently of shifted source lines; its deadline remains 90,000 ms.",'',
      f"The new observer retained {setup['summaryRecords']} cumulative summaries and {setup['slowRecords']} detailed slow-call records, counting {setup['totalCalls']} returned/throwing tracked calls and {setup['totalCpuCallMs']:.6f} ms of CPU call duration. {setup['totalSlowCalls']} calls reached the 100 ms threshold; {setup['totalThrows']} native JavaScript exceptions were counted.",'',
      f"At the chase-to-pit transition, {chase['calls']:,} setup calls account for {chase['cpuCallMs']/1000:.4f} seconds during the {chase['preparationStageElapsedMs']/1000:.4f}-second chase stage. All {chase['slowCalls']} calls at or above 100 ms occur before that transition. The final pit summary adds only {chase['callsAfterChaseInFinalSummary']} tracked calls and {chase['cpuMsAfterChaseInFinalSummary']:.1f} ms.",'',
      '| Method | Calls | CPU total (ms) | Maximum call (ms) | Calls ≥100 ms |',
      '| --- | ---: | ---: | ---: | ---: |',
      *[f"| {m['method']} | {m['calls']:,} | {m['cpuCallMs']:.1f} | {m['maximumCallMs']:.1f} | {m['slowCalls']} |" for m in setup['methodsByCpuTime'][:6]],'',
      f"The retained 16 calls account for {chase['retainedSlowCpuCallMs']/1000:.3f} seconds and exhaust the detail cap about {(chase['lastRetainedSlowReturnedAtMs']-chase['startAtMs'])/1000:.2f} seconds into chase. The other {chase['slowCalls']-chase['retainedSlowRecords']} slow calls remain in method totals and maxima but have no individual retained identity. Retained calls include built-in model/shadow matrices, roughness, fog/cloud uniforms, GP shape/front arrays, activeTexture and bindTexture. This distributed call-boundary evidence does not establish that any one uniform value or byte count causes the delay.",'',
      'See `high/program-setup-analysis.json` for original slow-call identity/stacks and method totals, `high/program-setup-timeline.json` for summary-to-summary counter deltas, and `high/native-analysis.json` for the original readiness, stage, native activity and shader/upload boundaries. The slow-call attachment and final summary are checked against the complete trace console records.','',
      'These returned-call measurements include wrapper/clock/driver overhead and cannot identify isolated GPU execution. Capped records can omit later identities. Recorded program/framebuffer/unit values are cached observations, not a full resource-ownership proof. The first pit-service fence can include the preceding entire chase submission.','',
      '## Source and reproduction','',
      'The published tree exactly equals the independently reviewed local diagnostic commit. Only the High observer setup/attachments and its new helper/conformance tests change; production source, workflow, original test workload, assertions and deadline remain intact. `protected-inputs.json` and `independent-review/receipt.json` preserve the proof.','',
      'Reproduce from the retained archives with the parameterized `analyze-high.py ARCHIVE HIGH_OUTPUT SOURCE RUN JOB`, then `analyze-program-setup.py HIGH_OUTPUT`, then `extract-program-setup.py ARCHIVE_DIRECTORY OUTPUT_DIRECTORY`. No application execution or remote mutation is performed by these extractors.']
(out/'README.md').write_text('\n'.join(rows)+'\n')
(out/'SHA256SUMS').write_text(''.join(sha(f.read_bytes())+'  '+f.relative_to(out).as_posix()+'\n' for f in sorted(out.rglob('*')) if f.is_file() and f!=out/'SHA256SUMS'))
print(json.dumps({'source':source,'run':run,'jobs':len(jobs),'browserCases':case_counts,
                  'files':len([f for f in out.rglob('*') if f.is_file()]),
                  'bytes':sum(f.stat().st_size for f in out.rglob('*') if f.is_file()),
                  'summarySha256':sha((out/'summary.json').read_bytes()),
                  'manifestSha256':sha((out/'SHA256SUMS').read_bytes()),'output':str(out)},indent=2))

