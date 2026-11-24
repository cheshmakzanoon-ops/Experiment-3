import type * as T from 'three';
import { chainShaderHook, injectBefore, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** The axial dimensions of the inverted fork in the lower leg's frame. */
export const MX_STANCHION_LENGTH = 0.68;
export const MX_WIPER_Y = -0.387;

const positions = new WeakMap<T.Material, T.IUniform<Float32Array>>();

/** The seal travels along the stanchion. Below its fully compressed reach,
 * dirt sticks to the tube. The polished stroke retains a thin oil film and
 * the lip carries a narrow collar of residue. Both legs and all LODs of an
 * entrant read the same positions in metres. */
export function installMxForkSurface(material: T.MeshPhysicalMaterial, fullCompression: number, rideHeight: number) {
  const existing = positions.get(material);
  if (existing) return existing;
  const seal = { value: Float32Array.of(MX_WIPER_Y - fullCompression, MX_WIPER_Y - rideHeight) };
  positions.set(material, seal);
  chainShaderHook(material, 'mx-fork-wiper-v1', (shader) => {
    shader.uniforms.mxForkSeal = seal;
    injectDeclarations(shader, 'common', 'varying float vMxShaftHeight;', 'vertex');
    // Cylinder UVs run axially from the lug to the top. They survive the
    // rigid lower-leg batch, steering movement and left/right placement.
    injectAfter(shader, 'begin_vertex', `vMxShaftHeight = uv.y * ${MX_STANCHION_LENGTH};`, 'vertex');
    injectDeclarations(shader, 'common', `
      varying float vMxShaftHeight;
      uniform vec2 mxForkSeal;
      float mxForkStroke, mxForkCollar;
      #define MX_MUD_RETENTION mix(1.0 - 0.9 * mxForkStroke, 0.76, mxForkCollar)
    `, 'fragment');
    injectBefore(shader, 'color_fragment', `
      float mxShaftFootprint = max(fwidth(vMxShaftHeight), 0.00025);
      mxForkStroke = smoothstep(mxForkSeal.x - mxShaftFootprint, mxForkSeal.x + 0.012 + mxShaftFootprint, vMxShaftHeight);
      // Filter the approximately 4 mm film at the lip as it gets smaller
      // than a pixel. Its geometric edge stays fixed to the actual seal.
      float mxLipGap = abs(mxForkSeal.y - 0.002 - vMxShaftHeight);
      mxForkCollar = (1.0 - smoothstep(0.001, 0.004 + mxShaftFootprint, mxLipGap)) *
        (0.004 / (0.004 + mxShaftFootprint));
    `, 'fragment');
    injectDeclarations(shader, 'roughnessmap_fragment',
      'roughnessFactor = max(0.08, roughnessFactor - 0.025 * mxForkStroke - 0.035 * mxForkCollar);', 'fragment');
  });
  return seal;
}
