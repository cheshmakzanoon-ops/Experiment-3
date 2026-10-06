import type * as T from 'three';
import { clamp, mod, smooth } from '../../core/math.ts';
import { racingLineFor } from '../../simulation/racing-line.ts';
import type { Track } from '../../simulation/track.ts';
import { ROAD_REPAIR_GLSL, ROAD_SEALANT } from '../road-macro.ts';
import { tyreMarkZones } from '../tyre-marks.ts';
import { chainShaderHook, injectAfter, injectBefore, injectDeclarations } from './shader-hooks.ts';

/**
 * Track surface detail (D04 track-asphalt).
 *
 * Two shader layers, both presentation only:
 *
 * - `installAsphaltDetail` (every asphalt surface: road, pit lane, run-off):
 *   the 0.64 m chip tile converges to its linear mean between 15 and 40 m, a
 *   second 4.5 m meso tile (packed in the roughness map's red channel) carries
 *   tone and relief from decimetres to centimetres, chip contrast is restored
 *   near the camera, sparse chip glints appear within 6 m, and mip-filtered
 *   normal variance widens roughness (Toksvig).
 *
 * - `installRoadDetail` (the racing surface only, after `installWetRoad`):
 *   the rubbered racing line from the per-vertex `apexLine` attribute (exact
 *   lateral distance from the solved line, plus a braking weight from the
 *   tyre-mark zones) with the simulation's laid rubber (`roadState.g`) as the
 *   amplitude, dusty edges from `edgeMetres`, small sealed repairs and crack
 *   sealant. Grip, water and deposits stay owned by the physics grid.
 *
 * Both chain through `chainShaderHook`, so the hook order of the finish, the
 * wet road and later departments' hooks is preserved.
 */
export const ASPHALT_DETAIL = Object.freeze({
  /** Distance band over which the chip tile converges to its mean, metres. */
  microFade: [15, 40] as const,
  /** Near-field chip contrast gain over the byte-limited texels (1 = as authored). */
  microContrast: 1.6,
  /** Meso tile size, metres; albedo, roughness and relief gains per unit field. */
  mesoTile: 4.5,
  mesoTone: 0.55,
  mesoRoughness: 0.12,
  /** Relief of the meso field, metres per unit (about +-0.6 mm at one sigma). */
  mesoRelief: 0.0035,
  /** Chip glints: range from the camera (m), share of chips and their roughness. */
  glintRange: 6,
  glintShare: 0.07,
  glintRoughness: 0.3,
});

export const ROAD_DETAIL = Object.freeze({
  /** Racing-line rubber: Gaussian sigma across the line, metres. */
  lineSigma: 0.85,
  /** Albedo darkening at the line centre, plus the braking share. */
  lineDarkening: 0.42,
  brakeDarkening: 0.18,
  /** Laid rubber (track-state G) at which the line is fully shown. */
  rubberFull: 0.3,
  /** Roughness reduction at the line centre (0.80 -> about 0.66). */
  lineRoughness: 0.14,
  /** Aggregate relief kept on the rubbered line (rubber fills the texture). */
  lineRelief: 0.55,
  /** Along-track traffic streaks (rubber dust lanes): tone amplitude off and
   * near the line, lateral cell width (m) and along-track cell length (m). */
  streakTone: [0.05, 0.1] as const,
  streakWidth: 0.32,
  streakLength: 9,
  /** Lighter, matter dust within this distance of the asphalt edge, metres. */
  dustWidth: 0.9,
  dustLift: 0.08,
  /** Profile sample spacing for the braking weight, metres. */
  profileStep: 2,
});

export interface AsphaltMeans {
  /** Linear-light mean albedo of the chip tile. */
  albedo: readonly [number, number, number];
  /** Mean roughness (green channel) of the chip tile. */
  roughness: number;
}

const g = (v: number) => v.toFixed(5);

