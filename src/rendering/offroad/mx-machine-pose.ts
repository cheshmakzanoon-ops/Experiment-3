import { clamp, lerp } from '../../core/math.ts';
import {
  B, BIKE_BASE, F, H, K, MX_MOTION, O, OFFROAD_BASE, R, RACE_BASE, SKID_BASE,
  W, WHEEL_BASE, WHEEL_STRIDE, hasMxFootControls, hasMxMachineMotion,
} from '../../simulation/protocol.ts';
import { vehicleAt } from '../../simulation/vehicles.ts';
import { sanitizeMxFootPose, writeMxFootPose } from './mx-foot-pose.ts';

const motionFields = [
  MX_MOTION.FORK_RATE, MX_MOTION.SHOCK_RATE, MX_MOTION.STEER_RATE,
  MX_MOTION.FRONT_FLEX, MX_MOTION.FRONT_FLEX_RATE,
  MX_MOTION.REAR_FLEX, MX_MOTION.REAR_FLEX_RATE, MX_MOTION.CHAIN_PULL,
] as const;

function validMotion(frame: Float32Array, car: number) {
  for (const field of motionFields) if (!Number.isFinite(frame[car + field])) return false;
  // The fixed-step beam controller and existing mesh bounds share this
  // displacement envelope. Finite but impossible recordings must take the
  // same legacy fallback at endpoints as at interpolated or paused poses.
  const front = frame[car + MX_MOTION.FRONT_FLEX], rear = frame[car + MX_MOTION.REAR_FLEX];
  return front >= -0.32 && front <= 1 && rear >= -0.32 && rear <= 1;
}

function corruptMotion(frame: Float32Array, car: number) {
  return hasMxMachineMotion(frame, car) && !validMotion(frame, car);
}

function clearMotion(frame: Float32Array, car: number) {
  frame[car + MX_MOTION.VALID] = 0;
  for (const field of motionFields) frame[car + field] = 0;
}

/** Optional recorded motion is an all-or-nothing extension. An invalid
 * marked payload falls back to the legacy pose without poisoning a paused
 * endpoint or a reset-boundary sample. Valid and unmarked bytes stay exact. */
export function sanitizeMxMachinePose(frame: Float32Array, car: number) {
  sanitizeMxFootPose(frame, car);
  if (corruptMotion(frame, car)) clearMotion(frame, car);
}

/** The axle and handlebars follow measured tangent speeds between snapshots.
 * A resolved reversal can leave the endpoint envelope, but never the actual
 * mechanical travel. Contact edges retain the conservative monotone curve. */
export function sampleMxJointField(a: Float32Array, b: Float32Array, car: number, field: number, t: number) {
  if (!hasMxMachineMotion(a, car) || !hasMxMachineMotion(b, car) ||
      !validMotion(a, car) || !validMotion(b, car)) return undefined;
  const rate = field === B.FORK ? MX_MOTION.FORK_RATE
    : field === B.SHOCK ? MX_MOTION.SHOCK_RATE : MX_MOTION.STEER_RATE;
  return sampleMxJoint(a, b, car, field, rate, t);
}

function continuousJoint(a: Float32Array, b: Float32Array, car: number, dt: number) {
  const bike = car + BIKE_BASE, offroad = car + OFFROAD_BASE;
  if (a[car + RACE_BASE + R.VEHICLE] !== b[car + RACE_BASE + R.VEHICLE] ||
      a[bike + B.CRASHES] !== b[bike + B.CRASHES] ||
      b[bike + B.STATE_CLOCK] < a[bike + B.STATE_CLOCK] ||
      a[offroad + O.AIRBORNE] !== b[offroad + O.AIRBORNE] ||
      a[offroad + O.LANDING_SPEED] !== b[offroad + O.LANDING_SPEED] ||
      a[offroad + O.LANDING_PITCH] !== b[offroad + O.LANDING_PITCH] ||
      b[offroad + O.AIR_TIME] < a[offroad + O.AIR_TIME] ||
      b[offroad + O.BOTTOM] > a[offroad + O.BOTTOM] + 1e-4 ||
      b[car + F.IMPACT] > a[car + F.IMPACT] + 1e-4 ||
      a[car + SKID_BASE + K.CONTACTS] !== b[car + SKID_BASE + K.CONTACTS]) return false;
  for (let wheel = 0; wheel < 4; wheel += 2) {
    const load = car + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LOAD;
    if ((a[load] > 1) !== (b[load] > 1)) return false;
  }
  const distance = Math.hypot(b[car + F.X] - a[car + F.X],
    b[car + F.Y] - a[car + F.Y], b[car + F.Z] - a[car + F.Z]);
  const speed = Math.max(Math.hypot(a[car + F.VX], a[car + F.VY], a[car + F.VZ]),
    Math.hypot(b[car + F.VX], b[car + F.VY], b[car + F.VZ]));
  return distance <= Math.max(12, 2 + 3 * speed * dt);
}

