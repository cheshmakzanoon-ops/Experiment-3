import { clamp } from '../../core/math.ts';
import {
  H, MX_POSTURE, O, OFFROAD_BASE, hasMxRiderPosture,
} from '../../simulation/protocol.ts';

/** Reconstruct the worker's stance, dab and body between measured snapshots.
 * Signed tangents retain a genuine reversal between the endpoints, including
 * equal endpoint positions. Bounding the equivalent Bezier control points
 * keeps the complete Hermite curve inside the physical pose range without
 * changing either recorded position or adding a render-time spring. */
export function sampleMxPostureField(
  a: Float32Array, b: Float32Array, car: number, field: number, t: number,
) {
  if ((field !== O.STANDING && field !== O.DAB && field !== O.BODY) ||
      !hasMxRiderPosture(a, car) || !hasMxRiderPosture(b, car)) return undefined;
  const p = car + OFFROAD_BASE + field;
  const start = a[p], end = b[p], minimum = field === O.STANDING ? 0 : -1;
  const rate = car + (field === O.STANDING ? MX_POSTURE.STANDING_RATE :
    field === O.DAB ? MX_POSTURE.DAB_RATE : MX_POSTURE.BODY_RATE);
  const startRate = a[rate], endRate = b[rate], dt = b[H.TIME] - a[H.TIME];
  if (!Number.isFinite(start) || !Number.isFinite(end) ||
      !Number.isFinite(startRate) || !Number.isFinite(endRate) ||
      !Number.isFinite(t) || start < minimum || start > 1 || end < minimum || end > 1 ||
      !(dt > 0 && dt <= 0.125)) return undefined;
  if (t <= 0) return start;
  if (t >= 1) return end;
  if (field === O.BODY) {
    const airborne = car + OFFROAD_BASE + O.AIRBORNE, flight = car + OFFROAD_BASE + O.AIR_TIME;
    // Ground and flight compute different automatic body demands. Do not
    // spread a launch/landing's new tangent across the preceding interval.
    // A changed last-flight clock also catches a complete short hop between
    // two grounded snapshots; a rewind identifies a new airborne origin.
    if (a[airborne] !== b[airborne] || b[flight] < a[flight] ||
        (a[airborne] === 0 && a[flight] !== b[flight])) return undefined;
  }
  const tangentA = 3 * (clamp(start + startRate * dt / 3, minimum, 1) - start);
  const tangentB = 3 * (end - clamp(end - endRate * dt / 3, minimum, 1));
  const change = end - start;
  const quadratic = 3 * change - 2 * tangentA - tangentB;
  const cubic = tangentA + tangentB - 2 * change;
  // The control hull already guarantees the bound; clamp only round-off at
  // the closed limits so even saturated/coarse recorded strokes stay valid.
  return clamp(start + t * (tangentA + t * (quadratic + t * cubic)), minimum, 1);
}
