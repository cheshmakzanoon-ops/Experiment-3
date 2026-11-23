import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { MX_LAMP_OPTICS } from './mx-floodlight.ts';
import { STADIUM } from './stadium-dimensions.ts';

export const MX_ARENA_LIGHT_HOOK = 'mx-arena-floodlights-v2';

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
  // Balanced against the evening arena look's stronger shadowed key: the
  // pools still shape the floor, but the riders' key shadows now read on it.
  intensity: 1700,
  colour: 0xe6efff,
  /** A lamp lights the floor out to this many grid cells; beyond it, nothing. */
  reachCells: 2,
  /** Share of the directional key kept on the floor: the key stands for the
   * same lamps, seen from far away. */
  keyShare: 0.75,
});

// Three decodes an sRGB hex swatch into scene-linear RGB when constructing the Color.
export const MX_ARENA_LAMP_LINEAR = new T.Color(MX_ARENA_LIGHT.colour);

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
}
#ifdef MX_HIGH_DETAIL
// Intersect the reflected view ray with the real roof. Only one housing can
// occupy the narrow image of a water film. The halo reaches zero before the
// midway plane so selecting the next bank cannot create a hard seam.
float mxArenaFloorReflection(vec3 world, vec3 up, vec3 eye, float film) {
  vec3 ray = reflect(-eye, up);
  if (ray.y <= .035 || world.y >= mxArenaLamp.z || film <= .01) return 0.;
  float distanceToRoof = (mxArenaLamp.z - world.y) / ray.y;
  vec2 hit = world.xz + ray.xz * distanceToRoof;
  vec2 cell = (hit - mxArenaGrid.xy) / mxArenaGrid.zw;
  vec2 bank = floor(cell);
  if (any(lessThan(bank, vec2(0.))) || any(greaterThanEqual(bank, mxArenaLamp.xy))) return 0.;
  vec2 offset = (fract(cell) - .5) * mxArenaGrid.zw;
  float field = max(abs(offset.x) / mxArenaGrid.z, abs(offset.y) / mxArenaGrid.w);
  float fade = 1. - smoothstep(.33, .5, field);
  // Water spreads the lights by their angular roughness. Unresolved lens
  // area is conserved as the highlight broadens across a rougher patch.
  float radius = ${MX_LAMP_OPTICS.radius.toFixed(3)};
  float blur = min(distanceToRoof * mix(.038, .009, film), min(mxArenaGrid.z, mxArenaGrid.w) * .19);
  float width2 = radius * radius + blur * blur;
  vec2 toCentre = (.5 * mxArenaLamp.xy - bank - .5) * mxArenaGrid.zw;
  vec3 aim = normalize(vec3(toCentre.x * ${MX_LAMP_OPTICS.inwardAim}, -${(STADIUM.roof - MX_LAMP_OPTICS.belowRoof - MX_LAMP_OPTICS.focusHeight).toFixed(2)}, toCentre.y * ${MX_LAMP_OPTICS.inwardAim}));
  // Rotate local X by the mounting quaternion (down to aim), then project
  // the tilted lens row into the same horizontal plane as the ray hit.
  vec3 axis = vec3(1. - aim.x * aim.x / (1. - aim.y), aim.x, -aim.z * aim.x / (1. - aim.y));
  vec2 along = ${MX_LAMP_OPTICS.pitch.toFixed(2)} * (axis.xz - ray.xz * (axis.y / ray.y));
  float lobes = exp(-dot(offset - along, offset - along) / width2)
              + exp(-dot(offset, offset) / width2)
              + exp(-dot(offset + along, offset + along) / width2);
  float facing = clamp(dot(up, eye), 0., 1.);
  float fresnel = .0204 + .9796 * pow(1. - facing, 5.);
  return fade * film * fresnel * max(0., dot(aim, -ray)) * (radius * radius / width2) * lobes;
}
#endif`;

const LIGHTING = /* glsl */ `
if ( mxArenaLamp.w > 0.0 ) {
  reflectedLight.directDiffuse *= mxArenaColour.a;
  vec3 arenaUp = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  reflectedLight.directDiffuse += mxArenaColour.rgb * ( mxArenaLamp.w * mxArenaIrradiance( vApexWorld, arenaUp ) )
    * BRDF_Lambert( material.diffuseColor );
  #if defined(MX_HIGH_DETAIL) && defined(MX_SOIL_HAS_WATER_FILM)
  // Arena groomers water the racing line under the roof. Compact, polished
  // clay can catch a broad glint before enough water collects for a puddle.
  float dampTrack = .58 * smoothstep(.32, .55, mxPreparedWet)
    * smoothstep(.24, .82, mxPreparedPacked) * mxPreparedGroove
    * clamp(vMxCourse.z, 0., 1.);
  float gloss = max(mxMorphFilm, dampTrack);
  if (gloss > .01) {
    vec3 pooledNormal = normalize(mix(normal, nonPerturbedNormal, gloss * .72));
    vec3 filmUp = normalize((vec4(pooledNormal, 0.) * viewMatrix).xyz);
    vec3 eye = normalize((vec4(geometryViewDir, 0.) * viewMatrix).xyz);
    reflectedLight.directSpecular += mxArenaColour.rgb * (mxArenaLamp.w *
      ${(MX_LAMP_OPTICS.radiance / MX_ARENA_LIGHT.intensity).toFixed(8)} *
      mxArenaFloorReflection(vApexWorld, filmUp, eye, gloss));
  }
  #endif
}`;

