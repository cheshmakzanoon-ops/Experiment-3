import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=resolve(process.argv[2]),out=resolve(process.argv[3]),mode=process.argv[4]??'observe';
const load=p=>import(pathToFileURL(resolve(root,p)).href);
const { Simulation }=await load('src/simulation/world.ts');
const { DEFAULT_OPTIONS }=await load('src/simulation/config.ts');
const { PHASE }=await load('src/simulation/race.ts');
const { GP_ASSIST }=await load('src/simulation/bike.ts');
const { gpCamberFriction }=await load('src/simulation/motogp-physics.ts');
const options={...DEFAULT_OPTIONS,circuit:'vellamar',mode:'race',ruleset:'gp-motorcycle',laps:2,opponents:5,vehicles:['gpr1','sbk1000','gpr1','sbk1000','gpr1','sbk1000'],seed:3303};
const sources=Object.fromEntries(['src/simulation/bike.ts','src/simulation/bike-ai.ts','src/simulation/bike-vehicle.ts'].map(p=>[p,createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex')]));
const sim=new Simulation(options);sim.autoPlayer=true;const samples=[],falls=[];let tick=0;
const stats=sim.cars.map(()=>({seconds:0,turningSeconds:0,targetClipSeconds:0,admissionExtraClipSeconds:0,ratioLessClipSeconds:0,ratioExtraAngleIntegral:0,clipAngleIntegral:0,meanSpeedIntegral:0,driveIntegral:0,brakeIntegral:0,demandCappedSeconds:0,bodyRollRateIntegral:0,substeps:0}));
const bins=sim.cars.map(()=>Array.from({length:Math.ceil(sim.track.length/100)},()=>({time:0,speedIntegral:0,driveIntegral:0,clipAngleIntegral:0,ratioAngleIntegral:0,throttleIntegral:0,brakeIntegral:0})));
for(const c of sim.cars){
 const d=c.dynamics,g=d.motoGP,a=sim.ai[c.id],fall=d.fall.bind(d);d.fall=kind=>{if(d.state==='riding')falls.push({id:c.id,t:sim.race.raceTime,s:c.s,lap:sim.race.laps[c.id].completed,afterFlag:c.finishTime>0,kind});return fall(kind);};
 if(!g)continue;
 let ratioAdmission=Infinity,current=null;
 const coreStep=d.step.bind(d),steer=d.gpSteer.bind(d);
 d.step=(input,h)=>{
  const p=d.p,N=d.contactLoads;
  if(N){const reaction=(N.front+N.rear)/d.mass,capacity=Math.min(p.mu*(d.frontGrip??d.grip)*N.front*p.wheelbase/(d.mass*p.cgToRear),p.mu*(d.rearGrip??d.grip)*N.rear*p.wheelbase/(d.mass*p.cgToFront))*gpCamberFriction(d.lean),q=reaction>1e-6?capacity/reaction:0;ratioAdmission=Number.isFinite(ratioAdmission)?Math.min(q,ratioAdmission+(q-ratioAdmission)*(1-Math.exp(-GP_ASSIST.rateGain*h))):q;}else ratioAdmission=Infinity;
  current=null;const result=coreStep(input,h);
  if(current&&sim.race.phase===PHASE.RACING&&c.finishTime===0){
   const row={...current,id:c.id,t:sim.race.raceTime,s:c.s,lap:sim.race.laps[c.id].completed,speed:d.speed,lean:d.lean,rate:d.leanRate,side:g.lateralSpeed,throttle:c.throttle,brake:c.brake,drive:d.driveForce,frontBrake:d.frontBrakeForce,rearBrake:d.rearBrakeForce,demand:g.lateralDemand,frontUse:d.frontUse,rearUse:d.rearUse,aiTarget:c.aiTarget,plan:a.planLimit,recovery:a.planRecovery,lateral:c.lateral,traffic:a.trafficSpeed};
   const z=stats[c.id],bin=bins[c.id][Math.min(bins[c.id].length-1,Math.floor(c.s/100))];
   const loss=Math.max(0,Math.min(Math.abs(row.request),row.rawLimit)-Math.abs(row.target)),ratioLoss=Math.max(0,Math.min(Math.abs(row.request),row.ratioLimit)-Math.abs(row.target));
   z.seconds+=h;z.substeps++;z.turningSeconds+=Math.abs(row.request)>.2?h:0;z.targetClipSeconds+=Math.abs(row.request)-Math.abs(row.target)>.02?h:0;z.admissionExtraClipSeconds+=loss>.02?h:0;z.ratioLessClipSeconds+=ratioLoss>.02?h:0;z.ratioExtraAngleIntegral+=h*ratioLoss;z.clipAngleIntegral+=h*loss;z.meanSpeedIntegral+=h*d.speed;z.driveIntegral+=h*d.driveForce;z.brakeIntegral+=h*(d.frontBrakeForce+d.rearBrakeForce);z.demandCappedSeconds+=g.lateralDemand>=2*9.80665-1e-6?h:0;z.bodyRollRateIntegral+=h*Math.abs(d.leanRate);
   bin.time+=h;bin.speedIntegral+=h*d.speed;bin.driveIntegral+=h*d.driveForce;bin.clipAngleIntegral+=h*loss;bin.ratioAngleIntegral+=h*ratioLoss;bin.throttleIntegral+=h*c.throttle;bin.brakeIntegral+=h*c.brake;
   if(tick%24===0&&current.sample) samples.push(row);
  }
  return result;
 };
 let sub=0;
 d.gpSteer=(stick,fmu,rmu,h)=>{
  const reaction=(d.frontLoad+d.rearLoad)/d.mass,support=d.gpSupportCapacity?d.gpSupportCapacity(fmu,rmu):Math.min(fmu*d.frontLoad*d.p.wheelbase/(d.mass*d.p.cgToRear),rmu*d.rearLoad*d.p.wheelbase/(d.mass*d.p.cgToFront))*gpCamberFriction(d.lean),admitted=d.roadAdmittedCapacity;
  const rawLimit=Math.atan2(GP_ASSIST.leanMargin*support,reaction),ratioLimit=Math.atan(GP_ASSIST.leanMargin*ratioAdmission),request=Math.max(-1,Math.min(1,stick))*d.leanLimit;
  if(mode==='ratio-counterfactual')d.roadAdmittedCapacity=reaction*ratioAdmission;
  const result=steer(stick,fmu,rmu,h);
  current={sample:sub++%2===0,frontN:d.frontLoad,rearN:d.rearLoad,reaction,support,admitted,ratioAdmission,rawLimit,ratioLimit,request,target:g.leanTarget};
  return result;
 };
}
const stopped=new Float64Array(6);let longestStop=0;const dt=1/120,start=performance.now();
for(;tick<400/dt&&sim.race.phase!==PHASE.FINISHED;tick++){sim.step(dt);if(sim.race.phase===PHASE.RACING)sim.cars.forEach((c,id)=>{stopped[id]=c.speed<1&&!c.finishTime&&!c.inPit?stopped[id]+dt:0;longestStop=Math.max(longestStop,stopped[id]);});}
const best=sim.race.laps.map(l=>l.best),gpBest=Math.min(...[0,2,4].map(i=>best[i]||Infinity)),sbkBest=Math.min(...[1,3,5].map(i=>best[i]||Infinity)),crashes=sim.cars.map(c=>c.dynamics.crashes);
const result={source:root,sources,mode,options,finished:sim.race.phase===PHASE.FINISHED,raceSeconds:sim.race.raceTime,wallSeconds:(performance.now()-start)/1000,best,gpBest,sbkBest,margin:sbkBest-gpBest,crashes,falls,longestStop,classified:sim.cars.every(c=>!c.retired&&c.finishTime>0&&sim.race.laps[c.id].completed===2),stats,bins,samples};
writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({out,finished:result.finished,gpBest,sbkBest,margin:result.margin,crashes,classified:result.classified,longestStop,stats}));
