import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

export const MX_CLOTH_EXCURSION = 0.16;

/** Direction and maximum deflection in venue space, plus a travelling-wave
 * phase in radians. A zero-length direction pins a vertex to its seam. */
export function installMxClothWind(material: T.Material, time: T.IUniform<number>, lit = false) {
  chainShaderHook(material, 'mx-pinned-event-fabric-v1', (shader) => {
    shader.uniforms.mxClothTime = time;
    injectDeclarations(
      shader,
      'common',
      `
      uniform float mxClothTime;
      attribute vec3 mxCloth;
      float mxClothWave(float phase) {
        return 0.66 * sin(phase - mxClothTime * 2.9)
             + 0.21 * sin(phase * 1.83 - mxClothTime * 4.25)
             + 0.13 * sin(phase * 0.47 - mxClothTime * 1.18);
      }
      float mxClothSlope(float phase) {
        return 0.66 * cos(phase - mxClothTime * 2.9)
             + 0.3843 * cos(phase * 1.83 - mxClothTime * 4.25)
             + 0.0611 * cos(phase * 0.47 - mxClothTime * 1.18);
      }`,
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      'transformed.xz += mxCloth.xy * mxClothWave(mxCloth.z);',
      'vertex',
    );
    if (lit) {
      // Vertical phase advance is shared by all panels. Bend the shading
      // normal along the wave so reflected light follows the fabric.
      injectAfter(
        shader,
        'beginnormal_vertex',
        'objectNormal.y -= dot(objectNormal.xz, mxCloth.xy) * 2.1 * mxClothSlope(mxCloth.z);',
        'vertex',
      );
    }
  });
}

export function attachMxClothShadows(mesh: T.Mesh, time: T.IUniform<number>) {
  const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, side: T.DoubleSide });
  const distance = new T.MeshDistanceMaterial({ side: T.DoubleSide });
  installMxClothWind(depth, time);
  installMxClothWind(distance, time);
  mesh.customDepthMaterial = depth;
  mesh.customDistanceMaterial = distance;
  const g = mesh.geometry;
  g.computeBoundingBox();
  g.boundingBox!.expandByScalar(MX_CLOTH_EXCURSION);
  g.computeBoundingSphere();
  g.boundingSphere!.radius += MX_CLOTH_EXCURSION;
}
