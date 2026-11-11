import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

export const MX_ARENA_LIGHT_HOOK = 'mx-arena-floodlights-v1';

/** The roof's regular floodlight grid in world metres (`Stadium.lampGrid`). */
export interface MxArenaGrid {
  minX: number;
  minZ: number;
  spanX: number;
  spanZ: number;
  /** World height of the lamps. */
  y: number;
  columns: number;
  rows: number;
}

/** Floodlights of the supercross roof: 40 lamps on a regular 8 x 5 grid, each
 * lighting the dirt beneath it the way it hangs over it. The analytic lamp
 * rows used for circuit floodlights stand poles 9 m up; an arena's light comes
 * from 30 m overhead, in a grid, and the pools it leaves are broad overlapping
 * discs with soft valleys between them, not a row of tight spots. */
export const MX_ARENA_LIGHT = Object.freeze({
  /** Each lamp's intensity (cd-like units in the renderer's linear scale). */
  intensity: 2400,
  colour: 0xe6efff,
  /** A lamp lights the floor out to this many grid cells; beyond it, nothing. */
  reachCells: 2,
  /** Share of the directional key kept on the floor: the key stands for the
   * same lamps, seen from far away. */
  keyShare: 0.45,
});

const DECLARATIONS = /* glsl */ `
uniform vec4 mxArenaGrid;   // minX, minZ, cell X, cell Z (m)
uniform vec4 mxArenaLamp;   // columns, rows, lamp height (m), strength
uniform vec4 mxArenaColour; // linear colour x intensity, key share
// Irradiance (cos / r^2) summed over the 4 x 4 lamps around a floor point; each
// is faded to nothing at ${MX_ARENA_LIGHT.reachCells} cells so no cell edge shows.
float mxArenaIrradiance( vec3 world, vec3 up ) {
  vec2 cell = ( world.xz - mxArenaGrid.xy ) / mxArenaGrid.zw - 0.5;
  vec2 base = floor( cell );
  float e = 0.0;
  for ( int j = -1; j <= 2; j ++ ) {
    for ( int i = -1; i <= 2; i ++ ) {
      vec2 index = base + vec2( float( i ), float( j ) );
      if ( index.x < 0.0 || index.y < 0.0 || index.x >= mxArenaLamp.x || index.y >= mxArenaLamp.y ) continue;
      float reach = 1.0 - smoothstep( ${(MX_ARENA_LIGHT.reachCells * 0.5).toFixed(2)}, ${MX_ARENA_LIGHT.reachCells.toFixed(2)}, length( index - cell ) );
      vec3 lamp = vec3( mxArenaGrid.x + ( index.x + 0.5 ) * mxArenaGrid.z, mxArenaLamp.z,
        mxArenaGrid.y + ( index.y + 0.5 ) * mxArenaGrid.w );
      vec3 d = lamp - world;
      float r2 = dot( d, d );
      e += reach * max( dot( up, d ) * inversesqrt( r2 ), 0.0 ) / r2;
    }
  }
  return e;
}`;

const LIGHTING = /* glsl */ `
if ( mxArenaLamp.w > 0.0 ) {
  reflectedLight.directDiffuse *= mxArenaColour.a;
  vec3 arenaUp = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  reflectedLight.directDiffuse += mxArenaColour.rgb * ( mxArenaLamp.w * mxArenaIrradiance( vApexWorld, arenaUp ) )
    * BRDF_Lambert( material.diffuseColor );
}`;

/** Light a supercross floor from the roof's floodlight grid. The terrain soil
 * material supplies `vApexWorld`. The returned uniform's `.w` is the arena's
 * strength: 1 lit, 0 off (the material's other lighting is untouched at 0). */
export function installMxArenaLighting(material: T.MeshPhysicalMaterial, grid: MxArenaGrid) {
  const cellX = grid.spanX / grid.columns,
    cellZ = grid.spanZ / grid.rows;
  const colour = new T.Color(MX_ARENA_LIGHT.colour).convertSRGBToLinear();
  const lamp = { value: new T.Vector4(grid.columns, grid.rows, grid.y, 1) };
  const installed = chainShaderHook(material, MX_ARENA_LIGHT_HOOK, (shader) => {
    shader.uniforms.mxArenaGrid = { value: new T.Vector4(grid.minX, grid.minZ, cellX, cellZ) };
    shader.uniforms.mxArenaLamp = lamp;
    shader.uniforms.mxArenaColour = {
      value: new T.Vector4(
        colour.r * MX_ARENA_LIGHT.intensity,
        colour.g * MX_ARENA_LIGHT.intensity,
        colour.b * MX_ARENA_LIGHT.intensity,
        MX_ARENA_LIGHT.keyShare,
      ),
    };
    injectDeclarations(shader, 'common', DECLARATIONS, 'fragment');
    injectAfter(shader, 'lights_fragment_end', LIGHTING, 'fragment');
  });
  return installed ? lamp : null;
}
