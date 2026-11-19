import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

const [rootArg,recordingArg,prefixArg]=process.argv.slice(2),root=resolve(rootArg),path=resolve(recordingArg),prefix=resolve(prefixArg);
const raw=readFileSync(path),data=JSON.parse(raw),hash=b=>createHash('sha256').update(b).digest('hex'),load=p=>import(pathToFileURL(resolve(root,p)).href);
for(const [file,h]of Object.entries(data.sourceHashes))if(hash(readFileSync(resolve(root,file)))!==h)throw new Error('Recorded source changed: '+file);
const {GP_ASSIST}=await load('src/simulation/bike.ts'),{gpCamberFriction,gpRollInertia}=await load('src/simulation/motogp-physics.ts');
const fall=data.falls[0],p=fall.nativeProof.parameters,geometry=fall.nativeProof.gp.geometry,
  history=data.history.find(h=>h.id===fall.id).rows,dt=history[0].dt,horizon=1/GP_ASSIST.rateGain,steps=horizon/dt,full=Math.floor(steps),fraction=steps-full;
const support=q=>Math.min(q.frontMu*q.frontLoad*p.wheelbase/(q.mass*p.cgToRear),q.rearMu*q.rearLoad*p.wheelbase/(q.mass*p.cgToFront))*gpCamberFriction(q.lean);
const reaction=q=>(q.frontLoad+q.rearLoad)/q.mass;
const capacity=q=>Math.max(.5,Math.min(
  Math.sqrt(Math.max(0,(q.frontMu*gpCamberFriction(q.lean)*q.frontLoad)**2-q.frontFx**2))/((q.mass*p.cgToRear)/p.wheelbase),
  Math.sqrt(Math.max(0,(q.rearMu*gpCamberFriction(q.lean)*q.rearLoad)**2-q.rearFx**2))/((q.mass*p.cgToFront)/p.wheelbase)));
