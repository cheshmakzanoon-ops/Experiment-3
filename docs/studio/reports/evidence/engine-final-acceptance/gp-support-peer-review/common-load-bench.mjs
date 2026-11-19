import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=resolve(process.argv[2]),out=resolve(process.argv[3]);
const load=p=>import(pathToFileURL(resolve(root,p)).href);
const { BikeVehicle }=await load('src/simulation/bike-vehicle.ts');
const { GP_R1 }=await load('src/simulation/bike-definitions.ts');
const { DEFAULT_SETUP }=await load('src/simulation/config.ts');
const { NOVICE, GP_ASSIST }=await load('src/simulation/bike.ts');
const { gpCamberFriction,gpHangOffAngle }=await load('src/simulation/motogp-physics.ts');
const dt=1/240,rows=[];
const pair=[0,1].map(()=>new BikeVehicle(0,'medium',DEFAULT_SETUP,'sport',GP_R1).dynamics);
const bases=pair.map(d=>({front:d.frontLoad,rear:d.rearLoad}));
for(const d of pair){d.assists=NOVICE;d.p.drag=0;d.p.rolling=0;}
for(let i=0;i<720;i++){
 const scale=i<240?1:i<360?.5:i<480?1.5:i<600?1:2;
 for(let j=0;j<pair.length;j++){
  const d=pair[j],g=d.motoGP,b=bases[j],factor=j===0?1:scale;
  const trim=g.steerTrim;
  d.speed=30;d.lean=.35;d.leanRate=0;d.riderOffset=.08;d.heading=0;d.x=d.z=0;d.steer=.005;
  d.frontBrakeForce=d.rearBrakeForce=d.driveForce=0;d.grip=d.frontGrip=d.rearGrip=1;
  g.reset(30);g.steerTrim=trim;g.lateralAcceleration=0;g.yawRate=0;g.lateralSpeed=0;
  d.contactLoads={front:b.front*factor,rear:b.rear*factor};
  const reaction=(d.contactLoads.front+d.contactLoads.rear)/d.mass;
  const support=Math.min(d.p.mu*d.contactLoads.front*d.p.wheelbase/(d.mass*d.p.cgToRear),d.p.mu*d.contactLoads.rear*d.p.wheelbase/(d.mass*d.p.cgToFront))*gpCamberFriction(d.lean);
  const rawLimit=Math.atan2(GP_ASSIST.leanMargin*support,reaction),request=d.leanLimit;
  d.step({lean:1,rider:.08/d.p.riderOffsetMax,throttle:0,frontBrake:0,rearBrake:0,drive:0},dt);
  if([239,240,241,245,259,299,359,360,361,365,379,419,479,480,481,599,600,601,605,619,659,719].includes(i)) rows.push({i,j,t:i*dt,factor,reaction,support,physicalRatio:support/reaction,rawLimit,request,admitted:d.roadAdmittedCapacity,target:g.leanTarget,targetRatio:Math.tan(g.leanTarget),frontLoad:d.frontLoad,rearLoad:d.rearLoad,state:d.state,frontUse:d.frontUse,rearUse:d.rearUse});
 }
}
const result={source:root,bikeHash:createHash('sha256').update(readFileSync(resolve(root,'src/simulation/bike.ts'))).digest('hex'),dt,heldPhysicalPose:{speed:30,lean:.35,leanRate:0,riderOffset:.08,grip:1},rows};
writeFileSync(out,JSON.stringify(result,null,2)+'\n');
for(const i of [239,240,360,365,379,419,600,605,619,659])console.log(JSON.stringify(rows.filter(r=>r.i===i)));
