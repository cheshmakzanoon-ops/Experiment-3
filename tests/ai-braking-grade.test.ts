import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { AI_ENVELOPE, ENVELOPE_STEP, envelopeProfile } from '../src/simulation/ai.ts';
import { BikeAIDriver } from '../src/simulation/bike-ai.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';

class GradeProbe extends BikeAIDriver {
  prepare(sim: Simulation) {
    this.limitSpeed(100, sim.track, sim.race);
  }
  brakeFor(deceleration: number) {
    this.planNext = Math.sqrt(this.bike.dynamics.speed ** 2 - 2 * deceleration * this.planDistance);
    return this.brakeDemand(0);
  }
}

describe('grade-aware braking envelope', () => {
  const env = { ...AI_ENVELOPE, brakingBase: 6, brakingAero: 0, brakingMargin: 1 };
  it.each([-0.1, 0, 0.1])(
    'matches constant-gradient stopping energy for gradient %s',
    (gradient) => {
      const corners = [100, 10],
        profile = new Float64Array(2),
        expected = Math.sqrt(
          10 ** 2 + 2 * (6 + (G * gradient) / Math.sqrt(1 + gradient ** 2)) * ENVELOPE_STEP,
        );
      expect(
        envelopeProfile([0, 0], corners, 1, 0, env, 2, profile, [gradient, gradient]),
      ).toBeCloseTo(expected, 12);
      expect(profile[1]).toBe(10);
    },
  );

  it('keeps omitted and zero-gradient callers identical and ignores inactive buffer tails', () => {
    const curvature = [0, 0.002, 0.009, 0.018, 0.04],
      corners = [100, 70, 44, 28, 18],
      level = envelopeProfile(curvature, corners, 0.7, 1),
      zero = new Float64Array(8).fill(NaN);
    zero.fill(0, 0, corners.length);
    expect(envelopeProfile(curvature, corners, 0.7, 1, undefined, 5, undefined, zero)).toBe(level);
  });

  it('asks the GP tyres to oppose downhill gravity without adding it twice to net deceleration', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      circuit: 'poggio-alto',
      opponents: 0,
      vehicles: ['gpr1'],
    });
    const bike = sim.cars[0] as BikeVehicle,
      probe = new GradeProbe(bike);
    bike.dynamics.speed = bike.speed = 60;
    probe.prepare(sim);
    bike.dynamics.slope = 0;
    const level = probe.brakeFor(3);
    expect(level).toBeGreaterThan(0);
    expect(level).toBeLessThan(0.5);
    for (const sine of [-0.1, 0.1]) {
      bike.dynamics.slope = sine;
      const onSlope = probe.brakeFor(3);
      // A 3 m/s² net stop needs (3 - g*sin(angle)) m/s² from tyres.
      expect(onSlope / level).toBeCloseTo((3 - G * sine) / 3, 10);
    }
  });
});