function sampleMxJoint(
  a: Float32Array, b: Float32Array, car: number, field: number, rate: number, t: number, velocity = false,
) {
  const p = car + BIKE_BASE + field, r = car + rate;
  const dt = b[H.TIME] - a[H.TIME];
  const change = b[p] - a[p];
  if (!(dt > 0 && dt <= 0.125) || !Number.isFinite(a[r] + b[r]))
    return velocity ? (dt > 0 ? change / dt : 0) : lerp(a[p], b[p], t);
  const tangentA = a[r] * dt, tangentB = b[r] * dt;
  // Opposed measured rates resolve one interior extremum, even with equal
  // positions. Reject tangents inconsistent with the interval displacement:
  // they can straddle an unrecorded contact impulse or several oscillations.
  if (tangentA * tangentB < 0 &&
      Math.abs(change - (tangentA + tangentB) / 2) <= 1e-5 + (Math.abs(tangentA) + Math.abs(tangentB)) / 4 &&
      continuousJoint(a, b, car, dt)) {
    const spec = vehicleAt(a[car + RACE_BASE + R.VEHICLE]).bike!;
    // Match the recorded Float32 endpoints at a physical hard stop.
    const maximum = Math.fround(field === B.FORK ? spec.forkTravel
      : field === B.SHOCK ? spec.shockTravel : spec.maxSteer);
    const minimum = field === B.STEER ? -maximum : 0;
    const controlA = a[p] + tangentA / 3, controlB = b[p] - tangentB / 3;
    // The Bezier control hull bounds every point of the equivalent Hermite
    // cubic, not just the queried time. Unsafe controls keep the old fallback;
    // safe controls retain both measured endpoint velocities without clipping.
    if (a[p] >= minimum && a[p] <= maximum && b[p] >= minimum && b[p] <= maximum &&
        controlA >= minimum && controlA <= maximum && controlB >= minimum && controlB <= maximum) {
      const value = motionSample(a[p], b[p], tangentA, tangentB, t, dt, velocity);
      return velocity ? value : clamp(value, minimum, maximum);
    }
  }
  if (Math.abs(change) < 1e-8)
    return velocity ? change / dt : lerp(a[p], b[p], t);
  let start = Math.max(0, tangentA / change);
  let end = Math.max(0, tangentB / change);
  const length = Math.hypot(start, end);
  if (length > 3) {
    start *= 3 / length;
    end *= 3 / length;
  }
  return motionSample(a[p], b[p], start * change, end * change, t, dt, velocity);
}

/** Position and physical velocity of the same cubic in distance units.
 * The two tangents already include the duration of the measured interval. */
function motionSample(start: number, end: number, tangentA: number, tangentB: number, t: number, dt: number, velocity: boolean) {
  const change = end - start;
  const quadratic = 3 * change - 2 * tangentA - tangentB;
  const cubic = tangentA + tangentB - 2 * change;
  return velocity
    ? (tangentA + t * (2 * quadratic + 3 * t * cubic)) / dt
    : start + t * (tangentA + t * (quadratic + t * cubic));
}

/** Recorded elastic tip motion remains absolute through pause, rewinds and
 * LOD changes. Legacy poses fall back to the snapshot's existing load curve. */
