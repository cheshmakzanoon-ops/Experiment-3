import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Bike as Before,BIKE,NOVICE} from './w27-gp-capacity-candidate/src/simulation/bike.ts';
import {Bike as After} from './w27-gp-history-candidate/src/simulation/bike.ts';
const geometry={frontArm:BIKE.cgToFront,rearArm:BIKE.cgToRear,yawInertia:55,frontRadius:.3,rearRadius:.32,frontWheelInertia:.6,rearWheelInertia:.9};
let first=null,total=0;for(const mode of ['standalone-gp','non-gp-road','non-gp-standalone'])for(const sign of [-1,1]){
 const a=new Before(NOVICE,BIKE),b=new After(NOVICE,BIKE);a.speed=b.speed=30;
 if(mode==='standalone-gp'){a.enableMotoGPPhysics(geometry);b.enableMotoGPPhysics(geometry)}
 for(let i=0;i<960;i++){
  if(mode==='non-gp-road'){const loads={front:1200+500*Math.sin(i*.09),rear:1200+400*Math.cos(i*.05)};a.contactLoads={...loads};b.contactLoads={...loads}}
  const q={lean:sign*.3*Math.sin(i*.013),rider:sign*.6*Math.sin(i*.009),throttle:.4+.3*Math.sin(i*.017),frontBrake:i%100<15?.25:0,rearBrake:i%113<8?.1:0,drive:1200+600*Math.sin(i*.007)},dt=i%2?1/240:1/120;
  a.step(q,dt);b.step(q,dt);total++;
  if(JSON.stringify(a)!==JSON.stringify(b,(key,value)=>key==='previewFront'?undefined:value)){first={mode,sign,i,before:JSON.parse(JSON.stringify(a)),after:JSON.parse(JSON.stringify(b,(key,value)=>key==='previewFront'?undefined:value))};break;}
 }
 if(first)break;
}
const result={excludedNewScratch:"previewFront only; all pre-existing fields compared",steps:total,firstDifference:first,identical:!first,sources:Object.fromEntries(['w27-gp-capacity-candidate','w27-gp-history-candidate'].map(p=>[p,createHash('sha256').update(readFileSync(p+'/src/simulation/bike.ts')).digest('hex')]))};writeFileSync('w27-gp-history-parity.json',JSON.stringify(result,null,2));console.log(JSON.stringify({steps:total,identical:!first,first:first?{mode:first.mode,sign:first.sign,i:first.i}:null}));if(first)process.exitCode=1;
