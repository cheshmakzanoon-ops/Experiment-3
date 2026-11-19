import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Offline native profile and native selection-loop replay. No Simulation is
// instantiated and no race is advanced. Profile, count, geometry, grip, path,
// recovery reserve and all constants stay fixed within each speed-only pair.
const [sourceArg, captureArg, outputArg] = process.argv.slice(2);
const root=resolve(sourceArg),output=resolve(outputArg),sha=b=>createHash('sha256').update(b).digest('hex');
const raw=readFileSync(captureArg);
const input=JSON.parse(raw,(_k,v)=>typeof v==='string'&&['Infinity','-Infinity','NaN'].includes(v)?Number(v):v);
if(!input.source.stable||!input.transitionExactlyReproduced)throw new Error('Unverified input capture');
const source=readFileSync(resolve(root,'src/simulation/bike-ai.ts'),'utf8');
if(sha(source)!==input.source.bikeAiSha256)throw new Error('bike-ai source mismatch');
const marker='    for (let i = 1; i < count; i++)\n      if (this.approachProfile[i] < d.speed - 1) {';
const start=source.indexOf(marker),end=source.indexOf('\n    this.planBrake =',start);
if(start<0||end<0||source.indexOf(marker,start+1)>=0)throw new Error('Native selector not uniquely located');
const initialization='    this.planRunway = Infinity;';
if(!source.includes(initialization))throw new Error('Native initialization missing');
const nativeFragment=initialization+'\n'+source.slice(start,end);
const select=new Function('count','d','ENVELOPE_STEP',nativeFragment+'\nreturn this.planRunway;');
const load=p=>import(pathToFileURL(resolve(root,p)).href);
const {motorcycleApproachProfile}=await load('src/simulation/motorcycle-braking-plan.ts');
const {ENVELOPE_STEP}=await load('src/simulation/ai.ts');
const {GP_ASSIST}=await load('src/simulation/bike.ts');
const selector=(q,speed)=>select.call({approachProfile:Float64Array.from(q.profile)},q.validCount,{speed},ENVELOPE_STEP);
const verified=input.profiles.map(q=>{
  const replayed=new Float64Array(q.profile.length);
  const result=motorcycleApproachProfile(q.curvatures,q.corners,q.computedGrip,q.computedAero,q.env,
    q.validCount,replayed,q.gradients,q.parameters,q.mass,
    GP_ASSIST.recovery/GP_ASSIST.leanMargin,0,q.distances,q.planRecovery);
  const differences=[];
  for(let i=0;i<q.validCount;i++)if(!Object.is(replayed[i],q.profile[i]))differences.push({i,expected:q.profile[i],actual:replayed[i]});
  const runway=selector(q,q.dynamicsSpeed);
  return {tick:q.tick,raceTime:q.raceTime,s:q.s,dynamicsSpeed:q.dynamicsSpeed,count:q.validCount,
    profileResultExact:Object.is(result,q.planLimit),profileEntriesExact:differences.length===0,
    runwayExact:Object.is(runway,q.planRunway),nativeRunway:q.planRunway,replayedRunway:runway,
    expectedPlanLimit:q.planLimit,replayedPlanLimit:result,differences};
});
const allNativeExact=verified.every(v=>v.profileResultExact&&v.profileEntriesExact&&v.runwayExact);
if(!allNativeExact) {
  mkdirSync(output,{recursive:true});
  writeFileSync(resolve(output,'offline-replay-failure.json'),JSON.stringify(verified,(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v,2)+'\n');
  throw new Error('Original native profile/selector did not exactly reproduce; no counterfactual claim allowed');
}
const selectPace=t=>input.paces.reduce((best,p)=>Math.abs(p.raceTime-t)<Math.abs(best.raceTime-t)?p:best);
const chosen=[145.54086604925837,145.63253271592495,145.9075327159247].map(t=>{
  const pace=selectPace(t),profile=input.profiles.find(q=>q.tick===pace.sourceLimitTick);
  if(!profile)throw new Error('Missing phase-exact source profile');
  return {pace,profile};
});
const matrix=chosen.map(({pace,profile})=>{
  let minimum=Infinity,index=-1;
  for(let i=1;i<profile.validCount;i++)if(profile.profile[i]<minimum){minimum=profile.profile[i];index=i;}
  return {profileTick:profile.tick,profileRaceTime:profile.raceTime,paceRaceTime:pace.raceTime,
    s:profile.s,count:profile.validCount,grip:profile.computedGrip,aero:profile.computedAero,
    recovery:profile.planRecovery,tactical:profile.pathCorrection.tactical,
    planLimit:profile.planLimit,planNext:profile.planNext,geometricRunway:pace.geometricRunway,
    actualSpeed:profile.dynamicsSpeed,actualRunway:profile.planRunway,
    minimumFutureProfile:minimum,minimumIndex:index,firstFiniteBoundarySpeed:minimum+1,
    speedOnlyColumns:chosen.map(({profile:other})=>{
      const nativeRunway=selector(profile,other.dynamicsSpeed);
      return {speedFromTick:other.tick,speed:other.dynamicsSpeed,nativeRunway,
        suppliedRunway:Math.min(pace.geometricRunway,nativeRunway)};
    }),
    validProfileSha256:sha(JSON.stringify(profile.profile.slice(0,profile.validCount))),
    validProfile:profile.profile.slice(0,profile.validCount)};
});
// Full window sweeps use observed speed extrema, not invented control inputs.
const speeds=input.profiles.map(q=>q.dynamicsSpeed),low=Math.min(...speeds),high=Math.max(...speeds);
const sweeps=input.profiles.map(q=>({tick:q.tick,raceTime:q.raceTime,s:q.s,count:q.validCount,
  originalSpeed:q.dynamicsSpeed,originalRunway:q.planRunway,lowObservedSpeed:low,highObservedSpeed:high,
  lowSpeedRunway:selector(q,low),highSpeedRunway:selector(q,high)}));
const sourceFiles=['src/simulation/bike-ai.ts','src/simulation/ai.ts','src/simulation/motorcycle-braking-plan.ts','src/simulation/bike.ts'];
const result={schema:'offline-native-runway-replay-v1',root,scope:'No game world construction or race loop; native profile function and verbatim source selector only',
  captureSha256:sha(raw),scriptSha256:sha(readFileSync(new URL(import.meta.url))),
  sourceSha256:Object.fromEntries(sourceFiles.map(p=>[p,sha(readFileSync(resolve(root,p)))])),
  nativeFragment,nativeFragmentSha256:sha(nativeFragment),allNativeExact,
  profilesVerified:verified.length,verified,matrix,sweeps,
  limitations:['Counterfactuals change only the selector speed; count/profile/geometry/grip/path/recovery remain fixed within each row.',
    'These isolate runway selection; they do not predict a corrected race or relax any safety bound.',
    'The original full TrafficPlanner.evaluate state remains incomplete and was not reconstructed.']};
mkdirSync(output,{recursive:true});
const encode=value=>JSON.stringify(value,(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v,2)+'\n';
writeFileSync(resolve(output,'native-runway-loop.txt'),nativeFragment+'\n');
writeFileSync(resolve(output,'offline-replay.json'),encode(result));
console.log(encode({allNativeExact,profilesVerified:verified.length,nativeFragmentSha256:result.nativeFragmentSha256,
  matrix:matrix.map(({validProfile,...rest})=>rest),observedSpeedRange:[low,high],
  speedOnlyRunwayChanges:sweeps.filter(v=>!Object.is(v.lowSpeedRunway,v.highSpeedRunway)).length}));
