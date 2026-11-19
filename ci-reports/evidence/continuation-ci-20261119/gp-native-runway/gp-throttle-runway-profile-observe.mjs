import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

// One explicitly authorized partial replay. Original seeded loop and native
// methods are unchanged; wrappers record and call each original exactly once.
const [sourceArg, outArg, whitelistArg, expectedArg] = process.argv.slice(2);
const root = resolve(sourceArg), output = resolve(outArg);
if (output.startsWith(`${root}/`)) throw new Error('External output required');
const sha = data => createHash('sha256').update(data).digest('hex');
const whitelistBytes = readFileSync(whitelistArg), whitelist = JSON.parse(whitelistBytes);
const expectedBytes = readFileSync(expectedArg), expected = JSON.parse(expectedBytes);
const sourceExpected = { ...whitelist.sourceSha256, ...whitelist.originalTests,
  'tests/gp-steering-throttle-ownership.test.ts': whitelist.focusedTestSha256 };
const enumerate = (dir, prefix='') => readdirSync(dir, {withFileTypes:true}).flatMap(e =>
  e.isDirectory() ? enumerate(resolve(dir,e.name),`${prefix}${e.name}/`) : [`${prefix}${e.name}`]);
function verify() {
  const files = enumerate(resolve(root,'src')).map(p=>`src/${p}`).sort();
  if (JSON.stringify(files)!==JSON.stringify(Object.keys(whitelist.sourceSha256).sort())) throw new Error('Source set differs');
  for (const [p, hash] of Object.entries(sourceExpected))
    if (sha(readFileSync(resolve(root,p)))!==hash) throw new Error(`Source mismatch ${p}`);
  return {sourceFiles:files.length, checkedFiles:Object.keys(sourceExpected).length,
    expectedSha256:sha(JSON.stringify(sourceExpected))};
}
const before=verify(), load=p=>import(pathToFileURL(resolve(root,p)).href);
const {Simulation}=await load('src/simulation/world.ts');
const {DEFAULT_OPTIONS}=await load('src/simulation/config.ts');
const {PHASE}=await load('src/simulation/race.ts');
const {GP_AI_HANDS,gpApproachSampleCount}=await load('src/simulation/bike-ai.ts');
const {GP_ASSIST}=await load('src/simulation/bike.ts');
const {clamp}=await load('src/core/math.ts');
const {racingLineFor}=await load('src/simulation/racing-line.ts');
const options={...DEFAULT_OPTIONS,circuit:'vellamar',mode:'race',ruleset:'gp-motorcycle',laps:2,
  opponents:5,vehicles:['gpr1','sbk1000','gpr1','sbk1000','gpr1','sbk1000'],seed:3303};
