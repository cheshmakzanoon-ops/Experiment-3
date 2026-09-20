import { F, H, W } from '../simulation/protocol.ts';
import { lerp, TAU } from '../core/math.ts';

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
  const start = a[wheel + W.ROTATION],
    end = b[wheel + W.ROTATION];
  if (alpha <= 0) return start;
  if (alpha >= 1) return end;
  const dt = b[H.TIME] - a[H.TIME];
  const replacement =
    b[car + F.COMPOUND] !== a[car + F.COMPOUND] || b[car + F.PIT_STOPS] !== a[car + F.PIT_STOPS];
  // A discontinuity or tire replacement is a new baseline, never a spun-back tire.
  if (!(dt > 0 && dt <= 0.5) || replacement) return start;
  const predicted = (a[wheel + W.OMEGA] + b[wheel + W.OMEGA]) * 0.5 * dt;
  const difference = end - start;
  const lifted = difference + TAU * Math.round((predicted - difference) / TAU);
  return start + alpha * lifted;
}
export function wheelTravel(a: Float32Array, b: Float32Array, wheel: number, alpha: number) {
  return lerp(a[wheel + W.LENGTH] || 0.25, b[wheel + W.LENGTH] || 0.25, alpha);
}
