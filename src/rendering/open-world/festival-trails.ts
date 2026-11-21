import * as T from 'three';
import { clamp } from '../../core/math.ts';
import {
  F,
  H,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../simulation/protocol.ts';
import { vehicleAt } from '../../simulation/vehicles.ts';
import { roadTyreSection } from '../../simulation/bike-tyre-profile.ts';
import { surfaceMaterial } from '../../simulation/surface-material.ts';
import { vehicleDynamics } from '../../simulation/vehicle-dynamics.ts';
import { markItems } from '../attribute-ranges.ts';
import { bodySheetFor } from '../vehicle-bodies/body-sheet.ts';
import { tireSmokeSliding } from '../effects.ts';
import { festivalContactLocal } from './festival-contacts.ts';

// Emit in world metres. The residual distance crosses render frames so a
// 144 Hz corner and a 30 Hz corner use the same rubber and buffer budget.
const STRIDE = 0.8;
const markLift = 0.016;
type GroundHeight = (x: number, z: number, y?: number) => number;

function wheelTrail() {
  return {
    input: new T.Vector3(NaN, NaN, NaN),
    start: new T.Vector3(),
    edge: new T.Vector3(),
    otherEdge: new T.Vector3(),
    remaining: STRIDE,
    time: 0,
    strength: 0,
    joined: false,
  };
}

/** A bounded ribbon of rubber at the player's actual loaded wheel contacts.
 * Wet/loose surfaces and airborne wheels do not receive asphalt skid marks.
 * Resets and travel break the ribbon, never joining two distant locations. */
export class FestivalTrails {
  readonly capacity = 1024;
  readonly root: T.Mesh;
  private readonly positions = new Float32Array(this.capacity * 12);
  private readonly born = new Float32Array(this.capacity * 4).fill(-1000);
  private readonly opacity = new Float32Array(this.capacity * 4);
  private readonly geometry = new T.BufferGeometry();
  private readonly material: T.ShaderMaterial;
  private readonly wheels = Array.from({ length: 4 }, wheelTrail);
  private readonly axle = new T.Vector3();
  private readonly tread = new Float32Array(2);
  private readonly current = new T.Vector3();
  private readonly quaternion = new T.Quaternion();
  private previousTime = NaN;
  private previousVehicle = -1;
  private cursor = 0;
  segments = 0;
  enabled = true;
  constructor() {
    const uv = new Float32Array(this.capacity * 8),
      indices = new Uint16Array(this.capacity * 6);
    for (let i = 0; i < this.capacity; i++) {
      uv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
      indices.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    }
    this.geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'born',
      new T.BufferAttribute(this.born, 1).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'strength',
      new T.BufferAttribute(this.opacity, 1).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    this.geometry.setIndex(new T.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);
    this.material = new T.ShaderMaterial({
      uniforms: { time: { value: 0 }, water: { value: 0 } },
      vertexShader: `attribute float born; attribute float strength;
        varying vec2 vUv; varying float vBorn; varying float vStrength;
        void main(){ vUv=uv; vBorn=born; vStrength=strength;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float time; uniform float water;
        varying vec2 vUv; varying float vBorn; varying float vStrength;
        void main(){ float edge=smoothstep(0.,.17,vUv.x)*smoothstep(0.,.17,1.-vUv.x);
          float fade=1.-smoothstep(28.,45.,time-vBorn);
          float phase=vUv.x*73.;
          float grooves=.78+.22*cos(phase)*(1.-smoothstep(1.,3.14,fwidth(phase)));
          float a=edge*fade*vStrength*grooves*(1.-water*.85);
          if(a<.008) discard; gl_FragColor=vec4(.035,.033,.03,a); }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: T.DoubleSide,
    });
    this.root = new T.Mesh(this.geometry, this.material);
    this.root.name = 'Festival contact rubber trails';
    this.root.frustumCulled = false;
  }
  reset() {
    this.wheels.forEach((w) => {
      w.input.x = NaN;
    });
    this.previousTime = NaN;
  }
  update(frame: Float32Array, height: GroundHeight) {
    const time = frame[H.TIME],
      o = carBase(0),
      vehicle = Math.round(frame[o + RACE_BASE + R.VEHICLE]);
    this.root.visible = this.enabled;
    this.material.uniforms.time.value = time;
    this.material.uniforms.water.value = clamp(frame[H.WATER], 0, 1);
    if (time === this.previousTime) return;
    if (time < this.previousTime) {
      this.segments = 0;
      this.cursor = 0;
      this.geometry.setDrawRange(0, 0);
    }
    if (
      !this.enabled ||
      vehicle !== this.previousVehicle ||
      !(time > this.previousTime) ||
      time - this.previousTime > 0.5
    )
      this.reset();
    const def = vehicleAt(vehicle);
    if (vehicle !== this.previousVehicle) {
      if (def.dynamicsKind === 'bike') {
        const section = roadTyreSection(def.classId);
        this.tread.set([section.frontHalfWidth * 2, section.rearHalfWidth * 2]);
      } else {
        const wheels = bodySheetFor(def)?.wheels.width;
        const commonWidth = vehicleDynamics(def).tyre.width;
        this.tread.set(wheels ?? [commonWidth, commonWidth]);
      }
    }
    const priorTime = this.previousTime;
    this.previousVehicle = vehicle;
    this.previousTime = time;
    if (!this.enabled) return;
    this.quaternion.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
    const first = this.cursor;
    let emitted = 0;
    for (let w = 0; w < 4; w++) {
      // Bikes duplicate front/rear telemetry into each axle's two slots.
      if (def.dynamicsKind === 'bike' && w % 2 === 1) continue;
      const p = o + WHEEL_BASE + w * WHEEL_STRIDE,
        trail = this.wheels[w],
        surface = frame[p + W.SURFACE];
      const sliding = tireSmokeSliding(frame[p + W.SLIP], frame[p + W.ANGLE]);
      if (
        frame[p + W.LOAD] < 30 ||
        Math.abs(frame[o + F.SPEED]) < 3 ||
        sliding < 0.06 ||
        !surfaceMaterial(surface).sealed ||
        frame[p + W.WATER] > 0.25
      ) {
        trail.input.x = NaN;
        continue;
      }
      festivalContactLocal(frame, 0, w, this.current).applyQuaternion(this.quaternion);
      this.current.x += frame[o + F.X];
      this.current.z += frame[o + F.Z];
      this.current.y += frame[o + F.Y];
      const dx = this.current.x - trail.input.x,
        dz = this.current.z - trail.input.z;
      const distance = Math.hypot(dx, dz);
      const strength = clamp(sliding * 0.62, 0.1, 0.62);
      if (!Number.isFinite(distance) || distance > 12) {
        trail.start.copy(this.current);
        trail.input.copy(this.current);
        trail.remaining = STRIDE;
        trail.joined = false;
        trail.time = time;
        trail.strength = strength * 0.22;
        continue;
      }
      if (distance > 1e-6 && distance >= trail.remaining) {
        const width = this.tread[w >> 1];
        const steer = frame[p + W.STEER],
          camber = frame[p + W.CAMBER];
        this.axle
          .set(
            Math.cos(steer) * Math.cos(camber),
            -Math.sin(camber),
            -Math.sin(steer) * Math.cos(camber),
          )
          .applyQuaternion(this.quaternion);
        // Project the loaded elliptical tread onto the direction across the
        // skid. A sideways locked tyre leaves a contact-length-wide mark.
        const nx = dz / distance,
          nz = -dx / distance;
        const transverse = clamp(nx * this.axle.x + nz * this.axle.z, -1, 1);
        const pressure = Math.max(90, frame[p + W.PRESSURE] || 200) * 1000;
        const length = clamp(frame[p + W.LOAD] / (pressure * width * 0.76), 0.065, width * 1.35);
        const half =
          0.5 *
          Math.sqrt(
            width * width * 0.83 * transverse ** 2 + length * length * (1 - transverse ** 2),
          );
        const ex = nx * half,
          ez = nz * half;
        if (!trail.joined) {
          this.setEdge(trail.edge, trail.start.x - ex, trail.start.z - ez, trail.start.y, height);
          this.setEdge(
            trail.otherEdge,
            trail.start.x + ex,
            trail.start.z + ez,
            trail.start.y,
            height,
          );
          trail.joined = true;
        }
        let at = trail.remaining;
        for (; at <= distance + 1e-8; at += STRIDE) {
          const fraction = Math.min(1, at / distance);
          const x = trail.input.x + dx * fraction,
            z = trail.input.z + dz * fraction;
          const y = trail.input.y + (this.current.y - trail.input.y) * fraction;
          const born = priorTime + (time - priorTime) * fraction;
          const i = this.cursor * 4;
          trail.edge.toArray(this.positions, i * 3);
          trail.otherEdge.toArray(this.positions, i * 3 + 3);
          this.setEdge(trail.edge, x - ex, z - ez, y, height).toArray(this.positions, i * 3 + 6);
          this.setEdge(trail.otherEdge, x + ex, z + ez, y, height).toArray(
            this.positions,
            i * 3 + 9,
          );
          this.born[i] = this.born[i + 1] = trail.time;
          this.born[i + 2] = this.born[i + 3] = born;
          this.opacity[i] = this.opacity[i + 1] = trail.strength;
          this.opacity[i + 2] = this.opacity[i + 3] = strength;
          trail.time = born;
          trail.strength = strength;
          this.cursor = (this.cursor + 1) % this.capacity;
          emitted++;
        }
        trail.remaining = at - distance;
      } else {
        trail.remaining -= distance;
      }
      trail.input.copy(this.current);
    }
    if (emitted) {
      this.segments = Math.min(this.capacity, this.segments + emitted);
      for (const key of ['position', 'born', 'strength']) {
        const attr = this.geometry.getAttribute(key) as T.BufferAttribute;
        markItems(attr, first * 4, Math.min(first + emitted, this.capacity) * 4 - 1);
        if (first + emitted > this.capacity) markItems(attr, 0, this.cursor * 4 - 1);
      }
      this.geometry.setDrawRange(0, this.segments * 6);
    }
  }
  private setEdge(target: T.Vector3, x: number, z: number, layer: number, height: GroundHeight) {
    return target.set(x, height(x, z, layer) + markLift, z);
  }
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
