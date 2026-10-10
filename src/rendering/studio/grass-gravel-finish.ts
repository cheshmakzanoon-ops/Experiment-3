import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './shader-hooks.ts';

/**
 * Grass and gravel (D19 ground-cover).
 *
 * Grass (in the circuit's 'grass' finish): the shared 89/101/53 texels are
 * tinted to an olive #6c7438 albedo (sunlit render #7f8444-#8e8a4c instead of
 * the saturated #4e6e2d), mown in 4 m bands at ±6 %, with ±12 % regional
 * variation at 25 m and 90 m and sparse dry patches.
 *
 * Gravel (#b9a98a): Voronoi pebbles at 50 cells per metre with dark cavities
 * between them and raked furrows every 0.3 m along the lap, all filtered to
 * their mean before a pixel spans a pebble. World-space and lap-space, so
 * stable in motion; 0 draw calls.
 */
// KPI 9 iteration: the rendered turf read #6d7937 at saturation 0.54 (target
// #7f8444-#8e8a4c, 0.33-0.47). A lighter, greyer olive albedo #808054 renders
// about #868553 in the day sun (shots/kpi-iteration-v1/v2).
export const GRASS_TINT = Object.freeze([2.17, 1.66, 2.46] as const);
export const GRASS_MOW_METRES = 4;
export const GRASS_MOW_CONTRAST = 0.06;
export const GRASS_DETAIL_GLSL = /* glsl */ `
    // D19 regional turf variation (25 m, 90 m) and dry patches.
    float turf25=finishFilteredNoise(vFinishWorld.xz/25.0+vec2(4.1,2.7));
    float turf90=finishFilteredNoise(vFinishWorld.xz/90.0+vec2(9.3,5.2));
    diffuseColor.rgb *= 1.0+.12*(turf25-.5)*2.0*.5+.12*(turf90-.5)*2.0*.5;
    float dryPatch=smoothstep(.66,.8,finishFilteredNoise(vFinishWorld.xz/14.0+vec2(1.7,8.3)));
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.16,1.06,.78),dryPatch*.6);
`;

export const GRAVEL = Object.freeze({
  color: 0xb9a98a,
  cellsPerMetre: 50,
  furrowMetres: 0.3,
  cavity: 0.55,
});

const f = (v: number) => v.toFixed(4);
const GRAVEL_GLSL = /* glsl */ `{
	// D19 gravel: Voronoi pebbles, dark cavities, raked furrows along the lap.
	vec2 p = vGravelWorld.xz * ${f(GRAVEL.cellsPerMetre)};
	vec2 cell = floor( p ), local = fract( p );
	float nearest = 8.0, second = 8.0, shade = 0.5;
	for ( int j = -1; j <= 1; j ++ )
		for ( int i = -1; i <= 1; i ++ ) {
			vec2 o = vec2( float( i ), float( j ) );
			vec2 h = fract( sin( vec2( dot( cell + o, vec2( 127.1, 311.7 ) ), dot( cell + o, vec2( 269.5, 183.3 ) ) ) ) * 43758.5453 );
			float d = length( o + h - local );
			if ( d < nearest ) { second = nearest; nearest = d; shade = h.x; }
			else if ( d < second ) second = d;
		}
	float edge = second - nearest;
	float footprint = max( length( dFdx( p ) ), length( dFdy( p ) ) );
	float resolve = 1.0 - smoothstep( 0.35, 1.2, footprint );
	float cavity = mix( 0.82, 1.0 - ${f(GRAVEL.cavity)} * ( 1.0 - smoothstep( 0.0, 0.18, edge ) ), resolve );
	float stone = mix( 1.0, 0.82 + 0.36 * shade, resolve );
	float furrowPhase = vGravelMetres.x / ${f(GRAVEL.furrowMetres)};
	float furrowAA = fwidth( furrowPhase );
	float furrow = mix( 0.5, 0.5 + 0.5 * cos( furrowPhase * 6.2831853 ), 1.0 - smoothstep( 0.3, 1.0, furrowAA ) );
	diffuseColor.rgb = gravelColour * cavity * stone * ( 0.9 + 0.12 * furrow );
	gravelRelief = ( 1.0 - furrow ) * 0.012 * ( 1.0 - smoothstep( 0.3, 1.0, furrowAA ) );
}`;

export const GRAVEL_HOOK = 'gravel-finish-v1';
/** Install the gravel finish on the gravel ribbon material. */
export function installGravelFinish(material: T.MeshStandardMaterial) {
  material.color.setHex(0xffffff);
  const uniforms = { gravelColour: { value: new T.Color(GRAVEL.color) } };
  return chainShaderHook(material, GRAVEL_HOOK, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectDeclarations(
      shader,
      'common',
      'varying vec3 vGravelWorld;\nvarying vec2 vGravelMetres;',
      'vertex',
    );
    injectAfter(
      shader,
      'project_vertex',
      'vGravelWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvGravelMetres = uv * 5.0;',
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      `varying vec3 vGravelWorld;\nvarying vec2 vGravelMetres;\nuniform vec3 gravelColour;\nfloat gravelRelief = 0.0;
vec3 apexGravelRelief( vec3 n, float h ) {
	vec3 sx = dFdx( - vViewPosition ), sy = dFdy( - vViewPosition );
	vec3 r1 = cross( sy, n ), r2 = cross( n, sx );
	float det = dot( sx, r1 );
	vec3 grad = sign( det ) * ( dFdx( h ) * r1 + dFdy( h ) * r2 );
	return normalize( max( abs( det ), 1e-10 ) * n - grad );
}`,
      'fragment',
    );
    injectAfter(shader, 'map_fragment', GRAVEL_GLSL, 'fragment');
    injectAfter(
      shader,
      'normal_fragment_maps',
      'normal = apexGravelRelief( normal, gravelRelief );',
      'fragment',
    );
  });
}
