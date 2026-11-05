import * as T from 'three';
import type { TerrainField } from '../../simulation/open-world/terrain-field.ts';
import { buildSea, installSeaWaves } from '../sea.ts';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import { useStudioUniforms } from '../studio/studio-frame.ts';
import { CoastalWater, FESTIVAL_SEA } from './coastal-water.ts';
import { OW_NOISE_GLSL } from './terrain-material.ts';

/** The sea wave shader maps plane UV to world metres at this scale. */
const SEA_UV_METRES = FESTIVAL_SEA.uvMetres;

/** Open-sea finish of the festival coast (High and ULTRA):
 *  - sun glitter: world-anchored micro-facets, one per jittered cell, whose
 *    tilts follow a Gaussian slope distribution (Cox-Munk style) on top of
 *    the normal-mapped waves. Only facets turned into the sun's mirror
 *    direction flash, so the glints crowd the reflection path and thin out
 *    away from it instead of dotting the whole sea. Each glint is a small,
 *    sharp point that flickers as its facet turns, and the field fades
 *    where a cell drops below a few pixels so it never aliases;
 *  - whitecaps: sparse wind-streaked foam on the steepest short-wave faces,
 *    clumped by a slow world-space field so only a few crests break. Foam
 *    is bright, rough and diffuse; the water's reflection gives way to it
 *    without the darker rim a shared roughness ramp would leave.
 * Cheap ALU only: no extra textures, targets or draws. */
