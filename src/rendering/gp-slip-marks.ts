import * as T from 'three';
import { clamp, smooth } from '../core/math.ts';
import {
  B,
  BC,
  BIKE_BASE,
  F,
  H,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
  hasRoadBikeContact,
  wheelContactBase,
} from '../simulation/protocol.ts';
import { SURFACE, trackPoint, type Track } from '../simulation/track.ts';
import { vehicleAt } from '../simulation/vehicles.ts';
import { GpTyreContactProjector } from './gp-tyre-contacts.ts';

/** Friction work per metre (joules/metre) and per unit normal load distinguish
 * sustained scrub from a tyre simply carrying a large cornering force. The
 * existing wheel ABI gives each duplicate slot half the physical tyre's watts. */
export function gpSlipInk(load: number, speed: number, halfWatts: number, water: number) {
  if (!(load > 70 && speed > 4 && halfWatts > 0 && water < 0.34)) return 0;
  const work = (2 * halfWatts) / speed;
  return (
    0.68 *
    smooth(12, 100, work) *
    smooth(0.045, 0.2, work / load) *
    smooth(70, 330, load) *
    (1 - smooth(0.035, 0.34, water))
  );
}

// Each knot holds centre, half-width vector, ground normal, track UV, stamp V and ink.
const KNOT = 13,
  EVENT = 1 + 2 * KNOT;
const PAGE = 256,
  HISTORY = 32768,
  VISIBLE = 1536,
  VERTEX = 14;
const MAX_GAP = 0.24;
const sealed = (id: number) =>
  id === SURFACE.ASPHALT || id === SURFACE.PAINT || id === SURFACE.KERB;

/** Recent physical tyre wipes. The raw worker stream supplies the events,
 * independently of the display cadence. Replays select a timestamp in the
 * same history. Only the most recent strips occupy the single GPU draw. */
export class GpSlipMarks {
  readonly mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  private readonly vertices = new T.InterleavedBuffer(
    new Float32Array(VISIBLE * 4 * VERTEX),
    VERTEX,
  ).setUsage(T.DynamicDrawUsage);
  private readonly pages: Float32Array[] = [];
  private readonly trails: { knot: Float64Array; time: number; machine: number }[] = [];
  private readonly projector = new GpTyreContactProjector();
  private readonly contacts = [new T.Vector4(), new T.Vector4()];
  private readonly strengths = [0, 0];
  private readonly shape = new T.Vector4();
  private readonly position = new T.Vector3();
  private readonly orientation = new T.Quaternion();
  private readonly forward = new T.Vector3();
  private readonly normal = new T.Vector3();
  private readonly side = new T.Vector3();
  private readonly road = trackPoint();
  private readonly knot = new Float64Array(KNOT);
  private first = 0;
  private end = 0;
  private drawn = -1;
  private lastTime = -Infinity;