/** Light a supercross floor from the roof's floodlight grid. The terrain soil
 * material supplies `vApexWorld`. The returned uniform's `.w` is the arena's
 * strength: 1 lit, 0 off (the material's other lighting is untouched at 0). */
export function installMxArenaLighting(material: T.MeshPhysicalMaterial, grid: MxArenaGrid) {
  const cellX = grid.spanX / grid.columns,
    cellZ = grid.spanZ / grid.rows;
  const lamp = { value: new T.Vector4(grid.columns, grid.rows, grid.y, 1) };
  const installed = chainShaderHook(material, MX_ARENA_LIGHT_HOOK, (shader) => {
    shader.uniforms.mxArenaGrid = { value: new T.Vector4(grid.minX, grid.minZ, cellX, cellZ) };
    shader.uniforms.mxArenaLamp = lamp;
    shader.uniforms.mxArenaColour = {
      value: new T.Vector4(
        MX_ARENA_LAMP_LINEAR.r * MX_ARENA_LIGHT.intensity,
        MX_ARENA_LAMP_LINEAR.g * MX_ARENA_LIGHT.intensity,
        MX_ARENA_LAMP_LINEAR.b * MX_ARENA_LIGHT.intensity,
        MX_ARENA_LIGHT.keyShare,
      ),
    };
    injectDeclarations(shader, 'common', DECLARATIONS, 'fragment');
    injectAfter(shader, 'lights_fragment_end', LIGHTING, 'fragment');
  });
  return installed ? lamp : null;
}

/** The lit clay returns light to the underside of the roof. Its finite extent
 * leaves less fill over the grandstands. The nearest lamp bank adds a cooler
 * spill to the steel immediately above its housing. Both terms are stationary
 * in the venue and use the existing structural batches. */
export function installMxRoofBounce(material: T.MeshStandardMaterial, grid: MxArenaGrid) {
  chainShaderHook(material, 'mx-roof-bounce-v1', (shader) => {
    shader.uniforms.mxRoofFloor = {
      value: new T.Vector4(grid.minX, grid.minZ, grid.spanX, grid.spanZ),
    };
    // A downward Lambertian bank emits pi times its axial intensity. Divide
    // total flux by the floor's area to estimate the mean incident light.
    const floorIrradiance =
      (Math.PI * MX_ARENA_LIGHT.intensity * grid.columns * grid.rows) / (grid.spanX * grid.spanZ);
    shader.uniforms.mxRoofBanks = {
      value: new T.Vector4(grid.columns, grid.rows, grid.y, floorIrradiance),
    };
    injectDeclarations(shader, 'common', 'varying vec3 vMxRoofWorld;', 'vertex');
    injectAfter(
      shader,
      'worldpos_vertex',
      'vMxRoofWorld = (modelMatrix * vec4(transformed, 1.)).xyz;',
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      /* glsl */ `
varying vec3 vMxRoofWorld;
uniform vec4 mxRoofFloor;
uniform vec4 mxRoofBanks;`,
      'fragment',
    );
    injectAfter(
      shader,
      'lights_fragment_end',
      /* glsl */ `{
  vec3 up = normalize((vec4(normal, 0.) * viewMatrix).xyz);
  vec2 p = vMxRoofWorld.xz - mxRoofFloor.xy;
  float height = max(vMxRoofWorld.y - mxRoofBanks.z + ${(STADIUM.roof - MX_LAMP_OPTICS.belowRoof).toFixed(2)}, 1.);
  vec2 farEdge = mxRoofFloor.zw - p;
  // Project opposite edges of the illuminated floor onto the two vertical planes.
  vec2 extent = .5 * (p * inversesqrt(p*p + height*height) + farEdge * inversesqrt(farEdge*farEdge + height*height));
  float floorView = extent.x * extent.y * (.5 - .5 * up.y);
  vec2 cell = mxRoofFloor.zw / mxRoofBanks.xy;
  vec2 lamp = (clamp(floor(p / cell), vec2(0.), mxRoofBanks.xy - 1.) + .5) * cell;
  vec3 delta = vec3(lamp.x - p.x, mxRoofBanks.z - vMxRoofWorld.y, lamp.y - p.y);
  float dist2 = max(dot(delta, delta), .01);
  float spill = max(dot(up, delta) * inversesqrt(dist2), 0.) / (1. + .11 * dist2);
  vec3 bounce = vec3(.20, .17, .15) * (mxRoofBanks.w * floorView) + vec3(.50, .64, .78) * spill;
  bounce *= smoothstep(12., 23., height);
  reflectedLight.indirectDiffuse += BRDF_Lambert(material.diffuseColor) * bounce;
  reflectedLight.indirectSpecular += .09 * material.roughness * material.specularColor * bounce;
}`,
      'fragment',
    );
  });
}
