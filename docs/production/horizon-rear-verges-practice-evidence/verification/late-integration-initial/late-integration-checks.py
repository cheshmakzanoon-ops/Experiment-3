from pathlib import Path
import subprocess,json,hashlib,time,datetime,sys,concurrent.futures
root=Path('/workspace/scratch/b60b57e087a1/Experiment-3');out=Path('/dev/shm/horizon-b60-validation')
identity=json.loads((out/'publication-source-identity.json').read_text())
def fingerprint():
    paths=sorted([p for p in (root/'src').rglob('*') if p.is_file()]+[root/n for n in ['package-lock.json','index.html','vite.config.ts']],key=lambda p:p.relative_to(root).as_posix())
    assert {p.relative_to(root).as_posix() for p in paths}==set(identity['files'])
    h=hashlib.sha256()
    for p in paths:
        name=p.relative_to(root).as_posix();data=p.read_bytes()
        assert hashlib.sha256(data).hexdigest()==identity['files'][name]
        h.update(name.encode()+b'\0'+data+b'\0')
    return h.hexdigest()
assert fingerprint()==identity['fingerprint']
test_files=['tests/motocross-ai.test.ts','tests/motocross-sprung-pose.test.ts','tests/tire-contact-animation.test.ts']
commands=[('late-integration-tests',['node','--max-old-space-size=2048','node_modules/vitest/vitest.mjs','run','--config',str(out/'vitest.config.mjs'),'--reporter=json','--outputFile='+str(out/'late-integration-tests.json'),*test_files]),('late-integration-eslint',['node','--max-old-space-size=1024','node_modules/eslint/bin/eslint.js',*json.loads((out/'late-integration-lint-files.json').read_text())])]
report={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'integratedBase':identity['integratedBase'],'sourceFingerprint':identity['fingerprint'],'sourceScope':identity['scope'],'testFiles':test_files,'steps':[],'passed':False,'scopeNotes':['Four upstream production files changed after the successful6537 combined TypeScript/build gate: recorded-tire.ts and three AI modules. All81 recorded Festival files remain unchanged.','This late gate tests the three incoming affected test files and lints all9 incoming TS files. It does not rerun or relabel the earlier full TypeScript/build, physical drives, component images or full-world failure.','Tests retain the existing isolated single-thread configuration and120-second test timeout. Each command is capped at600seconds. Independent tests and lint run concurrently.']}
def save():(out/'late-integration-validation.json').write_text(json.dumps(report,indent=2)+'\n')
save()
def run(item):
    name,cmd=item;print('START '+name,flush=True);start=time.monotonic()
    with (out/(name+'.log')).open('w') as f:
        try:
            r=subprocess.run(cmd,cwd=root,stdout=f,stderr=subprocess.STDOUT,timeout=600)
            result={'name':name,'command':cmd,'exitCode':r.returncode,'passed':r.returncode==0,'elapsedMs':round((time.monotonic()-start)*1000),'log':name+'.log'}
        except subprocess.TimeoutExpired:result={'name':name,'command':cmd,'exitCode':None,'passed':False,'elapsedMs':round((time.monotonic()-start)*1000),'log':name+'.log','failure':'Fixed600-second command limit exceeded'}
    print('FINISH '+json.dumps(result),flush=True);return result
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    futures=[pool.submit(run,item) for item in commands]
    report['steps']=[f.result() for f in futures]
report['finalSourceFingerprint']=fingerprint();report['sourceStable']=report['sourceFingerprint']==report['finalSourceFingerprint'];report['passed']=all(s['passed'] for s in report['steps']) and report['sourceStable']
if (out/'late-integration-tests.json').is_file():
    tests=json.loads((out/'late-integration-tests.json').read_text());report['testCounts']={k:tests[k] for k in ['numPassedTests','numFailedTests','numPendingTests','numTotalTests']};report['passed']=report['passed'] and tests['success'] is True
save();print(json.dumps({'passed':report['passed'],'sourceStable':report['sourceStable'],'testCounts':report.get('testCounts')}),flush=True)
sys.exit(0 if report['passed'] else 1)
