import type * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** XY carry braking wear and ridge height. ZW carry the packed bed
 * and loose outer shoulder of the physical banked groove. */
export function installMxBrakingBumps(material: T.MeshPhysicalMaterial) {
  return chainShaderHook(material, 'mx-physical-braking-lines-v2', (shader) => {
    injectDeclarations(
      shader,
      'common',
      'attribute vec4 mxBrakingWork;\nvarying vec4 vMxBrakingWork;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vMxBrakingWork = mxBrakingWork;', 'vertex');
    injectDeclarations(shader, 'common', 'varying vec4 vMxBrakingWork;', 'fragment');
    injectAfter(
      shader,
      'color_fragment',
      `// Worn lanes are a little darker than their unworked parallel line;
       // exposed ridge tops retain more dry clay. No painted guide stripe.
       diffuseColor.rgb *= 1.0 - clamp( vMxBrakingWork.x, 0.0, 1.0 ) * 0.10
         + clamp( vMxBrakingWork.y, 0.0, 1.0 ) * 0.055;
       // Wheel traffic exposes darker damp earth in the trough and pushes
       // pale, dry crumbs onto its outer lip. Retain the photographed grain.
       diffuseColor.rgb *= 1.0 - vMxBrakingWork.z * 0.22 + vMxBrakingWork.w * 0.13;`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      `roughnessFactor *= 1.0 - clamp( vMxBrakingWork.x, 0.0, 1.0 ) * 0.045;
       roughnessFactor = mix(roughnessFactor, max(0.28, roughnessFactor * 0.72), vMxBrakingWork.z);
       roughnessFactor = mix(roughnessFactor, max(0.85, roughnessFactor), vMxBrakingWork.w * 0.65);`,
      'fragment',
    );
  });
}
