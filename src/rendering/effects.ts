import { K, SKID_BASE } from '../simulation/protocol.ts';
import * as T from 'three';
import { Random, clamp } from '../core/math.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
import { renderWind } from '../simulation/weather.ts';
import { RainStreaks } from './rain-streaks.ts';
import { SprayClouds } from './spray-clouds.ts';
import { precipitationLighting } from './precipitation-light.ts';

export const EFFECT_CAPACITY = { contact: 1200, rain: 600 } as const;

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
  private count = EFFECT_CAPACITY.contact + EFFECT_CAPACITY.rain;
  private cursor = 0;
  private rainCursor = 0;
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
  private rain = new RainStreaks(
    this.positions.subarray(EFFECT_CAPACITY.contact * 3),
    this.velocities.subarray(EFFECT_CAPACITY.contact * 3),
    this.alpha.subarray(EFFECT_CAPACITY.contact),
  );
  private spray = new SprayClouds(
    this.positions.subarray(0, EFFECT_CAPACITY.contact * 3),
    this.velocities.subarray(0, EFFECT_CAPACITY.contact * 3),
    this.sizes.subarray(0, EFFECT_CAPACITY.contact),
    this.alpha.subarray(0, EFFECT_CAPACITY.contact),
    this.kind.subarray(0, EFFECT_CAPACITY.contact),
  );
  private viewport = new T.Vector4();
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
    // Rain cannot overwrite tire/contact trails, even at the 100 mm/h input bound.
    this.geometry.setDrawRange(0, EFFECT_CAPACITY.contact);
    this.geometry.setAttribute(
      'kind',
      new T.BufferAttribute(this.kind, 1).setUsage(T.DynamicDrawUsage),
    );
    const material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      fog: true,
      lights: true,
      uniforms: {
        ...T.UniformsUtils.clone(T.UniformsLib.fog),
        ...T.UniformsUtils.clone(T.UniformsLib.lights),
        viewportHeight: { value: 1 },
      },
      vertexShader: `
        #include <common>
        #include <lights_pars_begin>
        ${precipitationLighting}
        attribute float size; attribute float opacity; attribute float solid; attribute float kind;
        uniform float viewportHeight;
        varying float vSolid; varying float vKind; varying float vOpacity; varying vec3 vColor;
        #include <fog_pars_vertex>
        void main() {
          vSolid=solid; vKind=kind; vOpacity=opacity; vColor=color;
          if(kind<.5) { vOpacity=0.; gl_Position=vec4(2.,2.,2.,1.); gl_PointSize=1.; return; }
          vec4 mvPosition=modelViewMatrix*vec4(position,1.);
          if(!(kind>1.5&&kind<2.5)) vColor*=particleEnergy(mvPosition.xyz,0.);
          gl_Position=projectionMatrix*mvPosition;
          gl_PointSize=clamp(size*projectionMatrix[1][1]*viewportHeight*.5/max(.1,-mvPosition.z),1.,120.);
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying float vSolid; varying float vKind; varying float vOpacity; varying vec3 vColor;
        #include <fog_pars_fragment>
        void main() {
          vec2 p=gl_PointCoord*2.-1.;
          float soft=exp(-dot(p,p)*3.)*(1.-smoothstep(.6,1.,length(p)));
          float spark=(1.-smoothstep(.04,.18,abs(p.x+p.y*.22)))*(1.-smoothstep(.58,1.,abs(p.y)));
          float a=(vKind>1.5&&vKind<2.5?spark:soft)*vOpacity;
          a=mix(a,(1.-smoothstep(.55,.75,abs(p.x)+abs(p.y)*.8))*vOpacity,vSolid);
          if(a<.008)discard;
          gl_FragColor=vec4(vColor,a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    material.userData.localWeatherPosition = 'position';
    const points = new T.Points(this.geometry, material);
    points.name = 'Contact smoke, sparks and debris';
    points.frustumCulled = false;
    points.onBeforeRender = (renderer) => {
      renderer.getCurrentViewport(this.viewport);
      material.uniforms.viewportHeight.value = Math.max(1, this.viewport.w);
    };
    this.group.add(points, this.rain.mesh, this.spray.mesh);
  }
  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, kind: number) {
    const isRain = kind === PARTICLE_KIND.RAIN;
    const i = isRain ? EFFECT_CAPACITY.contact + this.rainCursor : this.cursor,
      p = i * 3,
      r = this.random;
    if (isRain) this.rainCursor = (this.rainCursor + 1) % EFFECT_CAPACITY.rain;
    else this.cursor = (this.cursor + 1) % EFFECT_CAPACITY.contact;
    this.kind[i] = kind;
    this.spawned[kind]++;
    this.solid[i] = Number(kind === PARTICLE_KIND.MARBLE);
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
      this.sizes[i] = 0.19 + r.next() * 0.11;
      this.gravity[i] = -0.35;
    } else if (kind === PARTICLE_KIND.MARBLE) {
      this.life[i] = this.maxLife[i] = 0.3 + r.next() * 0.15;
      this.sizes[i] = 0.012 + r.next() * 0.013;
      this.gravity[i] = -9.80665;
    } else {
      this.life[i] = this.maxLife[i] = 1 + r.next() * 0.7;
      this.sizes[i] = kind === PARTICLE_KIND.SMOKE ? 0.24 : 0.18;
      this.gravity[i] = kind === PARTICLE_KIND.SMOKE ? 0.78 : 0.48;
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
              const loadFactor = clamp(frame[p + W.LOAD] / 2500, 0.35, 1.3);
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
          // Cover eye/road level even when heavy rain recycles this bounded pool
          // faster than a droplet can fall from the top of the volume.
          frame[o + 1] + r.next() * 14,
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
      const remaining = clamp(this.life[i] / this.maxLife[i], 0, 1);
      if (this.kind[i] === PARTICLE_KIND.SPRAY) {
        const age = this.maxLife[i] - this.life[i];
        // Soft birth and broadening mist keep a trail legible, not a chain of dots.
        this.alpha[i] = Math.min(1, age / 0.06) * remaining ** 0.7 * 0.5;
        this.sizes[i] += dt * 1.05;
      } else {
        this.alpha[i] =
          remaining *
          (this.kind[i] === PARTICLE_KIND.MARBLE
            ? 0.95
            : this.kind[i] === PARTICLE_KIND.SPARK
              ? 0.82
              : this.kind[i] === PARTICLE_KIND.RAIN
                ? 0.34
                : this.kind[i] === PARTICLE_KIND.SMOKE
                  ? 0.42
                  : 0.31);
        if (this.kind[i] === PARTICLE_KIND.SMOKE) this.sizes[i] += dt * 0.72;
        else if (this.kind[i] === PARTICLE_KIND.DUST) this.sizes[i] += dt * 0.46;
      }
    }
    for (const attr of ['position', 'size', 'color', 'opacity', 'solid', 'kind'])
      this.geometry.getAttribute(attr).needsUpdate = true;
    this.rain.upload();
    this.spray.upload();
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
      contactCapacity: EFFECT_CAPACITY.contact,
      rainCapacity: EFFECT_CAPACITY.rain,
      active,
      spawned: Array.from(this.spawned),
      velocityX,
      velocityZ,
      windX: this.windX,
      windZ: this.windZ,
    };
  }
  /** Number of actual presented rear signals in the bounded spray light field. */
  get signalSourceCount() {
    return this.spray.signals.count.value;
  }
  setSignalLights(frame: Float32Array, enabled: boolean) {
    this.spray.signals.update(frame, enabled && this.enabled);
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
    this.rain.clear();
    this.spray.clear();
  }
}