export const FESTIVAL_SEA_FINISH = Object.freeze({
  /** Glint cells per metre and the RMS slope of their facet tilt (radians). */
  glintCells: 2.4,
  glintSlope: 0.085,
  /** Glint lobe exponent and peak gain over the sun's irradiance. */
  glintPower: 1600,
  glintGain: 150,
  /** Glint radius range as a share of the cell. */
  glintRadius: Object.freeze([0.035, 0.13] as const),
  /** Footprint (m per pixel) over which the glints fade out. */
  glintFade: Object.freeze([0.16, 0.7] as const),
  /** Wave-face slope (1 - n.up) at which whitecaps start, and their coverage. */
  capSlope: 0.085,
  capCoverage: 0.16,
  /** Linear foam albedo. */
  foam: Object.freeze([0.78, 0.8, 0.8] as const),
});
const f4 = (v: number) => v.toFixed(4);
export interface FestivalSeaUniforms {
  owSeaDetail: { value: number };
}
export function installFestivalSeaFinish(material: T.MeshPhysicalMaterial): FestivalSeaUniforms {
  const uniforms: FestivalSeaUniforms = { owSeaDetail: { value: 0 } };
  const F = FESTIVAL_SEA_FINISH;
  chainShaderHook(material, 'festival-open-sea-v2', (shader) => {
    useStudioUniforms(shader, ['studioTime'], 'fragment');
    Object.assign(shader.uniforms, uniforms);
    injectAfter(
      shader,
      'common',
      `uniform float owSeaDetail;
${OW_NOISE_GLSL}
float owSeaFoam = 0.0;
vec2 owSeaWorld = vec2(0.0);`,
      'fragment',
    );
    injectAfter(
      shader,
      'lights_physical_fragment',
      /* glsl */ `
#ifdef USE_NORMALMAP_TANGENTSPACE
if (owSeaDetail > 0.5) {
  owSeaWorld = vNormalMapUv / ${f4(160 / 5500)};
  vec3 seaUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float seaSlope = 1.0 - clamp(dot(normal, seaUp), 0.0, 1.0);
  float seaFootprint = max(length(dFdx(owSeaWorld)), length(dFdy(owSeaWorld)));
  // Wind-clumped breaking crests: a slow field picks the few that break;
  // the pores are streaked along the wind (+x) like blown foam.
  float capField = owFbm(owSeaWorld * 0.016 + vec2(studioTime * 0.01, 0.0), 1.0);
  float capPores = owNoise(owSeaWorld * vec2(0.45, 1.7) + vec2(studioTime * 0.06, 0.0));
  float capAt = ${f4(F.capSlope)} + 0.06 * (1.0 - capField);
  float capDetail = 1.0 - smoothstep(0.4, 2.0, seaFootprint);
  owSeaFoam = smoothstep(capAt, capAt + 0.03, seaSlope)
    * smoothstep(1.0 - ${f4(F.capCoverage)}, 1.0, capField + 0.18 * capPores)
    * mix(0.6, smoothstep(0.25, 0.6, capPores), capDetail);
  owSeaFoam = clamp(owSeaFoam * 1.6, 0.0, 0.9);
  material.diffuseColor = mix(material.diffuseColor, vec3(${F.foam.map(f4).join(', ')}), owSeaFoam);
  // Roughen only where foam is dense, so thin foam stays on a reflective sea.
  material.roughness = mix(material.roughness, 0.62, smoothstep(0.45, 0.85, owSeaFoam));
#ifdef USE_CLEARCOAT
  material.clearcoat *= 1.0 - owSeaFoam;
#endif
}
#endif`,
      'fragment',
    );
    injectAfter(
      shader,
      'lights_fragment_end',
      /* glsl */ `
#if defined( USE_NORMALMAP_TANGENTSPACE ) && NUM_DIR_LIGHTS > 0
if (owSeaDetail > 0.5) {
  vec3 seaL = directionalLights[0].direction;
  vec3 seaUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float seaSunUp = smoothstep(-0.02, 0.06, dot(seaL, seaUpV));
  float seaCell = max(length(dFdx(owSeaWorld)), length(dFdy(owSeaWorld))) * ${f4(F.glintCells)};
  float seaGlintFade = (1.0 - smoothstep(${f4(F.glintFade[0])}, ${f4(F.glintFade[1])}, seaCell)) * seaSunUp * (1.0 - owSeaFoam);
  if (seaGlintFade > 0.0) {
    vec2 gp = owSeaWorld * ${f4(F.glintCells)};
    vec2 gc = floor(gp);
    float r1 = owHash(gc), r2 = owHash(gc + 17.31), r3 = owHash(gc + 43.7);
    float r4 = owHash(gc + 71.9), r5 = owHash(gc + 5.17);
    // Facets turn with the wave phase: each cell flashes, then dims.
    float flash = fract(r3 * 7.0 + studioTime * (0.45 + 0.9 * r1));
    float flashOn = smoothstep(0.0, 0.12, flash) * (1.0 - smoothstep(0.22, 0.45, flash));
    // Gaussian facet slope (Box-Muller): most facets lie close to the
    // wave surface, so glints gather where the sun's mirror direction is.
    float slope = ${f4(F.glintSlope)} * sqrt(-2.0 * log(max(r1, 1e-4)));
    float azimuth = 6.2831853 * r2;
    vec3 tilt = (viewMatrix * vec4(cos(azimuth) * slope, 0.0, sin(azimuth) * slope, 0.0)).xyz;
    vec3 gn = normalize(normal + tilt);
    vec3 gh = normalize(seaL + geometryViewDir);
    float ndh = max(dot(gn, gh), 0.0);
    float vdh = clamp(dot(geometryViewDir, gh), 0.0, 1.0);
    float fres = 0.02 + 0.98 * pow(1.0 - vdh, 5.0);
    // One small, sharp point per cell at a jittered place inside it.
    vec2 local = fract(gp) - (0.3 + 0.4 * vec2(r4, r5));
    float radius = mix(${f4(F.glintRadius[0])}, ${f4(F.glintRadius[1])}, r3);
    float spot = 1.0 - smoothstep(radius * 0.25, radius, length(local));
    float glint = pow(ndh, ${f4(F.glintPower)}) * spot * flashOn * fres
      * clamp(dot(gn, seaL), 0.0, 1.0);
    reflectedLight.directSpecular += directionalLights[0].color * glint * ${f4(F.glintGain)} * seaGlintFade;
  }
}
#endif`,
      'fragment',
    );
  });
  return uniforms;
}

/**
 * Water of the region: the open sea (the circuit sea material and its wave
 * trains, re-meshed to reach the horizon: 48 km square, UVs keeping the
 * shader's metre scale) and the Ashvale river as a ribbon at its water level
 * along the valley channel down to the harbour.
 */
