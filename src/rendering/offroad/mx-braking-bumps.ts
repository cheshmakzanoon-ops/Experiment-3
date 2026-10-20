import type * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** The attribute is sampled from physical braking-bump relief: x is its
 * worked-line footprint and y its raised soil height. It only shades that
 * ground; normals and silhouettes remain the actual course mesh. */
export function installMxBrakingBumps(material: T.MeshPhysicalMaterial) {
  return chainShaderHook(material, 'mx-physical-braking-lines-v1', (shader) => {
    injectDeclarations(
      shader,
      'common',
      'attribute vec2 mxBrakingWork;\nvarying vec2 vMxBrakingWork;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vMxBrakingWork = mxBrakingWork;', 'vertex');
    injectDeclarations(shader, 'common', 'varying vec2 vMxBrakingWork;', 'fragment');
    injectAfter(
      shader,
      'color_fragment',
      `// Worn lanes are a little darker than their unworked parallel line;
       // exposed ridge tops retain more dry clay. No painted guide stripe.
       diffuseColor.rgb *= 1.0 - clamp( vMxBrakingWork.x, 0.0, 1.0 ) * 0.10
         + clamp( vMxBrakingWork.y, 0.0, 1.0 ) * 0.055;`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor *= 1.0 - clamp( vMxBrakingWork.x, 0.0, 1.0 ) * 0.045;',
      'fragment',
    );
  });
}