export function sampleMxFender(
  a: Float32Array, b: Float32Array, car: number, front: boolean, t: number, velocity = false,
) {
  const p = car + (front ? MX_MOTION.FRONT_FLEX : MX_MOTION.REAR_FLEX);
  const rate = car + (front ? MX_MOTION.FRONT_FLEX_RATE : MX_MOTION.REAR_FLEX_RATE);
  const left = hasMxMachineMotion(a, car) && validMotion(a, car);
  const right = hasMxMachineMotion(b, car) && validMotion(b, car);
  if (t <= 0) return left ? a[velocity ? rate : p] : undefined;
  if (t >= 1) return right ? b[velocity ? rate : p] : undefined;
  // The renderer also gates its recorded chain response on this sample.
  // Reject a corrupt pair as a whole so raw chain interpolation cannot
  // consume the invalid endpoint when its other endpoint is still valid.
  if (corruptMotion(a, car) || corruptMotion(b, car)) return undefined;
  if (!left && !right) return undefined;
  const dt = b[H.TIME] - a[H.TIME], start = left ? a[p] : 0, end = right ? b[p] : 0;
  if (!left || !right || !(dt > 0 && dt <= 0.125) || !Number.isFinite(a[rate] + b[rate]))
    return velocity ? (dt > 0 ? (end - start) / dt : 0) : start + (end - start) * t;
  const tangentA = a[rate] * dt, tangentB = b[rate] * dt;
  const value = motionSample(start, end, tangentA, tangentB, t, dt, false);
  if (velocity)
    return value <= -0.32 || value >= 1 ? 0 : motionSample(start, end, tangentA, tangentB, t, dt, true);
  return clamp(value, -0.32, 1);
}

const mxJoints = [
  [B.FORK, MX_MOTION.FORK_RATE], [B.SHOCK, MX_MOTION.SHOCK_RATE], [B.STEER, MX_MOTION.STEER_RATE],
] as const;

/** PresentedFrame also supplies camera/effect consumers with the same axle
 * strokes, slider lengths and elastic state seen on the drawn motorcycle. */
export function writeMxMachinePose(out: Float32Array, a: Float32Array, b: Float32Array, car: number, t: number) {
  if (!hasMxFootControls(out, car)) return;
  writeMxFootPose(out, a, b, car, t);
  if (t <= 0 || t >= 1 || a === b) {
    const source = t >= 1 ? b : a;
    out[car + MX_MOTION.VALID] = source[car + MX_MOTION.VALID];
    for (const field of motionFields) out[car + field] = source[car + field];
    sanitizeMxMachinePose(out, car);
    return;
  }
  if (corruptMotion(a, car) || corruptMotion(b, car)) {
    clearMotion(out, car);
    return;
  }
  const left = hasMxMachineMotion(a, car), right = hasMxMachineMotion(b, car);
  if (!left && !right) return;
  const bike = car + BIKE_BASE, steer = out[bike + B.STEER], dt = b[H.TIME] - a[H.TIME];
  out[car + MX_MOTION.VALID] = 1;
  for (const [field, rate] of mxJoints) {
    const p = bike + field;
    out[car + rate] = left && right ? sampleMxJoint(a, b, car, field, rate, t, true)
      : dt > 0 ? (b[p] - a[p]) / dt : 0;
  }
  out[car + F.STEER] = steer;
  const pull = car + MX_MOTION.CHAIN_PULL;
  out[pull] = lerp(left ? a[pull] : 0, right ? b[pull] : 0, t);
  for (let wheel = 0; wheel < 4; wheel++) {
    const front = wheel < 2, p = car + WHEEL_BASE + wheel * WHEEL_STRIDE;
    const stroke = out[bike + (front ? B.FORK : B.SHOCK)];
    // Length + compression is the fixed rest length in the worker's MX adapter.
    out[p + W.LENGTH] += out[p + W.COMPRESSION] - stroke;
    out[p + W.COMPRESSION] = stroke;
    if (front) out[p + W.STEER] = steer;
  }
  out[car + MX_MOTION.FRONT_FLEX] = sampleMxFender(a, b, car, true, t) ?? 0;
  out[car + MX_MOTION.REAR_FLEX] = sampleMxFender(a, b, car, false, t) ?? 0;
  out[car + MX_MOTION.FRONT_FLEX_RATE] = sampleMxFender(a, b, car, true, t, true) ?? 0;
  out[car + MX_MOTION.REAR_FLEX_RATE] = sampleMxFender(a, b, car, false, t, true) ?? 0;
}
