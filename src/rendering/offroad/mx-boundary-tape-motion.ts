import * as T from 'three';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../../simulation/protocol.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { MX_GUST_GLSL, type MxVenueWind } from './mx-venue-wind.ts';

/** A ribbon section moves sideways by at most 41 mm. The edge can swing
 * another half width around the centreline. Both ties are stationary. */
const BOW_LIMIT = 0.041;
const WAKE_REACH = 8;

/** A compact impulse, with zero velocity on entry and exit. */
function pulse(age: number, start: number, end: number) {
  if (age <= start || age >= end) return 0;
  const u = (age - start) / (end - start);
  const arc = 4 * u * (1 - u);
  return arc * arc;
}

/** The light plastic bows between ties, then rolls about its long axis. A
 * rider's pressure pulse, suction and weaker returning wave travel along the
 * span. Evaluate at the displayed positions so a replay cut has no stale wake. */
export class MxBoundaryTapeMotion {
  private readonly positions: T.BufferAttribute;
  private readonly normals: T.BufferAttribute;
  private readonly centres: Float32Array;
  private readonly order: Uint32Array;
  private readonly axis: number;
  private readonly maxRadius: number;
  private readonly accumulated: Float32Array;
  private readonly wake: T.BufferAttribute;
  private readonly rings: number;
  // Keep the union of this frame's samples and the preceding frame's samples.
  // An empty trail and a held grid need no full-venue buffer scan or upload.
  private readonly touched: Uint32Array;
  private readonly marked: Uint8Array;
  private used = 0;

  constructor(
    mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>,
    segments: number,
    halfWidth: number,
    time: T.IUniform<number>,
    wind: MxVenueWind,
  ) {
    const g = mesh.geometry;
    this.positions = g.getAttribute('position') as T.BufferAttribute;
    this.normals = g.getAttribute('normal') as T.BufferAttribute;
    this.rings = segments + 1;
    const count = this.positions.count;
    const spans = count / (2 * this.rings);
    this.centres = new Float32Array(spans * 3);
    this.accumulated = new Float32Array(count / 2);
    this.touched = new Uint32Array(count / 2);
    this.marked = new Uint8Array(count / 2);
    this.wake = new T.BufferAttribute(new Float32Array(count), 1).setUsage(T.DynamicDrawUsage);
    const binding = new Float32Array(count * 2);
    const bounds = new T.Box2();
    const midpoint = new T.Vector2();
    let widest = 0;
    for (let s = 0; s < spans; s++) {
      const first = 2 * s * this.rings;
      const last = first + 2 * segments;
      const x = this.positions.getX(first);
      const z = this.positions.getZ(first);
      const dx = this.positions.getX(last) - x;
      const dz = this.positions.getZ(last) - z;
      const length = Math.hypot(dx, dz);
      midpoint.set(x + dx * 0.5, z + dz * 0.5);
      bounds.expandByPoint(midpoint);
      widest = Math.max(widest, length * 0.5);
      this.centres.set([midpoint.x, midpoint.y, length * 0.5], s * 3);
      for (let j = 0; j <= segments; j++) {
        const t = j / segments;
        const freedom = j === segments ? 0 : Math.sin(Math.PI * t);
        const phase = x * 0.39 + z * 0.23 + t * length * 1.18;
        binding.set([freedom, phase, freedom, phase], (first + 2 * j) * 2);
      }
    }
    bounds.getSize(midpoint);
    this.axis = midpoint.x >= midpoint.y ? 0 : 1;
    this.maxRadius = widest;
    this.order = Uint32Array.from({ length: spans }, (_, s) => s * 3);
    this.order.sort((a, b) => this.centres[a + this.axis] - this.centres[b + this.axis]);
    g.setAttribute('mxTapeBind', new T.BufferAttribute(binding, 2));
    g.setAttribute('mxTapeWake', this.wake);
    const excursion = BOW_LIMIT + halfWidth * 1.1;
    g.computeBoundingSphere();
    g.boundingSphere!.radius += excursion;
    g.computeBoundingBox();
    g.boundingBox!.expandByScalar(excursion);

    chainShaderHook(mesh.material, 'mx-boundary-tape-motion-v1', (shader) => {
      shader.uniforms.mxTapeTime = time;
      shader.uniforms.mxVenueWind = wind;
      injectDeclarations(shader, 'common', `
        uniform float mxTapeTime;
        uniform vec3 mxVenueWind;
        attribute vec2 mxTapeBind;
        attribute float mxTapeWake;
        ${MX_GUST_GLSL}
        vec2 mxTapePose() {
          float gust = mxVenueGust(position.xz, mxTapeTime);
          float wave = sin(mxTapeBind.y - mxTapeTime * 4.3 + 0.65 * gust);
          float ripple = sin(mxTapeBind.y * 1.47 - mxTapeTime * 6.6 + 0.42 * wave);
          float pressure = dot(normal.xz, mxVenueWind.xy);
          float air = mxVenueWind.z * (0.24 + 0.76 * abs(pressure));
          float bow = 0.019 * mxVenueWind.z * pressure * (0.45 + 0.55 * gust)
                    + 0.009 * air * wave + 0.037 * mxTapeWake;
          float roll = air * (0.35 + 0.65 * gust) * (0.68 * wave + 0.28 * ripple)
                     + 1.08 * mxTapeWake;
          return mxTapeBind.x * vec2(clamp(bow, -${BOW_LIMIT}, ${BOW_LIMIT}), clamp(roll, -1.1, 1.1));
        }`, 'vertex');
      injectAfter(shader, 'beginnormal_vertex', `
        vec2 mxTapeBend = mxTapePose();
        float mxTapeSin = sin(mxTapeBend.y), mxTapeCos = cos(mxTapeBend.y);
        objectNormal = objectNormal * mxTapeCos - vec3(0.0, mxTapeSin, 0.0);`, 'vertex');
      injectAfter(shader, 'begin_vertex', `
        float mxTapeEdge = (uv.y * 2.0 - 1.0) * ${halfWidth};
        transformed.xz += normal.xz * (mxTapeBend.x + mxTapeEdge * mxTapeSin);
        transformed.y += mxTapeEdge * (mxTapeCos - 1.0);`, 'vertex');
    });
  }

