from pathlib import Path
import subprocess,json,hashlib,time,datetime,sys
root=Path('/workspace/scratch/b60b57e087a1/Experiment-3');out=Path('/dev/shm/horizon-b60-validation')
identity=json.loads((out/'source-identity.json').read_text())
def fingerprint():
 h=hashlib.sha256()
 paths=sorted([p for p in (root/'src').rglob('*') if p.is_file()]+[root/name for name in ['package-lock.json','index.html','vite.config.ts']],key=lambda p:p.relative_to(root).as_posix())
 for p in paths:
  h.update(p.relative_to(root).as_posix().encode()+b'\0'+p.read_bytes()+b'\0')
 return h.hexdigest()
assert fingerprint()==identity['fingerprint']
prior=json.loads((out/'pre-v15/tests.json').read_text());assert prior['success'] and prior['numPassedTests']==63
lint=json.loads((out/'changed-lint-files.json').read_text())
node=['node','--max-old-space-size=2048']
commands=[
 ('integration-tests',node+['node_modules/vitest/vitest.mjs','run','--config',str(out/'vitest.config.mjs'),'tests/aero-wind.test.ts','tests/session-identity.test.ts','tests/festival-rival-passing.test.ts','-t','production aerodynamics in the air-relative frame|WP12 recorded identity and schema policy|keeps the SC7 rear tyres loaded','--reporter=json','--outputFile='+str(out/'integration-tests.json')]),
 ('physical-clean',node+['--experimental-transform-types','scripts/horizon-practice-validation.ts',str(out/'physical-clean.json')]),
 ('physical-off-road',node+['--experimental-transform-types','scripts/horizon-practice-validation.ts',str(out/'physical-off-road.json'),'--stress']),
 ('typescript',node+['node_modules/typescript/bin/tsc','--noEmit']),
 ('eslint-integrated-changes',node+['node_modules/eslint/bin/eslint.js',*lint]),
 ('content',node+['--experimental-transform-types','scripts/validate-content.ts']),
 ('production-build',node+['--experimental-transform-types',str(out/'build.mjs')]),
]
report={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'integratedBase':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'sourceFingerprint':fingerprint(),'fingerprintScope':identity['scope'],'steps':[],'passed':False,'notes':['Final integration after main advanced from c4f674 to 844725. All 81 recorded Festival implementation files stayed byte-identical; see festival-integration.json.','The nine-file Festival regression set passed 63/63 on c4f674 plus this revision. Those unchanged component tests are retained under pre-v15 instead of needlessly repeated. Final integration exercises aero wind, simulation identity and the existing 25-second SC7 physical opening manoeuvre, followed by actual RH3 clean and off-road practice drives.','The original full lint pass covered src, tests, e2e and scripts; this final pass lints every incoming changed TS/JS module plus the corrected wheel-anchor test. Full TypeScript, content and production compilation run on the final source.','Direct CLIs avoid unchanged supplied-character LOD prehooks. Actual production Vite config is retained; temporary bundle output omits public asset duplication, and content validation checks the real assets.','One isolated thread and JSON reporting are used; no dependency source or worker RPC deadline is patched. Tests keep 120-second timeout and commands a fixed 600-second phase limit. No entire repository suite or npm run check claim.']}
def save(): (out/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
save()
for name,cmd in commands:
 print('START '+name,flush=True);start=time.monotonic();log=out/(name+'.log')
 with log.open('w') as f:
  try:
   result=subprocess.run(cmd,cwd=root,stdout=f,stderr=subprocess.STDOUT,timeout=600)
   step={'name':name,'command':cmd,'exitCode':result.returncode,'passed':result.returncode==0,'elapsedMs':round((time.monotonic()-start)*1000),'log':log.name}
  except subprocess.TimeoutExpired:
   step={'name':name,'command':cmd,'exitCode':None,'passed':False,'elapsedMs':round((time.monotonic()-start)*1000),'log':log.name,'failure':'Fixed 600-second phase limit exceeded'}
 report['steps'].append(step);save();print('FINISH '+json.dumps(step),flush=True)
 if not step['passed']: break
report['finalSourceFingerprint']=fingerprint();report['sourceStable']=report['sourceFingerprint']==report['finalSourceFingerprint'];report['passed']=len(report['steps'])==len(commands) and all(x['passed'] for x in report['steps']) and report['sourceStable'];save();print(json.dumps({'passed':report['passed'],'sourceStable':report['sourceStable'],'steps':len(report['steps'])}),flush=True)
sys.exit(0 if report['passed'] else 1)