  constructor(
    private readonly track: Track,
    material: T.MeshStandardMaterial,
  ) {
    const g = new T.BufferGeometry();
    for (const [name, size, offset] of [
      ['position', 3, 0],
      ['normal', 3, 3],
      ['uv', 2, 6],
      ['trackUV', 2, 8],
      ['color', 4, 10],
    ] as const)
      g.setAttribute(name, new T.InterleavedBufferAttribute(this.vertices, size, offset));
    // Repeated indices allow a wrapped range in a single draw.
    const index = new Uint16Array(VISIBLE * 12);
    for (let i = 0; i < VISIBLE * 2; i++) {
      const k = (i % VISIBLE) * 4;
      index.set([k, k + 2, k + 1, k + 1, k + 2, k + 3], i * 6);
    }
    g.setIndex(new T.BufferAttribute(index, 1));
    g.setDrawRange(0, 0);
    this.mesh = new T.Mesh(g, material);
    this.mesh.name = 'GP measured tyre slip on the road';
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  private page(id: number) {
    const page = Math.floor((id % HISTORY) / PAGE);
    return (this.pages[page] ??= new Float32Array(PAGE * EVENT));
  }
  private after(time: number) {
    let low = this.first,
      high = this.end;
    if (low === high || this.page(high - 1)[((high - 1) % PAGE) * EVENT] <= time) return high;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.page(mid)[(mid % PAGE) * EVENT] <= time) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  truncate(time: number) {
    this.end = this.after(time);
    this.trails.length = 0;
    this.lastTime = time;
    this.drawn = -1;
    this.show(time);
  }
  clear() {
    this.first = this.end = 0;
    this.pages.length = 0;
    this.truncate(-Infinity);
  }
  get recordedSegments() {
    return this.end - this.first;
  }
  get visibleSegments() {
    return this.mesh.geometry.drawRange.count / 6;
  }

  record(frame: Float32Array) {
    const time = frame[H.TIME],
      cars = frame[H.CARS];
    if (!Number.isFinite(time) || time === this.lastTime) return;
    if (time < this.lastTime) this.truncate(time);
    this.lastTime = time;
    for (let id = 0; id < cars; id++) {
      const c = carBase(id),
        machine = frame[c + RACE_BASE + R.VEHICLE];
      const definition = vehicleAt(machine),
        speed = Math.abs(frame[c + F.SPEED]);
      const active =
        definition.classId === 'gp-bike' &&
        speed > 4 &&
        !frame[c + F.IN_PIT] &&
        frame[c + BIKE_BASE + B.STATE] === 0 &&
        hasRoadBikeContact(frame, c);
      let project = false;
      for (let axle = 0; axle < 2; axle++) {
        const contact = wheelContactBase(c, 2 * axle),
          w = c + WHEEL_BASE + 2 * axle * WHEEL_STRIDE;
        const trail = this.trails[id * 2 + axle];
        if (
          !active ||
          frame[contact + BC.GAP] > 0.009 ||
          !sealed(frame[w + W.SURFACE]) ||
          frame[contact + BC.LOAD] < 70
        ) {
          if (trail) trail.time = -Infinity;
          this.strengths[axle] = 0;
          continue;
        }
        if (trail && (time - trail.time > MAX_GAP || trail.machine !== machine))
          trail.time = -Infinity;
        this.strengths[axle] = gpSlipInk(
          frame[contact + BC.LOAD],
          speed,
          frame[w + W.SLIP_POWER],
          frame[w + W.WATER],
        );
        project ||= this.strengths[axle] > 0.007 || !!(trail && Number.isFinite(trail.time));
      }
      if (!project) continue;
      this.position.fromArray(frame, c + F.X);
      this.orientation.fromArray(frame, c + F.QX).normalize();
      this.forward.set(0, 0, 1).applyQuaternion(this.orientation);
      this.projector.project(
        frame,
        c,
        definition,
        this.position,
        this.orientation,
        Math.atan2(this.forward.x, this.forward.z),
        this.contacts[0],
        this.contacts[1],
        this.shape,
      );
      this.track.at(frame[c + F.S], this.road);
      for (let axle = 0; axle < 2; axle++) {
        const slot = id * 2 + axle,
          ink = this.strengths[axle];
        if (ink <= 0.007 && !Number.isFinite(this.trails[slot]?.time)) continue;
        const w = c + WHEEL_BASE + 2 * axle * WHEEL_STRIDE,
          contact = wheelContactBase(c, axle * 2);
        const patch = this.contacts[axle];
        const trail = (this.trails[slot] ??= {
          knot: new Float64Array(KNOT),
          time: -Infinity,
          machine,
        });
        if (patch.w < 0.98) {
          trail.time = -Infinity;
          continue;
        }
        const k = this.knot,
          old = trail.knot;
        this.normal.fromArray(frame, contact + BC.NORMAL_X);
        // Contact area rises with load and falls with inflation pressure.
        const pressure = clamp(frame[w + W.PRESSURE] || 180, 70, 320) * 1000;
        const half = clamp(
          Math.sqrt(frame[contact + BC.LOAD] / (Math.PI * pressure * (axle ? 1.55 : 2.1))),
          0.016,
          axle ? 0.1 : 0.06,
        );
        this.side.crossVectors(this.normal, this.forward).setLength(half);
        k[0] = patch.x + this.normal.x * 0.006;
        k[1] = patch.z + this.normal.y * 0.006;
        k[2] = patch.y + this.normal.z * 0.006;
        this.side.toArray(k, 3);
        this.normal.toArray(k, 6);
        const dx = patch.x - this.road.x,
          dz = patch.y - this.road.z;
        k[9] = clamp(0.5 + (0.5 * (dx * this.road.nx + dz * this.road.nz)) / this.road.width, 0, 1);
        k[10] = (this.road.s + dx * this.road.tx + dz * this.road.tz) / this.track.length;
        k[11] = (this.road.s * 0.17 + slot * 0.29) % 1;
        k[12] = 0;
        if (Number.isFinite(trail.time)) {
          const distance = Math.hypot(k[0] - old[0], k[1] - old[1], k[2] - old[2]);
          if (distance < 0.46 && ink > 0.007) continue;
          if (distance > 0.025 && distance < speed * (time - trail.time) * 1.8 + 0.65) {
            k[11] = old[11] + distance / 3.8;
            k[12] = ink > 0.007 ? ink : 0;
            // Unwrap only this pair across the timing line; the material
            // applies fract after interpolation, as it does on historic marks.
            k[10] += Math.round(old[10] - k[10]);
            const page = this.page(this.end),
              at = (this.end % PAGE) * EVENT;
            page[at] = time;
            page.set(old, at + 1);
            page.set(k, at + 1 + KNOT);
            this.end++;
            this.first = Math.max(this.first, this.end - HISTORY);
          }
        }
        k[11] -= Math.floor(k[11]);
        k[10] -= Math.floor(k[10]);
        old.set(k);
        trail.machine = machine;
        trail.time = ink > 0.007 ? time : -Infinity;
      }
    }
  }

  show(time: number, visible = true) {
    const end = this.after(time),
      start = Math.max(this.first, end - VISIBLE);
    this.mesh.visible = visible && start < end;
    const geometry = this.mesh.geometry;
    geometry.setDrawRange((start % VISIBLE) * 6, (end - start) * 6);
    if (!this.mesh.visible || end === this.drawn) return;
    const from = this.drawn < start || this.drawn > end ? start : this.drawn;
    const bytes = this.vertices.array;
    for (let i = from; i < end; i++) {
      const page = this.page(i),
        at = (i % PAGE) * EVENT + 1;
      for (let vertex = 0; vertex < 4; vertex++) {
        const source = at + (vertex >= 2 ? KNOT : 0),
          side = vertex % 2 ? 1 : -1;
        const out = ((i % VISIBLE) * 4 + vertex) * VERTEX;
        for (let xyz = 0; xyz < 3; xyz++) {
          bytes[out + xyz] = page[source + xyz] + side * page[source + 3 + xyz];
          bytes[out + 3 + xyz] = page[source + 6 + xyz];
        }
        bytes[out + 6] = vertex % 2;
        bytes[out + 7] = page[source + 11];
        bytes[out + 8] = page[source + 9];
        bytes[out + 9] = page[source + 10];
        bytes[out + 10] = bytes[out + 11] = bytes[out + 12] = 1;
        bytes[out + 13] = page[source + 12];
      }
    }
    // Union any unconsumed range, including one across the ring wrap.
    let lo = (from % VISIBLE) * 4 * VERTEX,
      hi = (((end - 1) % VISIBLE) + 1) * 4 * VERTEX;
    if (lo >= hi) {
      lo = 0;
      hi = bytes.length;
    }
    for (const r of this.vertices.updateRanges) {
      lo = Math.min(lo, r.start);
      hi = Math.max(hi, r.start + r.count);
    }
    this.vertices.clearUpdateRanges();
    this.vertices.addUpdateRange(lo, hi - lo);
    this.vertices.needsUpdate = true;
    this.drawn = end;
  }
}
