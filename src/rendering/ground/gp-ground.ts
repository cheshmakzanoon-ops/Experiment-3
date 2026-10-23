import type * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/**
 * Verge turf and gravel traps of the motorcycle-GP venues only (the venue
 * kit installs these on its GP palette; every other venue keeps its own
 * materials and programs). Presentation only: where the physics reads grass
 * or gravel is unchanged.
 *
 * Gravel (REF_002, 004, 044, 045): a light, warm, washed river gravel, and a
 * trap that ends in an irregular, scattered edge instead of the 4 m quad
 * staircase. The venue kit extends a GP trap's ribbon one quad into the
 * neighbouring grass with a per-vertex `gravelCover` (1 over the physical
 * trap, 0 beyond it); fragments whose cover falls below a world-space
 * threshold field are discarded, so the stones thin out over the grass in
 * drifts. Inside the physical trap the cover is 1 and nothing is cut.
 *
 * Turf (REF_019, 033, 046): sun-dried summer grass — less saturated and
 * warmer than a lawn, with metre-scale dry and lush patches and the mower's
 * passes reading a little more strongly near the track.
 */
export const GP_GRAVEL = Object.freeze({
  /** Albedo ratio over the D19 river gravel (#8f8470): lighter and warmer. */
  tint: Object.freeze([1.16, 1.1, 0.98] as const),
  /** Threshold field: scales (m) of the drifts and of the scattered stones. */
  drift: 2.3,
  scatter: 0.11,
});
export const GP_TURF = Object.freeze({
  /** Share of the turf's chroma kept, and the warm shift. */
  saturation: 0.8,
  warm: Object.freeze([1.04, 1.0, 0.9] as const),
  /** Dry patches: scale (m), coverage threshold and tint. */
  dryScale: 7.5,
  dryThreshold: Object.freeze([0.56, 0.8] as const),
  dryTint: Object.freeze([1.2, 1.1, 0.78] as const),
  /** Lush (darker) patches: scale (m) and darkening. */
  lushScale: 12,
  lushDarkening: 0.13,
});

const v3 = (v: readonly number[]) => `vec3(${v.map((x) => x.toFixed(4)).join(', ')})`;
const f = (v: number) => v.toFixed(4);

/** GP gravel trap tint and scattered edge (after `installGravelFinish` and
 * `installScannedGravel`; the ribbon must carry `gravelCover`). */
export function installGpGravel(material: T.MeshStandardMaterial) {
  const G = GP_GRAVEL;
  material.userData.gpGravel = true;
  return chainShaderHook(material, 'gp-gravel-v1', (shader) => {
    injectDeclarations(
      shader,
      'common',
      'attribute float gravelCover; varying float vGravelCover;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vGravelCover = gravelCover;', 'vertex');
    injectDeclarations(shader, 'common', 'varying float vGravelCover;', 'fragment');
    injectAfter(
      shader,
      'color_fragment',
      `{
	// Drifts of stones over the grass beyond the physical trap.
	if ( vGravelCover < 0.999 ) {
		float drift = apexGravelNoise( vGravelWorld.xz / ${f(G.drift)} + vec2( 5.3, 1.9 ) );
		float stones = apexGravelNoise( vGravelWorld.xz / ${f(G.scatter)} + vec2( 2.1, 8.7 ) );
		if ( vGravelCover < 0.12 + 0.62 * drift + 0.3 * ( stones - 0.5 ) ) discard;
	}
	diffuseColor.rgb *= ${v3(G.tint)};
}`,
      'fragment',
    );
  });
}

/** GP verge turf (after the circuit 'grass' finish, scanned turf and verge
 * finish, which provide `vFinishWorld` and `finishFilteredNoise`). */
export function installGpTurf(material: T.MeshStandardMaterial) {
  const G = GP_TURF;
  return chainShaderHook(material, 'gp-turf-v1', (shader) => {
    injectAfter(
      shader,
      'color_fragment',
      `{
	float turfLuma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	diffuseColor.rgb = mix( vec3( turfLuma ), diffuseColor.rgb, ${f(G.saturation)} ) * ${v3(G.warm)};
	float turfDry = smoothstep( ${f(G.dryThreshold[0])}, ${f(G.dryThreshold[1])},
		finishFilteredNoise( vFinishWorld.xz / ${f(G.dryScale)} + vec2( 7.7, 3.1 ) ) * 0.7 +
		finishFilteredNoise( vFinishWorld.xz / ${f(G.dryScale * 0.23)} + vec2( 1.3, 9.4 ) ) * 0.3 );
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * ${v3(G.dryTint)}, turfDry * 0.6 );
	float turfLush = smoothstep( 0.6, 0.85, finishFilteredNoise( vFinishWorld.xz / ${f(G.lushScale)} + vec2( 4.4, 6.2 ) ) );
	diffuseColor.rgb *= 1.0 - ${f(G.lushDarkening)} * turfLush;
}`,
      'fragment',
    );
  });
}
