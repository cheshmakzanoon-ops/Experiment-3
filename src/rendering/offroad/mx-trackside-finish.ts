import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import type { MxTracksideMaterial } from './mx-trackside-models.ts';

/** Metre coordinates for the original part, before the venue combines rotated
 * placements. Use one projection per triangle, and run timber grain along the
 * longest edge of each individual board. Retain the artist's unwrap in uv. */
export function bindMxKitFinish(g: T.BufferGeometry, timber: boolean) {
  const p = g.getAttribute('position'),
    n = g.getAttribute('normal');
  g.computeBoundingBox();
  const span = g.boundingBox!.getSize(new T.Vector3());
  const long = span.x >= span.y && span.x >= span.z ? 0 : span.y >= span.z ? 1 : 2;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    const nx = Math.abs(n.getX(i) + n.getX(i + 1) + n.getX(i + 2));
    const ny = Math.abs(n.getY(i) + n.getY(i + 1) + n.getY(i + 2));
    const nz = Math.abs(n.getZ(i) + n.getZ(i + 1) + n.getZ(i + 2));
    const face = nx >= ny && nx >= nz ? 0 : ny >= nz ? 1 : 2;
    let u = face === 0 ? 2 : 0,
      v = face === 1 ? 2 : 1;
    if (timber && v === long) [u, v] = [v, u];
    for (let j = i; j < i + 3; j++) {
      uv[j * 2] = p.getComponent(j, u);
      uv[j * 2 + 1] = p.getComponent(j, v);
    }
  }
  g.setAttribute('mxKitMeters', new T.BufferAttribute(uv, 2));
}

const patterns: Record<MxTracksideMaterial, string> = {
  metal: `
    float zinc = mxKitNoise(p*69.0 + 4.0);
    float brushed = sin(6.283185 * (p.y*270.0 + 0.3*zinc)) * micro;
    tint = 1.0 + (zinc-0.5)*0.16*detail + 0.014*brushed;
    rough = (zinc-0.5)*0.17*detail + 0.025*brushed;
    relief = (zinc-0.5)*0.00015*detail;`,
  coated: `
    float peel = mxKitNoise(p*290.0);
    float patina = mxKitNoise(p*5.0 + 2.8);
    tint = 1.0 + 0.055*(patina-0.5) + 0.032*(peel-0.5)*micro;
    rough = 0.09*(patina-0.5) + 0.10*(peel-0.5)*micro;
    relief = 0.00012*(peel-0.5)*micro;`,
  rubber: `
    float grain = mxKitNoise(p*175.0 + 6.7);
    float handling = mxKitNoise(p*11.0);
    tint = 1.0 + (handling-0.5)*0.12 + (grain-0.5)*0.14*detail;
    rough = (grain-0.5)*0.15*detail - 0.035*handling;
    relief = (grain-0.5)*0.00022*detail;`,
  fabric: `
    vec2 yarn = cos(6.283185*p*360.0);
    vec2 ripstop = smoothstep(vec2(0.28),vec2(0.48),abs(fract(p*115.0+0.5)-0.5));
    float warp = yarn.x*yarn.y*micro;
    float grid = max(ripstop.x,ripstop.y)-0.40;
    tint = 1.0 + 0.035*warp + 0.12*grid*detail;
    rough = 0.037*warp - 0.075*grid*detail;
    relief = 0.00010*warp + 0.00016*grid*detail;`,
  timber: `
    float bend = mxKitNoise(vec2(p.x*1.8,p.y*7.0) + 8.0);
    float rings = sin(6.283185*(p.y*61.0 + 0.95*bend));
    float grain = mxKitNoise(vec2(p.x*9.0,p.y*154.0)+bend);
    tint = 1.0 + ((grain-0.5)*0.32 + rings*0.11)*detail + (bend-0.5)*0.14;
    rough = -0.08*rings*detail + (grain-0.5)*0.14*detail;
    relief = (0.00035*rings + 0.00024*(grain-0.5))*detail;`,
};

export function installMxKitFinish(material: T.MeshStandardMaterial, kind: MxTracksideMaterial) {
  chainShaderHook(material, 'mx-kit-' + kind + '-finish-v1', (shader) => {
    injectDeclarations(
      shader,
      'common',
      'attribute vec2 mxKitMeters; varying vec2 vMxKitMeters;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vMxKitMeters = mxKitMeters;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      /* glsl */ `
varying vec2 vMxKitMeters;
float mxKitRough, mxKitHeight;
float mxKitHash(vec2 p) {
  vec3 q = fract(p.xyx*0.1031); q += dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
float mxKitNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mxKitHash(i),mxKitHash(i+vec2(1.0,0.0)),f.x),
    mix(mxKitHash(i+vec2(0.0,1.0)),mxKitHash(i+1.0),f.x),f.y);
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      /* glsl */ `{
      vec2 p = vMxKitMeters;
      float footprint = max(fwidth(p.x), fwidth(p.y));
      float detail = 1.0-smoothstep(0.0025,0.012,footprint);
      float micro = 1.0-smoothstep(0.00055,0.002,footprint);
      float tint, rough, relief;
      ${patterns[kind]}
      diffuseColor.rgb *= tint; mxKitRough=rough; mxKitHeight=relief;
    }`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor=clamp(roughnessFactor+mxKitRough,0.08,1.0);',
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      /* glsl */ `{
      vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
      vec3 r1=cross(dy,normal),r2=cross(normal,dx);
      float det=dot(dx,r1);
      normal=normalize(max(abs(det),1e-10)*normal-sign(det)*(dFdx(mxKitHeight)*r1+dFdy(mxKitHeight)*r2));
    }`,
      'fragment',
    );
  });
}