const sim=new Simulation(options);sim.autoPlayer=true;
const c=sim.cars[0],d=c.dynamics,a=sim.ai[0],p=a.planner;
const profiles=[],paces=[],plans=[];
let tick=0,activeLimit=null,lastLimitTick=null;
const capture=()=>sim.race.raceTime>=145.30&&sim.race.raceTime<=146.11;
const originalPath=a.pathCorrection;
a.pathCorrection=function(...args){
  const result=originalPath.apply(this,args);
  if(activeLimit)activeLimit.pathCorrection={tactical:args[1],absolute:args[2],result};
  return result;
};
const originalLimit=a.limitSpeed;
a.limitSpeed=function(...args){
  const live=capture();
  if(live)activeLimit={tick,raceTime:sim.race.raceTime,time:sim.race.time,s:c.s,
    desired:args[0],dynamicsSpeed:d.speed,vehicleSpeed:c.speed,heading:d.heading,lateral:c.lateral,
    aiOffsetBefore:c.aiOffset,freeSpeedBefore:a.freeSpeed,trafficSpeed:a.trafficSpeed,
    grip:d.grip,frontGrip:d.frontGrip,rearGrip:d.rearGrip,
    water0:c.contacts[0].water,water2:c.contacts[2].water,frontHealth:c.frontHealth,
    floorHealth:c.floorHealth,wake:c.wake,dryMass:c.spec.dryMass,fuel:c.fuel,mass:d.mass,
    skill:a.skill,env:{...c.definition.ai},parameters:{...d.p}};
  const result=originalLimit.apply(this,args);
  if(live){
    const q=activeLimit;
    if(!q.pathCorrection)throw new Error('Expected native GP approach path correction');
    const tactical=q.pathCorrection.tactical;
    const wetness=clamp(Math.max(q.water0,q.water2)/0.8,0,1);
    // Same frozen arithmetic as the native method, using its phase-exact inputs.
    const grip=clamp(Math.min(q.grip,q.frontGrip??q.grip,q.rearGrip??q.grip),0.1,1)*
      (1-.15*wetness)*clamp(1-(.25*Math.max(0,Math.abs(tactical)-1.5))/6,.8,1);
    const aero=((.45+.55*Math.min(q.frontHealth,q.floorHealth))*q.env.downforceReference*(1-.3*q.wake))/(q.dryMass+q.fuel);
    const count=gpApproachSampleCount(q.dynamicsSpeed,q.env.brakingBase*grip*q.env.brakingMargin,sim.track.length);
    Object.assign(q,{result,wetness,computedGrip:grip,computedAero:aero,validCount:count,
      countDerivation:'Native pure gpApproachSampleCount with the exact captured phase inputs; profile replay must verify the inference.',
      planLimit:a.planLimit,planNext:a.planNext,planDistance:a.planDistance,planRunway:a.planRunway,
      planRecovery:a.planRecovery,planBrake:a.planBrake,
      curvatures:Array.from(a.approachCurvatures),corners:Array.from(a.approachCorners),
      profile:Array.from(a.approachProfile),gradients:Array.from(a.approachGradients),
      metrics:Array.from(a.approachMetrics),distances:Array.from(a.approachDistances)});
    profiles.push(q);activeLimit=null;
  }
  lastLimitTick=tick;
  return result;
};
const originalPace=a.passPace;
a.passPace=function(...args){
  const live=capture(),pre=live?{tick,raceTime:sim.race.raceTime,time:sim.race.time,s:c.s,
    vehicleSpeed:c.speed,dynamicsSpeed:d.speed,rawFreeSpeed:a.freeSpeed,rawPlanLimit:a.planLimit,
    rawPlanRunway:a.planRunway,sourceLimitTick:lastLimitTick}:null;
  const result=originalPace.apply(this,args);
  if(live){
    // Read-only geometry queries, after native passPace already used the same line.
    const line=racingLineFor(args[0]),curvatureSamples=[];let geometricRunway=0;
    while(geometricRunway<GP_AI_HANDS.runwayMax){
      const curvature=line.curvatureAt(c.s+geometricRunway);
      curvatureSamples.push({distance:geometricRunway,curvature});
      if(Math.abs(curvature)>=GP_AI_HANDS.straightCurvature)break;
      geometricRunway+=GP_AI_HANDS.runwayStep;
    }
    paces.push({...pre,result:result?{...result}:null,geometricRunway,curvatureSamples});
  }
  return result;
};
const originalEvaluate=p.evaluate;
p.evaluate=function(...args){
  const live=capture(),pre=live?{tick,raceTime:sim.race.raceTime,time:args[3],
    s:c.s,speed:c.speed,pace:args[12]?{...args[12]}:null}:null;
  const result=originalEvaluate.apply(this,args);
  if(live)plans.push({...pre,result:{...result},limitedBy:p.limitedBy,blocker:p.blocker,
    planRunway:a.planRunway,planLimit:a.planLimit});
  return result;
};
const start=performance.now(),stopRaceTime=146.10;
for(;tick<120*400&&sim.race.phase!==PHASE.FINISHED&&sim.race.raceTime<stopRaceTime;tick++)sim.step(1/120);
const wallSeconds=(performance.now()-start)/1000,after=verify();
const comparisons=[];
for(const old of expected.planning){
  const row=plans.find(p=>p.tick===old.tick);
  if(!row)throw new Error(`Missing expected planner call ${old.tick}`);
  const pairs={raceTime:[row.raceTime,old.raceTime],time:[row.time,old.time],s:[row.s,old.rider.s],
    speed:[row.speed,old.rider.speed],freeSpeed:[row.pace.freeSpeed,old.pace.freeSpeed],
    runway:[row.pace.runway,old.pace.runway],cap:[row.result.speedLimit,old.result.speedLimit],
    offset:[row.result.offset,old.result.offset],decision:[row.result.decision,old.result.decision],
    limitedBy:[row.limitedBy,old.after.limitedBy],blocker:[row.blocker,old.after.blocker]};
  comparisons.push({tick:row.tick,exact:Object.values(pairs).every(([x,y])=>Object.is(x,y)),pairs});
}
const transitionExactlyReproduced=comparisons.length===expected.planning.length&&comparisons.every(c=>c.exact);
const result={schema:'gp-throttle-native-profile-window-v1',root,scope:'Authorized partial replay for missing profile arrays only; no full-race acceptance claim',
  source:{before,after,stable:before.expectedSha256===after.expectedSha256,
    whitelistSha256:sha(whitelistBytes),observerSha256:sha(readFileSync(new URL(import.meta.url))),
    bikeAiSha256:sha(readFileSync(resolve(root,'src/simulation/bike-ai.ts')))},
  expectedWindowSha256:sha(expectedBytes),options,trackLength:sim.track.length,
  limits:{dt:1/120,maxOriginalTicks:120*400,stopRaceTime,captureFrom:145.30,captureTo:146.11},
  end:{ticks:tick,raceTime:sim.race.raceTime,time:sim.race.time,phase:sim.race.phase,
    wallSeconds,finished:sim.race.phase===PHASE.FINISHED,fullRaceAcceptanceEvaluated:false},
  constants:{GP_ASSIST,GP_AI_HANDS},transitionExactlyReproduced,comparisons,profiles,paces,plans};
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify(result,(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v)+'\n');
console.log(JSON.stringify({output,sourceStable:result.source.stable,transitionExactlyReproduced,
  comparisons:comparisons.length,profiles:profiles.length,paces:paces.length,plans:plans.length,end:result.end}));
process.exitCode=result.source.stable&&transitionExactlyReproduced?0:1;
