import * as T from 'three';
import { markItems } from '../attribute-ranges.ts';
import type { TerrainView } from './terrain-view.ts';
import { disposeOffroadResources } from './owned-resources.ts';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, mod, Random } from '../../core/math.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import { albedoOf, installScannedMaps } from '../ground/scanned-ground.ts';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import { mxCourseWearSample, sampleMxCourseWear } from './mx-course-wear.ts';
import { onMxDetail } from './mx-quality.ts';

/** Loose soil lying on the prepared surface: crumbs kicked out of the line,
 * broken clods on berm lips, and a few pebbles. Presentation only (no
 * collider, no contact, no effect on grip): none is larger than a fist, and
 * those on the prepared surface are thumb-sized. None stand on the starter's
 * pad or a jump face. Scatter is deterministic per course. */
export interface MxLooseSoilStats {
  clods: number;
  stones: number;
  chunks: number;
}

const CHUNK = 150;
/** Share of the scatter that stays on Low and Medium. */
const LOW_SHARE = 0.3;

/** A broken, faceted clod: a displaced 80-triangle ball with its underside
 * darkened (contact occlusion) and metre UVs for the photographed soil. */
export function looseClodGeometry(seed: number, angular: number, flat: number) {
  const raw = new T.IcosahedronGeometry(1, 1);
  raw.deleteAttribute('uv');
  raw.deleteAttribute('normal');
  const g = mergeVertices(raw, 1e-4);
  raw.dispose();
  const random = new Random(seed);
  const position = g.getAttribute('position') as T.BufferAttribute;
  const radial = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) radial[i] = 1 + (random.next() - 0.5) * angular;
  const colour = new Float32Array(position.count * 3);
  const uv = new Float32Array(position.count * 2);
  const v = new T.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).normalize().multiplyScalar(radial[i]);
    // Squash and tilt toward a flat-topped, broad-based crumb.
    v.y *= flat;
    position.setXYZ(i, v.x, v.y, v.z);
    // Occlusion: the base meets the ground, the crown is open sky.
    const open = clamp(0.62 + 0.55 * (v.y / Math.max(flat, 0.2)), 0.38, 1);
    colour[i * 3] = colour[i * 3 + 1] = colour[i * 3 + 2] = open;
    uv[i * 2] = v.x + v.y * 0.37;
    uv[i * 2 + 1] = v.z + v.y * 0.21;
  }
  g.setAttribute('color', new T.BufferAttribute(colour, 3));
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

interface Pose {
  matrix: T.Matrix4;
  colour: T.Color;
  station: number;
  lateral: number;
  lift: number;
}
type Ground = Pick<TerrainView, 'heightAt' | 'heightCellAt' | 'heightRevisions' | 'geometryRevision'>;
interface SoilChunk {
  mesh: T.InstancedMesh;
  total: number;
  anchors: Float64Array;
  cells: Int32Array;
}

