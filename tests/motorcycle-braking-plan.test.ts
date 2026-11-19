import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { envelopeProfile } from '../src/simulation/ai.ts';
import { bikeParameters, SBK_1000 } from '../src/simulation/bike-definitions.ts';
import {
  motorcycleApproachProfile,
  motorcycleBrakeCapacity,
} from '../src/simulation/motorcycle-braking-plan.ts';

const parameters = { ...bikeParameters(SBK_1000), drag: 0, downforce: 0 };

describe('motorcycle rear-load-preserving braking plan', () => {
  it('solves the rear normal-load transfer bound during a corner', () => {
    const p = parameters,
      lateral = 0.7 * p.mu * G,
      // Rear Fy/N must remain below .85*mu after braking transfers Fx*h/L.
      expected = ((G * p.cgToFront) / p.cgHeight) * (1 - 0.7 / 0.85),
      available = motorcycleBrakeCapacity(p, p.mass, 1, 30, lateral);
    expect(available).toBeCloseTo(expected, 12);
    expect(available).toBeLessThan(motorcycleBrakeCapacity(p, p.mass, 1, 30, 0));
    const remainingRear =
      (p.mass * G * p.cgToFront) / p.wheelbase - (p.mass * available * p.cgHeight) / p.wheelbase;
    expect((p.mass * lateral * p.cgToFront) / p.wheelbase).toBeCloseTo(
      remainingRear * 0.85 * p.mu,
      10,
    );
  });

  it('keeps the GP recovery reserve and ordinary rider offset inside that same bound', () => {
    const p = parameters,
      lateral = 0.65 * p.mu * G,
      ordinary = motorcycleBrakeCapacity(p, p.mass, 1, 30, lateral),
      gpReserve = motorcycleBrakeCapacity(p, p.mass, 1, 30, lateral, 1.0944444444444443),
      rider = motorcycleBrakeCapacity(p, p.mass, 1, 30, lateral, 1, 0.1);
    expect(gpReserve).toBeGreaterThan(0);
    expect(gpReserve).toBeLessThan(ordinary);
    expect(rider).toBeGreaterThan(0);
    expect(rider).toBeLessThan(ordinary);
    expect(motorcycleBrakeCapacity(p, p.mass, 1, 30, p.mu * G)).toBe(0);
  });

  it('starts slowing earlier than an ellipse while keeping shared uphill/downhill signs', () => {
    const curvature = [0, 0.009, 0.025, 0.025, 0.025],
      corners = [80, 45, 20, 20, 20],
      env = SBK_1000.ai,
      profile = new Float64Array(corners.length),
      solve = (gradient: number) =>
        motorcycleApproachProfile(
          curvature,
          corners,
          1,
          1,
          env,
          corners.length,
          profile,
          new Float64Array(corners.length).fill(gradient),
          parameters,
          parameters.mass,
        ),
      flat = solve(0),
      ellipse = envelopeProfile(curvature, corners, 1, 1, env);
    expect(flat).toBeLessThan(ellipse);
    expect(solve(-0.08)).toBeLessThan(flat);
    expect(solve(0.08)).toBeGreaterThan(flat);
    expect(profile.every(Number.isFinite)).toBe(true);
  });
});
