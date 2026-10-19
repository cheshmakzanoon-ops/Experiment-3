import { F, H, W } from '../simulation/protocol.ts';
import { lerp, TAU } from '../core/math.ts';
import {
  hermite,
  presentationAlpha,
  sampleValue,
  snapshotSource,
} from './snapshot-interpolation.ts';

export function tireAlpha(a: Float32Array, b: Float32Array, car: number, alpha: number) {
  return alpha < 1 &&
    (b[car + F.COMPOUND] !== a[car + F.COMPOUND] || b[car + F.PIT_STOPS] !== a[car + F.PIT_STOPS])
    ? 0
    : alpha;
}

/** Replacement tyres acquire fresh temperatures, wear and pressure at the
 * replacement boundary. Suspension travel and contact forces keep their motion. */
export function wheelValue(
  a: Float32Array,
  b: Float32Array,
  car: number,
  wheel: number,
  field: number,
  alpha: number,
) {
  if (field === W.SURFACE || field === W.PUNCTURED)
    return snapshotSource(a, b, alpha)[wheel + field];
  const t =
    field === W.OMEGA ||
    (field >= W.SURFACE_TEMP && field <= W.DIRT) ||
    (field >= W.FLAT && field <= W.GRAINING)
      ? tireAlpha(a, b, car, alpha)
      : alpha;
  return sampleValue(a, b, wheel + field, t);
}

/** Lift a wrapped phase using the recorded angular velocities. Shortest-arc
 * interpolation alone makes a fast rolling wheel rotate backwards at 15 Hz.
 * Between adjacent samples the trapezoidal angular-speed estimate selects the
 * nearest whole-turn count; it is not a re-simulation of an unrecorded tire. */
export function wheelPhase(
  a: Float32Array,
  b: Float32Array,
  car: number,
  wheel: number,
  alpha: number,
) {
  alpha = presentationAlpha(a, b, car, alpha);
  const start = a[wheel + W.ROTATION],
    end = b[wheel + W.ROTATION];
  if (alpha <= 0) return start;
  if (alpha >= 1) return end;
  const dt = b[H.TIME] - a[H.TIME];
  // A discontinuity or tire replacement is a new baseline, never a spun-back tire.
  if (!(dt > 0 && dt <= 0.5) || tireAlpha(a, b, car, alpha) === 0) return start;
  let tangentA = a[wheel + W.OMEGA] * dt,
    tangentB = b[wheel + W.OMEGA] * dt;
  const predicted = (tangentA + tangentB) * 0.5;
  const difference = end - start;
  const lifted = difference + TAU * Math.round((predicted - difference) / TAU);
  if (!Number.isFinite(lifted + tangentA + tangentB)) return start;
  // A small, coherent reversal can genuinely turn around within one sample.
  // Otherwise limit slopes to preserve direction and prevent impulse overshoot.
  const reversal =
    tangentA * tangentB < 0 &&
    Math.abs(tangentA) + Math.abs(tangentB) < Math.PI &&
    Math.abs(predicted - lifted) < 0.03;
  if (!reversal) {
    if (Math.abs(lifted) < 1e-8) return start;
    const sign = Math.sign(lifted),
      limit = 3 * Math.abs(lifted);
    tangentA = sign * Math.max(0, Math.min(limit, tangentA * sign));
    tangentB = sign * Math.max(0, Math.min(limit, tangentB * sign));
    const norm = Math.hypot(tangentA / lifted, tangentB / lifted);
    if (norm > 3) {
      tangentA *= 3 / norm;
      tangentB *= 3 / norm;
    }
  }
  return start + hermite(0, lifted, tangentA, tangentB, alpha);
}
export function wheelTravel(a: Float32Array, b: Float32Array, wheel: number, alpha: number) {
  return lerp(a[wheel + W.LENGTH] || 0.25, b[wheel + W.LENGTH] || 0.25, alpha);
}
