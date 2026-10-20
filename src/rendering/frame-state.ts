import {
  BIKE_BASE,
  BIKE_STRIDE,
  K,
  OFFROAD_BASE,
  OFFROAD_STRIDE,
  SKID_BASE,
  M,
  WHEEL_MOTION_BASE,
  C,
  WHEEL_CONTACT_BASE,
  wheelContactBase,
} from '../simulation/protocol.ts';
import { wheelPhase, wheelValue } from './wheel-pose.ts';
import { sampleWheelContact, wheelContactPose } from './wheel-contact.ts';
import { Quaternion, Vector3 } from 'three';
import {
  sampleBikeField,
  sampleChassisPose,
  sampleOffroadField,
} from './snapshot-interpolation.ts';
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
  private readonly position = new Vector3();
  private readonly orientation = new Quaternion();
  private readonly velocity = new Vector3();
  private readonly angularVelocity = new Vector3();
  private readonly contact = wheelContactPose();
  sample(a: Float32Array, b: Float32Array, alpha: number): Float32Array {
    const cars = b[H.CARS];
    if (
      !Number.isFinite(alpha) ||
      alpha < 0 ||
      alpha > 1 ||
      !Number.isInteger(cars) ||
      cars < 1 ||
      cars > 32 ||
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
      const t = sampleChassisPose(
        a,
        b,
        o,
        alpha,
        this.position,
        this.orientation,
        this.velocity,
        this.angularVelocity,
      );
      if (t === 0) continue;
      // An interpolated pose carries an unwrapped display phase, not another
      // measured winding sample. Do not let it masquerade as raw solver data.
      if (t < 1) out[o + WHEEL_MOTION_BASE + M.VALID] = 0;
      this.position.toArray(out, o + F.X);
      this.orientation.toArray(out, o + F.QX);
      this.velocity.toArray(out, o + F.VX);
      this.angularVelocity.toArray(out, o + F.WX);
      for (const field of SMOOTH_CAR) this.blend(a, b, o + field, t);
      for (let field = 0; field < BIKE_STRIDE; field++)
        out[o + BIKE_BASE + field] = sampleBikeField(a, b, o, field, t);
      for (let field = 0; field < OFFROAD_STRIDE; field++)
        out[o + OFFROAD_BASE + field] = sampleOffroadField(a, b, o, field, t);
      const skid = o + SKID_BASE;
      // Cumulative work survives contacts between visual samples. The first
      // recorded strike already has a real anchor: never blend it from (0,0,0).
      for (const field of SMOOTH_SKID)
        if (field < K.SLIDE_WORK || b[skid + field] >= a[skid + field])
          this.blend(a, b, skid + field, t);
      for (let field = K.SPARK_X as number; field <= K.VELOCITY_Z; field++) {
        if (a[skid + K.SPARK_WORK] > 0) this.blend(a, b, skid + field, t);
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
          if (field !== W.ROTATION) out[p + field] = wheelValue(a, b, o, p, field, t);
        out[p + W.ROTATION] = wheelPhase(a, b, o, p, t);
        const contact = sampleWheelContact(a, b, o, wheel, t, this.contact),
          c = wheelContactBase(o, wheel);
        if (contact.valid) {
          out[o + WHEEL_CONTACT_BASE] |= 1 << wheel;
          out[c + C.LONGITUDINAL] = contact.longitudinal;
          out[c + C.LATERAL] = contact.lateral;
          out[c + C.RADIAL] = contact.radial;
          out[c + C.HUB_LENGTH] = contact.hubLength;
          out[c + C.NORMAL_X] = contact.normalX;
          out[c + C.NORMAL_Y] = contact.normalY;
          out[c + C.NORMAL_Z] = contact.normalZ;
          out[c + C.PLANE_DISTANCE] = contact.planeDistance;
        } else out[o + WHEEL_CONTACT_BASE] &= ~(1 << wheel);
        const counter = o + F.MARBLE_PICKUP_FR + wheel;
        // A replacement tire starts a new counter, not a negative pickup ramp.
        if (b[counter] >= a[counter]) this.blend(a, b, counter, t);
      }
    }
    return out;
  }
  private blend(a: Float32Array, b: Float32Array, p: number, alpha: number) {
    this.value[p] = a[p] + (b[p] - a[p]) * alpha;
  }
}