const ASPHALT_COMMON = /* glsl */ `
varying vec2 vAsphaltWorld;
float apexAsphaltHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/** Install the asphalt micro/meso detail on a surfaceMaterial('asphalt'). */
export function installAsphaltDetail(material: T.MeshStandardMaterial, means: AsphaltMeans) {
  const { albedo, roughness } = means;
  if (![...albedo, roughness].every((v) => Number.isFinite(v) && v > 0 && v <= 1))
    throw new Error('Invalid asphalt texel means');
  const D = ASPHALT_DETAIL;
  return chainShaderHook(material, 'asphalt-detail-v1', (shader) => {
    injectAfter(shader, 'common', 'varying vec2 vAsphaltWorld;', 'vertex');
    injectAfter(
      shader,
      'project_vertex',
      `vec4 asphaltWorld = vec4(transformed, 1.0);
      #ifdef USE_BATCHING
        asphaltWorld = batchingMatrix * asphaltWorld;
      #endif
      #ifdef USE_INSTANCING
        asphaltWorld = instanceMatrix * asphaltWorld;
      #endif
      vAsphaltWorld = (modelMatrix * asphaltWorld).xz;`,
    );
    injectAfter(shader, 'common', ASPHALT_COMMON, 'fragment');
    // Map stage: declares the shared locals, then converges the chip tile to
    // its mean with distance and applies the meso tone. Multiplicative only,
    // so it composes with the finish, macro and wet terms in any hook order.
    injectAfter(
      shader,
      'map_fragment',
      `float apexAsphaltDistance = length(vViewPosition);
      float apexMicro = 1.0 - smoothstep(${g(D.microFade[0])}, ${g(D.microFade[1])}, apexAsphaltDistance);
      vec2 apexMesoUv = vAsphaltWorld * ${g(1 / D.mesoTile)};
      float apexMeso = 0.5;
      float apexGlint = 0.0;
      #ifdef USE_ROUGHNESSMAP
        apexMeso = texture2D(roughnessMap, apexMesoUv).r;
      #endif
      #ifdef USE_MAP
        diffuseColor.rgb *= pow(max(sampledDiffuseColor.rgb, vec3(0.003)) /
          vec3(${albedo.map(g).join(', ')}), vec3(apexMicro * ${g(D.microContrast)} - 1.0));
      #endif
      diffuseColor.rgb *= 1.0 + (apexMeso - 0.5) * ${g(D.mesoTone)};`,
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      `#ifdef USE_ROUGHNESSMAP
        roughnessFactor *= mix(${g(roughness)} / max(texelRoughness.g, 0.05), 1.0, apexMicro);
        roughnessFactor *= 1.0 + (apexMeso - 0.5) * ${g(D.mesoRoughness)};
        #ifdef USE_NORMALMAP_TANGENTSPACE
        {
          // Toksvig: a mip-averaged chip normal shortens; keep its spread as
          // roughness instead of normalising it away into a mirror at range.
          float apexNormalLength = clamp(length(texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0), 0.2, 1.0);
          float apexReliefScale = normalScale.x * apexMicro;
          float apexSpread = (1.0 - apexNormalLength) / apexNormalLength * apexReliefScale * apexReliefScale;
          roughnessFactor = sqrt(roughnessFactor * roughnessFactor + min(apexSpread, 0.25));
        }
        #endif
        // Glints: a few fractured chip faces near the camera, only while a
        // chip still spans more than a pixel (stable, never sub-pixel noise).
        vec2 apexChipCell = vRoughnessMapUv * 64.0;
        float apexChipFootprint = length(fwidth(apexChipCell));
        apexGlint = step(apexAsphaltHash(floor(apexChipCell)), ${g(D.glintShare)}) *
          smoothstep(0.6, 0.9, texelRoughness.b) *
          (1.0 - smoothstep(${g(D.glintRange * 0.65)}, ${g(D.glintRange)}, apexAsphaltDistance)) *
          (1.0 - smoothstep(0.35, 0.9, apexChipFootprint));
        roughnessFactor = mix(roughnessFactor, ${g(D.glintRoughness)}, apexGlint);
      #endif`,
    );
    // Normal stage, before the tangent-space map is applied: tilt the frame's
    // normal by the meso slope (and a glint facet), scale the chip relief by
    // the micro fade. The wet road's dry-normal capture stays geometric.
    injectBefore(
      shader,
      'normal_fragment_maps',
      `#ifdef USE_NORMALMAP_TANGENTSPACE
      {
        vec3 apexTilt = vec3(0.0);
        #ifdef USE_ROUGHNESSMAP
          float apexMesoStep = 1.5 / 512.0;
          vec2 apexSlope = vec2(
            texture2D(roughnessMap, apexMesoUv + vec2(apexMesoStep, 0.0)).r - apexMeso,
            texture2D(roughnessMap, apexMesoUv + vec2(0.0, apexMesoStep)).r - apexMeso) *
            ${g(D.mesoRelief / ((1.5 / 512) * D.mesoTile))};
          apexTilt = vec3(-apexSlope.x, 0.0, -apexSlope.y);
          vec2 apexFacetHash = vec2(apexAsphaltHash(floor(apexChipCell) + 17.0),
            apexAsphaltHash(floor(apexChipCell) + 41.0));
          float apexFacetAngle = apexFacetHash.x * 6.2831853;
          apexTilt += vec3(cos(apexFacetAngle), 0.0, sin(apexFacetAngle)) *
            (0.12 + 0.3 * apexFacetHash.y) * apexGlint;
        #endif
        vec3 apexTilted = tbn[2] + mat3(viewMatrix) * apexTilt;
        float apexTiltedLength = length(apexTilted);
        if (apexTiltedLength > 1e-4) tbn[2] = apexTilted / apexTiltedLength;
        tbn[0] *= apexMicro;
        tbn[1] *= apexMicro;
      }
      #endif`,
    );
  });
}

