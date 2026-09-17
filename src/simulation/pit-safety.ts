import { clamp, mod } from '../core/math.ts';
import type { Track } from './track.ts';
import type { Vehicle } from './vehicle.ts';

export const PIT_HOLD_S = 238;
export const PIT_MERGE_END_S = 330;
/** Predict arrival intervals at the shared merge corridor, not only current
 * distance. A stopped pit car uses a conservative acceleration/travel estimate.
 * The prediction never moves a vehicle; the controller must brake/yield. */
export function pitMergeConflict(car: Vehicle, cars: readonly Vehicle[], track: Track): boolean {
  if (car.pitPhase !== 6 || car.s < 210 || car.s >= 300) return false;
  const travel = Math.max(0, 302 - car.s) / Math.max(8, car.speed);
  for (const other of cars) {
    if (other === car || other.inPit || other.retired || other.speed < 1) continue;
    const relative = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
    if (relative > 35 || relative < -other.speed * (travel + 4)) continue;
    const arrival = (302 - car.s - relative) / other.speed;
    if (arrival >= -1 && arrival < travel + 2.5) return true;
  }
  return false;
}
export function safePitRelease(car: Vehicle, cars: readonly Vehicle[], track: Track): boolean {
  for (const other of cars) {
    if (other === car || !other.inPit || Math.abs(other.lateral - 20.5) > 2.4) continue;
    const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
    // A stopped follower already outside our chassis envelope must yield to
    // the releasing car ahead. Treating it as approaching traffic creates a
    // circular wait: it cannot pass our box and we can never leave it.
    // The following controller retains its normal braking/separation checks.
    if (gap <= -6.5 && other.speed < 0.5) continue;
    if (gap > -Math.max(12, other.speed * 2) && gap < 10) return false;
  }
  return true;
}
export function pitYieldSpeed(car: Vehicle, conflict: boolean, braking: number): number {
  if (!conflict) return Infinity;
  const remaining = Math.max(0, PIT_HOLD_S - car.s);
  return Math.sqrt(2 * clamp(braking, 1, 8) * remaining);
}
