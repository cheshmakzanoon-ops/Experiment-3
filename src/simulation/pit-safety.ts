import { clamp, mod } from '../core/math.ts';
import type { Track } from './track.ts';
import type { Vehicle } from './vehicle.ts';

// At this station the exit lane is still laterally clear of the racing surface.
export const PIT_HOLD_S = 268;
export const PIT_MERGE_END_S = 330;
/** Predict the swept merge corridor from the hold line. Cars already committed
 * beyond it continue merging; racing traffic also predicts that trajectory.
 * The controller, not this predicate, supplies the actual braking force. */
export function pitMergeConflict(car: Vehicle, cars: readonly Vehicle[], track: Track): boolean {
  if (car.pitPhase !== 6 || car.s < 210 || car.s > PIT_HOLD_S + 2) return false;
  const approachTime = Math.max(0, PIT_HOLD_S - car.s) / Math.max(8, car.speed);
  for (const other of cars) {
    if (other === car || other.inPit || other.retired || other.speed < 1) continue;
    const initialGap =
      mod(other.s - PIT_HOLD_S + track.length / 2, track.length) - track.length / 2;
    if (initialGap > 100 || initialGap < -other.speed * (approachTime + 9)) continue;
    for (let t = 0.25; t <= 8; t += 0.25) {
      // Conservative low-speed acceleration followed by the exit speed cap.
      const travel = t < 3.5 ? 2 * t * t : 24.5 + 14 * (t - 3.5);
      const s = PIT_HOLD_S + travel;
      const ourLateral = track.pitOffset(s) * (20.5 / 22);
      const longitudinalGap = initialGap + other.speed * (approachTime + t) - travel;
      const theirLateral = other.lateral + clamp(other.aiOffset - other.lateral, -1.6 * t, 1.6 * t);
      if (
        Math.abs(longitudinalGap) < 7 + (other.speed + 14) * 0.125 &&
        Math.abs(theirLateral - ourLateral) < 3
      )
        return true;
      if (s > PIT_MERGE_END_S + 12) break;
    }
  }
  return false;
}
/** A stationary queue behind a serviced car must not deadlock its release.
 * Adjacent cars always block, moving upstream traffic blocks by time-to-arrival,
 * and a car waiting at least one chassis length behind yields priority. */
export function safePitRelease(car: Vehicle, cars: readonly Vehicle[], track: Track): boolean {
  for (const other of cars) {
    if (other === car || !other.inPit || Math.abs(other.lateral - 20.5) > 2.4) continue;
    const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
    const a = car.forward.x * car.trackPosition.tx + car.forward.z * car.trackPosition.tz;
    const b = other.forward.x * car.trackPosition.tx + other.forward.z * car.trackPosition.tz;
    const occupied =
      2.5 * (Math.abs(a) + Math.abs(b)) +
      0.94 * (Math.sqrt(Math.max(0, 1 - a * a)) + Math.sqrt(Math.max(0, 1 - b * b))) +
      0.05;
    if (gap > -occupied && gap < 12) return false;
    if (gap <= -occupied && other.speed > 1 && -gap / other.speed < 2.5) return false;
  }
  return true;
}
export function pitYieldSpeed(car: Vehicle, conflict: boolean, braking: number): number {
  if (!conflict) return Infinity;
  const remaining = Math.max(0, PIT_HOLD_S - car.s);
  return Math.sqrt(2 * clamp(braking, 1, 8) * remaining);
}
