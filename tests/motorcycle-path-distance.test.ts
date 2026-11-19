import { describe, expect, it, vi } from 'vitest';
import { G } from '../src/core/math.ts';
import { AI_ENVELOPE, ENVELOPE_STEP, envelopeProfile } from '../src/simulation/ai.ts';
import { BikeAIDriver } from '../src/simulation/bike-ai.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { motorcyclePathMetric } from '../src/simulation/motorcycle-braking-plan.ts';
import { trackPoint, type Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

describe('motorcycle braking in physical path metres', () => {
  const radius = 30,
    env = { ...AI_ENVELOPE, brakingBase: 6, brakingAero: 0, brakingMargin: 1 };

  it.each([-6, 0, 6])('matches braking work on a circular lane offset by %s m', (offset) => {
    const angle = ENVELOPE_STEP / radius,
      arc = (radius - offset) * angle,
      metric = motorcyclePathMetric(1 / radius, offset, 0),
      entry = envelopeProfile([0, 0], [100, 10], 1, 0, env, 2, undefined, undefined, undefined, [
        metric * ENVELOPE_STEP,
      ]);
    expect(metric * ENVELOPE_STEP).toBeCloseTo(arc, 12);
    // Work per unit mass: (v_entry² - v_exit²)/2 = deceleration * path length.
    expect((entry * entry - 10 * 10) / 2).toBeCloseTo(6 * arc, 11);
  });

  it('includes lateral lane travel and uses that same distance for road grade', () => {
    // A straight centreline plus d(s)=0.3s is a diagonal, independently of a
    // racing-line implementation. Its horizontal length follows Pythagoras.
    const slope = 0.3,
      metric = motorcyclePathMetric(0, 4, slope),
      distance = Math.hypot(ENVELOPE_STEP, slope * ENVELOPE_STEP),
      heightChange = -0.08 * ENVELOPE_STEP,
      gradient = heightChange / distance,
      gravity = (G * gradient) / Math.hypot(1, gradient),
      speed = envelopeProfile(
        [0, 0],
        [100, 10],
        1,
        0,
        env,
        2,
        undefined,
        [gradient, gradient],
        undefined,
        [distance],
      );
    expect(metric * ENVELOPE_STEP).toBeCloseTo(distance, 12);
    expect((speed * speed - 100) / 2).toBeCloseTo((6 + gravity) * distance, 11);
  });

  it('retains the exact default/car profile when physical distances are omitted or equal', () => {
    const curvatures = [0, 0.002, 0.009, 0.018, 0.04],
      corners = [100, 70, 44, 28, 18],
      original = envelopeProfile(curvatures, corners, 0.7, 1),
      distances = new Float64Array(8).fill(NaN);
    distances.fill(ENVELOPE_STEP, 0, corners.length - 1);
    expect(
      envelopeProfile(
        curvatures,
        corners,
        0.7,
        1,
        undefined,
        5,
        undefined,
        undefined,
        undefined,
        distances,
      ),
    ).toBe(original);
  });

  it('uses the offset arc in the production GP plan and its lever feed-forward', () => {
    const offset = 6,
      gradient = -0.08,
      sim = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'practice',
        opponents: 0,
        vehicles: ['gpr1'],
      }),
      bike = sim.cars[0] as BikeVehicle;
    class Probe extends BikeAIDriver {
      protected override steeringLineOffset() {
        return offset;
      }
      protected override steeringLineCurvature() {
        return 1 / (radius - offset);
      }
      plan(track: Track) {
        return this.limitSpeed(100, track, sim.race);
      }
      get distance() {
        return this.planDistance;
      }
      brakeAt(netDeceleration: number) {
        this.planNext = Math.sqrt(
          bike.dynamics.speed ** 2 - 2 * netDeceleration * this.planDistance,
        );
        return this.brakeDemand(0);
      }
    }
    bike.dynamics.speed = bike.speed = 20;
    bike.aiOffset = offset;
    const driver = new Probe(bike);
    const sample = vi.spyOn(sim.track, 'at').mockImplementation((s, point = trackPoint()) => {
      Object.assign(point, {
        s,
        x: radius * (1 - Math.cos(s / radius)),
        z: radius * Math.sin(s / radius),
        y: gradient * s,
        tx: Math.sin(s / radius),
        tz: Math.cos(s / radius),
        nx: Math.cos(s / radius),
        nz: -Math.sin(s / radius),
        curvature: 1 / radius,
        gradient,
        width: 8,
      });
      return point;
    });
    try {
      expect(Number.isFinite(driver.plan(sim.track))).toBe(true);
      expect(driver.distance).toBeCloseTo((ENVELOPE_STEP * (radius - offset)) / radius, 12);
      bike.dynamics.slope = 0;
      const level = driver.brakeAt(3);
      bike.dynamics.slope = -0.08;
      expect(driver.brakeAt(3) / level).toBeCloseTo((3 + 0.08 * G) / 3, 10);
    } finally {
      sample.mockRestore();
    }
  });
});
