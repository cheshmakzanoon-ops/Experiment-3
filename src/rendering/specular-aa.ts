import * as T from 'three';

/** Screen-space normal-variance specular anti-aliasing (Tokuyoshi & Kaplanyan,
 * "Improved Geometric Specular Antialiasing", I3D 2019).
 *
 * MSAA resolves triangle edges but not highlights that flicker because a bump
 * or normal map varies faster than one pixel (asphalt aggregate, kerb chips,
 * carbon weave, tread). The GGX alpha² is widened by the projected variance of
 * the *shaded* normal so a pixel's highlight approximates the average of the
 * normals it covers. Three.js already adds a non-perturbed geometric term; this
 * adds the normal-map term. Energy is not added: only the lobe width changes,
 * and flat, smoothly varying surfaces (sigma² ≈ 0) keep their authored value.
 */
export const SPECULAR_AA = Object.freeze({
  /** Screen-space filter-kernel variance sigma². */
  variance: 0.25,
  /** Clamp on the added alpha² so steep edges cannot become fully rough. */
  threshold: 0.18,
});

/** CPU reference of the shader expression. `du`/`dv` are the per-pixel
 * derivatives of the unit shaded normal. Returns the filtered perceptual roughness. */
export function filteredRoughness(roughness: number, duLengthSq: number, dvLengthSq: number) {
  if (![roughness, duLengthSq, dvLengthSq].every(Number.isFinite))
    throw new Error('Invalid specular AA input');
  const r = T.MathUtils.clamp(roughness, 0, 1);
  const alpha2 = r ** 4;
  const kernel = Math.min(
    2 * SPECULAR_AA.variance * (Math.max(0, duLengthSq) + Math.max(0, dvLengthSq)),
    SPECULAR_AA.threshold,
  );
  return Math.min(1, Math.sqrt(Math.sqrt(alpha2 + kernel)));
}

const MARKER = 'apexSpecularAA';
/** Idempotently patch the shared physical-lighting chunk before any program
 * compiles. Materials that later replace this include still see the patched
 * roughness because they include the (modified) chunk text first. */
export function installSpecularAntialiasing() {
  const chunk = T.ShaderChunk.lights_physical_fragment;
  if (chunk.includes(MARKER)) return false;
  const anchor = 'material.roughness = min( material.roughness, 1.0 );';
  if (!chunk.includes(anchor)) throw new Error('Unexpected Three.js physical lighting chunk');
  T.ShaderChunk.lights_physical_fragment = chunk.replace(
    anchor,
    `${anchor}
{
	// ${MARKER}: widen GGX alpha^2 by the shaded normal's pixel-footprint variance.
	vec3 apexNormalDu = dFdx( normal );
	vec3 apexNormalDv = dFdy( normal );
	float apexKernel = min( 2.0 * ${SPECULAR_AA.variance.toFixed(3)} * ( dot( apexNormalDu, apexNormalDu ) + dot( apexNormalDv, apexNormalDv ) ), ${SPECULAR_AA.threshold.toFixed(3)} );
	float apexAlpha2 = pow2( pow2( material.roughness ) );
	material.roughness = min( sqrt( sqrt( apexAlpha2 + apexKernel ) ), 1.0 );
}`,
  );
  return true;
}
