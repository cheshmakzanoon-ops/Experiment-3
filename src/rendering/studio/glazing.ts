import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './shader-hooks.ts';

/**
 * Venue glazing (D26 venue-architecture). The district and paddock windows
 * were an opaque teal panel. Now they are dark, smooth glass that mirrors the
 * sky (roughness 0.04, F0 0.04, environment ×1.4) with a cheap parallax
 * interior: rooms on a `ROOM` grid behind the pane, whose ceiling light strip,
 * back wall and floor are found by marching the view ray through the room in
 * world space. The interior shows most at normal incidence and fades to the
 * reflection at grazing angles (Fresnel); no transmission pass, no textures,
 * 0 draw calls.
 */
export const GLAZING = Object.freeze({
  color: 0x0f1a1f,
  roughness: 0.04,
  metalness: 0,
  envMapIntensity: 1.4,
  /** Room size (width, height, depth) in metres. */
  room: Object.freeze([4.0, 3.5, 5.0] as const),
});

const f = (v: number) => v.toFixed(3);
const INTERIOR = /* glsl */ `{
	// D26 parallax interior: march into a room behind the pane.
	vec3 viewDir = normalize( vGlassWorld - cameraPosition );
	vec3 n = normalize( vGlassNormal );
	float facing = clamp( -dot( viewDir, n ), 0.0, 1.0 );
	// Room cells in world space; the ray enters through the pane.
	vec3 room = vec3( ${f(GLAZING.room[0])}, ${f(GLAZING.room[1])}, ${f(GLAZING.room[0])} );
	vec3 p = vGlassWorld / room;
	vec3 d = viewDir / room;
	vec3 cell = floor( p );
	vec3 parallel = step( abs( d ), vec3( 1e-4 ) );
	vec3 safeD = mix( d, vec3( 1e-4 ), parallel );
	vec3 tWall = mix( ( cell + step( 0.0, d ) - p ) / safeD, vec3( 1e4 ), parallel );
	float t = min( tWall.x, min( tWall.y, tWall.z ) );
	vec3 hit = p + d * t;
	float ceiling = step( tWall.y, min( tWall.x, tWall.z ) ) * step( 0.0, d.y );
	float floorHit = step( tWall.y, min( tWall.x, tWall.z ) ) * step( d.y, 0.0 );
	// Lit ceiling strips, warm walls, darker floor; each room its own tone.
	float roomHash = fract( sin( dot( cell, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
	float lit = step( 0.35, roomHash );
	vec3 wall = mix( vec3( 0.05, 0.05, 0.048 ), vec3( 0.16, 0.15, 0.13 ), lit );
	vec3 interior = wall;
	interior = mix( interior, vec3( 0.03, 0.03, 0.032 ), floorHit );
	float strip = 1.0 - smoothstep( 0.04, 0.08, abs( fract( hit.x + hit.z ) - 0.5 ) );
	interior = mix( interior, mix( vec3( 0.09 ), vec3( 0.9, 0.86, 0.75 ) * 1.4, strip * lit ), ceiling );
	interior *= 0.55 + 0.45 * smoothstep( 0.0, 1.2, t );
	glassInterior = interior * facing * facing;
}`;

export const GLAZING_HOOK = 'venue-glazing-v1';
/** Turn a venue glass material into reflective glazing with a parallax interior. */
export function installGlazing(material: T.MeshPhysicalMaterial) {
  material.color.setHex(GLAZING.color);
  material.roughness = GLAZING.roughness;
  material.metalness = GLAZING.metalness;
  material.envMapIntensity = GLAZING.envMapIntensity;
  material.clearcoat = 0;
  material.ior = 1.5;
  return chainShaderHook(material, GLAZING_HOOK, (shader) => {
    injectDeclarations(
      shader,
      'common',
      'varying vec3 vGlassWorld;\nvarying vec3 vGlassNormal;',
      'vertex',
    );
    injectAfter(
      shader,
      'project_vertex',
      `{
	vec4 glassWorld = vec4( transformed, 1.0 );
	vec3 glassNormal = objectNormal;
	#ifdef USE_INSTANCING
	glassWorld = instanceMatrix * glassWorld;
	glassNormal = mat3( instanceMatrix ) * glassNormal;
	#endif
	vGlassWorld = ( modelMatrix * glassWorld ).xyz;
	vGlassNormal = mat3( modelMatrix ) * glassNormal;
}`,
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      'varying vec3 vGlassWorld;\nvarying vec3 vGlassNormal;\nvec3 glassInterior = vec3( 0.0 );',
      'fragment',
    );
    injectAfter(shader, 'color_fragment', INTERIOR, 'fragment');
    injectAfter(
      shader,
      'emissivemap_fragment',
      '// The interior is seen through the glass: it is added as radiance.\ntotalEmissiveRadiance += glassInterior;',
      'fragment',
    );
  });
}
