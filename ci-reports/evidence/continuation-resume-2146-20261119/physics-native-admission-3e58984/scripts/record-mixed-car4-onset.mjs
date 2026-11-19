import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=resolve(process.argv[2]), output=resolve(process.argv[3]), observerRoot=resolve(process.argv[4]);
const load=(base,p)=>import(pathToFileURL(resolve(base,p)).href);
const {Simulation}=await load(root,'src/simulation/world.ts');
const {DEFAULT_OPTIONS}=await load(root,'src/simulation/config.ts');
const {GP_ASSIST}=await load(root,'src/simulation/bike.ts');
const {gpHangOffAngle,gpRollInertia,gpSpinPerSpeed,gpRollRateLimit}=await load(root,'src/simulation/motogp-physics.ts');
const {MotoGPChassis:Observer}=await load(observerRoot,'src/simulation/motogp-physics.ts');
const {clamp,G}=await load(root,'src/core/math.ts');
const hash=data=>createHash('sha256').update(data).digest('hex');
const observerFiles=['src/simulation/motogp-physics.ts','src/simulation/tyre-force.ts','src/simulation/motorcycle-thermal.ts','src/core/math.ts'];
const auxHashes=()=>Object.fromEntries(observerFiles.map(p=>[p,hash(readFileSync(resolve(observerRoot,p)))]));
const beforeAux=auxHashes(), scriptHash=hash(readFileSync(fileURLToPath(import.meta.url)));
const referencePath=resolve(process.argv[5]), referenceBytes=readFileSync(referencePath), reference=JSON.parse(referenceBytes), referenceSha256=hash(referenceBytes);
const referenceFixtures=reference.fixtures.filter(f=>f.fixture.id===4&&f.fixture.lap===1&&f.fixture.s>=1700&&f.fixture.s<=2050&&f.fixture.originalPlantInput).map(f=>f.fixture);
if(!referenceFixtures.length)throw new Error('No matching immutable mixed3e native reference fixture');
const referenceMatches=[];
const sim=new Simulation({...DEFAULT_OPTIONS,mode:'race',ruleset:'gp-motorcycle',circuit:'vellamar',laps:2,opponents:5,vehicles:['gpr1','sbk1000','gpr1','sbk1000','gpr1','sbk1000'],seed:3303});sim.autoPlayer=true;
const c=sim.cars[4],d=c.dynamics,gp=d.motoGP,a=sim.ai[4];
let tick=0,substep=0,current=null,pending=null,encoding=null,entered=false,observations=0,realPlantCalls=0,realControlCalls=0;
const ring=[],fallEvents=[],fixtures=new Map();let maxMismatch=-1,firstDirection=false,fixtureLap=-1,nativeFallCalls=0;const poststates=[];
const own=o=>Object.fromEntries(Object.entries(o).filter(([k,v])=>typeof v!=='function'&&k!=='motoGP'));
const serialize=()=>JSON.stringify(own(gp));
const cloneForObservation=state=>Object.assign(new Observer(gp.geometry),structuredClone(state));
function observe(state,q){
 const liveBefore=serialize(), clone=cloneForObservation(state), value=clone.currentLateralAcceleration(q),liveAfter=serialize();
 if(liveBefore!==liveAfter)throw new Error('Clone observation mutated the live GP state');
 observations++;
 return {value,liveBeforeSha256:hash(liveBefore),liveAfterSha256:hash(liveAfter)};
}
const basic=()=>({tick,substep,time:sim.race.time,raceTime:sim.race.raceTime,lap:sim.race.laps[4].completed,s:c.s,lateral:c.lateral,speed:d.speed,lean:d.lean,leanRate:d.leanRate,steer:d.steer,riderOffset:d.riderOffset,frontLoad:d.frontLoad,rearLoad:d.rearLoad,drive:d.driveForce,frontBrake:d.frontBrakeForce,rearBrake:d.rearBrakeForce,state:d.state,crashes:d.crashes,impact:c.impact,airborne:c.airborne,roadPitch:c.roadPitch,contactCrash:c.contactCrash});
const raceState=()=>({tick,time:sim.race.time,raceTime:sim.race.raceTime,message:sim.race.message,flags:Array.from(sim.race.control.flags),events:sim.race.control.events.slice(-24).map(e=>({...e})),cars:sim.cars.map((b,id)=>({id,s:b.s,speed:b.speed,lateral:b.lateral,lap:sim.race.laps[id].completed,state:b.dynamics.state,crashes:b.dynamics.crashes,impact:b.impact,input:{...b.input},target:b.aiTarget,free:sim.ai[id].freeSpeed,traffic:sim.ai[id].trafficSpeed,plan:sim.ai[id].planLimit,rule:sim.ai[id].planner.limitedBy,decision:sim.ai[id].decision}))});
const nativeIntent=a.steerIntent;
a.steerIntent=function(track,stick){
 const q={tick,s:c.s,speed:d.speed,reaction:(d.frontLoad+d.rearLoad)/d.mass,leanLimit:d.leanLimit};
 const result=nativeIntent.call(this,track,stick);
 encoding={...q,authoredStick:result,authoredLean:result*q.leanLimit,decodedAtAI:q.reaction*Math.tan(result*q.leanLimit),pathAcceleration:this.gpPathAcceleration??null,signedCorrection:this.steeringCorrection};
 return result;
};
const nativeRear=gp.rearForceFor;
gp.rearForceFor=function(...args){const value=nativeRear.apply(this,args);if(current)current.rearPreview={args:[...args],returned:value};return value;};
const nativeInverse=gp.frontSteerFor;
gp.frontSteerFor=function(...args){const value=nativeInverse.apply(this,args);if(current)current.inverse={args:[...args],returned:value};return value;};
const nativeSteer=d.gpSteer;
d.gpSteer=function(stick,frontMu,rearMu,dt){
 realControlCalls++;
 if(c.s<1700||c.s>2050)return nativeSteer.call(this,stick,frontMu,rearMu,dt);
 if(fixtureLap!==sim.race.laps[4].completed){fixtureLap=sim.race.laps[4].completed;ring.length=0;fixtures.clear();maxMismatch=-1;firstDirection=false;}
 const before=own(gp),state={tick,substep,s:c.s,dt,stick,frontMu,rearMu,phase:'before frozen3e gpSteer, after current Bike.step rider offset and contact-load update',stepEntry:{...pending.before},bike:structuredClone(own(this)),gp:structuredClone(before)};
 const reaction=(this.frontLoad+this.rearLoad)/this.mass,staticFront=this.mass*G*this.p.cgToRear/this.p.wheelbase+(this.p.downforce??0)*this.speed**2*(this.p.downforceFront??.6);
 const q={speed:this.speed,mass:this.mass,lean:this.lean,steer:this.steer,frontLoad:this.frontLoad,rearLoad:this.rearLoad,frontMu,rearMu,frontFx:-this.frontBrakeForce,rearFx:this.driveForce-this.rearBrakeForce,frontContact:clamp(this.frontLoad/Math.max(1,.05*staticFront),0,1)};
 const prepared=observe(before,q),psi=this.lean+gpHangOffAngle(this.riderOffset,this.p.cgHeight),inertia=gpRollInertia(gp.geometry,this.mass,this.p.cgHeight),gyro=gpSpinPerSpeed(gp.geometry)*this.speed*gp.yawRate*Math.cos(this.lean);
 const rolling=lateral=>(this.mass*this.p.cgHeight*(reaction*Math.sin(psi)-lateral*Math.cos(psi))-gyro)/inertia;
 const forecast=lateral=>{const alpha=rolling(lateral);return{rolling:alpha,rateAhead:this.leanRate+GP_ASSIST.lead*alpha,ahead:psi+GP_ASSIST.lead*this.leanRate+.5*GP_ASSIST.lead**2*alpha};};
 current={...basic(),stepEntry:{...pending.before},race:raceState(),input:pending.input,encoding,leanLimit:this.leanLimit,reaction,psi,gyro,frontFy:gp.frontFy,rearFy:gp.rearFy,frontElasticStiffness:gp.frontElasticStiffness,rearElasticStiffness:gp.rearElasticStiffness,storedLateral:gp.lateralAcceleration,preparedPriorFx:prepared,q,forecastStored:forecast(gp.lateralAcceleration),forecastPrepared:forecast(prepared.value),plan:{limit:a.planLimit,next:a.planNext,recovery:a.planRecovery,runway:a.planRunway,target:c.aiTarget},rawRequestedLean:clamp(stick,-1,1)*this.leanLimit,rawRequestedAcceleration:reaction*Math.tan(clamp(stick,-1,1)*this.leanLimit)};
 const result=nativeSteer.call(this,stick,frontMu,rearMu,dt);
 current.capacity=this.gpLateralCapacity(frontMu,rearMu);current.recovery=GP_ASSIST.recovery*current.capacity;current.supportedTarget=gp.leanTarget;current.supportedAcceleration=reaction*Math.tan(gp.leanTarget);current.lateralDemand=gp.lateralDemand;current.steerRequest=result;
 const effort=f=>Math.sign(gp.leanTarget-f.ahead)*Math.min(gpRollRateLimit(this.speed,gp.geometry),GP_ASSIST.rollGain*Math.abs(gp.leanTarget-f.ahead));
 current.effortStored=effort(current.forecastStored);current.effortPrepared=effort(current.forecastPrepared);
 pending.row=current;pending.beforeGP=before;pending.full=state;
 const difference=Math.abs(current.forecastStored.rolling-current.forecastPrepared.rolling);
 if(difference>maxMismatch){maxMismatch=difference;fixtures.set('maximumRollForecastDifference',state);}
 if(!fixtures.has('firstRecordedControl'))fixtures.set('firstRecordedControl',state);
 if(this.frontLoad>1&&this.rearLoad<=1&&!fixtures.has('firstRearUnloaded'))fixtures.set('firstRearUnloaded',state);
 if(this.frontLoad<=1&&this.rearLoad>1&&!fixtures.has('firstFrontUnloaded'))fixtures.set('firstFrontUnloaded',state);
 if(!firstDirection&&current.effortStored*current.effortPrepared<0){firstDirection=true;fixtures.set('firstOppositeEffortDirection',state);}
 return result;
};
const nativePlant=gp.step;
gp.step=function(q){
 realPlantCalls++;
 if(current&&pending?.row===current){
  current.preparedAllocatedFx=observe(pending.beforeGP,{...current.q,frontFx:q.frontFx,rearFx:q.rearFx});
  current.plantInput={...q};
  for(const f of referenceFixtures)if(f.tick===tick&&f.substep===substep){const exact=JSON.stringify(f.originalPlantInput)===JSON.stringify(q);referenceMatches.push({tick,substep,s:c.s,exact});if(!exact)throw new Error('Recorded native plant input differs from immutable full mixed3e recording');}
 }
 const value=nativePlant.call(this,q);
 if(current&&pending?.row===current)current.plantOutput={frontFy:this.frontFy,rearFy:this.rearFy,lateralAcceleration:this.lateralAcceleration,frontOmega:this.frontOmega,rearOmega:this.rearOmega,yawRate:this.yawRate,lateralSpeed:this.lateralSpeed};
 return value;
};
const nativeStep=d.step;
d.step=function(input,dt){
 substep++;current=null;pending={input:{...input},before:basic()};
 const value=nativeStep.call(this,input,dt);
 if(pending.row){pending.row.after=basic();ring.push(pending.row);if(ring.length>960)ring.shift();fixtures.set('lastRecordedControl',pending.full);}
 return value;
};
const nativeFall=d.fall;
d.fall=function(reason){
 nativeFallCalls++;
 if(!fallEvents.length){fallEvents.push({reason,at:basic(),callSite:new Error().stack,control:current?structuredClone(current):null,race:raceState()});if(pending?.full)fixtures.set('beforeTargetFall',pending.full);}
 return nativeFall.call(this,reason);
};
for(tick=0;tick<120*400;tick++){
 substep=0;sim.step(1/120);
 if(fallEvents.length){poststates.push({car4:basic(),race:raceState()});if(tick>=fallEvents[0].at.tick+2)break;}
}
if(!fallEvents.length)throw new Error('No original car4 fall reproduced within the original400s limit');
if(referenceMatches.length!==referenceFixtures.length||!referenceMatches.every(x=>x.exact)||!readFileSync(referencePath).equals(referenceBytes))throw new Error('Full race reference fixture not exactly preserved');
const afterAux=auxHashes();if(JSON.stringify(beforeAux)!==JSON.stringify(afterAux)||scriptHash!==hash(readFileSync(fileURLToPath(import.meta.url))))throw new Error('Observer/script changed during recording');
const result={root,sourceCommit:'3e58984936a9e1ba2821580688a723fb93053fa4',options:sim.options,final:basic(),nativeFallCalls,poststates,reference:{path:referencePath,sha256:referenceSha256,fixtures:referenceFixtures.map(f=>({tick:f.tick,substep:f.substep,s:f.s})),matches:referenceMatches},observerSource:{commit:'375cf3ab5017318bf19a067cca8c1474519fbe74',root:observerRoot,hashes:beforeAux,unchanged:true,method:'reviewed pure currentLateralAcceleration on deep-cloned native history; newly initialized previewFront scratch; no contact step or relaxation integration'},scriptHash,observations,liveStatePreservedForEveryObservation:true,realControlCalls,realPlantCalls,fallEvents,rows:ring,fixtures:[...fixtures].map(([label,state])=>({label,...state}))};
writeFileSync(output,JSON.stringify(result)+'\n');
console.log(JSON.stringify({root,final:result.final,rows:ring.length,observations,realControlCalls,realPlantCalls,nativeFallCalls,referenceMatches,poststates,fallEvents:fallEvents.map(f=>({reason:f.reason,at:f.at})),maxMismatch,fixtures:result.fixtures.map(f=>({label:f.label,tick:f.tick,substep:f.substep,s:f.s})),observerSource:result.observerSource},null,2));
