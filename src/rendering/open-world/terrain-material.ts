import * as T from 'three';
import { SCAN_COMMON_GLSL } from '../ground/ground-glsl.ts';
import {
  scanLayerCall,
  scanMacroCall,
  scannedGround,
  scanUniformDeclarations,
  type ScanLayer,
} from '../ground/scan-store.ts';

/** Photographed sets of the festival terrain (Medium and above): meadow
 * grass, rock (slope-aligned), forest-floor soil, sandy gravel, snow. */
export const FESTIVAL_SCAN_LAYERS: readonly ScanLayer[] = Object.freeze([
  'meadow',
  'rock',
  'forest',
  'gravel',
  'snow',
]);
const SCAN_LUMA = 'vec3(0.2126, 0.7152, 0.0722)';
/** Festival scan block: per-layer colour ratios (and a blended detail normal)
 * from the photographed sets, applied to the calibrated layer colours. */
const FESTIVAL_SCAN_GLSL = /* glsl */ `
#ifdef APEX_SCAN
  vec2 scanDx = dFdx(vOwWorld.xz), scanDy = dFdy(vOwWorld.xz);
  vec3 scanWorldN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  vec3 scanContour = normalize(vec3(-scanWorldN.z, 0.0, scanWorldN.x) + vec3(1e-4, 0.0, 0.0));
  vec2 scanFace = vec2(dot(vOwWorld, scanContour), vOwWorld.y);
  vec2 scanFaceDx = dFdx(scanFace), scanFaceDy = dFdy(scanFace);
  ApexScanSample sGrass = ${scanLayerCall('meadow', 'p', 'scanDx', 'scanDy', 1.5)};
  vec3 scanGrass = mix(vec3(dot(sGrass.ratio, ${SCAN_LUMA})), sGrass.ratio, 0.55);
  vec3 scanMacro = ${scanMacroCall('meadow', 'p', 0.08)};
  scanGrass *= 1.0 + 0.45 * (dot(scanMacro, ${SCAN_LUMA}) - 1.0);
  grass *= scanGrass * mix(1.0, sGrass.ao, 0.35);
  owScanN = sGrass.n;
  owScanRough = sGrass.rough;
  ApexScanSample sLayer;
  if (rock > 0.004) {
    sLayer = ${scanLayerCall('rock', 'scanFace', 'scanFaceDx', 'scanFaceDy', 1.5, false)};
    rockC *= sLayer.ratio;
    owScanN = apexScanMixNormal(owScanN, sLayer.n, rock);
  }
  if (soil > 0.004) {
    sLayer = ${scanLayerCall('forest', 'p', 'scanDx', 'scanDy', 1.5, false)};
    soilC *= sLayer.ratio;
    owScanN = apexScanMixNormal(owScanN, sLayer.n, soil * (1.0 - rock));
  }
  if (sand > 0.004) {
    sLayer = ${scanLayerCall('gravel', 'p', 'scanDx', 'scanDy', 1.5, false)};
    sandC *= mix(vec3(dot(sLayer.ratio, ${SCAN_LUMA})), sLayer.ratio, 0.5);
    owScanN = apexScanMixNormal(owScanN, sLayer.n, sand * (1.0 - rock));
  }
  if (snow > 0.004) {
    sLayer = ${scanLayerCall('snow', 'p', 'scanDx', 'scanDy', 1.5, false)};
    snowC *= sLayer.ratio;
    owScanN = apexScanMixNormal(owScanN, sLayer.n, snow);
  }
#endif
`;
/** Shared GLSL value noise for the festival materials (world-space, no
 * textures, filtered by distance so it never aliases). */
export const OW_NOISE_GLSL = /* glsl */ `
float owHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float owNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(owHash(i), owHash(i + vec2(1.0, 0.0)), u.x),
             mix(owHash(i + vec2(0.0, 1.0)), owHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float owFbm(vec2 p, float detail) {
  float s = owNoise(p) * 0.5;
  s += owNoise(p * 2.07 + 17.1) * 0.25 * detail;
  s += owNoise(p * 4.13 - 9.7) * 0.125 * detail;
  return s / (0.5 + 0.375 * detail);
}
`;

