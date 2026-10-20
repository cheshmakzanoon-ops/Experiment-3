import { F, H, M, W, WHEEL_BASE, WHEEL_MOTION_BASE, WHEEL_STRIDE } from '../simulation/protocol.ts';
import { lerp, TAU } from '../core/math.ts';
import {
  hermite,
  presentationAlpha,
  sampleValue,
  snapshotSource,
} from './snapshot-interpolation.ts';

export function tireAlpha(a: Float32Array, b: Float32Array, car: number, alpha: number) {
  const phaseA = a[car + F.PIT_PHASE],
    phaseB = b[car + F.PIT_PHASE];
  return alpha < 1 &&
    (b[car + F.COMPOUND] !== a[car + F.COMPOUND] ||
      b[car + F.PIT_STOPS] !== a[car + F.PIT_STOPS] ||
      ((phaseB === 4 || phaseB === 5) && ((phaseA >= 0 && phaseA < 4) || phaseA === 6)))
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

/** Exact measured turns prevent aliasing when a wheel locks or spins up between
 * sparse snapshots. Endpoint velocities alone cannot distinguish those histories.
 * Synthetic poses without winding retain the earlier angular-speed estimate. */
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
  if (!(dt > 0) || tireAlpha(a, b, car, alpha) === 0) return start;
  const index = (wheel - car - WHEEL_BASE) / WHEEL_STRIDE,
    motion = car + WHEEL_MOTION_BASE,
    maskA = a[motion + M.VALID],
    maskB = b[motion + M.VALID],
    turnsA = a[motion + M.TURNS_FR + index],
    turnsB = b[motion + M.TURNS_FR + index],
    measured =
      Number.isInteger(index) &&
      index >= 0 &&
      index < 4 &&
      Number.isInteger(maskA) &&
      Number.isInteger(maskB) &&
      maskA >= 0 &&
      maskA <= 15 &&
      maskB >= 0 &&
      maskB <= 15 &&
      (maskA & maskB & (1 << index)) !== 0 &&
      Number.isInteger(turnsA) &&
      Number.isInteger(turnsB) &&
      Math.abs(turnsA) <= 0xffffff &&
      Math.abs(turnsB) <= 0xffffff;
  if (dt > 0.5 && !measured) return start;
  let tangentA = a[wheel + W.OMEGA] * dt,
    tangentB = b[wheel + W.OMEGA] * dt;
  const predicted = (tangentA + tangentB) * 0.5;
  const difference = end - start;
  const lifted =
    difference + TAU * (measured ? turnsB - turnsA : Math.round((predicted - difference) / TAU));
  if (!Number.isFinite(lifted)) return start;
  // A long gap retains exact net rotations, but its interior acceleration and
  // contact changes are unresolved. Do not freeze a moving wheel or invent a
  // cubic trajectory from distant endpoint velocities.
  if (measured && (dt > 0.5 || !Number.isFinite(tangentA + tangentB)))
    return start + lifted * alpha;
  if (!Number.isFinite(tangentA + tangentB)) return start;
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
