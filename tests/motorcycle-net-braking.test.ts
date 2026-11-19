import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { AI_ENVELOPE, ENVELOPE_STEP, envelopeProfile } from '../src/simulation/ai.ts';
import { bikeParameters, SBK_1000 } from '../src/simulation/bike-definitions.ts';
import { motorcycleApproachProfile } from '../src/simulation/motorcycle-braking-plan.ts';

describe('vehicle-specific signed braking capacity', () => {
  const env = { ...AI_ENVELOPE, brakingBase: 6, brakingAero: 0, brakingMargin: 1 };
  const solve = (capacity: number, gradient = 0, exit = 10, distance = ENVELOPE_STEP) =>
    envelopeProfile(
      [0, 0],
      [100, exit],
      1,
      0,
      env,
      2,
      undefined,
      [gradient, gradient],
      () => capacity,
      [distance],
    );

  it.each([0, 0.2, 0.5, 3])('does not add a hidden braking floor to %s m/s²', (capacity) => {
    expect((solve(capacity) ** 2 - 100) / 2).toBeCloseTo(capacity * ENVELOPE_STEP, 12);
  });

  it('requires a slower entry when downhill gravity exceeds the available brakes', () => {
    const capacity = 0.2,
      gradient = -0.1,
      gravity = (G * gradient) / Math.hypot(1, gradient),
      entry = solve(capacity, gradient);
    expect(entry).toBeLessThan(10);
    expect((entry * entry - 100) / 2).toBeCloseTo((capacity + gravity) * ENVELOPE_STEP, 12);
  });

  it('returns a finite stop request when even entry at rest cannot meet the exit bound', () => {
    expect(solve(0, -0.5, 1, 100)).toBe(0);
    const profile = new Float64Array(5).fill(NaN);
    expect(
      envelopeProfile(
        [0, 0, 0],
        [100, 10, 1],
        1,
        0,
        env,
        3,
        profile,
        [-0.5, -0.5, -0.5],
        () => 0,
        [100, 100],
      ),
    ).toBe(0);
    expect(Array.from(profile.slice(0, 3))).toEqual([0, 0, 1]);
    expect(Number.isNaN(profile[3])).toBe(true);
  });

  it('preserves the car profile floor when no vehicle-specific capacity is supplied', () => {
    const carEnv = { ...env, brakingBase: 0 };
    expect(envelopeProfile([0, 0], [100, 10], 1, 0, carEnv)).toBe(Math.sqrt(100 + ENVELOPE_STEP));
  });

  it('honours the motorcycle rear-load reserve when it leaves no brake force', () => {
    const p = { ...bikeParameters(SBK_1000), drag: 0, downforce: 0 },
      curvature = (p.mu * G) / 100,
      profile = new Float64Array(2),
      entry = motorcycleApproachProfile(
        [curvature, curvature],
        [100, 10],
        1,
        0,
        SBK_1000.ai,
        2,
        profile,
        [0, 0],
        p,
        p.mass,
      );
    expect(entry).toBe(10);
    expect(Array.from(profile)).toEqual([10, 10]);
  });
});
