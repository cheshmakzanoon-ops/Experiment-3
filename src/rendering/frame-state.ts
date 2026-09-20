import { K, SKID_BASE } from '../simulation/protocol.ts';
import { wheelPhase } from './wheel-pose.ts';
import { Quaternion } from 'three';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';

// Only continuously varying presentation channels are interpolated. Gear,
// compound, flags, surface IDs and service phases remain genuine discrete states.
const SMOOTH_CAR = [
  F.X,
  F.Y,
  F.Z,
  F.VX,
  F.VY,
  F.VZ,
  F.WX,
  F.WY,
  F.WZ,
  F.SPEED,
  F.STEER,
  F.RPM,
  F.THROTTLE,
  F.BRAKE,
  F.ENGINE_TORQUE,
  F.MOTOR_POWER,
  F.REGEN_POWER,
  F.G_LONG,
  F.G_LAT,
  F.G_VERT,
  F.SLIP_ENERGY,
  F.BOTTOM_ENERGY,
  F.IMPACT,
] as const;
const SMOOTH_SKID = [
  K.LOAD,
  K.SLIDE_POWER,
  K.DAMPING_POWER,
  K.SPARK_POWER,
  K.SLIDE_WORK,
  K.SPARK_WORK,
  K.TOTAL_WORK,
] as const;
const SMOOTH_WEATHER = [H.RAIN, H.CLOUD, H.AMBIENT, H.WIND_X, H.WIND_Z] as const;

/** Reusable presentation-only snapshot. This buffer NEVER goes back to physics,
 * timing, CSV or replay storage; those retain original measured snapshots. */
export class PresentedFrame {
  value = new Float32Array(0);
  private qa = new Quaternion();
  private qb = new Quaternion();
  sample(a: Float32Array, b: Float32Array, alpha: number): Float32Array {
    const cars = b[H.CARS];
    if (
      !Number.isFinite(alpha) ||
      alpha < 0 ||
      alpha > 1 ||
      !Number.isInteger(cars) ||
      cars < 1 ||
      cars > 12 ||
      a[H.CARS] !== cars ||
      a.length !== b.length ||
      b.length !== HEADER + cars * CAR_STRIDE ||
      !Number.isFinite(a[H.TIME]) ||
      !Number.isFinite(b[H.TIME]) ||
      b[H.TIME] < a[H.TIME]
    )
      throw new Error('Invalid presentation snapshot pair');
    if (this.value.length !== b.length) this.value = new Float32Array(b.length);
    const out = this.value;
    out.set(alpha < 1 ? a : b);
    if (alpha === 0 || alpha === 1) return out;
    this.blend(a, b, H.TIME, alpha);
    for (const field of SMOOTH_WEATHER) this.blend(a, b, field, alpha);
    for (let id = 0; id < cars; id++) {
      const o = carBase(id);
      for (const field of SMOOTH_CAR) this.blend(a, b, o + field, alpha);
      this.qa
        .fromArray(a, o + F.QX)
        .slerp(this.qb.fromArray(b, o + F.QX), alpha)
        .normalize();
      out[o + F.QX] = this.qa.x;
      out[o + F.QY] = this.qa.y;
      out[o + F.QZ] = this.qa.z;
      out[o + F.QW] = this.qa.w;
      const skid = o + SKID_BASE;
      // Cumulative work survives contacts between visual samples. The first
      // recorded strike already has a real anchor: never blend it from (0,0,0).
      for (const field of SMOOTH_SKID)
        if (field < K.SLIDE_WORK || b[skid + field] >= a[skid + field])
          this.blend(a, b, skid + field, alpha);
      for (let field = K.SPARK_X as number; field <= K.VELOCITY_Z; field++) {
        if (a[skid + K.SPARK_WORK] > 0) this.blend(a, b, skid + field, alpha);
        else out[skid + field] = b[skid + field];
      }
      const normalLength = Math.hypot(
        out[skid + K.NORMAL_X],
        out[skid + K.NORMAL_Y],
        out[skid + K.NORMAL_Z],
      );
      if (normalLength > 1e-8)
        for (let field = K.NORMAL_X as number; field <= K.NORMAL_Z; field++)
          out[skid + field] /= normalLength;
      for (let wheel = 0; wheel < 4; wheel++) {
        const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
        for (let field = 0; field < WHEEL_STRIDE; field++)
          if (field !== W.SURFACE && field !== W.PUNCTURED && field !== W.ROTATION)
            this.blend(a, b, p + field, alpha);
        out[p + W.ROTATION] = wheelPhase(a, b, o, p, alpha);
        const counter = o + F.MARBLE_PICKUP_FR + wheel;
        // A replacement tire starts a new counter, not a negative pickup ramp.
        if (b[counter] >= a[counter]) this.blend(a, b, counter, alpha);
      }
    }
    return out;
  }
  private blend(a: Float32Array, b: Float32Array, p: number, alpha: number) {
    this.value[p] = a[p] + (b[p] - a[p]) * alpha;
  }
}
