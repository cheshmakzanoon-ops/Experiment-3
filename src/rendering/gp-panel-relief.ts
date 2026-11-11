import * as T from 'three';
import type { BikeMaterials } from './bike.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';

/** Sub-millimetre panel relief for the GP race shell.
 *
 * The livery draws its panel seams, quick-release fasteners and louvre gills
 * as flat colour: they never catch a highlight. This hook reads a height
 * atlas that shares the livery's UVs (128 = flat paint; below it a groove or
 * recess, above it a raised fastener head or louvre blade) and bends BOTH the
 * base normal and the clear-coat normal by its screen-space gradient, so the
 * lacquer's mirror reflection breaks along a seam and glints on a fastener the
 * way a moulded panel's does. The clear coat has its own normal in three.js
 * (the orange-peel map), which three's own bump map would not touch.
 *
 * Gradients come from the height texture's own derivatives, so a face whose
 * side-view UVs collapse (the tank top) gets no relief and a distant panel
 * (mipped flat) shows none: there is nothing to shimmer. The strength uniform
 * is zero below High and skips the three texture reads. */
export const GP_PANEL_RELIEF = Object.freeze({
  /** Atlas height values (0-255): flat paint, and what the livery draws into it. */
  flat: 128,
  groove: 40,
  recess: 70,
  dome: 220,
  /** Metres of paint height per atlas unit (0..1): a groove 88/255 down is about 0.3 mm. */
  heightMetres: 0.0009,
});
export const GP_PANEL_RELIEF_HOOK = 'gp-panel-relief-v1';

const DECLARATIONS = /* glsl */ `
uniform sampler2D gpReliefMap;
uniform float gpReliefStrength;
vec2 gpReliefGradient( vec2 uv ) {
  vec2 dSTdx = dFdx( uv );
  vec2 dSTdy = dFdy( uv );
  float h = texture2D( gpReliefMap, uv ).x;
  float dBx = texture2D( gpReliefMap, uv + dSTdx ).x - h;
  float dBy = texture2D( gpReliefMap, uv + dSTdy ).x - h;
  return vec2( dBx, dBy ) * ${GP_PANEL_RELIEF.heightMetres.toFixed(5)} * gpReliefStrength;
}
vec3 gpReliefBend( vec3 n, vec2 dHdxy ) {
  vec3 sx = dFdx( - vViewPosition );
  vec3 sy = dFdy( - vViewPosition );
  vec3 r1 = cross( sy, n );
  vec3 r2 = cross( n, sx );
  float det = dot( sx, r1 );
  vec3 grad = sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 );
  return normalize( abs( det ) * n - grad );
}`;
const BASE = /* glsl */ `
vec2 gpReliefD = vec2( 0.0 );
#ifdef USE_MAP
if ( gpReliefStrength > 0.0 && gl_FrontFacing ) {
  gpReliefD = gpReliefGradient( vMapUv );
  normal = gpReliefBend( normal, gpReliefD );
}
#endif`;
const COAT = /* glsl */ `
#if defined( USE_MAP ) && defined( USE_CLEARCOAT )
if ( gpReliefStrength > 0.0 && gl_FrontFacing ) clearcoatNormal = gpReliefBend( clearcoatNormal, gpReliefD );
#endif`;

export interface GpPanelReliefUniforms {
  readonly gpReliefMap: T.IUniform<T.Texture>;
  readonly gpReliefStrength: T.IUniform<number>;
}
/** Chain the relief onto one painted physical material (needs its colour map's
 * UVs and a clear coat). `strength` is the shared on/off uniform. */
export function installGpPanelRelief(
  material: T.MeshPhysicalMaterial,
  relief: T.Texture,
): GpPanelReliefUniforms {
  const uniforms: GpPanelReliefUniforms = {
    gpReliefMap: { value: relief },
    gpReliefStrength: { value: 0 },
  };
  chainShaderHook(material, GP_PANEL_RELIEF_HOOK, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectDeclarations(shader, 'common', DECLARATIONS, 'fragment');
    injectAfter(shader, 'normal_fragment_maps', BASE, 'fragment');
    injectAfter(shader, 'clearcoat_normal_fragment_maps', COAT, 'fragment');
  });
  return uniforms;
}

/** Switch the entrant's livery relief with the graphics tier (per frame, idempotent). */
export function setGpPanelRelief(materials: Pick<BikeMaterials, 'list'>, enabled: boolean) {
  for (const material of materials.list) {
    const uniforms = material.userData.gpRelief as GpPanelReliefUniforms | undefined;
    if (uniforms) uniforms.gpReliefStrength.value = enabled ? 1 : 0;
  }
}
