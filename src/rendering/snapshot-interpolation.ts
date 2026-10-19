import { Quaternion, Vector3 } from 'three';
import {
  B,
  BIKE_BASE,
  F,
  H,
  K,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  SKID_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
} from '../simulation/protocol.ts';

const targetQuaternion = new Quaternion();
const sampledQuaternion = new Quaternion();
const rotationControlA = new Quaternion();
const rotationControlB = new Quaternion();
const TAU = Math.PI * 2;

/** A discrete action belongs to the older sample until the newer sample's time.
 * This also makes seeking and repeated paused frames independent of render rate. */
export function snapshotSource(a: Float32Array, b: Float32Array, alpha: number) {
  return alpha < 1 ? a : b;
}

export function sampleValue(a: Float32Array, b: Float32Array, index: number, alpha: number) {
  if (alpha <= 0) return a[index];
  if (alpha >= 1) return b[index];
  return a[index] + (b[index] - a[index]) * alpha;
}

/** Angles such as heading wrap; accumulated quantities such as rider tumble do not. */
export function sampleAngle(a: Float32Array, b: Float32Array, index: number, alpha: number) {
  if (alpha <= 0) return a[index];
  if (alpha >= 1) return b[index];
  const delta = b[index] - a[index];
  return a[index] + (delta - TAU * Math.floor((delta + Math.PI) / TAU)) * alpha;
}

/** Per-entrant reset boundary, shared by the model, camera and effects snapshot.
 * A long but plausible recording gap still has a linear position fallback. A
 * changed vehicle or an implausible jump must never sweep a model across the map. */
export function presentationAlpha(a: Float32Array, b: Float32Array, car: number, alpha: number) {
  if (alpha <= 0) return 0;
  if (alpha >= 1 || a === b) return 1;
  if (a[car + RACE_BASE + R.VEHICLE] !== b[car + RACE_BASE + R.VEHICLE]) return 0;
  const dt = b[H.TIME] - a[H.TIME];
  if (!(dt > 0)) return 0;
  const distance = Math.hypot(
    b[car + F.X] - a[car + F.X],
    b[car + F.Y] - a[car + F.Y],
    b[car + F.Z] - a[car + F.Z],
  );
  const speed = Math.max(
    Math.hypot(a[car + F.VX], a[car + F.VY], a[car + F.VZ]),
    Math.hypot(b[car + F.VX], b[car + F.VY], b[car + F.VZ]),
  );
  return distance > Math.max(12, 2 + 3 * speed * dt) ? 0 : alpha;
}

/** Rider coordinates and state clocks acquire a new origin at a crash/remount.
 * Suspension, controls and measured lean remain continuous across those events. */
export function riderAlpha(a: Float32Array, b: Float32Array, car: number, alpha: number) {
  const p = car + BIKE_BASE;
  return alpha < 1 &&
    (a[p + B.STATE] !== b[p + B.STATE] ||
      a[p + B.CRASHES] !== b[p + B.CRASHES] ||
      b[p + B.STATE_CLOCK] < a[p + B.STATE_CLOCK])
    ? 0
    : alpha;
}

export function sampleBikeField(
  a: Float32Array,
  b: Float32Array,
  car: number,
  field: number,
  alpha: number,
) {
  const p = car + BIKE_BASE + field;
  if (field === B.STATE || field === B.CRASHES) return snapshotSource(a, b, alpha)[p];
  const t =
    field === B.STATE_CLOCK ||
    (field >= B.RIDER_X && field <= B.RIDER_Z) ||
    field === B.RIDER_HEADING ||
    field === B.RIDER_TUMBLE
      ? riderAlpha(a, b, car, alpha)
      : alpha;
  return field === B.LEAN || field === B.PITCH || field === B.RIDER_HEADING
    ? sampleAngle(a, b, p, t)
    : sampleValue(a, b, p, t);
}

