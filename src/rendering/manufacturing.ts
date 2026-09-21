import * as T from 'three';

const installed = new WeakMap<T.MeshStandardMaterial, string>();
export type SurfaceFinish = 'turned-alloy' | 'carbon-ceramic' | 'suede';

/** Filtered tool marks in mesh-local metres. No texture allocation, frame clock,
 * baked illumination or random flashes. Existing material hooks are retained. */
export function installManufacturingFinish<TMaterial extends T.MeshStandardMaterial>(
  material: TMaterial,
  finish: SurfaceFinish,
): TMaterial {
  if (!['turned-alloy', 'carbon-ceramic', 'suede'].includes(finish))
    throw new Error('Invalid surface finish');
  const existing = installed.get(material);
  if (existing === finish) return material;
  if (existing !== undefined) throw new Error('A material cannot have two manufacturing finishes');
  material.userData.aurelManufacturingFinish = finish;
  installed.set(material, finish);
  const previous = material.onBeforeCompile,
    previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vManufacture;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvManufacture=position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vManufacture;')
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        ${
          finish === 'turned-alloy'
            ? `
          float machinePhase=length(vManufacture.yz)*2100.0;
          float machineResolved=1.0-smoothstep(0.6,2.2,fwidth(machinePhase));
          float machineRing=sin(machinePhase)*machineResolved;
          roughnessFactor=clamp(roughnessFactor+0.07*machineRing,0.18,0.6);
        `
            : finish === 'carbon-ceramic'
              ? `
          vec3 machineP=vManufacture*1450.0;
          float machineResolved=1.0-smoothstep(0.5,2.0,max(length(dFdx(machineP)),length(dFdy(machineP))));
          float machineGrain=sin(machineP.x+machineP.z)*sin(machineP.y*1.37-machineP.z);
          roughnessFactor=clamp(roughnessFactor+machineGrain*machineResolved*0.09,0.55,0.94);
        `
              : `
          vec3 machineP=vManufacture*2200.0;
          float machineResolved=1.0-smoothstep(0.45,1.6,max(length(dFdx(machineP)),length(dFdy(machineP))));
          roughnessFactor=clamp(roughnessFactor+sin(machineP.y)*sin(machineP.z)*machineResolved*0.035,0.8,1.0);
        `
        }`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey}|aurel-${finish}-v1`;
  return material;
}

/** Actual circular through-holes and central bore, not black dots painted on a
 * solid cylinder. The disc spins on its own axle and stays on the upright while
 * the rim/tire move outwards during a physical pit-service wheel exchange. */
export function ventilatedBrakeGeometry() {
  const shape = new T.Shape();
  // Explicit perimeter segments are independent of the small ventilation holes.
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    if (i === 0) shape.moveTo(Math.cos(a) * 0.209, Math.sin(a) * 0.209);
    else shape.lineTo(Math.cos(a) * 0.209, Math.sin(a) * 0.209);
  }
  const bore = new T.Path();
  bore.absarc(0, 0, 0.084, 0, Math.PI * 2, true);
  shape.holes.push(bore);
  for (let ring = 0; ring < 2; ring++)
    for (let i = 0; i < 20; i++) {
      const a = ((i + ring * 0.5) / 20) * Math.PI * 2,
        radius = 0.15 + ring * 0.034;
      const hole = new T.Path();
      hole.absarc(Math.cos(a) * radius, Math.sin(a) * radius, 0.0045, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: 0.014,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 6,
  });
  geometry.translate(0, 0, -0.007);
  geometry.rotateY(Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
