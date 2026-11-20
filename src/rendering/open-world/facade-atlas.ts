import * as T from 'three';
import type { FacadeLayout } from './facade-layout.ts';

/** One header per wall and one texel per bay. Store the authored opening,
 * shop flag and room value directly, including vacant bays. All three
 * distances therefore resolve the same pattern of occupied rooms at night. */
export class FacadeAtlas {
  private values: number[] = [];
  add(layout: FacadeLayout) {
    const id = this.values.length / 4;
    const { bays, floors, bayWidth, floorHeight } = layout;
    this.values.push(bayWidth, floorHeight, bays, floors);
    for (let i = 0; i < bays * floors; i++) this.values.push(-1, 0, 0, 0);
    for (const o of layout.openings) {
      const col = Math.round(o.cell0 / bayWidth),
        row = Math.round(o.row0 / floorHeight);
      const at = 4 * (id + 1 + row * bays + col);
      this.values[at] = o.room + (o.entrance ? 4 : o.kind === 'shop' ? 2 : 0);
      this.values[at + 1] = (o.u1 - o.u0) / 2;
      this.values[at + 2] = o.v0 - o.row0;
      this.values[at + 3] = o.v1 - o.row0;
    }
    return id;
  }
  texture() {
    const pixels = Math.max(1, this.values.length / 4);
    const width = Math.min(1024, pixels),
      height = Math.ceil(pixels / width);
    const data = new Float32Array(width * height * 4);
    data.set(this.values);
    const texture = new T.DataTexture(data, width, height, T.RGBAFormat, T.FloatType);
    texture.name = 'Solvane facade bay dimensions and room identities';
    texture.minFilter = texture.magFilter = T.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.values = [];
    return texture;
  }
}
export const FACADE_ATLAS_GLSL = `
uniform highp sampler2D owFacadeAtlas;
vec4 owFacadeTexel(int id) {
  int width=textureSize(owFacadeAtlas,0).x;
  return texelFetch(owFacadeAtlas,ivec2(id%width,id/width),0);
}
// q initially holds metres along/up the wall. A glazed bay returns the
// pane UVs and room attributes read by the near and middle material paths.
void owResolveFacade(inout vec4 facade,inout vec2 q,inout vec2 footprint,out float coverage) {
  coverage=1.0;
  int first=int(-facade.z-8.0+0.5);
  vec4 grid=owFacadeTexel(first);
  ivec2 cell=ivec2(floor(q/grid.xy));
  facade.z=-3.0;
  if(any(lessThan(cell,ivec2(0))) || any(greaterThanEqual(cell,ivec2(grid.zw))))return;
  vec4 bay=owFacadeTexel(first+1+cell.y*int(grid.z)+cell.x);
  vec2 local=q-vec2(cell)*grid.xy;
  float side=local.x-grid.x*0.5;
  if(bay.x<0.0)return;
  vec2 extent=max(vec2(0.0001),footprint);
  vec2 centre=vec2(side,local.y);
  vec2 covered=max(vec2(0.0), min(centre+0.5*extent,vec2(bay.y,bay.w))
    -max(centre-0.5*extent,vec2(-bay.y,bay.z)))/extent;
  if(covered.x*covered.y<=0.0)return;
  coverage=clamp(covered.x*covered.y,0.0,1.0);
  vec2 size=vec2(2.0*bay.y,bay.w-bay.z);
  q=clamp(vec2(side+bay.y,local.y-bay.z)/size,0.0,1.0);
  footprint=extent/size;
  bool entrance=bay.x>=4.0, shop=bay.x>=2.0;
  float flag=entrance ? 2.0+min(1.08,size.x*0.58)/size.x : shop ? 1.0 : 0.0;
  facade=vec4(bay.x-(entrance?4.0:shop?2.0:0.0),facade.y,-4.0,flag);
}`;
