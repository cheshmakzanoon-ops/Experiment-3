import type * as T from 'three';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import { useStudioUniforms } from '../studio/studio-frame.ts';

/** The ribbon carries signed bank position, downstream travel time and bed
 * grade. The normal map is shared with the coast, but ripples advect along
 * the channel and slow at the banks. Both phases resolve directly on seek. */
export function installRiverCurrent(material: T.MeshPhysicalMaterial, halfWidth: number) {
  return chainShaderHook(material, 'festival-river-current-v1', (shader) => {
    useStudioUniforms(shader, ['studioTime'], 'fragment');
    shader.uniforms.riverHalfWidth = { value: halfWidth };
    injectAfter(shader, 'common', 'attribute vec3 riverFlow;\nvarying vec3 vRiverFlow;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vRiverFlow = riverFlow;', 'vertex');
    injectAfter(
      shader,
      'common',
      'uniform float riverHalfWidth;\nvarying vec3 vRiverFlow;',
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      /* glsl */ `
#ifdef USE_NORMALMAP_TANGENTSPACE
{
  float across = vRiverFlow.x * riverHalfWidth;
  float travel = vRiverFlow.y;
  float bank = smoothstep(0.42, 0.98, abs(vRiverFlow.x));
  float riffle = smoothstep(0.010, 0.044, vRiverFlow.z);
  vec2 channelUv = vec2(across * 0.23 + 0.14 * sin(travel * 0.075), (travel - studioTime) * 0.21);
  vec2 bankUv = vec2(across * 0.38 + 0.37, (travel - 0.46 * studioTime) * 0.34);
  vec2 current = texture2D(normalMap, channelUv).xy * 2.0 - 1.0;
  vec2 eddy = texture2D(normalMap, bankUv).xy * 2.0 - 1.0;
  vec2 ripple = mix(current, eddy, 0.18 + 0.69 * bank);
  // Distant unrevolved ripples contribute roughness in place of sharp reflections.
  float footprint = max(fwidth(across), fwidth(travel) * 1.4);
  float detail = 1.0 - smoothstep(0.28, 2.8, footprint);
  vec2 slope = ripple * normalScale * (0.64 + 0.7 * riffle) * (1.0 - 0.47 * bank);
  normal = normalize(tbn * vec3(slope * detail, 1.0));
  float fleck = smoothstep(0.56, 0.85, current.y) * smoothstep(0.06, 0.65, eddy.x)
    * riffle * (1.0 - bank) * detail;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.58, 0.66, 0.62), fleck * 0.44);
  roughnessFactor = min(1.0, roughnessFactor + 0.06 * (1.0 - detail) + 0.28 * fleck);
}
#endif`,
      'fragment',
    );
    injectAfter(
      shader,
      'clearcoat_normal_fragment_maps',
      /* glsl */ `
#if defined(USE_CLEARCOAT) && defined(USE_NORMALMAP_TANGENTSPACE)
  clearcoatNormal = normalize(mix(clearcoatNormal, normal, 0.85));
#endif`,
      'fragment',
    );
  });
}
