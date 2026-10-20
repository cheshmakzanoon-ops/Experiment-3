import { C, WHEEL_CONTACT_BASE, wheelContactBase } from '../simulation/protocol.ts';
import { presentationAlpha, sampleValue } from './snapshot-interpolation.ts';
import { tireAlpha, wheelTravel } from './wheel-pose.ts';

/** Measured car-tire geometry in the non-spinning wheel frame. Deformation
 * is read from snapshots, never integrated by the renderer. */
export interface WheelContactPose {
  valid: boolean;
  longitudinal: number;
  lateral: number;
  radial: number;
  hubLength: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  planeDistance: number;
}
export const wheelContactPose = (): WheelContactPose => ({
  valid: false,
  longitudinal: 0,
  lateral: 0,
  radial: 0,
  hubLength: 0,
  normalX: 0,
  normalY: 1,
  normalZ: 0,
  planeDistance: 0,
});

function validContact(frame: Float32Array, car: number, wheel: number) {
  const mask = frame[car + WHEEL_CONTACT_BASE];
  return Number.isInteger(mask) && mask >= 0 && mask <= 15 && (mask & (1 << wheel)) !== 0;
}

/** Linear interpolation preserves measured strain bounds, including signed
 * steering reversals. A service changes the tire's strain at the actual
 * replacement boundary. Placement/recovery follows the same discontinuity
 * policy as the chassis. Unknown endpoints are never invented. */
export function sampleWheelContact(
  a: Float32Array,
  b: Float32Array,
  car: number,
  wheel: number,
  alpha: number,
  out: WheelContactPose,
) {
  let t = presentationAlpha(a, b, car, alpha);
  const validA = validContact(a, car, wheel),
    validB = validContact(b, car, wheel);
  out.valid = t >= 1 ? validB : validA;
  if (t < 1 && !validB) t = 0;
  if (!out.valid) {
    out.longitudinal = out.lateral = out.radial = out.hubLength = out.planeDistance = 0;
    out.normalX = out.normalZ = 0;
    out.normalY = 1;
    return out;
  }
  const p = wheelContactBase(car, wheel),
    strainAlpha = tireAlpha(a, b, car, t);
  out.longitudinal = sampleValue(a, b, p + C.LONGITUDINAL, strainAlpha);
  out.lateral = sampleValue(a, b, p + C.LATERAL, strainAlpha);
  out.radial = sampleValue(a, b, p + C.RADIAL, t);
  out.hubLength = sampleValue(a, b, p + C.HUB_LENGTH, t);
  out.normalX = sampleValue(a, b, p + C.NORMAL_X, t);
  out.normalY = sampleValue(a, b, p + C.NORMAL_Y, t);
  out.normalZ = sampleValue(a, b, p + C.NORMAL_Z, t);
  out.planeDistance = sampleValue(a, b, p + C.PLANE_DISTANCE, t);
  const length = Math.hypot(out.normalX, out.normalY, out.normalZ);
  if (
    !Number.isFinite(
      out.longitudinal + out.lateral + out.radial + out.hubLength + length + out.planeDistance,
    ) ||
    length < 1e-8 ||
    out.radial < 0 ||
    Math.hypot(out.normalY, out.normalZ) < 1e-8
  ) {
    out.valid = false;
    out.longitudinal = out.lateral = out.radial = out.hubLength = out.planeDistance = 0;
    out.normalX = out.normalZ = 0;
    out.normalY = 1;
    return out;
  }
  out.normalX /= length;
  out.normalY /= length;
  out.normalZ /= length;
  return out;
}

/** Place the rigid axle at the measured suspension hub. Old/synthetic poses
 * retain their geometric wheel-length convention. */
export function contactHubLength(
  contact: WheelContactPose,
  a: Float32Array,
  b: Float32Array,
  wheel: number,
  alpha: number,
) {
  return contact.valid ? contact.hubLength : wheelTravel(a, b, wheel, alpha);
}

/** Distant wheel cylinders retain a round silhouette. Fit that bounded
 * approximation to the measured road plane, accounting for section width
 * and camber; the rigid rim still establishes a minimum safe radius. */
export function contactCylinderRadius(
  contact: WheelContactPose,
  radius: number,
  bead: number,
  half: number,
) {
  if (!contact.valid || contact.radial <= 0) return radius;
  return Math.max(
    bead + 0.006,
    Math.min(
      radius,
      (contact.planeDistance - Math.abs(contact.normalX) * half) /
        Math.max(1e-8, Math.hypot(contact.normalY, contact.normalZ)),
    ),
  );
}
