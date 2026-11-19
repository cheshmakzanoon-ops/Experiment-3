import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const [rootArg, recordingArg, prefixArg] = process.argv.slice(2);
const root=resolve(rootArg), recordingPath=resolve(recordingArg), prefix=resolve(prefixArg);
const raw=readFileSync(recordingPath), data=JSON.parse(raw), hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const file='src/simulation/motogp-physics.ts', sourceHash=hash(readFileSync(resolve(root,file)));
if(sourceHash!==data.sourceHashes[file]) throw new Error('Native angle source changed since recording');
const {gpHangOffAngle,gpCamberFriction,MOTOGP_SLICK}=await import(pathToFileURL(resolve(root,file)).href);
const tyreForceFile='src/simulation/tyre-force.ts',tyreForceHash=hash(readFileSync(resolve(root,tyreForceFile)));
const {prepareSlip,slipState}=await import(pathToFileURL(resolve(root,tyreForceFile)).href);
const {GP_ASSIST}=await import(pathToFileURL(resolve(root,'src/simulation/bike.ts')).href);
if(hash(readFileSync(resolve(root,'src/simulation/bike.ts')))!==data.sourceHashes['src/simulation/bike.ts']) throw new Error('Forecast horizon source changed');
const fall=data.falls[0], history=data.history.find(h=>h.id===fall.id).rows, dt=history[0].dt, horizon=GP_ASSIST.lead;
if(history.some(r=>r.dt!==dt)) throw new Error('Variable substep duration needs a different interpolation');
const steps=horizon/dt, lower=Math.floor(steps), upper=Math.ceil(steps), weight=steps-lower;
const cgHeight=fall.nativeProof.parameters.cgHeight;
if(history.some(r=>r.entryState && r.entryState.bike.p.cgHeight!==cgHeight)) throw new Error('Vehicle CG height changed');
const gaps=[], bodyDiscontinuities=[];
for(let i=1;i<history.length;i++){
  const a=history[i-1], b=history[i];
  if(!((b.before.tick===a.before.tick&&b.before.substep===a.before.substep+1)||(b.before.tick===a.before.tick+1&&a.before.substep===2&&b.before.substep===1))) gaps.push(i);
  for(const key of ['lean','leanRate','riderOffset']) if(a.after[key]!==b.before[key]) bodyDiscontinuities.push({i,key,previous:a.after[key],next:b.before[key]});
}
if(gaps.length) throw new Error('The saved substep sequence has gaps');
const combined=body=>body.lean+gpHangOffAngle(body.riderOffset,cgHeight);
const mix=(a,b)=>a+(b-a)*weight;
function forceBound(load,mu,lean){
  if(!(load>1&&mu>0)) return 0;
  const state=slipState();
  prepareSlip(MOTOGP_SLICK,load,Math.max(.05,mu)*gpCamberFriction(lean),1,1,1,state);
  return state.dy;
}
const records=[];
let noObservation=0, truncatedHorizon=0;
for(let i=0;i<history.length;i++){
  const row=history[i], o=row.observation;
  if(!o){noObservation++;continue;}
  if(i+upper-1>=history.length){truncatedHorizon++;continue;}
  const lo=history[i+lower-1],hi=history[i+upper-1],window=history.slice(i,i+upper);
  const actual={pose:mix(combined(lo.after),combined(hi.after)),rate:mix(lo.after.leanRate,hi.after.leanRate)};
  const errors={};
  for(const [key,forecast] of [['stored',o.storedForecast],['current',o.currentForecast]])
    errors[key]={pose:forecast.ahead-actual.pose,rate:forecast.rateAhead-actual.rate};
  const crossesAirborne=window.some(r=>r.before.road.airborne||r.after.road.airborne);
  const crossesZeroSupport=window.some(r=>r.plant && r.plant.q.frontLoad+r.plant.q.rearLoad<=1e-6);
  const crossesFall=window.some(r=>r.before.state!=='riding'||r.after.state!=='riding'||r.after.crashes!==r.before.crashes);
  const frontBound=forceBound(o.q.frontLoad*Math.max(0,Math.min(1,o.q.frontContact)),o.q.frontMu,o.q.lean),
    rearBound=forceBound(o.q.rearLoad,o.q.rearMu,o.q.lean),
    infeasiblePriorFrontForce=Math.abs(o.q.frontFx)>frontBound+1e-9,
    infeasiblePriorRearForce=Math.abs(o.q.rearFx)>rearBound+1e-9;
  records.push({originIndex:i,tick:row.before.tick,substep:row.before.substep,raceTime:row.before.time,s:row.before.s,
    elapsedSubstepTime:i*dt,lowerFutureAfterIndex:i+lower-1,upperFutureAfterIndex:i+upper-1,
    originActualCombinedLean:combined(row.before),originControllerPsi:o.psi,
    originRiderPhaseDifference:o.psi-combined(row.before),actual,
    storedForecast:o.storedForecast,currentForecast:o.currentForecast,errors,
    crossesAirborne,crossesZeroSupport,crossesFall,
    frontBound,rearBound,infeasiblePriorFrontForce,infeasiblePriorRearForce,
    reaction:o.reaction,storedAcceleration:o.stored,currentPreparationAcceleration:o.current,
    frontFx:o.q.frontFx,rearFx:o.q.rearFx});
}
function metrics(rows){
  const out={count:rows.length};
  if(!rows.length) return out;
  for(const prediction of ['stored','current']){
    out[prediction]={};
    for(const value of ['pose','rate']){
      const e=rows.map(r=>r.errors[prediction][value]);
      out[prediction][value]={rmse:Math.sqrt(e.reduce((s,v)=>s+v*v,0)/e.length),mae:e.reduce((s,v)=>s+Math.abs(v),0)/e.length,bias:e.reduce((s,v)=>s+v,0)/e.length,maxAbsolute:Math.max(...e.map(Math.abs))};
    }
  }
  out.rmseReductionPercent={pose:100*(1-out.current.pose.rmse/out.stored.pose.rmse),rate:100*(1-out.current.rate.rmse/out.stored.rate.rmse)};
  return out;
}
const subsets={
  allCompleteHorizons:records,
  noFallHorizons:records.filter(r=>!r.crossesFall),
  continuouslySupported:records.filter(r=>!r.crossesAirborne&&!r.crossesZeroSupport&&!r.crossesFall),
  continuouslySupportedFeasiblePriorForces:records.filter(r=>!r.crossesAirborne&&!r.crossesZeroSupport&&!r.crossesFall&&!r.infeasiblePriorFrontForce&&!r.infeasiblePriorRearForce),
  airborneOrZeroSupportCrossingNoFall:records.filter(r=>(r.crossesAirborne||r.crossesZeroSupport)&&!r.crossesFall),
  fallCrossing:records.filter(r=>r.crossesFall),
  finalSecondNoFall:records.filter(r=>!r.crossesFall&&r.raceTime>=fall.at.time-1),
  finalSecondContinuouslySupported:records.filter(r=>!r.crossesFall&&!r.crossesAirborne&&!r.crossesZeroSupport&&r.raceTime>=fall.at.time-1),
  zeroLongitudinalForceContinuouslySupported:records.filter(r=>!r.crossesFall&&!r.crossesAirborne&&!r.crossesZeroSupport&&r.frontFx===0&&r.rearFx===0),
};
const compressed=gzipSync(Buffer.from(JSON.stringify(records)+'\n'),{level:9,mtime:0});
const rowPath=prefix+'-rows.json.gz';writeFileSync(rowPath,compressed);
const result={scope:'Saved-trajectory forecast comparison only; no race rerun or altered production output.',
  recordingPath,recordingBytes:raw.length,recordingSha256:hash(raw),sourceHash,tyreForceHash,
  rider:fall.id,cgHeight,horizon,dt,futureSteps:steps,interpolation:{lowerSteps:lower,upperSteps:upper,upperWeight:weight},
  errorSign:'forecast minus actual',
  phaseDefinition:'Origin is before the recorded native Bike substep. Future samples are the 14th and 15th native after-states; interpolate at 14.4 steps. Use each recorded controller forecast as emitted, without changing its rider-offset phase. Actual combined lean uses native gpHangOffAngle on the body after-state; leanRate is the native combined-CG roll-rate state.',
  totalRows:history.length,noObservation,truncatedHorizon,completeHorizons:records.length,
  sequenceGaps:gaps,physicalBodyDiscontinuities:bodyDiscontinuities,
  flagCounts:{airborne:records.filter(r=>r.crossesAirborne).length,zeroSupport:records.filter(r=>r.crossesZeroSupport).length,fall:records.filter(r=>r.crossesFall).length,
    infeasiblePriorFrontForce:records.filter(r=>r.infeasiblePriorFrontForce).length,infeasiblePriorRearForce:records.filter(r=>r.infeasiblePriorRearForce).length},
  forceFeasibilityDefinition:'Prior signed Fx must lie within the original native prepareSlip current dy circle (1e-9 N numerical boundary tolerance), and must be zero when its current contact is absent.',
  metrics:Object.fromEntries(Object.entries(subsets).map(([name,rows])=>[name,metrics(rows)])),
  maxOriginRiderPhaseDifference:Math.max(...records.map(r=>Math.abs(r.originRiderPhaseDifference))),
  rowsFile:rowPath,rowsGzipBytes:compressed.length,rowsGzipSha256:hash(compressed),
  limitations:['Future contact loads, input changes, bar precession, wheel-spin changes and rider phase are not frozen; this evaluates the existing forecasts against the actual saved trajectory.',
    'Origins whose 0.06 s horizon crosses airborne/no-support or fall intervals are explicitly flagged and separately summarized.',
    'Better saved-trajectory prediction is not a causal proof that a changed closed-loop controller completes the original races.',
    'The current-strain observer uses saved prior Fx without pre-clipping it into newly reduced circles; comparisons with b3be9ab currentLateralAcceleration require checking prior-force feasibility. Zero-Fx origins avoid that difference.']};
writeFileSync(prefix+'.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({horizon,dt,completeHorizons:records.length,flags:result.flagCounts,bodyDiscontinuities:bodyDiscontinuities.length,metrics:result.metrics},null,2));
