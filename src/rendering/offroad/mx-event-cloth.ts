import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { MX_GUST_GLSL, MxVenueWind } from './mx-venue-wind.ts';

export const MX_CLOTH_EXCURSION = 0.16;

/** Direction and maximum deflection in venue space, plus a travelling-wave
 * phase in radians. A zero-length direction pins a vertex to its seam. */
export function installMxClothWind(
  material: T.Material,
  time: T.IUniform<number>,
  lit = false,
  wind = new MxVenueWind(),
) {
  chainShaderHook(material, 'mx-pinned-event-fabric-v2', (shader) => {
    shader.uniforms.mxClothTime = time;
    shader.uniforms.mxVenueWind = wind;
    injectDeclarations(
      shader,
      'common',
      `
      uniform float mxClothTime;
      uniform vec3 mxVenueWind;
      attribute vec3 mxCloth;
      ${MX_GUST_GLSL}
      float mxWindPressure() {
        vec2 normal = mxCloth.xy * inversesqrt(max(dot(mxCloth.xy,mxCloth.xy),0.000001));
        return dot(normal,mxVenueWind.xy);
      }
      float mxClothWave(float phase) {
        float fold = sin(phase - mxClothTime * 2.45);
        return 0.72 * fold + 0.28 * sin(phase * 1.83 - mxClothTime * 4.25 + 0.48 * fold);
      }
      float mxClothSlope(float phase) {
        float slow = phase - mxClothTime * 2.45;
        float fast = phase * 1.83 - mxClothTime * 4.25 + 0.48 * sin(slow);
        return 0.72 * cos(slow) + 0.28 * cos(fast) * (1.83 + 0.48 * cos(slow));
      }`,
      'vertex',
    );
    const load = `float mxPressure = mxWindPressure();
      float mxGust = mxVenueGust(position.xz, mxClothTime);
      float mxRipple = sqrt(mxVenueWind.z) * (0.32 + 0.68 * mxGust)
        * (0.19 + 0.35 * abs(mxPressure));
      float mxPhase = mxCloth.z + 0.42 * mxGust;`;
    if (lit) {
      // Vertical phase advance is shared by all panels. Bend the shading
      // normal along the wave so reflected light follows the fabric.
      injectAfter(
        shader,
        'beginnormal_vertex',
        `${load}
         objectNormal.y -= dot(objectNormal.xz, mxCloth.xy) * mxRipple * 2.1 * mxClothSlope(mxPhase);`,
        'vertex',
      );
    }
    injectAfter(
      shader,
      'begin_vertex',
      `${lit ? '' : load}
      transformed.xz += mxCloth.xy * (0.46 * mxPressure * mxVenueWind.z * (0.44 + 0.56 * mxGust)
        + mxRipple * mxClothWave(mxPhase));`,
      'vertex',
    );
  });
}

export function attachMxClothShadows(
  mesh: T.Mesh,
  time: T.IUniform<number>,
  wind = new MxVenueWind(),
) {
  const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, side: T.DoubleSide });
  const distance = new T.MeshDistanceMaterial({ side: T.DoubleSide });
  installMxClothWind(depth, time, false, wind);
  installMxClothWind(distance, time, false, wind);
  mesh.customDepthMaterial = depth;
  mesh.customDistanceMaterial = distance;
  const g = mesh.geometry;
  g.computeBoundingBox();
  g.boundingBox!.expandByScalar(MX_CLOTH_EXCURSION);
  g.computeBoundingSphere();
  g.boundingSphere!.radius += MX_CLOTH_EXCURSION;
}
