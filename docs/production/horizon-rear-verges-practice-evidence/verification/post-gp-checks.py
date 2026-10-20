from pathlib import Path
import subprocess,json,hashlib,time,datetime,sys
root=Path('/workspace/scratch/b60b57e087a1/Experiment-3');out=Path('/dev/shm/horizon-b60-validation')
identity=json.loads((out/'post-gp-source-identity.json').read_text())
def fingerprint():
 h=hashlib.sha256()
 files=sorted([p for p in (root/'src').rglob('*') if p.is_file()]+[root/name for name in ['package-lock.json','index.html','vite.config.ts']],key=lambda p:p.relative_to(root).as_posix())
 assert {p.relative_to(root).as_posix() for p in files}==set(identity['files'])
 for p in files:h.update(p.relative_to(root).as_posix().encode()+b'\0'+p.read_bytes()+b'\0')
 return h.hexdigest()
assert fingerprint()==identity['fingerprint']
node=['node','--max-old-space-size=2048']
commands=[('post-gp-typescript',node+['node_modules/typescript/bin/tsc','--noEmit']),('post-gp-eslint',node+['node_modules/eslint/bin/eslint.js',*json.loads((out/'post-gp-lint-files.json').read_text())]),('post-gp-production-build',node+['--experimental-transform-types',str(out/'post-gp-build.mjs')])]
report={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'integratedBase':identity['integratedBase'],'sourceFingerprint':fingerprint(),'sourceScope':identity['scope'],'steps':[],'passed':False,'scopeNotes':['A later MotoGP rendering/UI commit was integrated after the physics-v16 verification. All 81 recorded Festival files and the exact 211-file physical subset remain byte-identical; see post-gp-integration.json for the measured count and paths.','The existing 63 Festival regressions, 26 physical/identity integration assertions, two RH3 practice drives, content validation and component captures retain their original recorded scopes. No duplicate physics/render checks were run for unchanged inputs. This gate compiles the new combined render/UI application and lints every newly changed TS/JS file.','Each command retains a 600-second limit. The actual production Vite config is retained; duplicate public asset copy is disabled in the temporary build output.']}
# Keep the explanatory count tied to the measured integration proof.
proof=json.loads((out/'post-gp-integration.json').read_text());report['scopeNotes'][0]=report['scopeNotes'][0].replace('211-file',str(proof['physicalFilesCompared'])+'-file')
def save():(out/'post-gp-validation.json').write_text(json.dumps(report,indent=2)+'\n')
save()
for name,cmd in commands:
 print('START '+name,flush=True);start=time.monotonic();log=out/(name+'.log')
 with log.open('w') as f:
  try:
   r=subprocess.run(cmd,cwd=root,stdout=f,stderr=subprocess.STDOUT,timeout=600)
   step={'name':name,'command':cmd,'exitCode':r.returncode,'passed':r.returncode==0,'elapsedMs':round((time.monotonic()-start)*1000),'log':log.name}
  except subprocess.TimeoutExpired:step={'name':name,'command':cmd,'exitCode':None,'passed':False,'elapsedMs':round((time.monotonic()-start)*1000),'log':log.name,'failure':'Fixed 600-second phase limit exceeded'}
 report['steps'].append(step);save();print('FINISH '+json.dumps(step),flush=True)
 if not step['passed']:break
report['finalSourceFingerprint']=fingerprint();report['sourceStable']=report['sourceFingerprint']==report['finalSourceFingerprint'];report['passed']=len(report['steps'])==len(commands) and all(s['passed'] for s in report['steps']) and report['sourceStable'];save();print(json.dumps({'passed':report['passed'],'sourceStable':report['sourceStable']}),flush=True)
sys.exit(0 if report['passed'] else 1)