export class MxLooseSoil {
  readonly root = new T.Group();
  readonly stats: MxLooseSoilStats = { clods: 0, stones: 0, chunks: 0 };
  private readonly clodMaterial: T.MeshStandardMaterial;
  private stoneMaterial: T.MeshStandardMaterial | null = null;
  private readonly meshes: SoilChunk[] = [];
  private receiver: Ground | null = null;
  private revision = -1;
  private readonly geometries: T.BufferGeometry[] = [];
  private readonly clodBase: T.Color;
  private readonly unsubscribe: () => void;
  private readonly wet = { value: 0 };
  private disposed = false;
  constructor(private readonly track: Track) {
    const surface = Track.offroadOf(track);
    if (
      !(surface instanceof TrackTerrainSurface) ||
      !['motocross', 'supercross'].includes(surface.kind)
    )
      throw new Error('Loose soil needs a motocross or supercross course');
    this.root.name = 'MX loose soil: clods and pebbles';
    const indoor = surface.kind === 'supercross';
    this.clodBase = new T.Color(indoor ? 0x6e5238 : 0x8f6d4b);
    this.clodMaterial = new T.MeshStandardMaterial({
      name: 'MX loose clods',
      color: this.clodBase.clone(),
      roughness: 0.96,
      vertexColors: true,
      flatShading: true,
    });
    installScannedMaps(
      this.clodMaterial,
      'dryEarth',
      [this.clodBase.r, this.clodBase.g, this.clodBase.b],
      // The geometry's UVs are unit-ball coordinates; one unit is a few
      // centimetres of the photographed set, not a metre of it.
      0.04,
    );
    this.wetten(this.clodMaterial);
    this.build(surface, indoor);
    this.unsubscribe = onMxDetail((high) => {
      for (const { mesh, total } of this.meshes)
        mesh.count = high ? total : Math.floor(total * LOW_SHARE);
    });
  }
  /** Damp ground darkens and glosses its loose crumbs (a uniform, not a recompile). */
  private wetten(material: T.MeshStandardMaterial) {
    chainShaderHook(material, 'mx-loose-soil-wet-v1', (shader) => {
      shader.uniforms.mxLooseWet = this.wet;
      shader.fragmentShader = `uniform float mxLooseWet;\n${shader.fragmentShader}`;
      injectAfter(
        shader,
        'color_fragment',
        'diffuseColor.rgb *= 1.0 - 0.34 * mxLooseWet;',
        'fragment',
      );
      injectAfter(
        shader,
        'roughnessmap_fragment',
        'roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.55, mxLooseWet );',
        'fragment',
      );
    });
  }
  /** Created with the first pebble: a venue without any (the indoor arena)
   * registers no scanned-ground material it would never draw. */
  private pebbles() {
    if (!this.stoneMaterial) {
      this.stoneMaterial = new T.MeshStandardMaterial({
        name: 'MX loose pebbles',
        color: 0x8c8576,
        roughness: 0.9,
        vertexColors: true,
        flatShading: true,
      });
      installScannedMaps(this.stoneMaterial, 'rock', albedoOf(0x8c8576), 0.03);
      this.wetten(this.stoneMaterial);
    }
    return this.stoneMaterial;
  }
  private build(surface: TrackTerrainSurface, indoor: boolean) {
    const track = this.track,
      course = surface.course,
      terrain = surface.terrain,
      random = new Random(90417),
      point = trackPoint(),
      here = trackPoint(),
      nearby = trackPoint(),
      wear = mxCourseWearSample(),
      object = new T.Object3D();
    const chunks = Math.ceil(track.length / CHUNK);
    const clods: Pose[][] = Array.from({ length: chunks }, () => []);
    const stones: Pose[][] = Array.from({ length: chunks }, () => []);
    const lateralLimit = -terrain.lateralMin - 0.3;
    const clear = (s: number, lateral: number) => {
      // A vertex belongs to another section of the course (hairpin legs,
      // parallel straights) when that one is the nearer road.
      track.at(s, point);
      const x = point.x + point.nx * lateral,
        z = point.z + point.nz * lateral;
      const l = track.nearest(x, z, nearby),
        gap = Math.abs(mod(nearby.s - s + track.length / 2, track.length) - track.length / 2);
      return gap < 8 || Math.abs(l) > course.legalWidth(nearby.width, nearby.s, l) + 0.4;
    };
    const place = (
      list: Pose[],
      s: number,
      lateral: number,
      radius: number,
      stone: boolean,
      tone: number,
    ) => {
      if (Math.abs(lateral) > lateralLimit || !clear(s, lateral)) return false;
      track.at(s, point);
      const x = point.x + point.nx * lateral,
        z = point.z + point.nz * lateral;
      const y = terrain.baseHeight(s, lateral);
      // Sit slightly sunk; a squat crumb, a rounder pebble.
      const lift = radius * (stone ? 0.2 : 0.12);
      object.position.set(x, y + lift, z);
      object.rotation.set(
        (random.next() - 0.5) * 0.5,
        random.next() * Math.PI * 2,
        (random.next() - 0.5) * 0.5,
      );
      const stretch = 0.78 + random.next() * 0.47;
      object.scale.set(radius * stretch, radius * (0.8 + random.next() * 0.35), radius / stretch);
      object.updateMatrix();
      const c = new T.Color().setScalar(tone);
      // A drier crumb is paler; a freshly turned one is darker and redder.
      c.r *= 1 + (random.next() - 0.5) * 0.12;
      c.b *= 1 - (random.next() - 0.5) * 0.12;
      list.push({ matrix: object.matrix.clone(), colour: c, station: s, lateral, lift });
      return true;
    };
    const step = 0.55,
      gate = course.spec.gate;
    for (let s = 0; s < track.length; s += step) {
      // The starter's pad and its approach are groomed by hand.
      if (
        gate &&
        Math.abs(mod(s - gate.s + track.length / 2, track.length) - track.length / 2 + 5) < 12
      )
        continue;
      const chunk = Math.min(chunks - 1, Math.floor(s / CHUNK));
      track.at(s, here);
      sampleMxCourseWear(course, s, here.curvature, wear);
      const face = Math.max(wear.launch, wear.landing);
      for (const side of [-1, 1] as const) {
        if (side === track.pit.side && track.isPitSection(s)) continue;
        const legal = course.legalWidth(here.width, s, side);
        const jitter = s + (random.next() - 0.5) * step;
        // 1. Kicked out of the line: clods and crumbs along the shoulder, thick
        // at the legal edge and thinning into the grass.
        const outside = random.next() * random.next();
        if (random.next() < (indoor ? 0.55 : 0.78)) {
          const lateral = side * (legal + 0.08 + outside * 2.4);
          const stone = !indoor && random.next() < 0.12;
          const radius = stone
            ? 0.011 + random.next() * random.next() * 0.03
            : 0.012 + Math.pow(random.next(), 3) * 0.048;
          const tone = (stone ? 0.9 : 0.78) + random.next() * 0.4;
          place(stone ? stones[chunk] : clods[chunk], jitter, lateral, radius, stone, tone);
        }
        // 2. Berm lips keep the loose crumb the line's tyres threw up there.
        // A ridden berm's lip is a rough rim of thrown clods, up to fist size,
        // banked thickest at the crest (three tries per station).
        const berm = wear.berm * side > 0 ? Math.abs(wear.berm) : 0;
        for (let k = 0; k < 3; k++)
          if (berm > 0.15 && random.next() < 0.9 * berm) {
            const lateral = side * (here.width * (0.82 + random.next() * random.next() * 0.45));
            place(
              clods[chunk],
              s + (random.next() - 0.5) * step,
              lateral,
              0.012 + Math.pow(random.next(), 2.5) * 0.046,
              false,
              0.8 + random.next() * 0.4,
            );
          }
        // 3. Sparse small crumbs resting on the prepared surface itself,
        // never on a jump face and never large enough to read as an obstacle.
        if (face < 0.25 && random.next() < 0.05) {
          const lateral = side * legal * (0.1 + random.next() * 0.8);
          const stone = !indoor && random.next() < 0.1;
          place(
            stone ? stones[chunk] : clods[chunk],
            jitter,
            lateral,
            0.008 + random.next() * 0.014,
            stone,
            (stone ? 0.95 : 0.85) + random.next() * 0.3,
          );
        }
      }
    }
    const clodGeometry = looseClodGeometry(4711, 0.42, 0.62);
    const stoneGeometry = looseClodGeometry(8123, 0.3, 0.7);
    this.geometries.push(clodGeometry, stoneGeometry);
    for (let c = 0; c < chunks; c++) {
      for (const [poses, geometry, material, label] of [
        [clods[c], clodGeometry, this.clodMaterial, 'clods'],
        [stones[c], stoneGeometry, null, 'pebbles'],
      ] as const) {
        if (!poses.length) continue;
        // A random order, so the Low/Medium subset is spatially uniform.
        for (let i = poses.length - 1; i > 0; i--) {
          const j = Math.floor(random.next() * (i + 1));
          [poses[i], poses[j]] = [poses[j], poses[i]];
        }
        const mesh = new T.InstancedMesh(geometry, material ?? this.pebbles(), poses.length);
        const anchors = new Float64Array(poses.length * 3);
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        poses.forEach((pose, i) => {
          anchors.set([pose.station, pose.lateral, pose.lift], i * 3);
          mesh.setMatrixAt(i, pose.matrix);
          mesh.setColorAt(i, pose.colour);
        });
        mesh.name = `MX loose ${label} ${c * CHUNK}-${(c + 1) * CHUNK} m`;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.computeBoundingSphere();
        this.root.add(mesh);
        this.meshes.push({ mesh, total: poses.length, anchors, cells: new Int32Array(poses.length) });
        if (label === 'clods') this.stats.clods += poses.length;
        else this.stats.stones += poses.length;
      }
    }
    this.stats.chunks = this.meshes.length;
  }
  /** Settle the same scatter on the triangles currently shown by the race
   * or replay. Quality changes only the draw count: a hidden crumb will
   * already be at the correct height when the full field comes back. */
  conform(ground: Ground) {
    if (this.disposed) return;
    const fresh = ground !== this.receiver;
    if (!fresh && this.revision === ground.geometryRevision) return;
    for (const { mesh, total, cells, anchors } of this.meshes) {
      const attr = mesh.instanceMatrix, matrices = attr.array;
      const bound = mesh.boundingSphere!;
      let first = total, last = -1;
      for (let i = 0; i < total; i++) {
        const a = i * 3;
        if (fresh) cells[i] = ground.heightCellAt(anchors[a], anchors[a + 1]);
        else if (cells[i] < 0 || ground.heightRevisions[cells[i]] <= this.revision) continue;
        const y = Math.fround(ground.heightAt(anchors[a], anchors[a + 1]) + anchors[a + 2]);
        const m = i * 16;
        if (y === matrices[m + 13]) continue;
        matrices[m + 13] = y;
        if (i < first) first = i;
        last = i;
        // Conservatively expand the existing full-density chunk bound only
        // when a moved crumb reaches its edge (all clods fit in 10 cm).
        const dx = matrices[m + 12] - bound.center.x, dz = matrices[m + 14] - bound.center.z;
        const d2 = dx * dx + (y - bound.center.y) ** 2 + dz * dz;
        if (d2 > (bound.radius - 0.1) ** 2) bound.radius = Math.max(bound.radius, Math.sqrt(d2) + 0.1);
      }
      markItems(attr, first, last);
    }
    this.receiver = ground;
    this.revision = ground.geometryRevision;
  }
  /** Damp ground darkens and glosses its loose crumbs (session wetness 0..1). */
  setWetness(wetness: number) {
    if (this.disposed) return;
    this.wet.value = clamp(wetness, 0, 1);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    disposeOffroadResources(
      [this.root],
      this.stoneMaterial ? [this.clodMaterial, this.stoneMaterial] : [this.clodMaterial],
      [],
      this.geometries,
    );
    this.geometries.length = 0;
    this.meshes.length = 0;
    this.receiver = null;
  }
}
