import type * as T from 'three';
import {
  chainShaderHook,
  injectAfter,
  injectBefore,
  injectDeclarations,
} from '../studio/shader-hooks.ts';

export type MotocrossCastMetal = 'aluminium' | 'magnesium';

const DECLARATIONS = /* glsl */ `
varying vec3 vMxCastPosition;
// Grain height, roughness variation and oxide variation. The material's own
// base colour/roughness/metalness still distinguish the two cast alloys.
uniform vec3 mxCastFinish;
float mxCastHeight, mxCastRoughness, mxCastOxide;
float mxCastHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float mxCastNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(
    mix(mix(mxCastHash(i), mxCastHash(i + vec3(1,0,0)), f.x),
        mix(mxCastHash(i + vec3(0,1,0)), mxCastHash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(mxCastHash(i + vec3(0,0,1)), mxCastHash(i + vec3(1,0,1)), f.x),
        mix(mxCastHash(i + vec3(0,1,1)), mxCastHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

const SAMPLE = /* glsl */ `
{
  // Coordinates are authored in metres, independent of extruded-case UVs.
  // Fading before a grain spans less than a pixel prevents distant sparkle.
  float footprint = length(fwidth(vMxCastPosition));
  float fine = 1. - smoothstep(.00025, .00125, footprint);
  float broad = 1. - smoothstep(.004, .018, footprint);
  float grain = mxCastNoise(vMxCastPosition * 800.);
  float castVariation = mxCastNoise(vMxCastPosition * 55. + vec3(7.1, 3.7, 1.9));
  float pits = 1. - smoothstep(.18, .34, grain);
  mxCastHeight = ((grain - .5) - pits * .35) * mxCastFinish.x * fine;
  mxCastRoughness = ((grain - .5) * fine + (castVariation - .5) * .45 * broad) *
    mxCastFinish.y;
  mxCastOxide = smoothstep(.58, .83, castVariation) * broad * mxCastFinish.z;
  // Modest reflectance variation, never painted highlights or fake shadows.
  diffuseColor.rgb *= 1. + (castVariation - .5) * .065 * broad - mxCastOxide * .12;
}`;

const NORMAL = /* glsl */ `
{
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 r1 = cross(dy, normal), r2 = cross(normal, dx);
  float det = dot(dx, r1);
  vec3 gradient = sign(det) * (dFdx(mxCastHeight) * r1 + dFdy(mxCastHeight) * r2);
  normal = normalize(max(abs(det), 1.e-10) * normal - gradient);
}`;

/** Original cast-case microfinish. No textures, geometry, time state or extra
 * draws. Apply only to the dedicated MX engine materials: frame aluminium is
 * already brushed and the shared exhaust has its own heat-tinted vertices.
 *
 * Both profiles use one shader program. Fine relief is 12–20 micrometres,
 * with 1.25 mm grain and broad 18 mm casting variation; these are authored
 * scales, not measurements recovered from the screenshot references.
 *
 * The dry finish leads the mud hook's colour/roughness/normal work even if
 * installation order changes. The existing snapshot weather hook then acts
 * on the combined surface before physical lighting. */
export function installMotocrossMetalFinish(
  material: T.MeshStandardMaterial,
  kind: MotocrossCastMetal,
) {
  return chainShaderHook(material, 'motocross-cast-metal-v1', (shader) => {
    shader.uniforms.mxCastFinish = {
      value: kind === 'aluminium' ? [0.00002, 0.16, 0.3] : [0.000012, 0.12, 0.45],
    };
    injectDeclarations(shader, 'common', 'varying vec3 vMxCastPosition;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vMxCastPosition = position;', 'vertex');
    injectDeclarations(shader, 'common', DECLARATIONS, 'fragment');
    injectBefore(shader, 'color_fragment', SAMPLE, 'fragment');
    // Leading blocks run after the standard maps, before any deposited mud.
    injectDeclarations(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor = clamp(roughnessFactor + mxCastRoughness + mxCastOxide * .08, .12, .96);',
      'fragment',
    );
    injectDeclarations(
      shader,
      'metalnessmap_fragment',
      'metalnessFactor *= 1. - mxCastOxide;',
      'fragment',
    );
    injectDeclarations(shader, 'normal_fragment_maps', NORMAL, 'fragment');
  });
}
