import * as T from 'three';
import { mod, Random } from '../../core/math.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import type { BuildQueue } from '../build-queue.ts';
import { inStandFootprint } from '../grandstand.ts';
import type { QualityPreset } from '../options.ts';
import { valueNoise } from '../terrain-profile.ts';
import { mxHighDetail, onMxDetail } from './mx-quality.ts';
import { mxShoulderPlantGeometry, mxShoulderPlantMaterial } from './mx-shoulder-plants.ts';
import { mxFurnitureGround, type MxFurnitureSite } from './mx-trackside-furniture.ts';

export interface MxMeadowStats {
  /** Installed clumps and draw chunks, zero while absent. */
  clumps: number;
  chunks: number;
  /** Candidate work since creation, including cancelled builds. */
  candidates: number;
}

interface MeadowBuild {
  root: T.Group;
  meshes: T.InstancedMesh[];
  geometry: T.BufferGeometry | null;
  material: T.MeshStandardMaterial | null;
  clumps: number;
  iterator: Generator<void, void, void> | null;
  ready: boolean;
  disposed: boolean;
}

/** The graphics transaction installs before compilation, then accepts or
 * rolls back. Both methods are idempotent; disposal cancels every owner. */
export interface MxMeadowTransition {
  readonly root: T.Group | null;
  apply(): boolean;
  finish(accepted: boolean): void;
}

const CHUNK = 110;
const CANDIDATES = 58000;
const CANDIDATE_BATCH = 256;
/** Metres beyond the legal edge where the field begins and ends. */
export const MX_MEADOW_BAND = Object.freeze({ near: 5.2, far: 34 });
const MAX_SLOPE = 0.4;

/** Uncut field grass on the visible ground, outside courses and furniture.
 * Construction is inert on Low/Medium. Initial High/Ultra work is split into
 * BuildQueue jobs; a live upgrade prepares the same deterministic sequence
 * away from the scene and yields between bounded candidate/mesh batches. */
export class MxMeadow {
  readonly root = new T.Group();
  readonly stats: MxMeadowStats = { clumps: 0, chunks: 0, candidates: 0 };
  private readonly time = { value: 0 };
  private readonly owned = new Set<MeadowBuild>();
  private readonly unsubscribe: () => void;
  private readonly furniture: () => readonly MxFurnitureSite[];
  private active: MeadowBuild | null = null;
  private transition: MxMeadowTransition | null = null;
  private initial: MeadowBuild | null = null;
  private generation = 0;
  private enabled = mxHighDetail();
  private disposed = false;
  private queued = false;

  constructor(
    private readonly track: Track,
    furniture: readonly MxFurnitureSite[] | (() => readonly MxFurnitureSite[]) = [],
  ) {
    const surface = Track.offroadOf(track);
    if (!(surface instanceof TrackTerrainSurface) || surface.kind !== 'motocross')
      throw new Error('Meadow grass needs an outdoor motocross course');
    this.furniture = typeof furniture === 'function' ? furniture : () => furniture;
    this.root.name = 'MX field grass';
    this.root.visible = false;
    // Synchronous budget changes only change visibility. Resource release is
    // committed by the awaited graphics transaction, so a failed downgrade
    // can restore the already resident High planting without rebuilding it.
    this.unsubscribe = onMxDetail((high) => {
      this.enabled = high;
      this.root.visible = high && this.active !== null;
    });
  }

  /** Queue before construction starts. Furniture is read when work starts,
   * after the higher-priority course furniture tasks have completed. */
  queueInitial(construction: BuildQueue) {
    if (this.queued) throw new Error('Meadow construction already queued');
    this.queued = true;
    const steps =
      Math.ceil(CANDIDATES / CANDIDATE_BATCH) + Math.ceil(this.track.length / CHUNK) + 1;
    let begun = false;
    for (let step = 0; step < steps; step++) {
      construction.add('MX field grass', 4, () => {
        if (this.disposed) return;
        if (!begun) {
          begun = true;
          if (this.enabled && !this.active) this.initial = this.newBuild();
        }
        if (!this.initial) return;
        if (!this.enabled) {
          this.release(this.initial);
          this.initial = null;
          return;
        }
        if (this.advance(this.initial)) {
          const complete = this.initial;
          this.initial = null;
          this.install(complete);
        }
      });
    }
  }

