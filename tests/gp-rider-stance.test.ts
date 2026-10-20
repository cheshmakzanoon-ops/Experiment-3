import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  gpHelmetBuffet,
  gpLegDangle,
  gpRiderStance,
  gpTurnAhead,
  type GpRiderStance,
} from '../src/rendering/gp-rider-motion.ts';
import type { RiderPose } from '../src/rendering/rider.ts';
import { Track } from '../src/simulation/track.ts';

const base: RiderPose = { lean: 0, offset: 0, tuck: 0, braking: 0, steer: 0, speed: 50 };
const stance = (pose: Partial<RiderPose>): GpRiderStance =>
  gpRiderStance({ ...base, ...pose }, { x: 0, y: 0, z: 0, pitch: 0, into: 0, yaw: 0 });

describe('GP rider stance (REF 018/027/052/092)', () => {
  it('lies flatter in the tuck, rises only part way under braking and drops inside at full lean', () => {
    const tuck = stance({ tuck: 1, speed: 80 }),
      braking = stance({ braking: 1 }),
      corner = stance({ lean: 1.0, offset: 0.28, speed: 35 });
    expect(tuck.pitch).toBeGreaterThan(1.4);
    // Braced chest near 50 degrees from vertical, never sitting upright.
    expect(braking.pitch).toBeGreaterThan(0.95);
    expect(braking.pitch).toBeLessThan(tuck.pitch - 0.3);
    expect(braking.z).toBeGreaterThan(0);
    expect(corner.x).toBeCloseTo(0.28 * 0.74, 10);
    expect(corner.into).toBeGreaterThan(0.4);
    expect(corner.pitch).toBeGreaterThan(braking.pitch);
    const mirror = stance({ lean: -1.0, offset: -0.28, speed: 35 });
    expect(mirror.x).toBeCloseTo(-corner.x, 12);
    expect(mirror.into).toBeCloseTo(-corner.into, 12);
  });

  it('is a continuous, finite function of the snapshot values', () => {
    let previous: GpRiderStance | null = null;
    for (let i = 0; i <= 400; i++) {
      const t = i / 400,
        current = stance({
          lean: T.MathUtils.lerp(-1.1, 1.1, t),
          offset: T.MathUtils.lerp(-0.28, 0.28, t),
          braking: Math.max(0, 1 - 2 * t),
          throttle: Math.max(0, 2 * t - 1),
          tuck: 0,
        });
      for (const value of Object.values(current)) expect(Number.isFinite(value)).toBe(true);
      if (previous)
        for (const key of Object.keys(current) as (keyof GpRiderStance)[])
          expect(Math.abs(current[key] - previous[key])).toBeLessThan(0.03);
      previous = current;
    }
    expect(stance({ lean: NaN, offset: Infinity, braking: NaN }).pitch).toBeCloseTo(1.16, 10);
  });

  it('dangles only the inside leg in a hard straight stop before turn-in', () => {
    expect(gpLegDangle({ ...base, braking: 1, speed: 60 }, 0.8)).toBeCloseTo(1, 10);
    expect(gpLegDangle({ ...base, braking: 1, speed: 60 }, -0.8)).toBeCloseTo(-1, 10);
    // No dangle without braking, once leaned in, at low speed or on a straight.
    expect(gpLegDangle({ ...base, braking: 0.1, speed: 60 }, 0.8)).toBe(0);
    expect(gpLegDangle({ ...base, braking: 1, speed: 60, lean: 0.6 }, 0.8)).toBe(0);
    expect(gpLegDangle({ ...base, braking: 1, speed: 10 }, 0.8)).toBe(0);
    expect(gpLegDangle({ ...base, braking: 1, speed: 60 }, 0.05)).toBe(0);
  });

  it('reads the road ahead with the curvature sign and buffets only at very high speed', () => {
    const track = new Track(),
      corner = track.circuit.corners[0],
      turn = gpTurnAhead(track, corner.s - 60, 50);
    expect(Math.abs(turn)).toBeGreaterThan(0.15);
    expect(gpTurnAhead(track, NaN, 50)).toBe(0);
    expect(gpHelmetBuffet({ ...base, speed: 50, phase: 3 })).toBe(0);
    const fast = gpHelmetBuffet({ ...base, speed: 90, phase: 37 });
    expect(Math.abs(fast)).toBeGreaterThan(0);
    expect(Math.abs(fast)).toBeLessThan(0.015);
    expect(gpHelmetBuffet({ ...base, speed: 90, phase: 37 })).toBe(fast);
  });
});