export function sampleOffroadField(
  a: Float32Array,
  b: Float32Array,
  car: number,
  field: number,
  alpha: number,
) {
  const p = car + OFFROAD_BASE;
  if (
    field === O.AIRBORNE ||
    field === O.LANDING_PITCH ||
    field === O.LANDING_SPEED ||
    field >= O.JOKERS
  )
    return snapshotSource(a, b, alpha)[p + field];
  const t =
    field === O.AIR_TIME &&
    alpha < 1 &&
    (a[p + O.AIRBORNE] !== b[p + O.AIRBORNE] || b[p + O.AIR_TIME] < a[p + O.AIR_TIME])
      ? 0
      : alpha;
  return sampleValue(a, b, p + field, t);
}

function continuousContacts(a: Float32Array, b: Float32Array, car: number) {
  if (
    a[car + OFFROAD_BASE + O.AIRBORNE] !== b[car + OFFROAD_BASE + O.AIRBORNE] ||
    a[car + SKID_BASE + K.CONTACTS] !== b[car + SKID_BASE + K.CONTACTS]
  )
    return false;
  for (let i = 0; i < 4; i++) {
    const p = car + WHEEL_BASE + i * WHEEL_STRIDE;
    if (a[p + W.LOAD] > 1 !== b[p + W.LOAD] > 1) return false;
  }
  return true;
}

function smoothMotion(a: Float32Array, b: Float32Array, car: number, dt: number) {
  if (!(dt > 0 && dt <= 0.5)) return false;
  let error2 = 0,
    distance2 = 0,
    acceleration2 = 0;
  for (let axis = 0; axis < 3; axis++) {
    const d = b[car + F.X + axis] - a[car + F.X + axis];
    const va = a[car + F.VX + axis],
      vb = b[car + F.VX + axis];
    const error = d - (va + vb) * 0.5 * dt;
    error2 += error * error;
    distance2 += d * d;
    acceleration2 += ((vb - va) * (vb - va)) / (dt * dt);
  }
  // Reject inconsistent tangents and unresolved impulses. The absolute allowance
  // covers Float32 quantisation and fixed-step integration error at low speed.
  // Coherent airborne endpoints retain their parabola, including an apex lying
  // above both samples; a monotonic position clamp would incorrectly flatten it.
  return (
    Number.isFinite(error2 + acceleration2) &&
    Math.sqrt(error2) <= 0.03 + 0.1 * Math.sqrt(distance2) &&
    acceleration2 <= 120 * 120
  );
}

/** Snapshot omega is WORLD angular velocity. Left multiplication applies its
 * exponential about that world axis, irrespective of the chassis' initial pose. */
function rotationControl(
  target: Quaternion,
  pose: Quaternion,
  wx: number,
  wy: number,
  wz: number,
  time: number,
) {
  const speed = Math.hypot(wx, wy, wz),
    halfAngle = speed * time * 0.5,
    scale = speed > 1e-12 ? Math.sin(halfAngle) / speed : time * 0.5;
  target.set(wx * scale, wy * scale, wz * scale, Math.cos(halfAngle)).multiply(pose);
}

/** A spherical cubic has endpoint rates supplied by the measured world omegas.
 * Unlike constant-rate SLERP, adjacent smooth samples meet with the same angular
 * velocity. No frame clock, accumulated orientation or render-time integration
 * is involved; even an out-of-order replay query is a complete absolute pose. */