  /** False means cancelled; null means the requested assets are resident
   * already (including an empty Low/Medium tier). Never starts background work. */
  async prepareQuality(
    quality: QualityPreset,
    cancelled: () => boolean,
    yieldControl: () => Promise<void>,
  ): Promise<MxMeadowTransition | null | false> {
    this.transition?.finish(false);
    if (this.initial) {
      this.release(this.initial);
      this.initial = null;
    }
    const generation = ++this.generation;
    const stopped = () => this.disposed || cancelled() || generation !== this.generation;
    if (stopped()) return false;
    const high = quality === 'high' || quality === 'ultra';
    if (high === (this.active !== null)) return null;
    const next = high ? this.newBuild() : null;
    try {
      while (next && !next.ready) {
        // Yield before the first batch as well, so a pending cancellation
        // costs no terrain sampling or geometry allocation.
        await yieldControl();
        if (stopped()) {
          this.release(next);
          return false;
        }
        this.advance(next);
      }
      if (stopped()) {
        if (next) this.release(next);
        return false;
      }
    } catch (error) {
      if (next) this.release(next);
      if (stopped()) return false;
      throw error;
    }
    let previous: MeadowBuild | null = null;
    let applied = false,
      finished = false;
    const transition: MxMeadowTransition = {
      root: next?.root ?? null,
      apply: () => {
        if (finished || stopped()) return false;
        if (!applied) {
          previous = this.active;
          this.install(next);
          applied = true;
        }
        return true;
      },
      finish: (accepted) => {
        if (finished) return;
        finished = true;
        if (this.transition === transition) this.transition = null;
        if (accepted && applied && !stopped()) {
          if (previous) this.release(previous);
        } else {
          if (applied && !this.disposed) this.install(previous);
          if (next) this.release(next);
          if (this.disposed && previous) this.release(previous);
        }
      },
    };
    this.transition = transition;
    return transition;
  }

  private newBuild() {
    const build: MeadowBuild = {
      root: new T.Group(),
      meshes: [],
      geometry: null,
      material: null,
      clumps: 0,
      iterator: null,
      ready: false,
      disposed: false,
    };
    build.root.name = 'MX prepared field grass';
    build.iterator = this.build(build);
    this.owned.add(build);
    return build;
  }
  private advance(build: MeadowBuild) {
    if (build.disposed) return false;
    try {
      if (build.iterator?.next().done) {
        build.iterator = null;
        build.ready = true;
      }
      return build.ready;
    } catch (error) {
      this.release(build);
      throw error;
    }
  }
  private install(build: MeadowBuild | null) {
    this.active?.root.removeFromParent();
    this.active = build;
    if (build) this.root.add(build.root);
    this.stats.clumps = build?.clumps ?? 0;
    this.stats.chunks = build?.meshes.length ?? 0;
    this.root.visible = this.enabled && build !== null;
  }
  private release(build: MeadowBuild) {
    if (build.disposed) return;
    build.disposed = true;
    build.iterator?.return();
    build.iterator = null;
    build.root.removeFromParent();
    for (const mesh of build.meshes) mesh.dispose();
    build.meshes.length = 0;
    build.geometry?.dispose();
    build.geometry = null;
    build.material?.dispose();
    build.material = null;
    build.root.clear();
    this.owned.delete(build);
  }

