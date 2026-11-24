import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root=process.argv[2];
const get = p => import(pathToFileURL(`${root}/src/${p}`).href);
const [{LocalCarPredictor},{controls,DEFAULT_OPTIONS},{emptyCarState,CAR_FLAG},{RaceClient},{EventLoop},{encodeControl,encodeSnapshot},{sessionIdentity}]=await Promise.all([
 get('net/prediction.ts'),get('simulation/config.ts'),get('net/snapshot.ts'),get('net/client.ts'),get('net/event-loop.ts'),get('net/codec.ts'),get('core/session-identity.ts')
]);
const hash=createHash('sha256');const record=x=>hash.update(JSON.stringify(x)+'\n');
const input=t=>({...controls(),throttle:(Math.floor(t/17)%11)/10,brake:(t%101)>80?.25:0,steer:Math.sin(t*.001)*.25});
const state=t=>({...emptyCarState(0),flags:CAR_FLAG.FULL|(t%102===0?CAR_FLAG.CONTACT:0)|(t%174===0?CAR_FLAG.AI:0),x:5*Math.sin(t*.001),z:t*.1,qy:Math.sin(t*.0001),qw:Math.cos(t*.0001),vx:Math.cos(t*.001)*.6,vz:12,wy:.024,ax:-Math.sin(t*.001)*.072});
const p=new LocalCarPredictor();
for(let n=0;n<1200;n++){const tick=n*6;p.reconcile(state(tick),tick,input,tick+18,tick*1000/120);for(const dt of[1,7,14])record(p.render(tick*1000/120+dt));record(p.predictedAt(tick+18));}
const ps={};for(const key of['positionError','headingError','positionErrorClean','positionErrorContact','positionErrorAi','correction','visualStep','snaps','reconciles','aiDriven'])ps[key]=p.stats[key];record(ps);
const predictorHash=hash.copy().digest('hex');
const loop=new EventLoop(),options={...DEFAULT_OPTIONS,mode:'race',opponents:0,vehicles:['apx01'],grid:[0],seed:731};
const transport={label:'reference',open:true,onMessage:null,onClose:null,send(data,channel){record({channel,bytes:Array.from(data)});},close(){}};
const c=new RaceClient({loop,transport,advertised:options,name:'Metrics',vehicle:'apx01',input:({tick})=>input(tick),onRender:record});c.player='guest:metrics';
transport.onMessage(encodeControl({kind:'grid',options,identity:sessionIdentity(options),car:0,startTick:0,serverTick:0,startInMs:0,entries:[{car:0,player:c.player,name:'Metrics',vehicle:'apx01'}]}),'reliable');
const snap=t=>transport.onMessage(encodeSnapshot({tick:t,phase:1,raceTime:t/120,ackSeq:c.commands.nextSeq-1,slack:127,missing:0,echo:loop.now>=100?Math.floor(loop.now)-50:0,hold:0,cars:[state(t)]}),'unreliable');snap(0);
const stop=loop.every(50,()=>snap(Math.round(loop.now/(1000/120))),50);loop.runUntil(60_000);stop();c.dispose();
const cs={};for(const key of['rttMs','leadTicks','interpolationDelayTicks','snapshotBytes','inputBytes','snapshots','duplicateSnapshots','lateSnapshots','lostSnapshots','inputPackets','commands','rejectedSamples','clampedSamples','renderKinds','invalidMessages','stalledFrames','commandCopies'])cs[key]=c.stats[key];record(cs);
console.log(JSON.stringify({predictorHash,combinedHash:hash.digest('hex'),predictorVisualSamples:ps.visualStep.length,clientRenderSamples:cs.interpolationDelayTicks.length,clientSnapshots:cs.snapshots}));
