import * as T from 'three';
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
}

export class MxLooseSoil {
  readonly root = new T.Group();
  readonly stats: MxLooseSoilStats = { clods: 0, stones: 0, chunks: 0 };
  private readonly clodMaterial: T.MeshStandardMaterial;
  private stoneMaterial: T.MeshStandardMaterial | null = null;
  private readonly meshes: { mesh: T.InstancedMesh; total: number }[] = [];
  private readonly geometries: T.BufferGeometry[] = [];
  private readonly clodBase: T.Color;
  private readonly unsubscribe: () => void;
  private readonly wet = { value: 0 };
  constructor(private readonly track: Track) {
    const surface = Track.offroadOf(track);
    if (
      !(surface instanceof TrackTerrainSurface) ||
      !['motocross', 'supercross'].includes(surface.kind)
    )
      throw new Error('Loose soil needs a motocross or supercross course');
    this.root.name = 'MX loose soil: clods and pebbles';
    const indoor = surface.kind === 'supercross';
    this.clodBase = new T.Color(indoor ? 0x6e5238 : 0x8f6d4b).convertSRGBToLinear();
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
      object.position.set(x, y + radius * (stone ? 0.2 : 0.12), z);
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
      list.push({ matrix: object.matrix.clone(), colour: c });
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
        const berm = wear.berm * side > 0 ? Math.abs(wear.berm) : 0;
        if (berm > 0.15 && random.next() < 0.9 * berm) {
          const lateral = side * (here.width * (0.8 + random.next() * 0.45));
          place(
            clods[chunk],
            jitter,
            lateral,
            0.011 + Math.pow(random.next(), 3) * 0.045,
            false,
            0.85 + random.next() * 0.35,
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
        poses.forEach((pose, i) => {
          mesh.setMatrixAt(i, pose.matrix);
          mesh.setColorAt(i, pose.colour);
        });
        mesh.name = `MX loose ${label} ${c * CHUNK}-${(c + 1) * CHUNK} m`;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.computeBoundingSphere();
        this.root.add(mesh);
        this.meshes.push({ mesh, total: poses.length });
        if (label === 'clods') this.stats.clods += poses.length;
        else this.stats.stones += poses.length;
      }
    }
    this.stats.chunks = this.meshes.length;
  }
  /** Damp ground darkens and glosses its loose crumbs (session wetness 0..1). */
  setWetness(wetness: number) {
    this.wet.value = clamp(wetness, 0, 1);
  }
  dispose() {
    this.unsubscribe();
    for (const { mesh } of this.meshes) mesh.dispose();
    for (const g of this.geometries) g.dispose();
    this.clodMaterial.dispose();
    this.stoneMaterial?.dispose();
    this.root.clear();
    this.meshes.length = 0;
  }
}