const targetLimit=q=>Math.atan2(GP_ASSIST.leanMargin*support(q),reaction(q));
const work=(origin,q)=>{
  const o=origin.observation,target=origin.rollResult.target,forecast=o.activeForecast??o.currentForecast,direction=Math.sign(target-forecast.ahead),k=q.mass*p.cgHeight/gpRollInertia(geometry,q.mass,p.cgHeight);
  return k*(GP_ASSIST.recovery*capacity(q)*direction*(Math.sin(target)-Math.sin(forecast.ahead))+reaction(q)*(Math.cos(target)-Math.cos(forecast.ahead)));
};
const rows=[];
for(let i=0;i<history.length;i++){
  const origin=history[i],o=origin.observation;
  if(!o||origin.before.time<81.6||origin.before.time>82.4||i+full>=history.length)continue;
  const window=history.slice(i,i+full+1);
  if(window.some(r=>!r.plant||!r.observation))continue;
  const samples=window.map((r,j)=>{
    const q=r.plant.q,heldPose={...q,lean:o.q.lean,frontMu:o.q.frontMu,rearMu:o.q.rearMu,mass:o.q.mass};
    return {index:i+j,relativeTime:j*dt,weightSeconds:(j===full?fraction:1)*dt,time:r.before.time,
      frontLoad:q.frontLoad,rearLoad:q.rearLoad,reaction:reaction(q),pureSupport:support(q),supportedTargetLimit:targetLimit(q),
      heldPosePureSupport:support(heldPose),heldPoseTargetLimit:targetLimit(heldPose),finalForceCapacity:capacity(q),
      heldOriginStoppingWork:work(origin,q),frontFx:q.frontFx,rearFx:q.rearFx,
      actualLean:q.lean,actualLeanRate:r.before.leanRate,actualTarget:r.rollResult.target};
  });
  const sum=key=>samples.reduce((s,r)=>s+r[key]*r.weightSeconds,0)/horizon,
    min=key=>samples.reduce((a,b)=>b[key]<a[key]?b:a),
    currentPure=support(o.q),currentLimit=targetLimit(o.q),currentFinal=capacity(origin.plant.q),target=origin.rollResult.target,
    unsupported=samples.filter(s=>Math.abs(target)>s.supportedTargetLimit+1e-12),
    unsupportedHeld=samples.filter(s=>Math.abs(target)>s.heldPoseTargetLimit+1e-12),
    currentWork=work(origin,o.q);
  rows.push({index:i,time:origin.before.time,tick:origin.before.tick,substep:origin.before.substep,s:origin.before.s,
    lean:o.q.lean,leanRate:origin.before.leanRate,rawPath:o.rawPath,requestedTarget:o.stick*origin.before.leanLimit,target,
    currentPureSupport:currentPure,currentSupportedLimit:currentLimit,currentFinalForceCapacity:currentFinal,
    currentStoppingWork:currentWork,
    futureMinimumPureSupport:min('pureSupport'),futureMeanPureSupport:sum('pureSupport'),
    futureMeanHeldPosePureSupport:sum('heldPosePureSupport'),
    futureMinimumSupportedLimit:min('supportedTargetLimit'),futureMeanSupportedLimit:sum('supportedTargetLimit'),
    futureMinimumHeldPoseSupportedLimit:min('heldPoseTargetLimit'),
    futureMinimumFinalForceCapacity:min('finalForceCapacity'),futureMeanFinalForceCapacity:sum('finalForceCapacity'),
    futureMinimumHeldOriginStoppingWork:min('heldOriginStoppingWork'),futureMeanHeldOriginStoppingWork:sum('heldOriginStoppingWork'),
    currentVsFutureMeanPureSupport:currentPure-sum('pureSupport'),currentVsFutureMinPureSupport:currentPure-min('pureSupport').pureSupport,
    targetExceedsFutureMin:Math.abs(target)-min('supportedTargetLimit').supportedTargetLimit,
    targetExceedsFutureHeldPoseMin:Math.abs(target)-min('heldPoseTargetLimit').heldPoseTargetLimit,
    unsupportedDuration:unsupported.reduce((s,r)=>s+r.weightSeconds,0),heldPoseUnsupportedDuration:unsupportedHeld.reduce((s,r)=>s+r.weightSeconds,0),
    retainedIncomingState:!!origin.entryState,samples});
}
const max=(key,abs=false)=>rows.reduce((a,b)=>(abs?Math.abs(b[key]):b[key])>(abs?Math.abs(a[key]):a[key])?b:a);
const compact=r=>Object.fromEntries(Object.entries(r).filter(([key])=>key!=='samples'));
const sequence=rows.filter((r,i)=>i%24===0).map(compact);
const report={scope:'Saved future-support comparison over the existing 1/rateGain response horizon. No production source or physical load/capacity is changed.',
  recording:path,recordingSha256:hash(raw),sourceHashes:data.sourceHashes,
  interval:{start:81.6,end:82.4},horizon,rateGain:GP_ASSIST.rateGain,dt,steps,
  sampling:'Native current contact inputs are held over each substep; 26 whole steps plus two thirds of the 27th cover 1/9 s. Future minima/means use these positive-duration samples. No new filter or admission law is applied.',
  currentTargetDefinition:'Recorded actual supported target. Pure support ignores Fx as the existing target admission does; final-force capacity retains actual signed Fx and the full existing arrest budget.',
  counts:{origins:rows.length,risingRoll:rows.filter(r=>r.leanRate>0).length,
    targetExceedsFutureMinByPoint01:rows.filter(r=>r.targetExceedsFutureMin>.01).length,
    targetExceedsHeldPoseFutureMinByPoint01:rows.filter(r=>r.targetExceedsFutureHeldPoseMin>.01).length,
    currentPureAboveFutureMeanBy1:rows.filter(r=>r.currentVsFutureMeanPureSupport>1).length,
    currentPureAboveFutureMeanBy2:rows.filter(r=>r.currentVsFutureMeanPureSupport>2).length},
  largestTargetOvershoot:compact(max('targetExceedsFutureMin')),
  largestHeldPoseTargetOvershoot:compact(max('targetExceedsFutureHeldPoseMin')),
  largestCurrentVsFutureMeanSupport:compact(max('currentVsFutureMeanPureSupport')),
  longestUnsupportedTargetDuration:compact(max('unsupportedDuration')),sampledOrigins:sequence,
  limitations:['The future support belongs to the unchanged recorded trajectory and responds to the original controls. It is hindsight evidence, not a prediction available to the controller.',
    'A target exceeding a later instantaneous admission limit does not alone prove unrecoverability or identify the initiating cause of the fall.',
    'Held-origin stopping work keeps the origin target/ahead geometry and substitutes future actual capacity/reaction only; it is a local comparison, not integrated true work over the changing future pose.',
    'The held-pose/grip control separates load/mass preparation changes from later lean and friction evolution.',
    'No proposed support admission rule, new gain, or filtered physical force is evaluated by this analysis.']};
const compressed=gzipSync(Buffer.from(JSON.stringify(rows)+'\n'),{level:9,mtime:0});writeFileSync(prefix+'-rows.json.gz',compressed);
report.rowsFile=prefix+'-rows.json.gz';report.rowsGzipSha256=hash(compressed);
writeFileSync(prefix+'.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).filter(([k])=>!['sampledOrigins','sourceHashes'].includes(k))),null,2));
