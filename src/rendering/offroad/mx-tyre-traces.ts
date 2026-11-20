import * as T from 'three';
import { clamp, lerp, mod } from '../../core/math.ts';
import {
  B,
  BIKE_BASE,
  F,
  H,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../simulation/protocol.ts';
import { MATERIAL } from '../../simulation/surface-material.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { vehicleAt } from '../../simulation/vehicles.ts';
import { MotocrossAxles, MX_TREAD_PAIRS } from './motocross-axles.ts';
import { mxWheelPatch, type Roost } from './roost.ts';
import type { TerrainView } from './terrain-view.ts';

// The archive is paged on demand. Only fresh marks have GPU geometry; old
// events remain available for a seek without keeping an entire race on the GPU.
const PAGE = 1024,
  ARCHIVE = 262144,
  ACTIVE = 8192,
  STRIDE = 14,
  LIFE = 12;
const SOIL = new Set<number>([MATERIAL.DIRT, MATERIAL.MUD, MATERIAL.SAND, MATERIAL.GRAVEL_ROAD]);
interface Sample {
  machine: number;
  seen: number;
  time: number;
  s: number;
  l: number;
  sideS: number;
  sideL: number;
  rootX: number;
  rootZ: number;
  steer: number;
  x: number;
  z: number;
  phase: number;
  omega: number;
}
type Surface = Pick<TerrainView, 'heightAt' | 'geometryRevision'>;

function traceMaterial() {
  return new T.ShaderMaterial({
    name: 'MX fresh tyre impressions in soil',
    transparent: true,
    depthWrite: false,
    blending: T.MultiplyBlending,
    premultipliedAlpha: true,
    side: T.DoubleSide,
    forceSinglePass: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    toneMapped: false,
    uniforms: { raceTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec4 mxTrace;
      varying vec2 vTread;
      varying vec3 vPrint;
      uniform float raceTime;
      void main() {
        float age = raceTime - mxTrace.x;
        vTread = uv;
        vPrint = vec3(mxTrace.y * (1.0 - smoothstep(4.0, 12.0, age)), mxTrace.zw);
        gl_Position = (age < -0.0005 || age >= 12.0) ? vec4(2.0, 2.0, 2.0, 1.0)
          : projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vTread;
      varying vec3 vPrint;
      void main() {
        float u = abs(vTread.x);
        float footprint = 1.0 - smoothstep(0.78, 1.0, u);
        float front = vPrint.z;
        float mid = smoothstep(0.18, 0.38, u);
        float shoulder = smoothstep(0.58, 0.8, u);
        // A narrow longitudinal front block and a broader rear drive block.
        // Alternate centre and side rows on the manufactured wheel pitch.
        float v = vTread.y + 0.5 * mid - 0.34 * shoulder + u * mix(-0.2, 0.3, front);
        float edge = max(fwidth(v), 0.025);
        float block = 1.0 - smoothstep(mix(0.26, 0.34, front) - edge,
          mix(0.26, 0.34, front) + edge, abs(fract(v + 0.5) - 0.5));
        float channels = 1.0 - 0.78 * (1.0 - smoothstep(0.025, 0.1,
          min(abs(u - 0.26), abs(u - 0.69))));
        float resolved = (1.0 - smoothstep(0.17, 0.75, edge)) * (1.0 - vPrint.y);
        float press = mix(mix(0.12, 0.6, vPrint.y), 0.14 + block * channels * 0.86, resolved);
        float coverage = footprint * press * vPrint.x * (1.0 - smoothstep(0.5, 2.0, fwidth(vTread.x)));
        // Modulate the already lit dirt, retaining its colour, shadows, wet
        // highlights and photographic detail underneath each cut in the soil.
        gl_FragColor = vec4(vec3(1.0) - vec3(0.43, 0.46, 0.48) * coverage, 1.0);
      }`,
  });
}

export class MxTyreTraces {
  readonly mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  private readonly pages: Float32Array[] = [];
  private readonly previous: (Sample | undefined)[] = [];
  private readonly patch = mxWheelPatch();
  private readonly road = trackPoint();
  private readonly side = new T.Vector3();
  private readonly terrainUV = new Float32Array(ACTIVE * 8);
  private readonly position = new T.BufferAttribute(new Float32Array(ACTIVE * 12), 3).setUsage(
    T.DynamicDrawUsage,
  );
  private readonly uv = new T.BufferAttribute(new Float32Array(ACTIVE * 8), 2).setUsage(
    T.DynamicDrawUsage,
  );
  private readonly print = new T.BufferAttribute(new Float32Array(ACTIVE * 16), 4).setUsage(
    T.DynamicDrawUsage,
  );
  private first = 0;
  private end = 0;
  private drawnEnd = 0;
  private revision = -1;
  private shown = -Infinity;
  private lastTime = -Infinity;
  private maxSlot = -1;

  constructor(private readonly track: Track) {
    const g = new T.BufferGeometry(),
      indices = new Uint16Array(ACTIVE * 6);
    for (let i = 0; i < ACTIVE; i++) {
      const p = i * 4;
      indices.set([p, p + 2, p + 1, p + 1, p + 2, p + 3], i * 6);
    }
    g.setAttribute('position', this.position);
    g.setAttribute('uv', this.uv);
    g.setAttribute('mxTrace', this.print);
    g.setIndex(new T.BufferAttribute(indices, 1));
    g.setDrawRange(0, 0);
    this.mesh = new T.Mesh(g, traceMaterial());
    this.mesh.name = 'MX recent grounded tyre prints';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  private timeAt(serial: number) {
    const i = serial % ARCHIVE;
    return this.pages[Math.floor(i / PAGE)][(i % PAGE) * STRIDE];
  }
  private after(time: number) {
    let lo = this.first,
      hi = this.end;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.timeAt(mid) <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  /** Raw worker snapshots arrive independently of the display refresh. The
   * camera can be paused, slow, or watching a different entrant. No marks
   * cross a flight, missing sample, bike change, teleport or new live branch. */
  record(frame: Float32Array, sampler: Roost) {
    const time = frame[H.TIME],
      cars = frame[H.CARS];
    if (!Number.isFinite(time) || time === this.lastTime) return;
    if (time < this.lastTime) {
      this.end = this.after(time);
      this.previous.length = 0;
      this.resetDraw();
    }
    this.lastTime = time;
    this.previous.length = Math.min(64, cars) * 2;
    for (let id = 0; id < Math.min(64, cars); id++) {
      const o = carBase(id),
        machine = Math.round(frame[o + RACE_BASE + R.VEHICLE]);
      const def = vehicleAt(machine),
        speed = Math.abs(frame[o + F.SPEED]);
      for (let tire = 0; tire < 2; tire++) {
        const slot = id * 2 + tire,
          front = tire === 0;
        const w = o + WHEEL_BASE + tire * 2 * WHEEL_STRIDE,
          load = frame[w + W.LOAD];
        if (
          !def.bike?.offroad ||
          speed < 0.4 ||
          frame[o + OFFROAD_BASE + O.AIRBORNE] > 0.5 ||
          load < 55 ||
          !SOIL.has(frame[w + W.SURFACE])
        ) {
          this.previous[slot] = undefined;
          continue;
        }
        const rx = frame[o + F.X],
          rz = frame[o + F.Z],
          steer = front ? frame[o + BIKE_BASE + B.STEER] : 0;
        let old = this.previous[slot];
        if (old && (old.machine !== machine || time - old.seen > 0.35)) old = undefined;
        if (old) {
          old.seen = time;
          if (
            Math.hypot(rx - old.rootX, rz - old.rootZ) < 0.4 &&
            Math.abs(steer - old.steer) < 0.12
          )
            continue;
        }
        sampler.recordedWheel(frame, o, front, def, this.patch);
        const p = this.patch;
        this.track.at(p.station, this.road);
        const axles = MotocrossAxles.of(def);
        const half =
          (front ? axles.frontWidth : axles.rearWidth) * (0.83 + 0.26 * clamp(load / 850, 0, 1));
        this.side.crossVectors(p.normal, p.forward);
        const along =
          ((this.side.x * this.road.tx + this.side.z * this.road.tz) * half) /
          Math.max(0.45, 1 - this.road.curvature * p.lateral);
        const across = (this.side.x * this.road.nx + this.side.z * this.road.nz) * half;
        const omega = Math.abs(frame[w + W.OMEGA]);
        let phase = 0;
        if (old) {
          const dt = time - old.time,
            distance = Math.hypot(p.position.x - old.x, p.position.z - old.z);
          const ds =
            mod(p.station - old.s + this.track.length / 2, this.track.length) -
            this.track.length / 2;
          if (
            distance > 0.04 &&
            distance <= Math.min(9, speed * dt * 1.8 + 0.6) &&
            Math.abs(ds) < distance * 3 + 1
          ) {
            const spin = ((omega + old.omega) * dt * MX_TREAD_PAIRS) / (2 * Math.PI);
            const roadTyre = def.tireFamily === 'supermoto';
            const slip = roadTyre
              ? 1
              : clamp(
                  Math.max(Math.abs(frame[w + W.SLIP]) * 1.7, Math.abs(frame[w + W.ANGLE]) * 1.9),
                  0,
                  1,
                );
            const strength =
              clamp(0.23 + load / 1350 + frame[o + OFFROAD_BASE + O.MOISTURE] * 0.28, 0.23, 0.93) *
              (roadTyre ? 0.55 : 1);
            const steps = Math.ceil(distance / 0.65);
            for (let step = 0; step < steps; step++) {
              const a = step / steps,
                b = (step + 1) / steps,
                i = this.end % ARCHIVE;
              const page = (this.pages[Math.floor(i / PAGE)] ??= new Float32Array(PAGE * STRIDE));
              const off = (i % PAGE) * STRIDE;
              page[off] = time;
              page[off + 1] = old.s + ds * a;
              page[off + 2] = lerp(old.l, p.lateral, a);
              page[off + 3] = lerp(old.sideS, along, a);
              page[off + 4] = lerp(old.sideL, across, a);
              page[off + 5] = old.s + ds * b;
              page[off + 6] = lerp(old.l, p.lateral, b);
              page[off + 7] = lerp(old.sideS, along, b);
              page[off + 8] = lerp(old.sideL, across, b);
              page[off + 9] = old.phase + spin * a;
              page[off + 10] = old.phase + spin * b;
              page[off + 11] = strength;
              page[off + 12] = slip;
              page[off + 13] = front ? 1 : 0;
              this.end++;
              this.first = Math.max(this.first, this.end - ARCHIVE);
            }
            phase = mod(old.phase + spin, 1);
          }
        }
        // Reuse the per-wheel sample when advancing an established trail.
        const next = old ?? ({} as Sample);
        next.machine = machine;
        next.time = next.seen = time;
        next.rootX = rx;
        next.rootZ = rz;
        next.steer = steer;
        next.x = p.position.x;
        next.z = p.position.z;
        next.s = p.station;
        next.l = p.lateral;
        next.sideS = along;
        next.sideL = across;
        next.phase = phase;
        next.omega = omega;
        this.previous[slot] = next;
      }
    }
  }

  private resetDraw() {
    this.mesh.geometry.setDrawRange(0, 0);
    this.maxSlot = -1;
    this.drawnEnd = 0;
    this.position.array.fill(0);
    this.position.clearUpdateRanges();
    this.position.addUpdateRange(0, this.position.array.length);
    this.position.needsUpdate = true;
  }

  private write(serial: number, surface: Surface, fresh: boolean) {
    const record = serial % ARCHIVE,
      data = this.pages[Math.floor(record / PAGE)];
    const off = (record % PAGE) * STRIDE,
      slot = serial % ACTIVE;
    for (let v = 0; v < 4; v++) {
      const vertex = slot * 4 + v;
      if (fresh) {
        const at = off + (v < 2 ? 1 : 5),
          side = v % 2 ? 1 : -1;
        const s = data[at] + data[at + 2] * side,
          l = data[at + 1] + data[at + 3] * side;
        this.terrainUV[vertex * 2] = s;
        this.terrainUV[vertex * 2 + 1] = l;
        this.track.at(s, this.road);
        this.position.setXYZ(
          vertex,
          this.road.x + this.road.nx * l,
          0,
          this.road.z + this.road.nz * l,
        );
        this.uv.setXY(vertex, side, data[off + (v < 2 ? 9 : 10)]);
        this.print.setXYZW(vertex, data[off], data[off + 11], data[off + 12], data[off + 13]);
      }
      this.position.setY(
        vertex,
        surface.heightAt(this.terrainUV[vertex * 2], this.terrainUV[vertex * 2 + 1]) + 0.0035,
      );
    }
    this.maxSlot = Math.max(this.maxSlot, slot);
  }

  /** Union outstanding uploads if a reflection, hidden tab or camera cut
   * delays the GPU read. A pause with unchanged dirt sends no new vertices. */
  private upload(attribute: T.BufferAttribute, from: number, to: number) {
    if (from >= to) return;
    const stride = 4 * attribute.itemSize,
      a = from % ACTIVE,
      b = (to - 1) % ACTIVE;
    let start = (a <= b ? a : 0) * stride,
      end = (a <= b ? b + 1 : ACTIVE) * stride;
    for (const pending of attribute.updateRanges) {
      start = Math.min(start, pending.start);
      end = Math.max(end, pending.start + pending.count);
    }
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(start, end - start);
    attribute.needsUpdate = true;
  }

  show(time: number, surface: Surface) {
    const end = this.after(time),
      first = Math.max(this.after(time - LIFE), end - ACTIVE);
    if (time < this.shown) this.resetDraw();
    this.mesh.material.uniforms.raceTime.value = time;
    this.mesh.visible = first < end;
    const insert = Math.max(first, this.drawnEnd);
    const refresh = this.revision !== surface.geometryRevision ? first : insert;
    for (let i = refresh; i < end; i++) this.write(i, surface, i >= insert);
    this.upload(this.position, refresh, end);
    this.upload(this.uv, insert, end);
    this.upload(this.print, insert, end);
    this.mesh.geometry.setDrawRange(0, (this.maxSlot + 1) * 6);
    this.drawnEnd = end;
    this.shown = time;
    this.revision = surface.geometryRevision;
  }

  get recordedSegments() {
    return this.end - this.first;
  }
  dispose() {
    this.previous.length = this.pages.length = 0;
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
