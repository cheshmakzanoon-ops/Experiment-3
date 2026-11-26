import { F, H, R, RACE_BASE, W, WHEEL_BASE, WHEEL_STRIDE } from '../simulation/protocol.ts';
import { vehicleAt } from '../simulation/vehicles.ts';
import { recordedWheelTurns } from '../simulation/wheel-rotation.ts';
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
  // MX exposure and chain motion must use the velocity of the displayed wheel,
  // including recorded spin bursts and limited braking slopes. Keep every
  // other vehicle's existing measured-velocity interpolation unchanged.
  if (
    field === W.OMEGA &&
    vehicleAt(snapshotSource(a, b, alpha)[car + RACE_BASE + R.VEHICLE]).tireFamily === 'knobby'
  )
    return sampleWheelMotion(a, b, car, wheel, alpha, true);
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
  return sampleWheelMotion(a, b, car, wheel, alpha, false);
}

/** Choose the winding, fallback and post-limiter tangents in one place. The
 * scalar entrypoints allocate nothing, and omega differentiates this exact
 * curve. Endpoints, paused snapshots and reset/service holds retain their
 * selected recorded state; an unresolved continuous interval has zero rate. */
function sampleWheelMotion(
  a: Float32Array,
  b: Float32Array,
  car: number,
  wheel: number,
  alpha: number,
  rate: boolean,
) {
  alpha = presentationAlpha(a, b, car, alpha);
  const start = a[wheel + W.ROTATION],
    end = b[wheel + W.ROTATION];
  if (alpha <= 0) return rate ? a[wheel + W.OMEGA] : start;
  if (alpha >= 1) return rate ? b[wheel + W.OMEGA] : end;
  const dt = b[H.TIME] - a[H.TIME];
  // A discontinuity or tire replacement is a new baseline, never a spun-back tire.
  if (!(dt > 0) || tireAlpha(a, b, car, alpha) === 0) return rate ? a[wheel + W.OMEGA] : start;
  const index = (wheel - car - WHEEL_BASE) / WHEEL_STRIDE,
    turnsA = recordedWheelTurns(a, car, index),
    turnsB = recordedWheelTurns(b, car, index),
    measured = turnsA !== undefined && turnsB !== undefined;
  if (dt > 0.5 && !measured) return rate ? 0 : start;
  let tangentA = a[wheel + W.OMEGA] * dt,
    tangentB = b[wheel + W.OMEGA] * dt;
  const predicted = (tangentA + tangentB) * 0.5;
  const difference = end - start;
  const lifted =
    difference + TAU * (measured ? turnsB - turnsA : Math.round((predicted - difference) / TAU));
  if (!Number.isFinite(lifted)) return rate ? 0 : start;
  // A long gap retains exact net rotations, but its interior acceleration and
  // contact changes are unresolved. Do not freeze a moving wheel or invent a
  // cubic trajectory from distant endpoint velocities.
  if (measured && (dt > 0.5 || !Number.isFinite(tangentA + tangentB)))
    return rate ? lifted / dt : start + lifted * alpha;
  if (!Number.isFinite(tangentA + tangentB)) return rate ? 0 : start;
  // A small, coherent reversal can genuinely turn around within one sample.
  // Otherwise limit slopes to preserve direction and prevent impulse overshoot.
  const reversal =
    tangentA * tangentB < 0 &&
    Math.abs(tangentA) + Math.abs(tangentB) < Math.PI &&
    Math.abs(predicted - lifted) < 0.03;
  if (!reversal) {
    if (Math.abs(lifted) < 1e-8) return rate ? 0 : start;
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
  if (rate)
    return (
      (6 * alpha * (1 - alpha) * lifted +
        (3 * alpha * alpha - 4 * alpha + 1) * tangentA +
        (3 * alpha * alpha - 2 * alpha) * tangentB) /
      dt
    );
  return start + hermite(0, lifted, tangentA, tangentB, alpha);
}
export function wheelTravel(a: Float32Array, b: Float32Array, wheel: number, alpha: number) {
  return lerp(a[wheel + W.LENGTH] || 0.25, b[wheel + W.LENGTH] || 0.25, alpha);
}
