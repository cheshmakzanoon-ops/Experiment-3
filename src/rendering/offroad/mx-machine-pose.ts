import { clamp, lerp } from '../../core/math.ts';
import {
  B, BIKE_BASE, F, H, MX_MOTION, W, WHEEL_BASE, WHEEL_STRIDE, hasMxFootControls, hasMxMachineMotion,
} from '../../simulation/protocol.ts';

/** The axle and handlebars follow measured tangent speeds between snapshots.
 * Limit the tangents only where a coarse interval crosses a travel stop or
 * an unresolved reversal, so interpolation cannot add mechanical travel. */
export function sampleMxJointField(a: Float32Array, b: Float32Array, car: number, field: number, t: number) {
  if (!hasMxMachineMotion(a, car) || !hasMxMachineMotion(b, car)) return undefined;
  const rate = field === B.FORK ? MX_MOTION.FORK_RATE
    : field === B.SHOCK ? MX_MOTION.SHOCK_RATE : MX_MOTION.STEER_RATE;
  return sampleMxJoint(a, b, car + BIKE_BASE + field, car + rate, t);
}

function sampleMxJoint(a: Float32Array, b: Float32Array, p: number, rate: number, t: number, velocity = false) {
  const dt = b[H.TIME] - a[H.TIME];
  const change = b[p] - a[p];
  if (!(dt > 0 && dt <= 0.125) || !Number.isFinite(a[rate] + b[rate]) || Math.abs(change) < 1e-8)
    return velocity ? (dt > 0 ? change / dt : 0) : lerp(a[p], b[p], t);
  let start = Math.max(0, a[rate] * dt / change);
  let end = Math.max(0, b[rate] * dt / change);
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
  const left = hasMxMachineMotion(a, car) && Number.isFinite(a[p]);
  const right = hasMxMachineMotion(b, car) && Number.isFinite(b[p]);
  if (t <= 0) return left ? a[velocity ? rate : p] : undefined;
  if (t >= 1) return right ? b[velocity ? rate : p] : undefined;
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
  const left = hasMxMachineMotion(a, car), right = hasMxMachineMotion(b, car);
  if ((!left && !right) || !hasMxFootControls(out, car)) return;
  const bike = car + BIKE_BASE, steer = out[bike + B.STEER], dt = b[H.TIME] - a[H.TIME];
  out[car + MX_MOTION.VALID] = 1;
  for (const [field, rate] of mxJoints) {
    const p = bike + field;
    out[car + rate] = left && right ? sampleMxJoint(a, b, p, car + rate, t, true)
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
