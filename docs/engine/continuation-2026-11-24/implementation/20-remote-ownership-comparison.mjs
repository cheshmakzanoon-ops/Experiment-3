import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const [baselineRoot, candidateRoot, output] = process.argv.slice(2);
if (!baselineRoot || !candidateRoot) throw new Error('Usage: node --experimental-transform-types 20-remote-ownership-comparison.mjs BASELINE_REPO CANDIDATE_REPO [OUTPUT_JSON]');
const paths={baseline:resolve(baselineRoot,'src/net/interpolation.ts'),candidate:resolve(candidateRoot,'src/net/interpolation.ts')};
const [baseline,candidate,snapshot]=await Promise.all([import(pathToFileURL(paths.baseline)),import(pathToFileURL(paths.candidate)),import(pathToFileURL(resolve(candidateRoot,'src/net/snapshot.ts')))]);
let baselineCommit = null;
try { baselineCommit = execFileSync('git', ['-C', resolve(baselineRoot), 'rev-parse', 'HEAD'], {encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); } catch {}
const fields=Object.keys(snapshot.emptyCarState());
const poseFields=['x','y','z','qx','qy','qz','qw'];
let seed=18731,queries=0,pushes=0,latestReads=0;
const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
const digest=createHash('sha256');
const scratch=Buffer.alloc(8);
const record=(value)=>{scratch.writeDoubleLE(value);digest.update(scratch);};
for(let run=0;run<32;run++){
 const a=new baseline.RemoteCarTrack(),b=new candidate.RemoteCarTrack();
 for(let index=0;index<128;index++){
  const tick=Math.max(0,index*6-(index%7===0?12:0));
  const state=snapshot.emptyCarState(run);
  for(const field of fields)state[field]=(random()-.5)*100;
  const q=Math.hypot(state.qx,state.qy,state.qz,state.qw);
  for(const field of ['qx','qy','qz','qw'])state[field]/=q;
  assert.equal(b.push(tick,state),a.push(tick,{...state}));pushes++;
  // Reuse/damage the producer object only after both pushes.
  for(const field of fields)state[field]=-500;
  assert.equal(b.newest,a.newest);
  const got=b.latest(),expected=a.latest();
  assert.deepStrictEqual(got,expected);latestReads++;
  for(const field of fields){record(got[field]);got[field]=1000;}
  for(const offset of [-241,-240,-13.5,0,1.25,7.5,15,18]){
   const query=tick+offset,limit=index%2?15:7.5;
   const sample=b.sample(query,limit),expectedSample=a.sample(query,limit);
   assert.deepStrictEqual(sample,expectedSample);queries++;
   digest.update(sample?.kind??'null');
   if(sample)for(const field of poseFields){record(sample.pose[field]);sample.pose[field]=-2000;}
  }
 }
}
const source={};
for(const [name,path]of Object.entries(paths)){const text=readFileSync(path,'utf8');source[name]={sha256:createHash('sha256').update(text).digest('hex'),sampling:text.slice(text.indexOf('  sample('),text.indexOf('/** Adaptive interpolation delay'))};}
assert.equal(source.baseline.sampling,source.candidate.sampling);
const evidence={node:process.version,baselineCommit,tracks:32,pushes,queries,latestReads,traceSHA256:digest.digest('hex'),samplingAndSlerpByteIdentical:true,sourceSHA256:{baseline:source.baseline.sha256,candidate:source.candidate.sha256}};
if (output) writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
