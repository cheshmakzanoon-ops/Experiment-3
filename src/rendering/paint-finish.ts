import { Vector3, type MeshPhysicalMaterial } from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';
const observations = new WeakMap<MeshPhysicalMaterial, { value: Vector3 }>();

/** Snapshot projection, not a second body-water simulation. All inputs come
 * from current rain, loaded wheel contacts and recorded component health. */
export function setPaintObservation(
  material: MeshPhysicalMaterial,
  wet: number,
  frontHealth: number,
  rearHealth: number,
) {
  if (![wet, frontHealth, rearHealth].every(Number.isFinite))
    throw new Error('Invalid paint observation');
  observations
    .get(material)
    ?.value.set(
      Math.max(0, Math.min(1, wet)),
      1 - Math.max(0, Math.min(1, frontHealth)),
      1 - Math.max(0, Math.min(1, rearHealth)),
    );
}

/** A deterministic object-space pigment finish. Unresolved flecks fade to their
 * mean rather than sparkle at distance. No new texture, render pass, time source
 * or accumulated water state; bounded snapshot observations modulate the coat. */
const pigmentInstalled = new WeakSet<MeshPhysicalMaterial>();
export function installPaintFinish(material: MeshPhysicalMaterial) {
  if (pigmentInstalled.has(material)) return material;
  pigmentInstalled.add(material);
  material.userData.aurelPaintFinish = true;
  const previous = material.onBeforeCompile,
    previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPaintPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaintPosition=position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPaintPosition;')
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        vec3 paintP=vPaintPosition*1100.0;
        float paintFootprint=max(length(dFdx(paintP)),length(dFdy(paintP)));
        float paintResolved=1.0-smoothstep(0.5,1.8,paintFootprint);
        float paintGrain=sin(paintP.x+sin(paintP.z))*sin(paintP.y*1.13+paintP.z);
        float paintPanel=sin(vPaintPosition.z*3.1)*sin(vPaintPosition.x*4.7+vPaintPosition.y*3.3);
        roughnessFactor=clamp(roughnessFactor+paintGrain*paintResolved*0.018+paintPanel*0.009,0.06,1.0);
      `,
      );
  };
  material.customProgramCacheKey = () => `${previousKey}|aurel-filtered-pigment-v2`;
  return material;
}

/** Explicit dynamic layer. Static pigment-only callers retain their zero-uniform
 * contract; production vehicle materials opt in once at construction. */
export function installPaintObservation(material: MeshPhysicalMaterial) {
  installPaintFinish(material);
  if (observations.has(material)) return material;
  const observation = { value: new Vector3() };
  observations.set(material, observation);
  const previous = material.onBeforeCompile,
    previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.paintObservation = observation;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 paintObservation;')
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoatRoughness=min(1.,mix(material.clearcoatRoughness,.075+geometryRoughness,paintObservation.x));
          material.roughness=mix(material.roughness,material.roughness*.86,paintObservation.x);
        #endif
      `,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float damaged=max(paintObservation.y*smoothstep(1.5,2.,vPaintPosition.z),paintObservation.z*smoothstep(1.8,2.1,-vPaintPosition.z));
        vec2 scratch=vec2(vPaintPosition.x*190.,vPaintPosition.z*18.+sin(vPaintPosition.x*71.)*.7);
        float mark=pow(max(0.,sin(scratch.x)*sin(scratch.y)),12.)*(1.-smoothstep(.8,2.5,max(fwidth(scratch.x),fwidth(scratch.y))));
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.037,.043,.045),mark*damaged*.55);
      `,
      );
  };
  material.customProgramCacheKey = () => `${previousKey}|snapshot-wet-component-damage-v2-filtered`;
  return material;
}

/** Paint finish table (ART_BIBLE_A §6.1, D06). `flake` scales the metallic
 * flake tilt, `peel` is the clear-coat orange-peel slope. */
export const PAINT_FINISHES = Object.freeze({
  gloss: Object.freeze({
    metalness: 0,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    flake: 0,
    peel: 0.002,
  }),
  metallic: Object.freeze({
    metalness: 0.5,
    roughness: 0.38,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    flake: 1,
    peel: 0.002,
  }),
  satin: Object.freeze({
    metalness: 0.1,
    roughness: 0.48,
    clearcoat: 0.35,
    clearcoatRoughness: 0.32,
    flake: 0,
    peel: 0,
  }),
  matte: Object.freeze({
    metalness: 0,
    roughness: 0.62,
    clearcoat: 0,
    clearcoatRoughness: 0,
    flake: 0,
    peel: 0,
  }),
});
export type PaintFinish = keyof typeof PAINT_FINISHES;

/** Set `material`'s lobes to `finish` and record it (`userData.paintFinish`). */
export function applyPaintFinish(material: MeshPhysicalMaterial, finish: PaintFinish) {
  const f = PAINT_FINISHES[finish];
  if (!f) throw new Error('Unknown paint finish');
  material.metalness = f.metalness;
  material.roughness = f.roughness;
  material.clearcoat = f.clearcoat;
  material.clearcoatRoughness = f.clearcoatRoughness;
  material.userData.paintFinish = finish;
  return material;
}

/** Shared GLSL helpers: an integer cell hash and the object-to-view mapping of
 * a surface direction through the screen-space Jacobian of the two positions
 * (no tangents, no model matrix in the fragment stage). */
const FLAKE_DECLARATIONS = `#ifndef APEX_PAINT_FLAKE_DECLARED
#define APEX_PAINT_FLAKE_DECLARED
uvec3 apexPaintHash3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 apexPaintRandom(vec3 cell) {
  return vec3(apexPaintHash3(uvec3(ivec3(cell) + 1048576))) * (1.0 / 4294967296.0);
}
vec3 apexObjectToView(vec3 d, vec3 ox, vec3 oy, vec3 vx, vec3 vy) {
  float a11 = dot(ox, ox), a12 = dot(ox, oy), a22 = dot(oy, oy);
  float det = a11 * a22 - a12 * a12;
  vec2 r = vec2(dot(d, ox), dot(d, oy));
  vec2 ab = vec2(a22 * r.x - a12 * r.y, a11 * r.y - a12 * r.x) / max(det, 1e-30);
  return det > 1e-30 ? ab.x * vx + ab.y * vy : vec3(0.0);
}
#endif`;
/** Flake cell size (0.4 mm) and the distance by which the sparkle is gone. */
export const PAINT_FLAKE = Object.freeze({ cell: 0.0004, fadeStart: 4, fadeEnd: 10, tilt: 0.18 });
const flakeGlsl = (amount: number) => `{
  // Metallic flake (D06): 0.4 mm cells in object space, a glitter LOD that never
  // makes cells smaller than ~1.5 px (two levels blended like a mip), averaged
  // tilt shrinking with the flakes per cell, gone by ${PAINT_FLAKE.fadeEnd} m.
  vec3 flakeOx = dFdx(vPaintPosition), flakeOy = dFdy(vPaintPosition);
  vec3 flakeVx = dFdx(-vViewPosition), flakeVy = dFdy(-vViewPosition);
  float flakePixel = max(length(flakeOx), length(flakeOy));
  float flakeLevel = max(0.0, log2(max(flakePixel, 1e-7) * 1.5 / ${PAINT_FLAKE.cell}));
  float flakeLod = floor(flakeLevel), flakeBlend = flakeLevel - flakeLod;
  float flakeFade = 1.0 - smoothstep(${PAINT_FLAKE.fadeStart.toFixed(1)}, ${PAINT_FLAKE.fadeEnd.toFixed(1)}, length(vViewPosition));
  vec3 flakeTilt = vec3(0.0);
  float flakeCover = 0.0;
  for (int k = 0; k < 2; k++) {
    float level = flakeLod + float(k);
    float size = ${PAINT_FLAKE.cell} * exp2(level);
    vec3 r = apexPaintRandom(floor(vPaintPosition / size) + level * 7919.0);
    vec3 s = apexPaintRandom(floor(vPaintPosition / size) + level * 7919.0 + 104729.0);
    float weight = (k == 0 ? 1.0 - flakeBlend : flakeBlend) * step(0.82, r.x) * inversesqrt(exp2(level));
    flakeTilt += weight * apexObjectToView(vec3(r.y, r.z, s.x) * 2.0 - 1.0, flakeOx, flakeOy, flakeVx, flakeVy);
    flakeCover += weight;
  }
  flakeTilt -= normal * dot(normal, flakeTilt);
  normal = normalize(normal + ${(PAINT_FLAKE.tilt * amount).toFixed(4)} * flakeFade * flakeTilt);
  metalnessFactor = min(1.0, metalnessFactor + ${(0.25 * amount).toFixed(4)} * flakeFade * flakeCover);
}`;
const peelGlsl = (slope: number) => `#ifdef USE_CLEARCOAT
{
  // Orange peel (D06): a 7 mm ripple in the coat normal only (analytic object
  // gradient of three skewed waves), faded once a wave spans under ~2 px.
  vec3 peelOx = dFdx(vPaintPosition), peelOy = dFdy(vPaintPosition);
  float peelPixel = max(length(peelOx), length(peelOy));
  float peelResolved = 1.0 - smoothstep(0.0015, 0.0035, peelPixel);
  vec3 peelP = vPaintPosition * (6.2831853 / 0.007);
  vec3 peelA = vec3(0.83, 0.31, 0.47), peelB = vec3(-0.29, 0.77, 0.57), peelC = vec3(0.41, -0.52, 0.75);
  vec3 peelG = cos(dot(peelP, peelA)) * peelA + cos(dot(peelP, peelB) + 1.7) * peelB +
    cos(dot(peelP, peelC) + 4.1) * peelC;
  vec3 peelV = apexObjectToView(peelG, peelOx, peelOy, dFdx(-vViewPosition), dFdy(-vViewPosition));
  peelV -= clearcoatNormal * dot(clearcoatNormal, peelV);
  clearcoatNormal = normalize(clearcoatNormal - ${(slope / 1.2).toFixed(6)} * peelResolved * peelV);
}
#endif`;

/**
 * Metallic flakes in the base layer and orange peel in the clear coat, chained
 * after `installPaintFinish` (whose `vPaintPosition` it reads). Constants only:
 * no uniform, texture or time source, so the paint keeps its zero-uniform
 * contract; the amounts are baked into the GLSL and the hook key.
 */
export function installPaintFlakes(material: MeshPhysicalMaterial, flake: number, peel: number) {
  if (![flake, peel].every(Number.isFinite) || flake < 0 || flake > 2 || peel < 0 || peel > 0.02)
    throw new Error('Invalid paint flake setting');
  installPaintFinish(material);
  if (flake === 0 && peel === 0) return false;
  const key = `paint-flake-${Math.round(flake * 100)}-${Math.round(peel * 10000)}-v1`;
  return chainShaderHook(material, key, (shader) => {
    injectDeclarations(shader, 'common', FLAKE_DECLARATIONS, 'fragment');
    if (flake > 0) injectAfter(shader, 'normal_fragment_maps', flakeGlsl(flake), 'fragment');
    if (peel > 0) injectAfter(shader, 'clearcoat_normal_fragment_maps', peelGlsl(peel), 'fragment');
  });
}