export interface TerrainUniforms {
  owWet: { value: number };
  owSnowTint: { value: number };
  /** 1 on High and ULTRA: view-dependent grass scattering (see below). */
  owGrassDetail: { value: number };
  /** Still-water datum for the beach swash zone; far below the world (off)
   * until the festival renderer sets the region's sea level. */
  owSeaLevel: { value: number };
}
/** View-dependent sward response (High and ULTRA). A meadow is not a
 * Lambertian plane: looking toward a low sun, light forward-scatters through
 * thin backlit blades (a warm yellow-green glow along the sun's path); with
 * the sun behind the viewer, blades hide their own shadows and the turf
 * brightens around the antisolar point (the opposition hot spot). Both are
 * lobes on the existing sun irradiance (shadowed), weighted by grass cover. */
export const TERRAIN_GRASS_SCATTER = Object.freeze({
  /** Forward lobe exponent and gain over the Lambert response. */
  forwardPower: 5,
  forward: 0.11,
  /** Transmitted tint relative to the grass albedo (chlorophyll window). */
  transmit: Object.freeze([1.25, 1.55, 0.55] as const),
  /** Opposition lobe exponent and relative gain. */
  hotSpotPower: 10,
  hotSpot: 0.32,
});
/**
 * Festival terrain: one physically based material blending five layers per
 * pixel — meadow grass (with forest-floor and dry variants), rock, soil
 * (ploughed fields, verges, worn town ground), sand and snow — from the
 * tile's per-vertex layer weights (slope, height and biome), broken up by
 * world-space noise so the transitions read as ground, not as gradients.
 * Albedos are linear reflectances of real materials (grass ~0.1, rock ~0.2,
 * sand ~0.45, snow ~0.85); roughness and a noise-derived detail normal
 * follow each layer; standing water darkens and smooths the porous layers.
 */