interface LineProfile {
  offset: Float32Array;
  brake: Float32Array;
  step: number;
  length: number;
}
const profiles = new WeakMap<Track, LineProfile>();

/** Racing-line offset and braking weight along a lap, sampled every
 * ROAD_DETAIL.profileStep metres. The weight rises through each braking zone
 * to 1 at the apex (scaled by the speed lost), fades over ~20 m after it, and
 * carries a lighter share through slow-corner exits. Cached per track. */
export function apexLineProfile(track: Track): LineProfile {
  let profile = profiles.get(track);
  if (profile) return profile;
  const line = racingLineFor(track),
    length = track.length,
    n = Math.max(8, Math.round(length / ROAD_DETAIL.profileStep)),
    step = length / n;
  const offset = new Float32Array(n),
    brake = new Float32Array(n);
  for (let i = 0; i < n; i++) offset[i] = line.offsetAt(i * step);
  for (const zone of tyreMarkZones(track)) {
    const span = Math.max(zone.end - zone.start, 1e-3);
    if (zone.kind === 'braking') {
      const peak = clamp(zone.strength / 28, 0.45, 1);
      const reach = span + 40;
      for (let d = 0; d <= reach; d += step) {
        const s = zone.start + d;
        const w =
          d <= span ? peak * smooth(0, 1, d / span) ** 0.8 : peak * Math.exp(-(d - span) / 18);
        const i = Math.round(mod(s, length) / step) % n;
        brake[i] = Math.max(brake[i], w);
      }
    } else {
      for (let d = 0; d <= span; d += step) {
        const i = Math.round(mod(zone.start + d, length) / step) % n;
        brake[i] = Math.max(brake[i], 0.55 * (1 - smooth(0, 1, d / span)));
      }
    }
  }
  profile = { offset, brake, step, length };
  profiles.set(track, profile);
  return profile;
}

function sample(profile: LineProfile, values: Float32Array, s: number) {
  const u = mod(s, profile.length) / profile.step,
    i = Math.floor(u) % values.length,
    f = u - Math.floor(u);
  return values[i] + (values[(i + 1) % values.length] - values[i]) * f;
}
/** Per-vertex `apexLine` for a road vertex at lap distance `s`, lateral `l`:
 * (signed metres from the racing line, braking weight 0-1). */
export function apexLineAt(track: Track, s: number, l: number, out: [number, number] = [0, 0]) {
  const profile = apexLineProfile(track);
  out[0] = l - sample(profile, profile.offset, s);
  out[1] = clamp(sample(profile, profile.brake, s), 0, 1);
  return out;
}

const ROAD_COMMON = /* glsl */ `
varying vec2 vApexLine;
varying float vEdgeMetres;
// Value noise that repeats every 'period' cells along y, so lap-distance
// patterns close exactly at the start line.
float apexLapNoise(vec2 p, float period) {
  vec2 i = floor(p), q = fract(p), u = q * q * (3.0 - 2.0 * q);
  vec2 a = vec2(i.x, mod(i.y, period)), b = vec2(i.x, mod(i.y + 1.0, period));
  return mix(mix(apexRoadHash(a), apexRoadHash(a + vec2(1.0, 0.0)), u.x),
    mix(apexRoadHash(b), apexRoadHash(b + vec2(1.0, 0.0)), u.x), u.y);
}
`;

/** Install the racing-surface layer on the road material. Requires the wet
 * road (`roadState`, `vRoadMetres`, the macro noise) and the asphalt detail
 * (`vAsphaltWorld`); throws at compile time if either is missing. */
