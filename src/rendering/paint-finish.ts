import { Vector3, type MeshPhysicalMaterial } from 'three';
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
