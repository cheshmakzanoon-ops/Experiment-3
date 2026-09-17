import { approach, clamp, mod, Random } from '../core/math.ts';
import type { Track } from './track.ts';
import type { Vehicle } from './vehicle.ts';

export interface DriverPersonality {
  aggression: number;
  consistency: number;
  wetSkill: number;
  overtakingSkill: number;
  tireManagement: number;
  defensiveBias: number;
  errorRate: number;
}
export function personality(seed: number, id: number): DriverPersonality {
  const rng = new Random((seed ^ Math.imul(id + 1, 0x9e3779b9)) >>> 0);
  return {
    aggression: 0.3 + rng.next() * 0.5,
    consistency: 0.92 + rng.next() * 0.07,
    wetSkill: 0.7 + rng.next() * 0.25,
    overtakingSkill: 0.7 + rng.next() * 0.25,
    tireManagement: 0.65 + rng.next() * 0.3,
    defensiveBias: rng.next(),
    errorRate: 0.002 + rng.next() * 0.005,
  };
}
export interface TrafficPlan {
  offset: number;
  speedLimit: number;
  decision: string;
}

/** Swept track-coordinate footprints over a four-second horizon. Lane changes
 * are evaluated at their achievable slew rate, never as instantaneous offsets.
 * Acceleration uncertainty inflates longitudinal separation requirements. */
export class TrafficPlanner {
  readonly result: TrafficPlan = { offset: 0, speedLimit: 110, decision: 'RACING LINE' };
  private heldOffset = 0;
  private holdUntil = 0;
  private candidates = new Float64Array(5);
  evaluate(
    car: Vehicle,
    cars: readonly Vehicle[],
    track: Track,
    now: number,
    braking: number,
    traits: DriverPersonality,
    yellow: boolean,
  ) {
    const result = this.result;
    const limit = Math.max(1, car.trackPosition.width - 2.4);
    const closest = clamp(car.lateral, -limit, limit);
    this.candidates[0] = clamp(now < this.holdUntil ? this.heldOffset : 0, -limit, limit);
    this.candidates[1] = closest;
    this.candidates[2] = clamp(closest - 3.5, -limit, limit);
    this.candidates[3] = clamp(closest + 3.5, -limit, limit);
    this.candidates[4] = 0;
    let best = Infinity,
      bestOffset = this.candidates[0],
      found = false;
    for (const candidate of this.candidates) {
      if (yellow && Math.abs(candidate - closest) > 1.5) continue;
      let score = Math.abs(candidate) * 0.22 + Math.abs(candidate - closest) * 0.6;
      if (now < this.holdUntil && Math.abs(candidate - this.heldOffset) > 0.6) score += 6;
      let safe = true;
      for (const other of cars) {
        if (other === car || other.inPit !== car.inPit) continue;
        const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
        if (Math.abs(gap) > 180) continue;
        const closing = other.speed - car.speed;
        const lateralVelocity = clamp(
          other.body.velocity.x * other.trackPosition.nx +
            other.body.velocity.z * other.trackPosition.nz,
          -2,
          2,
        );
        for (let t = 0.2; t <= 4; t += 0.4) {
          const dx = gap + closing * t;
          const ours = approach(closest, candidate, 1.6 * t);
          const theirs = clamp(other.lateral + lateralVelocity * Math.min(t, 1.2), -limit, limit);
          const dy = Math.abs(theirs - ours);
          if (Math.abs(dx) < 6.5 + Math.min(4, t * 0.5) && dy < 2.75) {
            safe = false;
            break;
          }
          if (dx > 0 && dx < 70 && dy < 2.9) score += ((70 - dx) / 70) * (1 + traits.aggression);
        }
        if (!safe) break;
      }
      if (safe && score < best) {
        best = score;
        bestOffset = candidate;
        found = true;
      }
    }
    // When no lane is safe, hold the currently occupied corridor and brake.
    // Emergency avoidance must not weave across a second car to dodge the first.
    result.offset = found ? bestOffset : closest;
    result.speedLimit = 110;
    result.decision = !found
      ? 'ABORT / FOLLOW'
      : Math.abs(bestOffset) > 1
        ? 'PASS / HOLD LANE'
        : 'RACING LINE';
    if (found && Math.abs(bestOffset - this.heldOffset) > 0.6) {
      this.heldOffset = bestOffset;
      this.holdUntil = now + 3;
    }
    for (const other of cars) {
      if (other === car || other.inPit !== car.inPit) continue;
      const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
      if (gap <= 0 || gap > 180) continue;
      const corridor =
        Math.abs(other.lateral - car.lateral) < 3 || Math.abs(other.lateral - result.offset) < 3;
      if (!corridor) continue;
      const reserve = 7 + car.speed * (0.28 + 0.12 * (1 - traits.consistency));
      const safeSpeed = Math.sqrt(
        Math.max(0, other.speed * other.speed + 2 * Math.max(1, braking * 0.72) * (gap - reserve)),
      );
      result.speedLimit = Math.min(result.speedLimit, safeSpeed);
      if (gap < 7) result.speedLimit = Math.min(result.speedLimit, Math.max(0, other.speed - 4));
    }
    return result;
  }
}
