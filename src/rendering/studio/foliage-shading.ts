import type * as T from 'three';
import { chainShaderHook, injectAfter, injectBefore } from './shader-hooks.ts';
import { useStudioUniforms } from './studio-frame.ts';

/**
 * Canopy shading and wind for card foliage (D11 forest-vegetation).
 *
 * Shading (colour materials only):
 *  - canopy grade: the lit albedo is pulled toward the dark olive canopy of a
 *    real forest (`CANOPY.color`, linear), keeping `CANOPY.keep` of its own
 *    chroma, so the lime of a sRGB leaf atlas reads as mature summer foliage;
 *  - translucency: sunlight through the leaves when the camera looks toward
 *    the sun, `CANOPY.translucency · pow(sat(dot(-V, L)), 4)`, tinted by the
 *    leaf colour and gated by the crown's own shadow term;
 *  - the existing crown occlusion (instance colour) is kept.
 *
 * Wind (colour, depth and distance materials alike, so shadows stay attached):
 * trunk sway `0.015 · H · hn²` metres along the wind (H tree height, hn
 * normalised height) at 0.6 rad/s with a per-tree phase from the instance
 * position, plus a 2 cm, 3 Hz flutter of the crown. Driven by `studioWind`
 * (presented wind and simulation time): held frames are identical.
 */
export const CANOPY = Object.freeze({
  /** Linear canopy colour the albedo is pulled toward (#3f4b3e display). */
  color: Object.freeze([0.0497, 0.0685, 0.0482] as const),
  /** Share of the original albedo's colour kept. */
  keep: 0.38,
  translucency: 0.35,
  sway: 0.015,
  swayRate: 0.6,
  flutter: 0.02,
  flutterHz: 3,
});

const f = (v: number) => v.toFixed(4);

const SHADE = /* glsl */ `{
	// D11 canopy grade: toward a deep olive canopy, keeping some leaf variation.
	vec3 canopyTarget = vec3( ${CANOPY.color.map(f).join(', ')} );
	float canopyLuma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	float targetLuma = dot( canopyTarget, vec3( 0.2126, 0.7152, 0.0722 ) );
	vec3 graded = canopyTarget * ( canopyLuma / max( targetLuma, 1e-4 ) );
	diffuseColor.rgb = mix( graded, diffuseColor.rgb, ${f(CANOPY.keep)} );
}`;

const TRANSLUCENCY = /* glsl */ `
#if NUM_DIR_LIGHTS > 0
{
	// D11 leaf translucency toward the sun (light 0 is the sun).
	vec3 sunView = normalize( ( viewMatrix * vec4( studioSunDir, 0.0 ) ).xyz );
	float back = pow( saturate( dot( - normalize( vViewPosition ), sunView ) ), 4.0 );
	reflectedLight.directDiffuse += ${f(CANOPY.translucency)} * back * diffuseColor.rgb * directionalLights[ 0 ].color;
}
#endif`;

const WIND = /* glsl */ `
#ifdef USE_INSTANCING
{
	// D11 wind: trunk sway along the wind and a small crown flutter.
	float treeHeight = length( instanceMatrix[ 1 ].xyz );
	float treeWidth = max( length( instanceMatrix[ 0 ].xyz ), 1e-3 );
	float hn = clamp( transformed.y, 0.0, 1.2 );
	vec2 windXZ = studioWind.xy;
	float windSpeed = length( windXZ );
	vec2 windDir = windSpeed > 1e-3 ? windXZ / windSpeed : vec2( 0.7071, 0.7071 );
	float strength = clamp( windSpeed / 8.0, 0.15, 1.5 ) * ( 0.55 + 0.45 * studioWind.w );
	float phase = dot( instanceMatrix[ 3 ].xz, vec2( 0.37, 0.61 ) );
	float sway = ${f(CANOPY.sway)} * treeHeight * hn * hn * sin( ${f(CANOPY.swayRate)} * studioWind.z + phase ) * strength;
	float flutter = ${f(CANOPY.flutter)} * hn * sin( ${f(CANOPY.flutterHz * 2 * Math.PI)} * studioWind.z + phase * 7.0 + dot( transformed, vec3( 9.1, 5.3, 7.7 ) ) ) * strength;
	// Instance space is scaled by the tree's width across: metres / width.
	mat3 toLocal = transpose( mat3( normalize( instanceMatrix[ 0 ].xyz ), normalize( instanceMatrix[ 1 ].xyz ), normalize( instanceMatrix[ 2 ].xyz ) ) );
	vec3 worldOffset = vec3( windDir.x, 0.0, windDir.y ) * ( sway + flutter );
	transformed += toLocal * worldOffset / treeWidth;
}
#endif`;

export const FOLIAGE_SHADING_HOOK = 'foliage-shading-v1';
export const FOLIAGE_WIND_HOOK = 'foliage-wind-v1';

/** Canopy grade and translucency on a lit foliage colour material. */
export function installFoliageShading(material: T.Material) {
  return chainShaderHook(material, FOLIAGE_SHADING_HOOK, (shader) => {
    useStudioUniforms(shader, ['studioSunDir'], 'fragment');
    injectAfter(shader, 'color_fragment', SHADE, 'fragment');
    injectAfter(shader, 'lights_fragment_end', TRANSLUCENCY, 'fragment');
  });
}

/** Wind sway on an instanced foliage material (colour, depth or distance). */
export function installFoliageWind(material: T.Material) {
  return chainShaderHook(material, FOLIAGE_WIND_HOOK, (shader) => {
    useStudioUniforms(shader, ['studioWind'], 'vertex');
    injectBefore(shader, 'project_vertex', WIND, 'vertex');
  });
}

/** CPU reference of the sway displacement (metres along the wind) at the top
 * of a tree of `height` metres, for tests and budgets. */
export function foliageSwayAmplitude(height: number, windSpeed: number, gust: number) {
  const strength = Math.min(1.5, Math.max(0.15, windSpeed / 8)) * (0.55 + 0.45 * gust);
  return CANOPY.sway * height * strength + CANOPY.flutter * strength;
}
