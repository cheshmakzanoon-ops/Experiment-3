import { type MeshPhysicalMaterial } from 'three';

/** A deterministic object-space pigment finish. Unresolved flecks fade to their
 * mean rather than sparkle at distance. No new texture, render pass, time source
 * or wetness state; the existing coat/wetness uniforms continue to own the lobe. */
export function installPaintFinish(material: MeshPhysicalMaterial) {
  if (material.userData.aurelPaintFinish) return material;
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
  material.customProgramCacheKey = () => `${previousKey}|aurel-filtered-pigment-v1`;
  return material;
}
