import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { wingElement } from '../src/rendering/bodywork.ts';

type Dimensions = [number, number, number, number, number, number];
const production: Dimensions[] = [
  ...Array.from({ length: 4 }, (_, j): Dimensions => [1.94-j*0.018,j===0?0.34:0.2,0.025+j*0.007,0.015,0.08,0.028]),
  [1.65,0.42,0.048,0.022,0.025,0.015],[1.64,0.22,0.045,0.016,0.02,0.012],
  [1.41,0.23,0.018,0.011,0.015,0.008],[1.36,0.17,0.018,0.009,0.02,0.009],
];
const variants: Dimensions[]=[[1.8,0.35,0,0.015,0,0],[1.8,0.35,-0.04,0.015,-0.08,-0.03],[1.8,0.35,0.1,0.008,0.08,0.03]];
const across=20, around=32, stride=around+1, skinVertices=(across+1)*stride, capStart=skinVertices+across+1;
function point(a:T.BufferAttribute|T.InterleavedBufferAttribute,i:number){return new T.Vector3().fromBufferAttribute(a,i);}
function topology(g:T.BufferGeometry){
 const p=g.getAttribute('position'), index=g.getIndex()!, vertices=new Map<string,number>();
 const ids=Array.from({length:p.count},(_,i)=>{const key=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>Math.round(x*1e8)).join(','); if(!vertices.has(key))vertices.set(key,vertices.size); return vertices.get(key)!;});
 const edges=new Map<string,{count:number;direction:number}>(); let volume=0,minimumArea=Infinity;
 for(let o=0;o<index.count;o+=3){const ii=[index.getX(o),index.getX(o+1),index.getX(o+2)], [a,b,c]=ii.map(i=>point(p,i)); minimumArea=Math.min(minimumArea,b.clone().sub(a).cross(c.clone().sub(a)).length()/2); volume+=a.dot(b.clone().cross(c))/6;
  for(let j=0;j<3;j++){const a=ids[ii[j]],b=ids[ii[(j+1)%3]],key=`${Math.min(a,b)}:${Math.max(a,b)}`,e=edges.get(key)??{count:0,direction:0};e.count++;e.direction+=a<b?1:-1;edges.set(key,e);}
 }
 return {volume,minimumArea,openEdges:[...edges.values()].filter(e=>e.count!==2).length,windingErrors:[...edges.values()].filter(e=>e.direction!==0).length,euler:vertices.size-edges.size+index.count/3};
}
describe('Phase 27B original aero surfaces',()=>{
 it.each([...production,...variants].map((dimensions,id)=>({id,dimensions})))('closes and orients production/concave airfoil $id with a bounded mesh',({dimensions})=>{
  const g=wingElement(...dimensions); try{const r=topology(g);expect(r.openEdges).toBe(0);expect(r.windingErrors).toBe(0);expect(r.euler).toBe(2);expect(r.volume).toBeGreaterThan(0);expect(r.minimumArea).toBeGreaterThan(1e-10);expect(g.getAttribute('position').count).toBe(778);expect(g.getIndex()!.count/3).toBe(1340);expect(g.boundingBox).not.toBeNull();expect(g.boundingSphere).not.toBeNull();expect(Number.isFinite(g.boundingSphere!.radius)).toBe(true);expect(g.boundingBox!.max.x-g.boundingBox!.min.x).toBeCloseTo(dimensions[0],6);for(const a of ['position','normal','uv'])expect(Array.from(g.getAttribute(a).array).every(Number.isFinite)).toBe(true);const n=g.getAttribute('normal');for(let i=0;i<n.count;i++)expect(point(n,i).length()).toBeCloseTo(1,5);}finally{g.dispose();}
 });
 it('smooths the rounded leading UV seam but retains a crisp trailing edge and flat tips',()=>{
  const g=wingElement(...production[0]);try{const p=g.getAttribute('position'),n=g.getAttribute('normal');for(let row=0;row<=across;row++){const first=row*stride,last=first+around;expect(point(p,first).distanceTo(point(p,last))).toBe(0);expect(point(n,first).distanceTo(point(n,last))).toBe(0);expect(n.getZ(first)).toBeGreaterThan(0.8);const upper=first+around/2,lower=skinVertices+row;expect(point(p,upper).distanceTo(point(p,lower))).toBe(0);expect(point(n,upper).dot(point(n,lower))).toBeLessThan(-0.5);}for(let tip=0;tip<2;tip++)for(let j=0;j<around;j++){const i=capStart+tip*around+j;expect(n.getX(i)).toBeCloseTo(tip===0?-1:1,6);expect(n.getY(i)).toBe(0);expect(n.getZ(i)).toBe(0);}}finally{g.dispose();}
 });
 it('tapers both tips symmetrically without moving the centre chord or extending the span',()=>{
  const [span,chord,camber,thickness,sweep,gull]=production[0],g=wingElement(span,chord,camber,thickness,sweep,gull);try{const p=g.getAttribute('position'),centre=(across/2)*stride;expect(p.getZ(centre)).toBeCloseTo(chord/2,6);expect(p.getZ(centre+around/2)).toBeCloseTo(-chord/2,6);for(const row of [0,across]){const s=row*stride;expect(p.getZ(s)-p.getZ(s+around/2)).toBeCloseTo(chord*0.84,6);expect(p.getY(s)).toBeCloseTo(-gull,6);expect((p.getZ(s)+p.getZ(s+around/2))/2).toBeCloseTo(-sweep,6);}for(let row=0;row<=across;row++)for(let j=0;j<=around;j++){const a=row*stride+j,b=(across-row)*stride+j;expect(p.getX(a)).toBeCloseTo(-p.getX(b),6);expect(p.getY(a)).toBe(p.getY(b));expect(p.getZ(a)).toBe(p.getZ(b));}}finally{g.dispose();}
 });
 it('builds deterministic buffers and spends only 480 extra triangles across eight wings',()=>{let total=0;for(const d of production){const a=wingElement(...d),b=wingElement(...d);try{for(const n of ['position','normal','uv'])expect(a.getAttribute(n).array).toEqual(b.getAttribute(n).array);expect(a.getIndex()!.array).toEqual(b.getIndex()!.array);total+=a.getIndex()!.count/3;}finally{a.dispose();b.dispose();}}expect(total-production.length*1280).toBe(480);});
 it('rejects invalid dimensions before constructing geometry',()=>{for(let axis=0;axis<6;axis++)for(const invalid of [NaN,Infinity,-Infinity]){const d=[...production[0]] as Dimensions;d[axis]=invalid;expect(()=>wingElement(...d)).toThrow('Invalid airfoil dimensions');}for(const axis of [0,1,3])for(const invalid of [0,-1]){const d=[...production[0]] as Dimensions;d[axis]=invalid;expect(()=>wingElement(...d)).toThrow('Invalid airfoil dimensions');}});
});