function sampleChassisRotation(
  a: Float32Array,
  b: Float32Array,
  car: number,
  dt: number,
  t: number,
  continuous: boolean,
) {
  const quaternion = sampledQuaternion;
  quaternion.fromArray(a, car + F.QX).normalize();
  targetQuaternion.fromArray(b, car + F.QX).normalize();
  if (quaternion.dot(targetQuaternion) < 0)
    targetQuaternion.set(
      -targetQuaternion.x,
      -targetQuaternion.y,
      -targetQuaternion.z,
      -targetQuaternion.w,
    );
  let smooth = false;
  const ax = a[car + F.WX],
    ay = a[car + F.WY],
    az = a[car + F.WZ],
    bx = b[car + F.WX],
    by = b[car + F.WY],
    bz = b[car + F.WZ];
  if (
    continuous &&
    dt > 0 &&
    dt <= 0.5 &&
    riderAlpha(a, b, car, t) !== 0 &&
    b[car + F.IMPACT] <= a[car + F.IMPACT] + 1e-4
  ) {
    rotationControlA.copy(quaternion).conjugate();
    rotationControlB.multiplyQuaternions(targetQuaternion, rotationControlA);
    const sine = Math.hypot(rotationControlB.x, rotationControlB.y, rotationControlB.z),
      angle = 2 * Math.atan2(sine, Math.max(0, rotationControlB.w)),
      scale = sine > 1e-12 ? angle / sine : 2,
      error = Math.hypot(
        rotationControlB.x * scale - (ax + bx) * 0.5 * dt,
        rotationControlB.y * scale - (ay + by) * 0.5 * dt,
        rotationControlB.z * scale - (az + bz) * 0.5 * dt,
      ),
      speed = Math.max(Math.hypot(ax, ay, az), Math.hypot(bx, by, bz)),
      acceleration = Math.hypot(bx - ax, by - ay, bz - az) / dt;
    // A quaternion alone cannot identify whole turns. Do not invent a rotation
    // beyond the unambiguous half-turn span, or use unresolved impact tangents.
    // Small coherent reversals remain valid (e.g. the top of a chassis roll).
    smooth =
      Number.isFinite(error + speed + acceleration) &&
      speed * dt < Math.PI &&
      speed > 1e-8 &&
      (angle > 1e-6 || ax * bx + ay * by + az * bz < 0) &&
      acceleration <= 200 &&
      error <= 1e-4 + 0.1 * angle;
  }
  if (smooth) {
    rotationControl(rotationControlA, quaternion, ax, ay, az, dt / 3);
    rotationControl(rotationControlB, targetQuaternion, bx, by, bz, -dt / 3);
    // Spherical de Casteljau evaluation. Fixed scratch quaternions also avoid
    // adding garbage collection work to a 32-entrant presentation frame.
    quaternion.slerp(rotationControlA, t);
    rotationControlA.slerp(rotationControlB, t);
    rotationControlB.slerp(targetQuaternion, t);
    quaternion.slerp(rotationControlA, t);
    rotationControlA.slerp(rotationControlB, t);
    quaternion.slerp(rotationControlA, t);
  } else quaternion.slerp(targetQuaternion, t);
  return quaternion.normalize();
}

/** Cubic endpoint reconstruction, not render-time physics integration. */
export function hermite(start: number, end: number, tangentA: number, tangentB: number, t: number) {
  const t2 = t * t,
    t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * start +
    (t3 - 2 * t2 + t) * tangentA +
    (-2 * t3 + 3 * t2) * end +
    (t3 - t2) * tangentB
  );
}

/** All visible chassis roots and PresentedFrame use exactly these Float32 poses.
 * No per-frame objects are created. Snapshot endpoint velocities shape the
 * intermediate path only when measured motion and contact state support it. */
export function sampleChassisPose(
  a: Float32Array,
  b: Float32Array,
  car: number,
  alpha: number,
  position: Vector3,
  quaternion: Quaternion,
) {
  const t = presentationAlpha(a, b, car, alpha),
    source = snapshotSource(a, b, t);
  if (t === 0 || t === 1) {
    position.fromArray(source, car + F.X);
    quaternion.fromArray(source, car + F.QX);
    return t;
  }
  const dt = b[H.TIME] - a[H.TIME],
    continuous = continuousContacts(a, b, car),
    smooth = continuous && smoothMotion(a, b, car, dt);
  for (let axis = 0; axis < 3; axis++) {
    const p = car + F.X + axis,
      v = car + F.VX + axis;
    const value = smooth ? hermite(a[p], b[p], a[v] * dt, b[v] * dt, t) : sampleValue(a, b, p, t);
    position.setComponent(axis, Math.fround(value));
  }
  const orientation = sampleChassisRotation(a, b, car, dt, t, continuous);
  // Publish once: an Object3D quaternion callback also rebuilds its Euler pose.
  // Intermediate control evaluations stay in callback-free shared scratch.
  quaternion.set(
    Math.fround(orientation.x),
    Math.fround(orientation.y),
    Math.fround(orientation.z),
    Math.fround(orientation.w),
  );
  return t;
}
