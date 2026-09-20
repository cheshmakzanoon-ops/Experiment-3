import { K, SKID_BASE } from '../simulation/protocol.ts';
import * as T from 'three';
import { Random, clamp } from '../core/math.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
import { renderWind } from '../simulation/weather.ts';

const COLORS = [
  [0.65, 0.73, 0.73],
  [0.52, 0.43, 0.28],
  [2.5, 0.9, 0.12],
  [0.65, 0.74, 0.77],
  [0.77, 0.77, 0.73],
  [0.045, 0.042, 0.038],
] as const;
export const PARTICLE_KIND = { SPRAY: 0, DUST: 1, SPARK: 2, RAIN: 3, SMOKE: 4, MARBLE: 5 } as const;
/** One bounded particle pool. All contact emitters use measured load and work;
 * weather advection consumes the same wind carried by physics and replay. */
export class Effects {
  readonly group = new T.Group();
  private count = 1800;
  private cursor = 0;
  private positions = new Float32Array(this.count * 3);
  private velocities = new Float32Array(this.count * 3);
  private life = new Float32Array(this.count);
  private maxLife = new Float32Array(this.count);
  private sizes = new Float32Array(this.count);
  private colors = new Float32Array(this.count * 3);
  private alpha = new Float32Array(this.count);
  private gravity = new Float32Array(this.count);
  private kind = new Uint8Array(this.count);
  private spawned = new Float64Array(6);
  private geometry = new T.BufferGeometry();
  private random = new Random(65012);
  private v = new T.Vector3();
  private wake = new T.Vector3();
  private q = new T.Quaternion();
  private emission = new Float64Array(12 * 4);
  private sparks = new Float64Array(12);
  private sparkWork = new Float64Array(12).fill(NaN);
  private sparkTime = -Infinity;
  private marbleEmission = new Float64Array(48);
  private marblePrevious = new Float64Array(48).fill(NaN);
  private marbleTime = -Infinity;
  private solid = new Float32Array(this.count);
  private shape = new Float32Array(this.count);
  private rainEmission = 0;
  private windX = 0;
  private windZ = 0;
  enabled = true;
  density = 1;
  constructor() {
    this.geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'size',
      new T.BufferAttribute(this.sizes, 1).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'color',
      new T.BufferAttribute(this.colors, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'opacity',
      new T.BufferAttribute(this.alpha, 1).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'solid',
      new T.BufferAttribute(this.solid, 1).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'shape',
      new T.BufferAttribute(this.shape, 1).setUsage(T.DynamicDrawUsage),
    );
    const material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      vertexShader: `attribute float size; attribute float opacity; attribute float solid; attribute float shape; varying float vSolid; varying float vShape; varying float vOpacity; varying vec3 vColor; void main(){vSolid=solid;vShape=shape;vOpacity=opacity;vColor=color;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;float scale=mix(1.,1.55,step(2.5,vShape)*step(vShape,3.5));gl_PointSize=clamp(size*scale*650./max(1.,-mv.z),1.,100.);}`,
      fragmentShader: `varying float vSolid;varying float vShape;varying float vOpacity;varying vec3 vColor;void main(){vec2 p=gl_PointCoord*2.-1.;float soft=exp(-dot(p,p)*3.)*(1.-smoothstep(.6,1.,length(p)));float spray=exp(-(p.x*p.x*5.+p.y*p.y*2.1))*(1.-smoothstep(.72,1.,length(p)));float spark=(1.-smoothstep(.18,.9,abs(p.x)+abs(p.y)*.22));float rain=exp(-abs(p.x)*13.)*(1.-smoothstep(.76,1.,abs(p.y)));float a=soft*vOpacity;if(vShape<.5)a=spray*vOpacity;else if(vShape>1.5&&vShape<2.5)a=spark*vOpacity;else if(vShape>2.5&&vShape<3.5)a=rain*vOpacity;a=mix(a,(1.-smoothstep(.55,.75,abs(p.x)+abs(p.y)*.8))*vOpacity,vSolid);if(a<.008)discard;gl_FragColor=vec4(vColor,a);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>}`,
    });
    const points = new T.Points(this.geometry, material);
    points.frustumCulled = false;
    this.group.add(points);
  }
  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, kind: number) {
    const i = this.cursor,
      p = i * 3,
      r = this.random;
    this.cursor = (this.cursor + 1) % this.count;
    this.kind[i] = kind;
    this.spawned[kind]++;
    this.solid[i] = Number(kind === PARTICLE_KIND.MARBLE);
    this.shape[i] = kind;
    this.positions[p] = x;
    this.positions[p + 1] = y;
    this.positions[p + 2] = z;
    this.velocities[p] = vx + (kind === PARTICLE_KIND.RAIN ? 0 : (r.next() - 0.5) * 2);
    this.velocities[p + 1] = vy;
    this.velocities[p + 2] = vz + (kind === PARTICLE_KIND.RAIN ? 0 : (r.next() - 0.5) * 2);
    if (kind === PARTICLE_KIND.SPARK) {
      this.life[i] = this.maxLife[i] = 0.35 + r.next() * 0.3;
      this.sizes[i] = 0.08 + r.next() * 0.035;
      this.gravity[i] = -8;
    } else if (kind === PARTICLE_KIND.RAIN) {
      this.life[i] = this.maxLife[i] = 0.45 + r.next() * 0.22;
      this.sizes[i] = 0.17 + r.next() * 0.08;
      this.gravity[i] = 0;
    } else if (kind === PARTICLE_KIND.SPRAY) {
      this.life[i] = this.maxLife[i] = 0.82 + r.next() * 0.58;
      this.sizes[i] = 0.16 + r.next() * 0.09;
      this.gravity[i] = -0.35;
    } else if (kind === PARTICLE_KIND.MARBLE) {
      this.life[i] = this.maxLife[i] = 0.3 + r.next() * 0.15;
      this.sizes[i] = 0.012 + r.next() * 0.013;
      this.gravity[i] = -9.80665;
    } else {
      this.life[i] = this.maxLife[i] = 1 + r.next() * 0.7;
      this.sizes[i] = 0.18;
      this.gravity[i] = kind === PARTICLE_KIND.SMOKE ? 0.9 : 0.55;
    }
    const color = COLORS[kind];
    this.colors[p] = color[0];
    this.colors[p + 1] = color[1];
    this.colors[p + 2] = color[2];
  }
  private marblePickup(frame: Float32Array, emit: boolean, density: number) {
    const time = frame[H.TIME];
    if (time === this.marbleTime) return; // A redisplayed snapshot is not new contact work.
    if (time < this.marbleTime || !emit) {
      this.marblePrevious.fill(NaN);
      this.marbleEmission.fill(0);
    }
    this.marbleTime = time;
    for (let id = 0; id < Math.min(12, frame[H.CARS]); id++) {
      const o = carBase(id);
      this.q.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
      for (let wheel = 0; wheel < 4; wheel++) {
        const slot = id * 4 + wheel,
          p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
        const total = frame[o + F.MARBLE_PICKUP_FR + wheel],
          previous = this.marblePrevious[slot];
        this.marblePrevious[slot] = total;
        const surface = frame[p + W.SURFACE];
        if (
          !emit ||
          !Number.isFinite(previous + total) ||
          total < previous ||
          frame[p + W.LOAD] <= 1 ||
          Math.abs(frame[o + F.SPEED]) < 1 ||
          surface > 2
        ) {
          this.marbleEmission[slot] = 0;
          continue;
        }
        // Cumulative measured pickup survives low render rates. The first frame,
        // a tire replacement and a replay rewind establish a baseline, not a burst.
        this.marbleEmission[slot] += Math.max(0, total - previous) * 320 * density;
        const births = Math.min(64, Math.floor(this.marbleEmission[slot] + 1e-6));
        this.marbleEmission[slot] = Math.max(
          0,
          this.marbleEmission[slot] - Math.floor(this.marbleEmission[slot] + 1e-6),
        );
        this.v
          .set(wheel % 2 === 0 ? -0.83 : 0.83, -0.37, wheel < 2 ? 1.82 : -1.62)
          .applyQuaternion(this.q);
        for (let i = 0; i < births; i++)
          this.spawn(
            frame[o] + this.v.x,
            frame[o + 1] + this.v.y,
            frame[o + 2] + this.v.z,
            frame[o + F.VX] * 0.4,
            1 + this.random.next(),
            frame[o + F.VZ] * 0.4,
            PARTICLE_KIND.MARBLE,
          );
      }
    }
  }
  private skidSparks(frame: Float32Array, dt: number, emit: boolean, density: number) {
    const time = frame[H.TIME];
    if (time === this.sparkTime) return;
    if (time < this.sparkTime || !emit) {
      this.sparkWork.fill(NaN);
      this.sparks.fill(0);
    }
    this.sparkTime = time;
    for (let id = 0; id < Math.min(12, frame[H.CARS]); id++) {
      const k = carBase(id) + SKID_BASE,
        work = frame[k + K.SPARK_WORK],
        previous = this.sparkWork[id];
      this.sparkWork[id] = work;
      if (!emit || !Number.isFinite(work + previous) || work < previous) {
        this.sparks[id] = 0;
        continue;
      }
      // Integrate actual hard-contact sliding work, including a short strike
      // between two render/replay samples. A first frame or rewind is not work.
      const power = (work - previous) / dt;
      this.sparks[id] += clamp((power - 300) / 80, 0, 100) * dt * density;
      const births = Math.floor(this.sparks[id] + 1e-6);
      this.sparks[id] = Math.max(0, this.sparks[id] - births);
      const nx = frame[k + K.NORMAL_X],
        ny = frame[k + K.NORMAL_Y],
        nz = frame[k + K.NORMAL_Z];
      const vx = frame[k + K.VELOCITY_X],
        vy = frame[k + K.VELOCITY_Y],
        vz = frame[k + K.VELOCITY_Z];
      const normalSpeed = vx * nx + vy * ny + vz * nz;
      for (let i = 0; i < births; i++)
        this.spawn(
          frame[k + K.SPARK_X] + nx * 0.005,
          frame[k + K.SPARK_Y] + ny * 0.005,
          frame[k + K.SPARK_Z] + nz * 0.005,
          (vx - normalSpeed * nx) * 0.6 + nx * 1.5,
          (vy - normalSpeed * ny) * 0.6 + ny * 1.5,
          (vz - normalSpeed * nz) * 0.6 + nz * 1.5,
          PARTICLE_KIND.SPARK,
        );
    }
  }
  update(frame: Float32Array, dt: number, emit = true) {
    if (!Number.isFinite(dt) || dt < 0 || dt > 0.25) throw new Error('Invalid particle timestep');
    this.group.visible = this.enabled;
    const r = this.random,
      density = clamp(this.density, 0, 1);
    // Even disabled effects observe counters, preventing catch-up clouds on enable.
    this.marblePickup(frame, emit && this.enabled && dt > 0, density);
    this.skidSparks(frame, dt, emit && this.enabled && dt > 0, density);
    if (!this.enabled || dt === 0) return;
    this.windX = renderWind(frame[H.WIND_X]);
    this.windZ = renderWind(frame[H.WIND_Z]);
    if (emit)
      for (let id = 0; id < Math.min(12, frame[H.CARS]); id++) {
        const o = carBase(id),
          speed = frame[o + F.SPEED];
        this.q.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
        this.wake.set(0, 0, -1).applyQuaternion(this.q).normalize();
        for (let wheel = 0; wheel < 4; wheel++) {
          const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE,
            slot = id * 4 + wheel;
          const water = frame[p + W.WATER],
            surface = frame[p + W.SURFACE];
          let rate = 0,
            kind: number = PARTICLE_KIND.SMOKE;
          if (frame[p + W.LOAD] > 1) {
            if (water > 0.04 && speed > 5) {
              const tread =
                frame[o + F.COMPOUND] === 4 ? 1.15 : frame[o + F.COMPOUND] === 3 ? 1 : 0.8;
              const loadFactor = clamp(frame[p + W.LOAD] / 3500, 0.35, 1.3);
              rate = Math.min(180, speed * water * 2.5 * tread * loadFactor);
              kind = PARTICLE_KIND.SPRAY;
            } else if ((surface === 3 || surface === 4) && speed > 4) {
              rate = speed * 1.7;
              kind = PARTICLE_KIND.DUST;
            } else if (speed > 6) {
              // Actual slip power includes lateral scrub and locked-wheel work.
              // The brake pedal itself is deliberately not an emission trigger.
              rate = clamp((frame[p + W.SLIP_POWER] - 1800) / 700, 0, 80);
            }
          }
          if (rate <= 0) {
            this.emission[slot] = 0;
            continue;
          }
          this.emission[slot] += rate * dt * density;
          const births = Math.floor(this.emission[slot] + 1e-9);
          this.emission[slot] = Math.max(0, this.emission[slot] - births);
          for (let birth = 0; birth < births; birth++) {
            this.v
              .set(wheel % 2 === 0 ? -0.83 : 0.83, -0.37, wheel < 2 ? 1.82 : -1.62)
              .applyQuaternion(this.q);
            const spray = kind === PARTICLE_KIND.SPRAY;
            this.spawn(
              frame[o] + this.v.x,
              frame[o + 1] + this.v.y,
              frame[o + 2] + this.v.z,
              spray
                ? frame[o + F.VX] * 0.16 + this.wake.x * speed * 0.2 + this.windX * 0.84
                : frame[o + F.VX] * 0.25 + this.windX * 0.75,
              spray ? 1.15 + r.next() * 1.4 : 1 + r.next(),
              spray
                ? frame[o + F.VZ] * 0.16 + this.wake.z * speed * 0.2 + this.windZ * 0.84
                : frame[o + F.VZ] * 0.25 + this.windZ * 0.75,
              kind,
            );
          }
        }
      }
    if (emit && frame[H.RAIN] > 0) {
      const o = carBase(0);
      // Keep fractional births: floor(rate*dt) every frame erased light rain at
      // high FPS. This accumulator measures elapsed time, not render frequency.
      this.rainEmission += clamp(frame[H.RAIN], 0, 100) * dt * 40 * density;
      const births = Math.min(this.count, Math.floor(this.rainEmission + 1e-9));
      this.rainEmission = Math.max(0, this.rainEmission - births);
      for (let i = 0; i < births; i++)
        this.spawn(
          frame[o] + (r.next() - 0.5) * 40,
          frame[o + 1] + 4 + r.next() * 18,
          frame[o + 2] + (r.next() - 0.5) * 40,
          this.windX,
          -15,
          this.windZ,
          PARTICLE_KIND.RAIN,
        );
    } else if (emit) this.rainEmission = 0;
    const entrainment = -Math.expm1(-dt * 0.65);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const p = i * 3;
      if (
        this.kind[i] === PARTICLE_KIND.SPRAY ||
        this.kind[i] === PARTICLE_KIND.DUST ||
        this.kind[i] === PARTICLE_KIND.SMOKE
      ) {
        this.velocities[p] += (this.windX - this.velocities[p]) * entrainment;
        this.velocities[p + 2] += (this.windZ - this.velocities[p + 2]) * entrainment;
      }
      this.velocities[p + 1] += this.gravity[i] * dt;
      this.positions[p] += this.velocities[p] * dt;
      this.positions[p + 1] += this.velocities[p + 1] * dt;
      this.positions[p + 2] += this.velocities[p + 2] * dt;
      const fade = clamp(this.life[i] / this.maxLife[i], 0, 1);
      const opacity =
        this.kind[i] === PARTICLE_KIND.MARBLE
          ? 0.95
          : this.kind[i] === PARTICLE_KIND.SPARK
            ? 0.82
            : this.kind[i] === PARTICLE_KIND.RAIN
              ? 0.52
              : this.kind[i] === PARTICLE_KIND.SPRAY
                ? 0.44
                : 0.35;
      this.alpha[i] = fade * opacity;
      if (this.kind[i] === PARTICLE_KIND.SPRAY) this.sizes[i] += dt * 0.72;
      else if (this.gravity[i] > 0.1) this.sizes[i] += dt * 0.6;
    }
    for (const attr of ['position', 'size', 'color', 'opacity', 'solid', 'shape'])
      this.geometry.getAttribute(attr).needsUpdate = true;
  }
  diagnostics() {
    const active = [0, 0, 0, 0, 0, 0],
      velocityX = [0, 0, 0, 0, 0, 0],
      velocityZ = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < this.count; i++)
      if (this.life[i] > 0) {
        const k = this.kind[i];
        active[k]++;
        velocityX[k] += this.velocities[i * 3];
        velocityZ[k] += this.velocities[i * 3 + 2];
      }
    for (let k = 0; k < 6; k++)
      if (active[k]) {
        velocityX[k] /= active[k];
        velocityZ[k] /= active[k];
      }
    return {
      capacity: this.count,
      active,
      spawned: Array.from(this.spawned),
      velocityX,
      velocityZ,
      windX: this.windX,
      windZ: this.windZ,
    };
  }
  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.emission.fill(0);
    this.sparks.fill(0);
    this.sparkWork.fill(NaN);
    this.sparkTime = -Infinity;
    this.spawned.fill(0);
    this.rainEmission = 0;
    this.marbleEmission.fill(0);
    this.marblePrevious.fill(NaN);
    this.marbleTime = -Infinity;
    // A paused/replay-seek frame may have dt=0 and never enter update().
    this.geometry.getAttribute('opacity').needsUpdate = true;
  }
}
