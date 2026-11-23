import * as T from 'three';
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
export function installGpGravel(material: T.MeshStandardMaterial, landform = 'hills') {
  const G = GP_GRAVEL;
  material.userData.gpGravel = true;
  // One material program for the four locally dressed beds. Neutral limestone,
  // coastal greys and the warmer sierra use the same measured grain sizes.
  const mineral = new T.Vector3(1, 1, 1);
  if (landform === 'coast') mineral.set(.92, .99, 1.08);
  else if (landform === 'flat') mineral.set(.95, .99, 1.035);
  else if (landform === 'rolling') mineral.set(1.10, .98, .90);
  return chainShaderHook(material, 'gp-gravel-v2', (shader) => {
    shader.uniforms.gpTrapMineral = {value: mineral};
    injectDeclarations(
      shader,
      'common',
      'attribute float gravelCover; attribute float gpTrapInset; varying float vGravelCover; varying float vGpTrapInset;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vGravelCover = gravelCover; vGpTrapInset = gpTrapInset;', 'vertex');
    // A GP trap's two stone sizes only need a neighbourhood search while their
    // filtered contribution is nonzero. The sky and a telephoto camera can put
    // very different footprints on the same part of the trap.
    injectDeclarations(
      shader,
      'common',
      '#define APEX_GP_GRAVEL\nuniform vec3 gpTrapMineral; varying float vGravelCover; varying float vGpTrapInset;',
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `{
	// Tines fan slightly with the tractor's steering. Broader overlaps stay
	// visible after the individual teeth disappear in a grazing camera view.
	float station = vGravelMetres.y;
	float pass = vGpTrapInset + .26*sin(.054*station) + .12*sin(.097*station+.8);
	float sweep = pass / 3.25;
	float broadAA = fwidth(sweep);
	float swath = cos(6.2831853*sweep)*(1.-smoothstep(.20,.52,broadAA));
	float tine = pass/.16 + .15*sin(station*.65);
	float tineAA = fwidth(tine);
	float tines = cos(6.2831853*tine)*(1.-smoothstep(.16,.48,tineAA));
	float graded = smoothstep(.22,.92,vGpTrapInset)*smoothstep(.82,.99,vGravelCover);
	// A packed shoulder and a small ridge of displaced stone repeat at the
	// edge of consecutive passes. Relief remains metric on grades and banks.
	float shoulder = 1.-smoothstep(.05,.9,vGpTrapInset);
	gravelRelief += graded*(.0047*tines+.009*swath);
	diffuseColor.rgb *= gpTrapMineral * (1.+graded*(.043*swath+.023*tines)-.085*shoulder);
	// Neighbouring fragments can straddle the edge. Take derivatives before
	// branching on coverage, including at grazing angles in an onboard view.
	float gpGravelPixel = max( length( dFdx( vGravelWorld.xz ) ), length( dFdy( vGravelWorld.xz ) ) );
	if ( vGravelCover < 0.999 ) {
		float drift = apexGravelNoiseAt( vGravelWorld.xz / ${f(G.drift)} + vec2( 5.3, 1.9 ), gpGravelPixel / ${f(G.drift)} );
		float stones = apexGravelNoiseAt( vGravelWorld.xz / ${f(G.scatter)} + vec2( 2.1, 8.7 ), gpGravelPixel / ${f(G.scatter)} );
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
    injectDeclarations(shader, 'common',
      'attribute vec4 gpBankWalkway; varying vec4 vGpBankWalkway;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vGpBankWalkway = gpBankWalkway;', 'vertex');
    injectDeclarations(shader, 'common', 'varying vec4 vGpBankWalkway;', 'fragment');
    // Across the infield of a hairpin, the nearest station can jump to the
    // opposite straight or stay constant along an entire triangle. Retain
    // that station for racing infrastructure. Tile the grass in world metres.
    injectAfter(shader, 'uv_vertex', `
      #if defined(USE_MAP) || defined(USE_BUMPMAP) || defined(USE_ROUGHNESSMAP) || defined(USE_NORMALMAP)
        vec3 gpTurfUv = vec3((modelMatrix * vec4(position, 1.)).xz * .2, 1.);
        #ifdef USE_MAP
          vMapUv = (mapTransform * gpTurfUv).xy;
        #endif
        #ifdef USE_BUMPMAP
          vBumpMapUv = (bumpMapTransform * gpTurfUv).xy;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = (roughnessMapTransform * gpTurfUv).xy;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv = (normalMapTransform * gpTurfUv).xy;
        #endif
      #endif
    `, 'vertex');
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
	// The bank mesh carries its dimensions. Ordinary verges have zero in Z.
	if (vGpBankWalkway.z > 0.) {
		vec2 p = vGpBankWalkway.xy;
		float width = vGpBankWalkway.z, lengthZ = vGpBankWalkway.w;
		float ruffle = .36 * (finishFilteredNoise(vFinishWorld.xz / .83) - .5);
		float crossPath = abs(p.y - 3. - .24 * sin(.36 * p.x)) + ruffle;
		float servicePath = abs(p.x - .55 * width - .22 * sin(.17 * p.y)) + ruffle;
		float crossReach = smoothstep(-.96 * width, -.76 * width, p.x)
			* (1. - smoothstep(.60 * width, .88 * width, p.x));
		float serviceReach = 1. - smoothstep(.72 * lengthZ, .94 * lengthZ, abs(p.y));
		float traffic = max((1. - smoothstep(.26, 1.32, crossPath)) * crossReach,
			(1. - smoothstep(.19, 1.05, servicePath)) * serviceReach);
		float clods = finishFilteredNoise(vFinishWorld.xz / .14);
		float grass = smoothstep(.30, .75, clods + .46 * (1. - traffic));
		// Flattened stems remain along the edges. The core exposes mineral
		// soil between surviving tufts. All three receive the turf lighting.
		vec3 straw = turfLuma * vec3(1.19, .96, .59);
		vec3 soil = turfLuma * vec3(.84, .63, .42) * (.79 + .38 * clods);
		vec3 worn = mix(soil, straw, .28 + .57 * grass);
		diffuseColor.rgb = mix(diffuseColor.rgb, worn, traffic * (.70 + .26 * (1. - grass)));
	}
}`,
      'fragment',
    );
  });
}
