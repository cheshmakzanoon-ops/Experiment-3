import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

const [rootArg,dataArg,prefixArg]=process.argv.slice(2),root=resolve(rootArg),path=resolve(dataArg),prefix=resolve(prefixArg);
const raw=readFileSync(path),data=JSON.parse(raw),hash=b=>createHash('sha256').update(b).digest('hex'),load=p=>import(pathToFileURL(resolve(root,p)).href);
for(const [file,h] of Object.entries(data.sourceHashes)) if(hash(readFileSync(resolve(root,file)))!==h) throw new Error('Recorded source changed: '+file);
const {G,clamp}=await load('src/core/math.ts');
const {GP_ASSIST}=await load('src/simulation/bike.ts');
const {gpCamberFriction,gpRollInertia,gpSpinPerSpeed,gpRollRateLimit}=await load('src/simulation/motogp-physics.ts');
const fall=data.falls[0],p=fall.nativeProof.parameters,geometry=fall.nativeProof.gp.geometry,history=data.history.find(h=>h.id===fall.id).rows;
const states={lower:0,upper:Infinity},rows=[];
let maxTargetError=0,maxReserveError=0,maxFrontRequestError=0,maxReactionError=0,firstExactConvergence=null;
for(let index=0;index<history.length;index++) {
  const row=history[index],o=row.observation;
  if(!o||!row.plant||!row.frontInverse||!row.rearPreview)continue;
  const q=o.q,m=q.mass,h=p.cgHeight,inertia=gpRollInertia(geometry,m,h),k=m*h/inertia,dt=row.dt;
  const support=Math.min(q.frontMu*q.frontLoad*p.wheelbase/(m*p.cgToRear),q.rearMu*q.rearLoad*p.wheelbase/(m*p.cgToFront))*gpCamberFriction(q.lean),
    reaction=(q.frontLoad+q.rearLoad)/m,ratio=reaction>1e-6?support/reaction:0,
    nativeLimit=Math.atan2(GP_ASSIST.leanMargin*support,reaction),requestedTarget=clamp(o.stick,-1,1)*row.before.leanLimit,
    target=clamp(requestedTarget,-nativeLimit,nativeLimit),forecast=o.activeForecast??o.currentForecast,
    shoulder=gpCamberFriction(q.lean),capacity=Math.max(.5,Math.min(
      Math.sqrt(Math.max(0,(q.frontMu*shoulder*q.frontLoad)**2-q.frontFx**2))/((m*p.cgToRear)/p.wheelbase),
      Math.sqrt(Math.max(0,(q.rearMu*shoulder*q.rearLoad)**2-q.rearFx**2))/((m*p.cgToFront)/p.wheelbase))),
    recovery=GP_ASSIST.recovery*capacity,
    gyro=gpSpinPerSpeed(geometry)*q.speed*row.before.gp.yawRate*Math.cos(q.lean),
    balance=accel=>(m*h*reaction*Math.sin(o.psi)-gyro-inertia*accel)/(m*h*Math.max(.3,Math.cos(o.psi))),
    requestedError=requestedTarget-forecast.ahead,
    rawEffort=Math.sign(requestedError)*Math.min(gpRollRateLimit(q.speed,geometry),GP_ASSIST.rollGain*Math.abs(requestedError)),
    requestedReserve=Math.abs(balance(GP_ASSIST.rateGain*(rawEffort-forecast.rateAhead))),
    zeroRateArrestReserve=Math.abs(balance(-GP_ASSIST.rateGain*forecast.rateAhead));
  const plan=plannedTarget=>{
    const error=plannedTarget-forecast.ahead,direction=Math.sign(error),
      effort=direction*Math.min(gpRollRateLimit(q.speed,geometry),GP_ASSIST.rollGain*Math.abs(error)),
      stopping=k*(recovery*direction*(Math.sin(plannedTarget)-Math.sin(forecast.ahead))+reaction*(Math.cos(plannedTarget)-Math.cos(forecast.ahead))),
      rate=direction*Math.min(Math.abs(effort),Math.sqrt(2*GP_ASSIST.stopShare*Math.max(0,stopping))),
      demand=balance(GP_ASSIST.rateGain*(rate-forecast.rateAhead)),lateral=clamp(demand,-recovery,recovery),
      reportedReserve=Math.min(Math.max(Math.abs(demand),requestedReserve),2*G),
      nominalLeanReserve=G*Math.tan(Math.min(1.3,Math.max(Math.abs(o.psi),Math.abs(plannedTarget)))),
      allocationReserve=Math.max(Math.abs(o.stored),nominalLeanReserve,reportedReserve)*(GP_ASSIST.recovery/GP_ASSIST.leanMargin),
      frontRequest=m*lateral-row.rearPreview.result-(GP_ASSIST.yawDamping*geometry.yawInertia*(row.before.gp.yawRate-lateral/Math.max(q.speed,3)))/geometry.frontArm;
    return {target:plannedTarget,error,direction,effort,stopping,rate,demand,lateral,reportedReserve,nominalLeanReserve,allocationReserve,frontRequest,requestedReserve};
  };
  const original=plan(target),shadows={};
  for(const [name,old] of Object.entries(states)) {
    const mix=1-Math.exp(-GP_ASSIST.rateGain*dt),admitted=Number.isFinite(old)?Math.min(ratio,old+(ratio-old)*mix):ratio;
    states[name]=admitted;
    // Preserve the exact native atan2 arithmetic whenever ratio admission is nonbinding.
    const supportedLimit=admitted<ratio?Math.min(nativeLimit,Math.atan(GP_ASSIST.leanMargin*admitted)):nativeLimit,
      shadowTarget=clamp(requestedTarget,-supportedLimit,supportedLimit),shadow=plan(shadowTarget);
    shadows[name]={admitted,supportedLimit,ratioBinding:admitted<ratio,...shadow,
      targetChange:shadowTarget-target,rateChange:shadow.rate-original.rate,lateralChange:shadow.lateral-original.lateral,
      demandChange:shadow.demand-original.demand,frontRequestChange:shadow.frontRequest-original.frontRequest,
      reportedReserveChange:shadow.reportedReserve-original.reportedReserve,allocationReserveChange:shadow.allocationReserve-original.allocationReserve,
      rawRequestReserveChange:shadow.requestedReserve-original.requestedReserve};
  }
  const targetError=target-row.rollResult.target,reserveError=original.reportedReserve-row.rollResult.demand,frontRequestError=original.frontRequest-row.frontInverse.args[0];
  maxTargetError=Math.max(maxTargetError,Math.abs(targetError));maxReserveError=Math.max(maxReserveError,Math.abs(reserveError));maxFrontRequestError=Math.max(maxFrontRequestError,Math.abs(frontRequestError));maxReactionError=Math.max(maxReactionError,Math.abs(reaction-o.reaction));
  const boundsDifference=states.upper-states.lower;
  if(boundsDifference===0&&firstExactConvergence===null)firstExactConvergence={index,time:row.before.time,admitted:states.upper};
  rows.push({index,time:row.before.time,tick:row.before.tick,substep:row.before.substep,s:row.before.s,dt,lean:q.lean,leanRate:row.before.leanRate,psi:o.psi,speed:q.speed,
    rawPath:o.rawPath,requestedTarget,support,reaction,ratio,nativeLimit,capacity,recovery,forecast,
    frontLoad:q.frontLoad,rearLoad:q.rearLoad,oldFrontFx:q.frontFx,oldRearFx:q.rearFx,actualFrontFx:row.plant.q.frontFx,actualRearFx:row.plant.q.rearFx,
    zeroRateArrestReserve,requestedReserve,original,...shadows,boundsDifference,targetError,reserveError,frontRequestError,
    retainedIncomingState:!!row.entryState});
}
if(maxTargetError!==0||maxReserveError!==0||maxFrontRequestError!==0||maxReactionError!==0)throw new Error('Native reconstruction is not exact: '+JSON.stringify({maxTargetError,maxReserveError,maxFrontRequestError,maxReactionError}));
const window=rows.filter(r=>r.time>=81.6&&r.time<82.4),maxAbs=(items,get)=>items.reduce((a,b)=>Math.abs(get(b))>Math.abs(get(a))?b:a),min=(items,get)=>items.reduce((a,b)=>get(b)<get(a)?b:a);
const scopeSummary=(items)=>({count:items.length,
  ratioBinding:items.filter(r=>r.upper.ratioBinding).length,targetChanged:items.filter(r=>r.upper.target!==r.original.target).length,
  targetChangedByPoint01:items.filter(r=>Math.abs(r.upper.targetChange)>.01).length,lateralChangedByPoint01:items.filter(r=>Math.abs(r.upper.lateralChange)>.01).length,
  rateChangedByPoint01:items.filter(r=>Math.abs(r.upper.rateChange)>.01).length,
  rawRequestReserveChanged:items.filter(r=>r.upper.rawRequestReserveChange!==0).length,
  reportedReserveDecreased:items.filter(r=>r.upper.reportedReserveChange<0).length,allocationReserveDecreased:items.filter(r=>r.upper.allocationReserveChange<0).length,
  maximumInitialBoundsDifference:Math.max(...items.map(r=>r.boundsDifference)),
  firstTargetChangeAbovePoint01:items.find(r=>Math.abs(r.upper.targetChange)>.01)??null,
  firstLateralChangeAbovePoint01:items.find(r=>Math.abs(r.upper.lateralChange)>.01)??null,
  maximumTargetChange:maxAbs(items,r=>r.upper.targetChange),maximumLateralChange:maxAbs(items,r=>r.upper.lateralChange),
  maximumRateChange:maxAbs(items,r=>r.upper.rateChange),minimumAllocationReserveChange:min(items,r=>r.upper.allocationReserveChange)});
