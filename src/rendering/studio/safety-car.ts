import * as T from 'three';
import { VEHICLE } from '../../simulation/config.ts';
import {
  CAR_STRIDE,
  HEADER,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../simulation/protocol.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { ghostPose, writeGhostFrame, type GhostPose } from '../../core/ghost-lap.ts';
import { validateLivery } from '../../storage/livery.ts';
import { FormulaCar } from '../car.ts';
import type { HeroShells } from '../hero-shells.ts';

/**
 * The safety car (D27 gameplay-race-rules): a presentation-only car on the
 * simulation's safety-car lap distance (H.SC_S), never simulated or collided.
 * It reuses the rival representation with an original livery (silver, green
 * accent, "SAFETY CAR" identity; no real-brand marks) and carries an amber
 * light bar whose halves alternate at 2 Hz, emissive ×6 so the bloom catches it.
 */
export const SAFETY_CAR_LOOK = Object.freeze({
  livery: Object.freeze({
    primary: '#c9cdd1',
    accent: '#1f8a52',
    sponsor: 'SAFETY CAR',
    number: 1,
    pattern: 'split' as const,
  }),
  amber: 0xffa21a,
  gain: 6,
  /** Off half of the bar, as a fraction of the lit colour. */
  idle: 0.06,
  blinkHz: 2,
  /** Body height above the road at rest (the chassis datum). */
  rideHeight: 0.48,
});

/** Which half of the light bar is lit at presented time `time` (0 left, 1 right). */
export function lightBarSide(time: number) {
  return Math.floor(Math.max(0, time) * SAFETY_CAR_LOOK.blinkHz * 2) % 2;
}

const point = trackPoint();
/** Pose on the centreline at lap distance `s`, heading along the track. */
export function safetyCarPose(track: Track, s: number, speed: number, out = ghostPose()) {
  track.at(s, point);
  const yaw = Math.atan2(point.tx, point.tz);
  out.s = point.s;
  out.x = point.x;
  out.y = point.y + SAFETY_CAR_LOOK.rideHeight;
  out.z = point.z;
  out.qx = 0;
  out.qy = Math.sin(yaw / 2);
  out.qz = 0;
  out.qw = Math.cos(yaw / 2);
  out.steer = 0;
  out.speed = speed;
  return out;
}

export class SafetyCarView {
  readonly car: FormulaCar;
  readonly lights: [T.MeshBasicMaterial, T.MeshBasicMaterial];
  private readonly frame = new Float32Array(HEADER + CAR_STRIDE);
  private visibleNow = false;
  constructor(hero?: HeroShells) {
    this.car = new FormulaCar(1, hero);
    this.car.root.name = 'Safety car';
    this.car.setLivery(validateLivery(SAFETY_CAR_LOOK.livery));
    // The bar sits on the highest point of the body (the airbox).
    this.car.root.updateMatrixWorld(true);
    const top = new T.Vector3(0, 0, 0),
      v = new T.Vector3();
    this.car.root.traverse((object) => {
      const mesh = object as T.Mesh;
      if (!mesh.isMesh) return;
      const position = mesh.geometry.getAttribute('position');
      if (!position) return;
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(v.x) < 0.2 && v.y > top.y) top.copy(v);
      }
    });
    this.lights = [0, 1].map(() => {
      const material = new T.MeshBasicMaterial({ color: SAFETY_CAR_LOOK.amber });
      material.name = 'Safety car light bar';
      return material;
    }) as [T.MeshBasicMaterial, T.MeshBasicMaterial];
    const base = new T.Mesh(
      new T.BoxGeometry(0.5, 0.035, 0.12),
      new T.MeshStandardMaterial({ color: 0x15181b, roughness: 0.6 }),
    );
    base.position.set(0, top.y + 0.02, top.z);
    this.car.root.add(base);
    for (let side = 0; side < 2; side++) {
      const lamp = new T.Mesh(new T.BoxGeometry(0.22, 0.045, 0.1), this.lights[side]);
      lamp.position.set(side === 0 ? 0.12 : -0.12, top.y + 0.055, top.z);
      lamp.castShadow = false;
      this.car.root.add(lamp);
    }
    this.car.root.visible = false;
  }
  get root() {
    return this.car.root;
  }
  get visible() {
    return this.visibleNow;
  }
  /** Pose the safety car for this presented frame, or hide it (null). */
  update(
    pose: GhostPose | null,
    camera: T.Camera,
    quality: 'low' | 'medium' | 'high',
    time: number,
    dt: number,
  ) {
    this.visibleNow = this.car.root.visible = !!pose;
    if (!pose) return;
    const f = this.frame,
      o = carBase(0);
    writeGhostFrame(f, pose, time);
    for (let i = 0; i < 4; i++) {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
      f[p + W.STEER] = i < 2 ? pose.steer * VEHICLE.maxSteer : 0;
      f[p + W.ROTATION] = (pose.s / 0.335) % (Math.PI * 2);
      f[p + W.RADIUS] = 0.335;
      f[p + W.LOAD] = 0;
    }
    const lit = lightBarSide(time);
    this.lights.forEach((material, side) =>
      material.color
        .setHex(SAFETY_CAR_LOOK.amber)
        .multiplyScalar(side === lit ? SAFETY_CAR_LOOK.gain : SAFETY_CAR_LOOK.idle),
    );
    const distance = camera.position.distanceTo(this.car.root.position.set(pose.x, pose.y, pose.z));
    this.car.setLod(distance, quality, false);
    this.car.update(f, f, o, 1, dt, time, false);
  }
}