  private *build(build: MeadowBuild): Generator<void, void, void> {
    const track = this.track,
      furniture = this.furniture(),
      course = (Track.offroadOf(track) as TrackTerrainSurface).course,
      random = new Random(77213),
      point = trackPoint(),
      nearby = trackPoint(),
      object = new T.Object3D(),
      up = new T.Vector3(0, 1, 0),
      normal = new T.Vector3();
    const chunks = Math.ceil(track.length / CHUNK);
    const poses: T.Matrix4[][] = Array.from({ length: chunks }, () => []);
    const colours: T.Color[][] = Array.from({ length: chunks }, () => []);
    const patchAt = (x: number, z: number) => valueNoise(x * 0.045 + 3.1, z * 0.045 - 9.4);
    const slopeAt = (x: number, z: number) => {
      const h = 0.5,
        gx = (mxFurnitureGround(track, x + h, z) - mxFurnitureGround(track, x - h, z)) / (2 * h),
        gz = (mxFurnitureGround(track, x, z + h) - mxFurnitureGround(track, x, z - h)) / (2 * h);
      return { gx, gz };
    };
    // Dense enough that the field reads as standing grass, not dots on a
    // lawn, from the chase camera's height (High/Ultra only, instanced).
    for (let start = 0; start < CANDIDATES; start += CANDIDATE_BATCH) {
      const end = Math.min(CANDIDATES, start + CANDIDATE_BATCH);
      for (let i = start; i < end; i++) {
        this.stats.candidates++;
        const s = random.next() * track.length,
          side = random.next() < 0.5 ? -1 : 1;
        const at = track.at(s, point);
        // Denser by the shoulder, a thinning field beyond.
        const reach = Math.pow(random.next(), 1.35);
        const lateral =
          side *
          (course.legalWidth(at.width, s, side) +
            MX_MEADOW_BAND.near +
            reach * (MX_MEADOW_BAND.far - MX_MEADOW_BAND.near));
        const x = at.x + at.nx * lateral,
          z = at.z + at.nz * lateral;
        const patch = patchAt(x, z);
        if (random.next() > 0.18 + patch * 0.95 - reach * 0.32) continue;
        // The nearest road must be this one, and well clear of it.
        const l = track.nearest(x, z, nearby),
          gap = Math.abs(mod(nearby.s - s + track.length / 2, track.length) - track.length / 2);
        if (gap > 12) continue;
        if (Math.abs(l) < course.legalWidth(nearby.width, nearby.s, l) + MX_MEADOW_BAND.near - 0.6)
          continue;
        if (inStandFootprint(track, x, z, 3)) continue;
        if (furniture.some((site) => Math.hypot(site.x - x, site.z - z) < site.radius + 1.5))
          continue;
        const { gx, gz } = slopeAt(x, z);
        if (Math.hypot(gx, gz) > MAX_SLOPE) continue;
        normal.set(-gx, 1, -gz).normalize();
        object.position.set(x, mxFurnitureGround(track, x, z) - 0.045, z);
        object.quaternion.setFromUnitVectors(up, normal);
        object.rotateY(random.next() * Math.PI * 2);
        // Taller where the field has gone to seed, shorter at the margin.
        object.scale.setScalar(0.75 + patch * 0.7 + random.next() * 0.35 - reach * 0.2);
        object.updateMatrix();
        const chunk = Math.min(chunks - 1, Math.floor(s / CHUNK));
        poses[chunk].push(object.matrix.clone());
        // Linear-light tints: cool fresh green to straw (setHSL reads linear).
        colours[chunk].push(
          new T.Color().setHSL(
            0.15 + random.next() * 0.075 - patch * 0.02,
            0.2 + random.next() * 0.16,
            0.2 + random.next() * 0.1 + patch * 0.05,
          ),
        );
      }
      yield;
    }
    build.material = mxShoulderPlantMaterial(this.time);
    build.geometry = mxShoulderPlantGeometry('meadow');
    for (let c = 0; c < chunks; c++) {
      if (!poses[c].length) {
        yield;
        continue;
      }
      const mesh = new T.InstancedMesh(build.geometry, build.material, poses[c].length);
      build.root.add(mesh);
      build.meshes.push(mesh);
      poses[c].forEach((m, k) => {
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, colours[c][k]);
      });
      mesh.name = `MX field grass ${c * CHUNK}-${(c + 1) * CHUNK} m`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      build.clumps += poses[c].length;
      yield;
    }
  }
  /** Absolute simulation time only: a held frame is still. */
  update(time: number) {
    if (Number.isFinite(time)) this.time.value = Math.max(0, time);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.unsubscribe();
    this.transition?.finish(false);
    for (const build of this.owned) this.release(build);
    this.initial = null;
    this.active = null;
    this.root.clear();
    this.root.visible = false;
    this.stats.clumps = this.stats.chunks = 0;
  }
}
