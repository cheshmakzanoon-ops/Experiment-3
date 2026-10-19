import * as T from 'three';
import type { TerrainField } from '../../simulation/open-world/terrain-field.ts';
import { installSeaWaves } from '../sea.ts';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import { useStudioUniforms } from '../studio/studio-frame.ts';

/** Keep shore UVs in the exact same metre frame as the open-water plane. */
export const FESTIVAL_SEA = Object.freeze({ size: 48000, northEdge: 2000, uvMetres: 5500 });
export const COASTAL_WATER = Object.freeze({
  spacing: 20,
  maxSegments: 768,
  chunkSegments: 32,
  /** Coarse Solvane triangles can place the visible shore up to 170 m inland
   * of the analytic contour. One tile of overlap lets opaque terrain depth
   * determine that edge without adding rows; signed depth still comes from
   * the field, and only analytically wet ground receives breaking wash. */
  offsets: Object.freeze([-256, 0, 1.3, 3.1, 6.6, 14, 30, 64, 128]),
  surfaceOffset: 0.012,
});

type CoastalField = Pick<TerrainField, 'height' | 'region'>;
interface ShoreProfile {
  x: number;
  z: number;
  normalZ: number;
  beach: number;
  depths: number[];
}
export interface CoastalWaterStats {
  profiles: number;
  rejectedSpans: number;
  chunks: number;
  triangles: number;
  vertices: number;
  heightSamples: number;
  maxRootError: number;
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Find the first sea-to-land crossing, then solve against field.height.
 * Authored coast points only bound the search; they are not the waterline.
 * Estuaries that remain open inland are left open instead of bridged by surf.
 * Fixed x strips cannot cross one another around headlands. */
export function buildCoastalWaterGeometry(field: CoastalField, level: number) {
  const stats: CoastalWaterStats = {
    profiles: 0,
    rejectedSpans: 0,
    chunks: 0,
    triangles: 0,
    vertices: 0,
    heightSamples: 0,
    maxRootError: 0,
  };
  const geometries: T.BufferGeometry[] = [];
  const coast = field.region.coast;
  if (coast.length < 2) return { geometries, stats };
  const x0 = coast[0][0],
    x1 = coast[coast.length - 1][0];
  if (!(x1 > x0) || !Number.isFinite(level)) return { geometries, stats };
  const segments = Math.min(
    COASTAL_WATER.maxSegments,
    Math.ceil((x1 - x0) / COASTAL_WATER.spacing),
  );
  const dx = (x1 - x0) / segments;
  const sample = (x: number, z: number) => {
    stats.heightSamples++;
    return field.height(x, z);
  };
  const profiles: (ShoreProfile | null)[] = [];
  let coastSegment = 0;
  for (let i = 0; i <= segments; i++) {
    const x = x0 + i * dx;
    while (coastSegment < coast.length - 2 && x > coast[coastSegment + 1][0]) coastSegment++;
    const a = coast[coastSegment],
      b = coast[coastSegment + 1];
    const hint = a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    let low = hint - 208,
      high = low;
    let previous = sample(x, low) - level;
    let found = false;
    if (previous <= 0) {
      for (high = low + 16; high <= hint + 272; high += 16) {
        const height = sample(x, high) - level;
        if (height >= 0 && previous <= 0) {
          found = true;
          break;
        }
        low = high;
        previous = height;
      }
    }
    if (!found) {
      profiles.push(null);
      continue;
    }
    for (let j = 0; j < 16; j++) {
      const mid = (low + high) / 2;
      if (sample(x, mid) < level) low = mid;
      else high = mid;
    }
    const z = (low + high) / 2;
    const error = Math.abs(sample(x, z) - level);
    if (!Number.isFinite(error) || error > 0.015) {
      profiles.push(null);
      continue;
    }
    stats.maxRootError = Math.max(stats.maxRootError, error);
    const gx = (sample(x + 2, z) - sample(x - 2, z)) / 4;
    const gz = (sample(x, z + 2) - sample(x, z - 2)) / 4;
    const grade = Math.hypot(gx, gz);
    const depths = COASTAL_WATER.offsets.map((offset) => level - sample(x, z - offset));
    if (depths.some((depth) => !Number.isFinite(depth))) {
      profiles.push(null);
      continue;
    }
    profiles.push({
      x,
      z,
      depths,
      normalZ: Math.max(0.2, Math.abs(gz) / Math.max(grade, 0.001)),
      // Gentle beach wash; vertical harbour quays receive no breaking surf.
      beach: 1 - smooth(0.1, 0.5, grade),
    });
    stats.profiles++;
  }

  const accepted = new Uint8Array(segments);
  const edgeFade = new Float32Array(segments + 1).fill(1);
  for (let i = 0; i < segments; i++) {
    const a = profiles[i],
      b = profiles[i + 1];
    if (a && b && Math.abs(a.z - b.z) <= dx * 2) {
      // River mouths and quay corners can fall between two valid profiles.
      const mid = sample((a.x + b.x) / 2, (a.z + b.z) / 2);
      if (Number.isFinite(mid) && Math.abs(mid - level) <= 0.12) accepted[i] = 1;
    }
    if (accepted[i]) continue;
    stats.rejectedSpans++;
    // Fade into the unchanged open sea on both sides of every internal gap.
    // Reuse two existing intervals: zero at the cut, half at its neighbour,
    // full strength two profiles away. No triangles bridge the opening.
    for (let j = Math.max(0, i - 2); j <= Math.min(segments, i + 3); j++) {
      const distance = j <= i ? i - j : j - i - 1;
      edgeFade[j] = Math.min(edgeFade[j], smooth(0, 2, distance));
    }
  }

  const rowCount = COASTAL_WATER.offsets.length;
  for (let start = 0; start < segments; start += COASTAL_WATER.chunkSegments) {
    const end = Math.min(segments, start + COASTAL_WATER.chunkSegments);
    const positions: number[] = [],
      normals: number[] = [],
      uvs: number[] = [];
    const shore: number[] = [],
      indices: number[] = [];
    const bases = new Map<number, number>();
    const append = (i: number, p: ShoreProfile) => {
      const existing = bases.get(i);
      if (existing !== undefined) return existing;
      const base = positions.length / 3;
      for (let k = 0; k < rowCount; k++) {
        const offset = COASTAL_WATER.offsets[k],
          z = p.z - offset;
        positions.push(p.x, level + COASTAL_WATER.surfaceOffset, z);
        normals.push(0, 1, 0);
        uvs.push(
          (p.x + FESTIVAL_SEA.size / 2) / FESTIVAL_SEA.uvMetres,
          (FESTIVAL_SEA.northEdge - z) / FESTIVAL_SEA.uvMetres,
        );
        shore.push(
          p.depths[k],
          offset * p.normalZ,
          p.beach,
          smooth(0, 120, Math.min(p.x - x0, x1 - p.x)) *
            (1 - smooth(64, 128, offset)) *
            edgeFade[i],
        );
      }
      bases.set(i, base);
      return base;
    };
    for (let i = start; i < end; i++) {
      if (!accepted[i]) continue;
      const a = profiles[i]!,
        b = profiles[i + 1]!;
      const ai = append(i, a),
        bi = append(i + 1, b);
      for (let k = 0; k < rowCount - 1; k++)
        indices.push(ai + k, bi + k, ai + k + 1, ai + k + 1, bi + k, bi + k + 1);
    }
    if (!indices.length) continue;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('coastal', new T.Float32BufferAttribute(shore, 4));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometries.push(geometry);
    stats.vertices += positions.length / 3;
    stats.triangles += indices.length / 3;
  }
  stats.chunks = geometries.length;
  return { geometries, stats };
}

/** A shallow-water finish over the existing physical sea, borrowing its wave
 * texture. All colour/foam is lit by the scene; no emissive night-water tint,
 * fake local reflections, depth render target or copied photographic assets. */
export class CoastalWater {
  readonly root = new T.Group();
  readonly material: T.MeshPhysicalMaterial;
  readonly stats: CoastalWaterStats;
  private disposed = false;
  constructor(field: CoastalField, base: T.MeshPhysicalMaterial, level: number) {
    this.root.name = 'Solvane shallows and shore wash';
    const { geometries, stats } = buildCoastalWaterGeometry(field, level);
    this.stats = stats;
    this.material = base.clone();
    this.material.name = 'Solvane coastal water';
    this.material.transparent = true;
    this.material.depthTest = true;
    this.material.depthWrite = false;
    installSeaWaves(this.material);
    chainShaderHook(this.material, 'solvane-coastal-water-v1', (shader) => {
      useStudioUniforms(shader, ['studioTime'], 'fragment');
      injectAfter(
        shader,
        'common',
        'attribute vec4 coastal;\nvarying vec4 vCoastal;\nvarying vec2 vCoastalWorld;',
        'vertex',
      );
      injectAfter(
        shader,
        'begin_vertex',
        'vCoastal = coastal;\nvCoastalWorld = (modelMatrix * vec4(transformed, 1.0)).xz;',
        'vertex',
      );
      injectAfter(
        shader,
        'common',
        /* glsl */ `
varying vec4 vCoastal;
varying vec2 vCoastalWorld;
float coastalFoam = 0.0;
float coastalNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec4 h = fract(sin(vec4(dot(i, vec2(127.1, 311.7)),
    dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7)),
    dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7)),
    dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7)))) * 43758.5453);
  return mix(mix(h.x, h.y, u.x), mix(h.z, h.w, u.x), u.y);
}`,
        'fragment',
      );
      injectAfter(
        shader,
        'color_fragment',
        /* glsl */ `
{
  float depth = max(0.0, vCoastal.x);
  float distance = max(0.0, vCoastal.y);
  float footprint = max(length(dFdx(vCoastalWorld)), length(dFdy(vCoastalWorld)));
  float detail = 1.0 - smoothstep(0.35, 2.0, footprint);
  float wet = smoothstep(-0.005, 0.065, vCoastal.x);
  // Rendered terrain, including coarse fallback triangles, occludes the
  // inland cap. Analytic wetness gates foam only: using it for body opacity
  // would expose a blue sea gap wherever the two shorelines disagree.
  float body = 1.0 - smoothstep(2.5, 7.5, depth);
  float broad = coastalNoise(vCoastalWorld * 0.047);
  // A slow, spatially offset swash; irregular gaps keep it from reading as
  // an illuminated contour line. Fine foam fades before subpixel shimmer.
  float phase = studioTime * 0.63 + broad * 3.7;
  float crest = 1.35 + 0.8 * sin(phase);
  float width = 0.38 + min(footprint, 1.5);
  float wash = (1.0 - smoothstep(width, width + 0.55, abs(distance - crest)));
  float breakup = coastalNoise(vCoastalWorld * 0.72 + vec2(studioTime * 0.024, 0.0));
  float pores = mix(0.48, smoothstep(0.28, 0.72, breakup), detail);
  coastalFoam = wash * pores * smoothstep(0.22, 0.78, broad) *
    vCoastal.z * wet * (1.0 - smoothstep(0.65, 1.7, depth)) * 0.7;
  vec3 shallow = mix(vec3(0.18, 0.195, 0.14), vec3(0.022, 0.16, 0.155), smoothstep(0.05, 1.1, depth));
  shallow *= 0.93 + 0.14 * broad;
  vec3 waterColour = mix(shallow, diffuseColor.rgb, smoothstep(1.6, 7.5, depth));
  diffuseColor.rgb = mix(waterColour, vec3(0.58, 0.61, 0.57), coastalFoam);
  diffuseColor.a *= clamp(max(body * 0.82, coastalFoam) * vCoastal.w, 0.0, 1.0);
}`,
        'fragment',
      );
      injectAfter(
        shader,
        'normal_fragment_maps',
        'roughnessFactor = mix(roughnessFactor, 0.68, coastalFoam);',
        'fragment',
      );
      injectAfter(
        shader,
        'lights_physical_fragment',
        /* glsl */ `
#ifdef USE_CLEARCOAT
  material.clearcoat *= 1.0 - coastalFoam;
  material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.6, coastalFoam);
#endif`,
        'fragment',
      );
    });
    for (const geometry of geometries) {
      const mesh = new T.Mesh(geometry, this.material);
      mesh.name = 'Solvane shore water chunk';
      mesh.userData.excludeMotionBlur = true;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.root.children) (mesh as T.Mesh).geometry.dispose();
    this.material.dispose();
    // The sea owns the borrowed normal texture.
    this.root.clear();
    this.root.removeFromParent();
  }
}