  update(frame?: Float32Array) {
    if (!frame && !this.used) return;
    if (frame) {
      const riders = Math.min(Math.floor(frame[H.CARS]), Math.floor((frame.length - HEADER) / CAR_STRIDE));
      for (let i = 0; i < riders; i++) {
        const b = carBase(i);
        const vx = frame[b + F.VX], vz = frame[b + F.VZ];
        const speed = Math.hypot(vx, vz);
        const x = frame[b + F.X], y = frame[b + F.Y], z = frame[b + F.Z];
        if (!(speed > 3) || !Number.isFinite(speed + x + y + z)) continue;
        this.addWake(x, y, z, vx / speed, vz / speed, Math.min(45, speed));
      }
    }
    const values = this.wake.array as Float32Array;
    let changed = false;
    let retained = 0;
    for (let i = 0; i < this.used; i++) {
      const j = this.touched[i];
      const value = T.MathUtils.clamp(this.accumulated[j], -1, 1);
      this.accumulated[j] = 0;
      if (value !== 0) this.touched[retained++] = j;
      else this.marked[j] = 0;
      if (values[2 * j] === value) continue;
      values[2 * j] = values[2 * j + 1] = value;
      changed = true;
    }
    this.used = retained;
    if (changed) this.wake.needsUpdate = true;
  }

  private addWake(x: number, y: number, z: number, fx: number, fz: number, speed: number) {
    const gain = T.MathUtils.smoothstep(speed, 3, 23);
    const positions = this.positions.array, normals = this.normals.array;
    // Start with the swept interval on the venue's widest axis. Only this
    // neighbourhood needs a per-span or per-ring test on the racing frame.
    const axis = this.axis, origin = axis === 0 ? x : z;
    const heading = axis === 0 ? fx : fz;
    const margin = this.maxRadius + WAKE_REACH * Math.abs(axis === 0 ? fz : fx);
    const nose = origin + 0.2 * speed * heading, tail = origin - 1.2 * speed * heading;
    const min = Math.min(nose, tail) - margin, max = Math.max(nose, tail) + margin;
    let lo = 0, hi = this.order.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.centres[this.order[mid] + axis] < min) lo = mid + 1;
      else hi = mid;
    }
    for (let k = lo; k < this.order.length; k++) {
      const s = this.order[k];
      if (this.centres[s + axis] > max) break;
      const dx = this.centres[s] - x, dz = this.centres[s + 1] - z;
      const radius = this.centres[s + 2];
      // Reject the whole chord outside the rider's short tapered trail.
      const along = dx * fx + dz * fz, side = dx * fz - dz * fx;
      if (along > radius + 0.2 * speed || along < -radius - 1.2 * speed ||
          Math.abs(side) > radius + WAKE_REACH) continue;
      const first = s / 3 * this.rings;
      // Top and bottom share one wake value and a face normal. Each ring
      // holds two xyz vertices, so the top edge starts six scalars apart.
      const face = normals[first * 6] * fz - normals[first * 6 + 2] * fx;
      for (let j = first + 1; j < first + this.rings - 1; j++) {
        const i = j * 6;
        const rx = positions[i] - x;
        const rz = positions[i + 2] - z;
        const cross = rx * fz - rz * fx;
        const across = Math.abs(cross);
        const height = Math.abs(positions[i + 1] - y);
        if (across >= WAKE_REACH || height >= 2.8) continue;
        // Air takes a little time to spread sideways from the passing bike.
        const age = -(rx * fx + rz * fz) / speed - 0.032 * across + 0.055;
        if (age <= -0.11 || age >= 0.88) continue;
        const packet = pulse(age, -0.11, 0.23) - 0.58 * pulse(age, 0.14, 0.59)
                     + 0.2 * pulse(age, 0.47, 0.88);
        const exposure = (1 - T.MathUtils.smoothstep(across, 1, WAKE_REACH))
                       * (1 - T.MathUtils.smoothstep(height, 0.7, 2.8));
        if (!this.marked[j]) {
          this.marked[j] = 1;
          this.touched[this.used++] = j;
        }
        this.accumulated[j] += gain * exposure * face * packet * cross / Math.sqrt(1 + cross * cross);
      }
    }
  }
}