export class Water {
  readonly root = new T.Group();
  readonly sea: T.Mesh;
  readonly river: T.Mesh;
  readonly coast: CoastalWater;
  private readonly normalTexture: T.Texture | null;
  private readonly seaFinish: FestivalSeaUniforms;
  private disposed = false;
  constructor(field: TerrainField) {
    this.root.name = 'Festival water';
    const region = field.region;
    this.sea = buildSea(region.seaLevel);
    this.normalTexture = (this.sea.material as T.MeshPhysicalMaterial).normalMap;
    const size = FESTIVAL_SEA.size;
    const geometry = new T.PlaneGeometry(size, size, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, (uv.getX(i) * size) / SEA_UV_METRES, (uv.getY(i) * size) / SEA_UV_METRES);
    this.sea.geometry.dispose();
    this.sea.geometry = geometry;
    this.sea.name = 'Festival sea';
    this.sea.position.set(0, region.seaLevel - 0.05, -size / 2 + FESTIVAL_SEA.northEdge);
    this.sea.userData.excludeMotionBlur = true;
    // River ribbon along the valley polyline at its water level.
    const points = region.valley.points,
      positions: number[] = [],
      normals: number[] = [],
      uvs: number[] = [],
      index: number[] = [];
    let along = 0;
    const width = region.valley.channel * 0.95;
    const steps: { x: number; z: number; y: number }[] = [];
    for (let k = 0; k < points.length - 1; k++) {
      const [ax, az, ah] = points[k],
        [bx, bz, bh] = points[k + 1],
        len = Math.hypot(bx - ax, bz - az),
        n = Math.max(1, Math.ceil(len / 8));
      for (let i = k === 0 ? 0 : 1; i <= n; i++) {
        const t = i / n;
        steps.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, y: ah + (bh - ah) * t - 0.9 });
      }
    }
    steps.forEach((p, i) => {
      const a = steps[Math.max(0, i - 1)],
        b = steps[Math.min(steps.length - 1, i + 1)],
        dx = b.x - a.x,
        dz = b.z - a.z,
        len = Math.hypot(dx, dz) || 1,
        nx = dz / len,
        nz = -dx / len;
      if (i) along += Math.hypot(p.x - steps[i - 1].x, p.z - steps[i - 1].z);
      // The river meets the sea at sea level.
      const y = Math.max(region.seaLevel, p.y);
      for (const side of [-1, 1]) {
        positions.push(p.x + nx * side * width, y, p.z + nz * side * width);
        normals.push(0, 1, 0);
        uvs.push((side * width) / SEA_UV_METRES, along / SEA_UV_METRES);
      }
      if (i) {
        const base = i * 2;
        index.push(base - 2, base, base - 1, base - 1, base, base + 1);
      }
    });
    const river = new T.BufferGeometry();
    river.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    river.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    river.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    river.setIndex(index);
    river.computeBoundingSphere();
    const riverMaterial = (this.sea.material as T.MeshPhysicalMaterial).clone();
    riverMaterial.color.setHex(0x1d3a33);
    riverMaterial.name = 'Ashvale river';
    installSeaWaves(riverMaterial);
    riverMaterial.polygonOffset = true;
    riverMaterial.polygonOffsetFactor = -1;
    this.river = new T.Mesh(river, riverMaterial);
    this.river.name = 'Ashvale river';
    this.coast = new CoastalWater(
      field,
      this.sea.material as T.MeshPhysicalMaterial,
      this.sea.position.y,
    );
    // After the river and shore clones, which keep their own hook chains.
    this.seaFinish = installFestivalSeaFinish(this.sea.material as T.MeshPhysicalMaterial);
    this.root.add(this.sea, this.river, this.coast.root);
  }
  /** Glitter and whitecaps on High and ULTRA; Low and Medium keep the plain sea. */
  setDetail(enabled: boolean) {
    this.seaFinish.owSeaDetail.value = enabled ? 1 : 0;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.coast.dispose();
    this.sea.geometry.dispose();
    (this.sea.material as T.Material).dispose();
    this.river.geometry.dispose();
    (this.river.material as T.Material).dispose();
    this.normalTexture?.dispose();
    this.root.clear();
    this.root.removeFromParent();
  }
}
