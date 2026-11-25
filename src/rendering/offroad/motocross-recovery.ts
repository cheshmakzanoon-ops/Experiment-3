import * as T from 'three';
import { BIKE_STATES, type BikeState } from '../../simulation/bike.ts';
import { B, BIKE_BASE, H, MX_PUSH, WHEEL_CONTACT_BASE } from '../../simulation/protocol.ts';
import { MX_PUSH_STANCE, type MxPushGait } from './motocross-rider-motion.ts';
import { MX_RECOVERY, MX_PUSH_STRIDE } from '../../simulation/offroad/rider-recovery.ts';
import { RIDER, type Rider } from '../rider.ts';
import { MX_GLOVE_GRIP, MX_GLOVE_WRIST, type MxRecoveryGrip } from './motocross-rider-contact.ts';
import type { MxDabSurface } from './motocross-dab.ts';

const UP = new T.Vector3(0, 1, 0);
const IDENTITY = new T.Quaternion();
const REMOUNT = BIKE_STATES.indexOf('remount');

/** The separated rider has a recorded world pelvis and a ground surface of
 * their own. The fallen motorcycle can be on the opposite side of a jump. */
export class MxRecoveryPose {
  private readonly floor = new T.Plane();
  private readonly tilt = new T.Quaternion();
  private readonly local = new T.Matrix4();
  private readonly offset = new T.Vector3();
  private readonly grip: MxRecoveryGrip = {
    point: new T.Vector3(), frame: new T.Quaternion(), engagement: 0,
  };

  private readonly push: MxPushGait = { phase: 0, x: 0, z: 0, weight: 0 };

  /** The recording supplies world velocity for both endpoints, including
   * stops. Older paired snapshots can reconstruct travel from their roots. */
  pushMotion(a: Float32Array, b: Float32Array, car: number, t: number, heading: number) {
    const o = car + BIKE_BASE;
    const left = a[o + B.STATE] === REMOUNT, right = b[o + B.STATE] === REMOUNT;
    if (!left && !right) return undefined;
    // Recovery cuts do not contain meaningful cross-state velocities.
    // A recorded endpoint can still reproduce its pose in isolation.
    if (!left) a = b;
    if (!right) b = a;
    const recorded = a[car + WHEEL_CONTACT_BASE] === 0 && b[car + WHEEL_CONTACT_BASE] === 0 &&
      a[car + MX_PUSH.RECORDED] === 1 && b[car + MX_PUSH.RECORDED] === 1;
    let vx: number, vz: number, phase: number;
    if (recorded) {
      vx = T.MathUtils.lerp(a[car + MX_PUSH.VX], b[car + MX_PUSH.VX], t);
      vz = T.MathUtils.lerp(a[car + MX_PUSH.VZ], b[car + MX_PUSH.VZ], t);
      // Starting at midstance places the support boot below its hip and
      // keeps it there as the rider's first displacement arrives.
      phase = T.MathUtils.lerp(a[car + MX_PUSH.PHASE], b[car + MX_PUSH.PHASE], t) + Math.PI * MX_PUSH_STANCE;
    } else {
      const dt = b[H.TIME] - a[H.TIME];
      if (!(dt > 0 && dt <= 0.5)) return undefined;
      vx = (b[o + B.RIDER_X] - a[o + B.RIDER_X]) / dt;
      vz = (b[o + B.RIDER_Z] - a[o + B.RIDER_Z]) / dt;
      phase = T.MathUtils.lerp(a[o + B.STATE_CLOCK], b[o + B.STATE_CLOCK], t) * (2 * Math.PI * 1.8);
    }
    const speed = Math.hypot(vx, vz);
    if (!(speed > 0.015 && speed < 9) || !Number.isFinite(phase + heading)) return undefined;
    const weight = T.MathUtils.smoothstep(speed, 0.015, 0.50);
    const length = recorded ? MX_PUSH_STRIDE : Math.min(MX_PUSH_STRIDE, speed / 1.8);
    const scale = length * weight / speed, c = Math.cos(heading), s = Math.sin(heading);
    this.push.x = (vx * c - vz * s) * scale;
    this.push.z = (vx * s + vz * c) * scale;
    this.push.phase = phase;
    this.push.weight = weight;
    return this.push;
  }

  place(
    rider: Rider,
    point: T.Vector3,
    heading: number,
    state: BikeState,
    clock: number,
    standing: number,
    tumble: number,
    time: number,
    surface?: MxDabSurface,
    leftGrip?: T.Object3D,
    push?: MxPushGait,
  ) {
    const floor = surface?.planeAtWorld(point, this.floor) ? this.floor : undefined;
    const clearance = floor ? floor.distanceToPoint(point) / floor.normal.y : Infinity;
    const remount = state === 'remount';
    let rise = remount
      ? 1
      : state === 'separated' && clock >= MX_RECOVERY.restSeconds
        ? T.MathUtils.clamp(standing, 0, 1)
        : 0;
    if (floor && !remount) {
      // Older frames carried the preceding peg posture into a crash. Bound
      // that value by the recorded pelvis above the dirt under the rider.
      const expected = T.MathUtils.lerp(MX_RECOVERY.slideHeight, MX_RECOVERY.uprightHeight, rise);
      if (Math.abs(clearance - expected) > 0.14) {
        const supported =
          (clearance - MX_RECOVERY.slideHeight) /
          (MX_RECOVERY.uprightHeight - MX_RECOVERY.slideHeight);
        rise =
          clearance > MX_RECOVERY.uprightHeight + 0.14
            ? 0
            : Math.min(rise, T.MathUtils.clamp(supported, 0, 1));
      }
    }
    rider.root.quaternion.setFromAxisAngle(UP, heading);
    if (floor) {
      const support = (1 - rise) * (1 - T.MathUtils.smoothstep(clearance, 0.17, 0.49));
      this.tilt.setFromUnitVectors(UP, floor.normal);
      rider.root.quaternion.premultiply(this.tilt.slerp(IDENTITY, 1 - support));
    }
    rider.root.position
      .copy(point)
      .sub(
        this.offset
          .set(0, MX_RECOVERY.uprightHeight * rise, 0)
          .applyQuaternion(rider.root.quaternion),
      );
    const bar = remount ? leftGrip : undefined;
    if (floor || bar) {
      rider.root.updateWorldMatrix(true, false);
      this.local.copy(rider.root.matrixWorld).invert();
      floor?.applyMatrix4(this.local);
    }
    if (bar) {
      bar.updateWorldMatrix(true, false);
      this.local.multiply(bar.matrixWorld);
      this.local.decompose(this.grip.point, this.grip.frame, this.offset);
      // Measure from the inside shoulder. A bike across a rut or below a
      // berm can be close in plan view and still be well outside arm's reach.
      const armReach = RIDER.upperArm + RIDER.forearm + MX_GLOVE_GRIP[2] - MX_GLOVE_WRIST[2];
      const { x, y, z } = this.grip.point;
      const distance = Math.hypot(
        x + RIDER.shoulderWidth,
        y - (MX_RECOVERY.uprightHeight + RIDER.spine - 0.04),
        z,
      );
      this.grip.engagement = T.MathUtils.smoothstep(clock, 0, 0.38) *
        (1 - T.MathUtils.smoothstep(distance, armReach, armReach + 0.35));
    }
    rider.separated(remount ? 2 : rise > 0 ? 1 : 0, tumble, time, rise, floor, surface,
      bar ? this.grip : undefined, remount ? push : undefined);
  }
}
