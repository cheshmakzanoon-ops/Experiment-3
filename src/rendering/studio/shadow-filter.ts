import * as T from 'three';

/**
 * Sun shadow filtering (D08 shadows-grounding).
 *
 * Replaces the body of three's `SHADOWMAP_TYPE_PCF_SOFT` branch in `getShadow`
 * (r180: a fixed 3×3 bilinear kernel, 16 fetches, `shadow.radius` ignored) with:
 *
 *  - an 8-tap blocker search (Vogel disc, interleaved-gradient-noise rotation)
 *    that returns "lit" at once when no tap is occluded (most sunlit pixels pay
 *    8 fetches instead of 16);
 *  - percentage-closer soft shadows: the penumbra grows with the receiver-to-
 *    blocker distance for the sun's 0.53° disc, so a tyre's shadow is crisp at
 *    the contact patch and a grandstand roof's shadow is soft on the ground;
 *  - a 16-tap rotated Vogel PCF over that penumbra (the Medium tap limit).
 *
 * The penumbra needs the light's depth range per texel, which three does not
 * pass to `getShadow`. It is carried by the otherwise unused `shadow.radius`:
 * a light whose radius is in (0, 1) uses PCSS with `radius` = penumbra scale
 * (`sunPenumbraScale`); every other light (three's default radius is 1) keeps a
 * fixed one-texel rotated disc. Deterministic: the rotation depends on the pixel
 * position only, so held frames are byte-identical.
 *
 * Installed at module scope after the far-shadow chunks (it touches only the
 * PCF_SOFT branch, never `lights_fragment_begin` nor the far-map helper).
 */

/** Angular diameter of the sun, radians (0.53°). */
export const SUN_ANGULAR_DIAMETER = (0.53 * Math.PI) / 180;
/** Penumbra radius limits in shadow-map texels. */
export const SHADOW_PENUMBRA_TEXELS = Object.freeze({ min: 1, max: 6 });
/** Blocker-search radius in texels (covers the largest penumbra). */
export const SHADOW_SEARCH_TEXELS = 6;
export const SHADOW_BLOCKER_TAPS = 8;
export const SHADOW_FILTER_TAPS = 16;

/**
 * `shadow.radius` for an orthographic sun camera: the penumbra radius, in
 * texels per texel of map, per unit of light-space depth difference, i.e.
 * `penumbraTexels = Δdepth · scale · mapSize`. Half the sun's angular diameter
 * times the depth range, over the frustum width. Always in (0, 1) for any
 * sensible frustum, which is what selects PCSS in the shader.
 */
export function sunPenumbraScale(camera: {
  left: number;
  right: number;
  near: number;
  far: number;
}) {
  const width = camera.right - camera.left,
    depth = camera.far - camera.near;
  if (!(width > 0 && depth > 0)) throw new Error('Invalid sun shadow camera');
  const scale = (Math.tan(SUN_ANGULAR_DIAMETER / 2) * depth) / width;
  return Math.min(0.999, Math.max(1e-4, scale));
}

const PCF_SOFT_BRANCH =
  /(#elif defined\( SHADOWMAP_TYPE_PCF_SOFT \)\n)[\s\S]*?(\n\t\t#elif defined\( SHADOWMAP_TYPE_VSM \))/;
const GET_SHADOW =
  '\tfloat getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity';

const FILTER_GLSL = /* glsl */ `
	// D08 shadows-grounding: blocker search + PCSS + rotated Vogel PCF.
	float apexShadowNoise( vec2 p ) {
		return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
	}
	vec2 apexVogel( int i, int n, float phi ) {
		float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
		float a = float( i ) * 2.39996323 + phi;
		return r * vec2( cos( a ), sin( a ) );
	}
	float apexShadowDepth( sampler2D map, vec2 uv ) {
		return unpackRGBAToDepth( texture2D( map, uv ) );
	}
	float apexShadowFilter( sampler2D map, vec2 size, float radius, vec2 uv, float z ) {
		vec2 texel = 1.0 / size;
		float phi = 6.28318531 * apexShadowNoise( gl_FragCoord.xy );
		float penumbra = ${SHADOW_PENUMBRA_TEXELS.min.toFixed(1)};
		if ( radius > 0.0 && radius < 1.0 ) {
			float blockers = 0.0, blockerDepth = 0.0;
			for ( int i = 0; i < ${SHADOW_BLOCKER_TAPS}; i ++ ) {
				vec2 tap = uv + apexVogel( i, ${SHADOW_BLOCKER_TAPS}, phi ) * ${SHADOW_SEARCH_TEXELS.toFixed(1)} * texel;
				float d = apexShadowDepth( map, tap );
				#ifdef USE_REVERSED_DEPTH_BUFFER
				float occluding = step( z, d );
				#else
				float occluding = step( d, z );
				#endif
				// Ignore the receiver's own depth (bias-sized differences).
				occluding *= step( 1e-5, abs( z - d ) );
				blockers += occluding;
				blockerDepth += occluding * d;
			}
			if ( blockers < 0.5 ) return 1.0;
			blockerDepth /= blockers;
			penumbra = clamp( abs( z - blockerDepth ) * radius * size.x, ${SHADOW_PENUMBRA_TEXELS.min.toFixed(1)}, ${SHADOW_PENUMBRA_TEXELS.max.toFixed(1)} );
		}
		float lit = 0.0;
		for ( int i = 0; i < ${SHADOW_FILTER_TAPS}; i ++ ) {
			vec2 tap = uv + apexVogel( i, ${SHADOW_FILTER_TAPS}, phi ) * penumbra * texel;
			lit += texture2DCompare( map, tap, z );
		}
		return lit * ( 1.0 / ${SHADOW_FILTER_TAPS}.0 );
	}
`;

/** Patched copy of three's `shadowmap_pars_fragment`. Throws when the r180
 * PCF_SOFT branch or the `getShadow` signature is no longer where expected. */
export function shadowFilterChunk(shadowPars: string) {
  if (shadowPars.includes('apexShadowFilter(')) return shadowPars;
  if (!PCF_SOFT_BRANCH.test(shadowPars) || shadowPars.split(GET_SHADOW).length !== 2)
    throw new Error('Unexpected three.js shadow map chunk');
  return shadowPars
    .replace(GET_SHADOW, `${FILTER_GLSL}\n${GET_SHADOW}`)
    .replace(
      PCF_SOFT_BRANCH,
      '$1\n\t\t\tshadow = apexShadowFilter( shadowMap, shadowMapSize, shadowRadius, shadowCoord.xy, shadowCoord.z );\n$2',
    );
}

let installed = false;
/** Install once, at module scope, before any lit material compiles. */
export function installShadowFilter() {
  if (installed) return;
  T.ShaderChunk.shadowmap_pars_fragment = shadowFilterChunk(T.ShaderChunk.shadowmap_pars_fragment);
  installed = true;
}
