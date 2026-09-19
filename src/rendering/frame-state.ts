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
      for (let wheel = 0; wheel < 4; wheel++) {
        const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
        for (let field = 0; field < WHEEL_STRIDE; field++)
          if (field !== W.SURFACE && field !== W.PUNCTURED) this.blend(a, b, p + field, alpha);
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