export function installRoadDetail(material: T.MeshStandardMaterial, lapLength: number) {
  if (!Number.isFinite(lapLength) || lapLength <= 0) throw new Error('Invalid road lap length');
  const R = ROAD_DETAIL;
  // Striation cells along the lap: an integer count, so the pattern closes.
  const alongCells = Math.max(1, Math.round(lapLength / 18)),
    streakCells = Math.max(1, Math.round(lapLength / R.streakLength));
  return chainShaderHook(material, 'road-detail-v1', (shader) => {
    for (const needed of [
      'vec4 roadState',
      'varying vec2 vRoadMetres',
      'float apexRoadNoise',
      'varying vec2 vAsphaltWorld',
    ])
      if (!shader.fragmentShader.includes(needed))
        throw new Error(`Road detail needs the wet road and asphalt detail (${needed})`);
    injectAfter(
      shader,
      'common',
      'attribute vec2 apexLine; attribute float edgeMetres; varying vec2 vApexLine; varying float vEdgeMetres;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vApexLine = apexLine; vEdgeMetres = edgeMetres;');
    // Below every pars chunk and the wet road's common block, whose macro
    // hash and noise these functions call (GLSL needs them declared first).
    injectAfter(
      shader,
      'clipping_planes_pars_fragment',
      ROAD_COMMON + ROAD_REPAIR_GLSL,
      'fragment',
    );
    injectDeclarations(
      shader,
      'map_fragment',
      `float apexLineMask = 0.0, apexSealant = 0.0, apexRepair = 0.0, apexDust = 0.0;`,
    );
    // After every map-stage term (finish, macro, water, marbles): the line is
    // laid rubber on top of the surface, and needs the physics state sample.
    injectBefore(
      shader,
      'color_fragment',
      `{
        float apexX = vApexLine.x;
        float apexBrake = clamp(vApexLine.y, 0.0, 1.0);
        float apexRubber = smoothstep(0.0, ${g(R.rubberFull)}, roadState.g);
        float apexCore = exp(-0.5 * (apexX / ${g(R.lineSigma)}) * (apexX / ${g(R.lineSigma)}));
        // Laid rubber is streaky: many passes a tyre wide, a little off the
        // mean line. Fine lateral striations, varying slowly along the lap and
        // converging to their mean before they would alias.
        vec2 apexStriP = vec2(apexX * 9.0, vRoadMetres.y * ${g(alongCells / lapLength)});
        float apexStriAA = 1.0 - smoothstep(0.35, 1.0, fwidth(apexStriP.x));
        float apexStri = mix(0.5, apexLapNoise(apexStriP, ${g(alongCells)}), apexStriAA);
        apexLineMask = apexCore * apexRubber * mix(0.78, 1.16, apexStri);
        // Traffic streaks: every car's tyres polish and dust lanes along the
        // lap, strongest around the line. Converge to the mean before aliasing.
        vec2 apexLaneP = vec2(vRoadMetres.x / ${g(R.streakWidth)}, vRoadMetres.y * ${g(streakCells / lapLength)});
        float apexLaneAA = 1.0 - smoothstep(0.3, 0.9, fwidth(apexLaneP.x));
        float apexLane = (apexLapNoise(apexLaneP, ${g(streakCells)}) * 0.65 +
          apexLapNoise(apexLaneP * vec2(2.7, 1.0) + vec2(3.7, 0.0), ${g(streakCells)}) * 0.35 - 0.5) * apexLaneAA;
        diffuseColor.rgb *= 1.0 + 2.0 * apexLane * mix(${g(R.streakTone[0])}, ${g(R.streakTone[1])}, exp(-0.5 * apexX * apexX / 9.0));
        float apexDark = min(0.8, (${g(R.lineDarkening)} + ${g(R.brakeDarkening)} * apexBrake) * apexLineMask);
        vec3 apexGrey = vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
        // Rubber is a neutral black: darken toward grey, not along the hue.
        diffuseColor.rgb = mix(diffuseColor.rgb, apexGrey, 0.45 * apexDark) * (1.0 - apexDark);
        // Dust and fine debris collect toward the edges, off the line.
        apexDust = smoothstep(-${g(R.dustWidth)}, -0.12, vEdgeMetres) * (1.0 - apexLineMask) *
          (0.7 + 0.6 * apexRoadNoise(vAsphaltWorld * 2.7));
        diffuseColor.rgb *= 1.0 + ${g(R.dustLift)} * apexDust;
        vec3 apexRepairState = apexRoadRepair(vRoadMetres, ${g(lapLength)});
        apexRepair = apexRepairState.x;
        diffuseColor.rgb *= mix(1.0, apexRepairState.y, apexRepair);
        apexSealant = max(apexRoadSealant(vAsphaltWorld), apexRepairState.z);
        diffuseColor.rgb = mix(diffuseColor.rgb, apexSealantColour, apexSealant * 0.85);
      }`,
    );
    // Roughness before the water film takes over (the wet mix follows).
    injectAfter(
      shader,
      'roughnessmap_fragment',
      `roughnessFactor -= ${g(R.lineRoughness)} * apexLineMask;
      roughnessFactor -= 0.05 * apexRepair;
      roughnessFactor += 0.05 * apexDust;
      roughnessFactor = mix(roughnessFactor, ${g(ROAD_SEALANT.roughness)}, apexSealant);`,
    );
    injectBefore(
      shader,
      'normal_fragment_maps',
      `#ifdef USE_NORMALMAP_TANGENTSPACE
        float apexRelief = 1.0 - (1.0 - ${g(R.lineRelief)}) * apexLineMask - 0.8 * apexSealant;
        tbn[0] *= apexRelief;
        tbn[1] *= apexRelief;
      #endif`,
    );
  });
}
