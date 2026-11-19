import { describe, expect, it, vi } from 'vitest';
import { G } from '../src/core/math.ts';
import { AI_ENVELOPE, envelopeCornerSpeed, envelopeProfile } from '../src/simulation/ai.ts';
import { BIKE_AI, BikeAIDriver } from '../src/simulation/bike-ai.ts';
import { bikeParameters, SBK_1000 } from '../src/simulation/bike-definitions.ts';
import type { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import {
  motorcycleApproachProfile,
  motorcycleBrakeCapacity,
} from '../src/simulation/motorcycle-braking-plan.ts';
import { trackPoint, type Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

const env = {
  ...AI_ENVELOPE,
  lateralBase: 12,
  lateralAero: 0,
  lateralMargin: 1,
  slowLateralMargin: 1,
  brakingBase: 6,
  brakingAero: 0,
  brakingMargin: 1,
};

describe('motorcycle path-recovery force budget', () => {
  it.each([3, -3])(
    'keeps a signed correction of %s m/s² inside the same lateral budget',
    (correction) => {
      const curvature = 0.04,
        reserve = Math.abs(correction),
        speed = envelopeCornerSpeed(curvature, 1, 0, env, reserve);
      expect(speed).toBe(15);
      expect(speed * speed * curvature + reserve).toBe(env.lateralBase);
      // An opposing correction is conservative too: it does not grant more
      // speed that would consume the margin when the path recovery reverses.
      expect(Math.abs(speed * speed * curvature + correction)).toBeLessThanOrEqual(env.lateralBase);
    },
  );

  it('spends the same recovery reserve in the friction ellipse and motorcycle rear-load bound', () => {
    const p = { ...bikeParameters(SBK_1000), drag: 0, downforce: 0 },
      curvature = 0.02,
      reserve = 3,
      exit = 15,
      distance = 12,
      lateral = exit * exit * curvature + reserve,
      capacity = Math.min(
        env.brakingBase * Math.sqrt(1 - (lateral / env.lateralBase) ** 2),
        motorcycleBrakeCapacity(p, p.mass, 1, exit, lateral),
      ),
      profile = new Float64Array(2),
      entry = motorcycleApproachProfile(
        [0, curvature],
        [100, exit],
        1,
        0,
        env,
        2,
        profile,
        [0, 0],
        p,
        p.mass,
        1,
        0,
        [distance],
        reserve,
      );
    expect((entry * entry - exit * exit) / 2).toBeCloseTo(capacity * distance, 10);
    expect(capacity).toBeGreaterThan(0);
    expect(capacity).toBeLessThan(motorcycleBrakeCapacity(p, p.mass, 1, exit, lateral - reserve));
  });

  it('retains bit-exact corner and braking results when recovery is zero', () => {
    const curves = [0, 0.002, 0.009, 0.018, 0.04],
      corners = [100, 70, 44, 28, 18];
    for (const curvature of curves) {
      expect(envelopeCornerSpeed(curvature, 0.7, 1, AI_ENVELOPE, 0)).toBe(
        envelopeCornerSpeed(curvature, 0.7, 1),
      );
    }
    expect(
      envelopeProfile(
        curves,
        corners,
        0.7,
        1,
        AI_ENVELOPE,
        corners.length,
        undefined,
        undefined,
        undefined,
        undefined,
        0,
      ),
    ).toBe(envelopeProfile(curves, corners, 0.7, 1));
  });

  it('recomputes current recovery continuously and clears it immediately on the path', () => {
    const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'practice',
        opponents: 0,
        vehicles: ['gpr1'],
      }),
      bike = sim.cars[0] as BikeVehicle,
      curvature = 0.04;
    class Probe extends BikeAIDriver {
      protected override steeringLineOffset() {
        return 0;
      }
      protected override steeringLineCurvature() {
        return curvature;
      }
      plan(track: Track) {
        return this.limitSpeed(100, track, sim.race);
      }
      get reserve() {
        return this.planRecovery;
      }
      correction(track: Track) {
        return this.pathCorrection(track, 0, false) * bike.dynamics.speed ** 2;
      }
    }
    const driver = new Probe(bike, 1);
    bike.dynamics.speed = bike.speed = 20;
    bike.dynamics.heading = 0;
    bike.trackPosition.tx = 0;
    bike.trackPosition.tz = 1;
    bike.trackPosition.width = 8;
    bike.aiOffset = 0;
    const sample = vi.spyOn(sim.track, 'at').mockImplementation((s, point = trackPoint()) => {
      Object.assign(point, {
        s,
        x: 0,
        z: s,
        y: 0,
        tx: 0,
        tz: 1,
        nx: 1,
        nz: 0,
        curvature,
        gradient: 0,
        width: 8,
      });
      return point;
    });
    try {
      bike.lateral = 0;
      const free = driver.plan(sim.track);
      expect(driver.reserve).toBe(0);
      bike.lateral = -2;
      const recovering = driver.plan(sim.track);
      expect(driver.reserve).toBeCloseTo(2 * BIKE_AI.bandwidth ** 2, 12);
      expect(driver.reserve).toBeCloseTo(Math.abs(driver.correction(sim.track)), 12);
      expect(recovering).toBeLessThan(free);
      bike.lateral = 2;
      expect(driver.plan(sim.track)).toBe(recovering);
      bike.lateral = 2 + 1e-5;
      expect(Math.abs(driver.plan(sim.track) - recovering)).toBeLessThan(1e-3);
      bike.lateral = 5;
      driver.plan(sim.track);
      expect(driver.reserve).toBeCloseTo(BIKE_AI.correctionG * G, 12);
      bike.lateral = 0;
      expect(driver.plan(sim.track)).toBe(free);
      expect(driver.reserve).toBe(0);
    } finally {
      sample.mockRestore();
    }
  });
});