const times=[81.6,81.7,81.8,81.9,82,82.1,82.2,82.3,82.333333333333,82.35,82.4];
const report={scope:'Offline target-only admission shadow on the unchanged saved native trajectory. It changes neither the executed controls nor any production source.',
  recording:path,recordingSha256:hash(raw),sourceHashes:data.sourceHashes,observations:rows.length,
  rule:{ratio:'pure current support / current reaction',initialBounds:{lower:0,upper:'Infinity (native reset sentinel)'},
    update:'admitted = finite(previous) ? min(current, previous + (current - previous) * (1 - exp(-rateGain * dt))) : current',
    rateGain:GP_ASSIST.rateGain,horizon:1/GP_ASSIST.rateGain,
    limit:'Keep native atan2(leanMargin * support, reaction) unless admitted ratio is below current; then take min(native limit, atan(leanMargin * admitted)).',
    scope:'Only the new target is restricted. Current stopping-work formula uses exactly the original unfiltered capacity and reaction; recovery and force limits remain original. Original requestedTarget, active current-strain forecast and raw-request reserve remain original.'},
  initialBounds:{firstExactConvergence,maximumOnsetWindowDifference:Math.max(...window.map(r=>r.boundsDifference))},
  reconstruction:{maxTargetError,maxReserveError,maxFrontRequestError,maxReactionError},
  entireHistory:scopeSummary(rows),onsetWindow:{start:81.6,end:82.4,...scopeSummary(window)},
  sampledOrigins:times.map(time=>rows.reduce((a,b)=>Math.abs(b.time-time)<Math.abs(a.time-time)?b:a)),
  limitations:['This is an algebraic shadow. Actual roll, support loads, forecast, speed, path, trim, front inverse state, later pedals and future trajectory stay recorded from the original controller.',
    'Current stopping capacity is the exact native pre-allocation capacity used by this candidate, including previous signed Fx; target admission does not repair its phase relative to the later final Fx.',
    'The old raw-request reserve contribution is unchanged, but the planned-demand contribution and nominal target-lean reserve may change with the new target. A preserved raw term is not a proof that all endpoint arrest demand is reserved.',
    'Bounds cover any nonnegative incoming admission state because the recurrence clips immediately at current ratio. Both are propagated from the first retained row; no earlier trajectory is invented.',
    'Local earlier action does not prove the fall is avoided or unchanged controls pass. A later native closed-loop gate would still be required.']};
const compressed=gzipSync(Buffer.from(JSON.stringify(rows)+'\n'),{level:9,mtime:0});writeFileSync(prefix+'-rows.json.gz',compressed);report.rowsFile=prefix+'-rows.json.gz';report.rowsGzipSha256=hash(compressed);
writeFileSync(prefix+'.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({observations:report.observations,reconstruction:report.reconstruction,initialBounds:report.initialBounds,
  onset:Object.fromEntries(Object.entries(report.onsetWindow).filter(([k])=>!/^first|^maximumTarget|^maximumLateral|^maximumRate|^minimumAllocation/.test(k))),
  sampledOrigins:report.sampledOrigins.map(r=>({time:r.time,lean:r.lean,leanRate:r.leanRate,ratio:r.ratio,admitted:r.upper.admitted,
    oldTarget:r.original.target,newTarget:r.upper.target,oldRate:r.original.rate,newRate:r.upper.rate,oldLateral:r.original.lateral,newLateral:r.upper.lateral,
    rawRequestReserve:r.requestedReserve,oldReportedReserve:r.original.reportedReserve,newReportedReserve:r.upper.reportedReserve,
    oldAllocationReserve:r.original.allocationReserve,newAllocationReserve:r.upper.allocationReserve}))},null,2));
