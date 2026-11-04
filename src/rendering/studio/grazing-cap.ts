import * as T from 'three';
import { chainShaderHook, injectAfter } from './shader-hooks.ts';

/**
 * Grazing-Fresnel cap (vehicle-art D8).
 *
 * A glossy skin that faces the sky and is seen at a glancing angle (the
 * low showroom eye, a chase camera behind a wing) reflects the bright dome with a
 * Fresnel term near 1: a front splitter reads as a flat light-grey plate, a flap
 * of the front wing as a blotchy white stripe, a windscreen base throws a white
 * star. The reflection is physically right and visually wrong, because a real car
 * is photographed with a flag or a softbox cutting the top of the sky.
 *
 * The cap scales the specular and clear-coat IBL radiance, and the direct (sun) specular, by
 * `1 - strength * up * grazing`, where `up` is how far the shaded normal points at
 * the sky (0 below 0.3 of the vertical, 1 above 0.8) and `grazing` is
 * `(1 - N.V)^1.6`. A side flank (up = 0) and a bonnet seen head-on (grazing = 0)
 * keep exactly the radiance they had; only the glancing, up-facing glint loses
 * energy, at most `strength` of it, and what is left is clamped to `limit / weight`
 * (a ceiling that only bites near full weight), so the sun disc's streak cannot survive the
 * attenuation. No texture, uniform or time source: the amounts are baked into the program
 * key, so the paint's zero-uniform contract holds.
 *
 * It is chained on paint and carbon (car-livery, vehicle-bodies materials,
 * materials.ts), never on road, venue or glass materials: a wet road's grazing
 * reflection is the effect the weather team wants.
 */
export const GRAZING_CAP = Object.freeze({
  /** Share of the specular radiance removed at a fully grazing, fully up-facing point. */
  strength: 0.85,
  /** Exponent of (1 - N.V). */
  power: 1.6,
  /** Dot(normal, sky) range over which a skin counts as up-facing. */
  upFrom: 0.3,
  upTo: 0.8,
  /** Ceiling on the IBL radiance (sky units, ~1 is the dome's mean) and on the direct specular
   * (output units) at a fully glancing, fully up-facing point; it relaxes as 1 / weight. A
   * multiplicative cap alone cannot tame the reflection of the sun disc, which is tens of times
   * brighter than the sky: 15 % of it is still white. */
  limit: 1.4,
  directLimit: 1.1,
});
export const GRAZING_CAP_KEY = 'grazing-cap-v1';

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
/** CPU reference of the GLSL: the radiance multiplier for a point whose unit
 * normal makes `normalUp` with the sky direction and `normalView` with the eye. */
export function grazingCapFactor(
  normalUp: number,
  normalView: number,
  strength: number = GRAZING_CAP.strength,
) {
  if (![normalUp, normalView, strength].every(Number.isFinite) || strength < 0 || strength > 1)
    throw new Error('Invalid grazing cap input');
  const up = smooth(GRAZING_CAP.upFrom, GRAZING_CAP.upTo, normalUp);
  const grazing = Math.pow(1 - Math.min(1, Math.max(0, normalView)), GRAZING_CAP.power);
  return 1 - strength * up * grazing;
}

/** CPU reference of the ceiling: the largest specular radiance (sky units) the same point may keep. */
export function grazingCapCeiling(normalUp: number, normalView: number) {
  if (![normalUp, normalView].every(Number.isFinite)) throw new Error('Invalid grazing cap input');
  const weight =
    smooth(GRAZING_CAP.upFrom, GRAZING_CAP.upTo, normalUp) *
    Math.pow(1 - Math.min(1, Math.max(0, normalView)), GRAZING_CAP.power);
  return GRAZING_CAP.limit / Math.max(weight, 0.02);
}

const glslIbl = (strength: number) => `float apexGrazingCap = 1.0;
float apexCapWeight = 0.0;
#if defined( RE_IndirectSpecular )
{
  // D8: glancing, up-facing glints lose up to ${(strength * 100).toFixed(0)} % of their sky radiance.
  vec3 apexSkyView = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  float apexFacingUp = smoothstep( ${GRAZING_CAP.upFrom.toFixed(2)}, ${GRAZING_CAP.upTo.toFixed(2)}, dot( geometryNormal, apexSkyView ) );
  float apexGraze = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), ${GRAZING_CAP.power.toFixed(1)} );
  apexCapWeight = apexFacingUp * apexGraze;
  apexGrazingCap = 1.0 - ${strength.toFixed(3)} * apexCapWeight;
  #if defined( USE_ENVMAP )
    vec3 apexCeiling = vec3( ${GRAZING_CAP.limit.toFixed(2)} / max( apexCapWeight, 0.02 ) );
    radiance = min( radiance * apexGrazingCap, apexCeiling );
    #ifdef USE_CLEARCOAT
      clearcoatRadiance = min( clearcoatRadiance * apexGrazingCap, apexCeiling );
    #endif
  #endif
}
#endif`;
/** The same factor on the direct (sun and lamp) specular, base lobe and clear coat, after every light has been summed:
 * the showroom's backlit sun glinting off a front wing at a glancing angle is the other half of D8. */
const GLSL_DIRECT = `{
  vec3 apexDirectCeiling = vec3( ${GRAZING_CAP.directLimit.toFixed(2)} / max( apexCapWeight, 0.02 ) );
  reflectedLight.directSpecular = min( reflectedLight.directSpecular * apexGrazingCap, apexDirectCeiling );
  #ifdef USE_CLEARCOAT
    clearcoatSpecularDirect = min( clearcoatSpecularDirect * apexGrazingCap, apexDirectCeiling );
  #endif
}`;

/** Chain the cap on a Standard/Physical material. False when it does not apply
 * (another material class) or is already installed. `strength` is baked in. */
export function installGrazingCap(material: T.Material, strength: number = GRAZING_CAP.strength) {
  if (!(material instanceof T.MeshStandardMaterial)) return false;
  if (!Number.isFinite(strength) || strength < 0 || strength > 1)
    throw new Error('Invalid grazing cap strength');
  if (strength === 0) return false;
  const key =
    strength === GRAZING_CAP.strength
      ? GRAZING_CAP_KEY
      : `grazing-cap-${Math.round(strength * 100)}-v1`;
  return chainShaderHook(material, key, (shader) => {
    // A previous hook that inlined a lighting chunk keeps its own lighting.
    if (
      !shader.fragmentShader.includes('#include <lights_fragment_maps>') ||
      !shader.fragmentShader.includes('#include <lights_fragment_end>')
    )
      return;
    injectAfter(shader, 'lights_fragment_maps', glslIbl(strength), 'fragment');
    injectAfter(shader, 'lights_fragment_end', GLSL_DIRECT, 'fragment');
  });
}