export function terrainMaterial(): T.MeshStandardMaterial & { userData: { ow: TerrainUniforms } } {
  const material = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }) as T.MeshStandardMaterial & {
    userData: { ow: TerrainUniforms };
  };
  material.name = 'Festival terrain (layered PBR)';
  material.polygonOffset = true;
  material.polygonOffsetFactor = 1;
  material.polygonOffsetUnits = 2;
  const uniforms: TerrainUniforms = {
    owWet: { value: 0 },
    owSnowTint: { value: 1 },
    owGrassDetail: { value: 0 },
    owSeaLevel: { value: -1e4 },
  };
  const G = TERRAIN_GRASS_SCATTER,
    g4 = (v: number) => v.toFixed(4);
  material.userData.ow = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, scannedGround.uniformsFor(FESTIVAL_SCAN_LAYERS));
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 splat;
attribute vec4 shade;
varying vec4 vSplat;
varying vec4 vShade;
varying vec3 vOwWorld;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vSplat = splat;
vShade = shade;
vOwWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float owWet;
uniform float owSnowTint;
uniform float owGrassDetail;
uniform float owSeaLevel;
float owGrass = 0.0;
varying vec4 vSplat;
varying vec4 vShade;
varying vec3 vOwWorld;
${OW_NOISE_GLSL}
float owRoughness;
vec2 owBump;
#ifdef APEX_SCAN
${scanUniformDeclarations(FESTIVAL_SCAN_LAYERS)}
vec3 owScanN = vec3(0.0, 0.0, 1.0);
float owScanRough = 1.0;
#endif
${SCAN_COMMON_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float dist = length(vViewPosition);
  float near = 1.0 - smoothstep(60.0, 420.0, dist);
  float mid = 1.0 - smoothstep(400.0, 2600.0, dist);
  vec2 p = vOwWorld.xz;
  float macro = owFbm(p * 0.0021, 1.0);
  float meso = owFbm(p * 0.019, mid);
  float micro = owFbm(p * 0.21, near);
  // Layer weights broken up by noise (height-blend style transitions).
  float rock = clamp(vSplat.x * (0.75 + 0.6 * meso) - 0.08 + 0.25 * (micro - 0.5) * vSplat.x, 0.0, 1.0);
  float soil = clamp(vSplat.y * (0.7 + 0.6 * meso), 0.0, 1.0);
  float sand = clamp(vSplat.z * (0.85 + 0.3 * micro), 0.0, 1.0);
  float snow = clamp(vSplat.w * (0.8 + 0.5 * meso) - 0.05, 0.0, 1.0);
  float town = vShade.w;
  float forest = vShade.y;
  // Grass: lush to dry by macro noise, darker forest floor under woods.
  vec3 lush = vec3(0.075, 0.13, 0.035), dry = vec3(0.16, 0.17, 0.065);
  vec3 grass = mix(lush, dry, smoothstep(0.35, 0.75, macro));
  grass *= 0.82 + 0.36 * meso;
  grass = mix(grass, vec3(0.055, 0.07, 0.03) * (0.8 + 0.4 * micro), smoothstep(0.3, 0.8, forest) * 0.85);
  if (owGrassDetail > 0.5) {
    // Sward mosaic (High and ULTRA): species and moisture patches tens of
    // metres across shift the hue between yellow- and blue-green, seeding
    // patches turn to straw, and tussock-scale mottling carries the turf's
    // texture into the middle distance where the scanned detail has
    // filtered to its mean. A meadow then reads as vegetation, not a lawn.
    float swardMix = smoothstep(0.3, 0.7, owFbm(p * 0.035 + vec2(11.3, 4.1), mid));
    float swardStraw = smoothstep(0.6, 0.78, owFbm(p * 0.012 + vec2(-7.7, 2.9), 1.0));
    float swardTuft = owNoise(p * 0.45 + vec2(3.7, -1.3)) - 0.5;
    float swardOpen = (1.0 - forest) * (1.0 - town);
    grass *= mix(vec3(1.0), mix(vec3(0.9, 0.96, 1.07), vec3(1.1, 1.03, 0.84), swardMix), swardOpen);
    grass = mix(grass, vec3(0.2, 0.175, 0.085), swardStraw * 0.34 * swardOpen);
    grass *= 1.0 + swardTuft * 0.16 * (1.0 - smoothstep(150.0, 420.0, dist)) * swardOpen;
  }
  // Short airfield and park turf, worn paving in towns.
  grass = mix(grass, mix(vec3(0.17, 0.165, 0.15), vec3(0.11, 0.15, 0.06), smoothstep(0.4, 0.7, meso)), town * 0.8);
  vec3 rockC = mix(vec3(0.17, 0.16, 0.145), vec3(0.29, 0.27, 0.24), owFbm(vec2(p.x * 0.05, vOwWorld.y * 0.6), mid));
  rockC *= 0.85 + 0.3 * micro;
  // Farm presence is interpolated tile data, not a row coordinate. Repeating
  // that scalar with fract() would turn each terrain triangle into hard
  // green/gold contour bands. Crop variation stays continuous in world space.
  float field = vShade.z;
  vec3 crop = mix(vec3(0.13, 0.16, 0.052), vec3(0.20, 0.19, 0.075),
    smoothstep(0.25, 0.8, macro * 0.7 + meso * 0.3));
  vec3 earth = mix(vec3(0.16, 0.115, 0.075), vec3(0.24, 0.19, 0.13), micro);
  vec3 soilC = mix(earth, crop, smoothstep(0.06, 0.42, field) * 0.75);
  vec3 sandC = mix(vec3(0.42, 0.37, 0.27), vec3(0.6, 0.54, 0.41), meso) * (0.9 + 0.2 * micro);
  vec3 snowC = vec3(0.82, 0.84, 0.88) * (0.94 + 0.06 * micro) * owSnowTint;
  ${FESTIVAL_SCAN_GLSL}
  // Road verges: compacted, dusty.
  float verge = smoothstep(0.25, 1.0, vShade.x) * (1.0 - snow);
  vec3 col = grass;
  col = mix(col, soilC, soil);
  col = mix(col, sandC, sand);
  col = mix(col, rockC, rock);
  col = mix(col, vec3(0.19, 0.17, 0.14) * (0.85 + 0.3 * micro), verge * 0.6);
  col = mix(col, snowC, snow);
  owGrass = (1.0 - soil) * (1.0 - sand) * (1.0 - rock) * (1.0 - snow) * (1.0 - verge * 0.6) * (1.0 - town * 0.5);
  owRoughness = mix(0.93, 0.78, rock);
  owRoughness = mix(owRoughness, 0.96, soil * 0.6);
  owRoughness = mix(owRoughness, 0.88, sand);
  owRoughness = mix(owRoughness, 0.42, snow);
#ifdef APEX_SCAN
  owRoughness = clamp(owRoughness * mix(owScanRough, 1.0, max(rock, snow)), 0.05, 1.0);
#endif
  // Standing water: porous layers darken and smooth (not snow or rock faces).
  float wet = owWet * (1.0 - snow) * (1.0 - 0.6 * rock);
  col *= 1.0 - 0.38 * wet;
  owRoughness = mix(owRoughness, 0.32, wet * 0.75);
  // Beach swash zone: sand and shingle stay saturated a little above the
  // still-water line (darker and glossy, mirroring the sky at grazing), with
  // a ragged drying edge and a faint strand line of wrack along its top.
  float owAbove = vOwWorld.y - owSeaLevel;
  if (owAbove < 2.0) {
    float owEdge = 0.55 + 0.4 * meso + 0.14 * (micro - 0.5);
    float owShore = clamp(sand + 0.6 * soil + 0.4 * rock, 0.0, 1.0) * (1.0 - snow) * (1.0 - town);
    float owDamp = (1.0 - smoothstep(owEdge * 0.3, owEdge, owAbove)) * owShore;
    // The last swash leaves a glassy film right at the water's edge.
    float owFilm = (1.0 - smoothstep(0.02, 0.12, owAbove)) * owShore;
    float owStrand = (1.0 - smoothstep(0.0, 0.07, abs(owAbove - owEdge - 0.12)))
      * smoothstep(0.45, 0.7, micro) * owShore * near;
    col *= (1.0 - 0.56 * owDamp) * (1.0 - 0.24 * owStrand);
    owRoughness = mix(owRoughness, 0.17, owDamp * 0.9);
    owRoughness = mix(owRoughness, 0.07, owFilm);
  }
  diffuseColor.rgb = col;
  // Detail normal: gradient of the micro and meso relief (fades with distance).
  float e = 0.35;
  float h0 = owFbm(p * 0.21, near) * near * (0.35 + 0.65 * rock + 0.3 * soil) + meso * 0.6 * mid;
  float hx = owFbm((p + vec2(e, 0.0)) * 0.21, near) * near * (0.35 + 0.65 * rock + 0.3 * soil) + owFbm((p + vec2(e, 0.0)) * 0.019, mid) * 0.6 * mid;
  float hz = owFbm((p + vec2(0.0, e)) * 0.21, near) * near * (0.35 + 0.65 * rock + 0.3 * soil) + owFbm((p + vec2(0.0, e)) * 0.019, mid) * 0.6 * mid;
  owBump = vec2(hx - h0, hz - h0) / e * (0.55 * (1.0 - snow * 0.7));
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = owRoughness;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
if (owGrassDetail > 0.5 && owGrass > 0.001) {
  // directLight still holds the (only) sun after the light loop, shadowed.
  vec3 owL = directionalLights[0].direction;
  float owSunN = clamp(dot(geometryNormal, owL), 0.0, 1.0);
  float owGraze = 1.0 - clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
  vec3 owLambert = directLight.color * material.diffuseColor * RECIPROCAL_PI;
  float owForward = pow(clamp(dot(-geometryViewDir, owL), 0.0, 1.0), ${g4(G.forwardPower)});
  float owHot = pow(clamp(dot(geometryViewDir, owL), 0.0, 1.0), ${g4(G.hotSpotPower)});
  reflectedLight.directDiffuse += owLambert * owGrass * (
    vec3(${G.transmit.map(g4).join(', ')}) * owForward * owGraze * smoothstep(0.0, 0.2, owSunN) * ${g4(G.forward / 0.3183)}
    + owHot * owSunN * ${g4(G.hotSpot)});
}
#endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = normalize(normal + (viewMatrix * vec4(-owBump.x, 0.0, -owBump.y, 0.0)).xyz);
#ifdef APEX_SCAN
normal = apexScanPerturb(normal, owScanN, 1.1);
#endif`,
      );
  };
  material.customProgramCacheKey = () => 'festival-terrain-v5-swash-film';
  scannedGround.register(material, FESTIVAL_SCAN_LAYERS);
  return material;
}
