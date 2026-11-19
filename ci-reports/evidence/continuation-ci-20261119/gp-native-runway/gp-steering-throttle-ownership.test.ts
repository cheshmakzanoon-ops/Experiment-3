import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { BikeAIDriver } from '../src/simulation/bike-ai.ts';
import { GP_R1 } from '../src/simulation/bike-definitions.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { Track } from '../src/simulation/track.ts';

class DemandDriver extends BikeAIDriver {
  constructor(
    bike: BikeVehicle,
    private readonly pathAcceleration: number,
    private readonly correctionAcceleration: number,
  ) {
    super(bike);
  }
  protected override steeringLineOffset() {
    return 0;
  }
  protected override steeringLineCurvature() {
    return this.pathAcceleration / this.bike.dynamics.speed ** 2;
  }
  protected override pathCorrection() {
    return this.correctionAcceleration / this.bike.dynamics.speed ** 2;
  }
}

/** Exercise the actual intent conversion followed by the actual throttle
 * budget, with controlled path/feedback inputs instead of duplicating either
 * controller formula. The final physical contact controls still run in Bike. */
function plannedThrottle(track: Track, path: number, correction: number, support = 1) {
  const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', GP_R1);
  bike.place(track, 120, 0);
  const d = bike.dynamics;
  d.speed = 30;
  d.frontLoad = (support * d.mass * G * d.p.cgToRear) / d.p.wheelbase;
  d.rearLoad = (support * d.mass * G * d.p.cgToFront) / d.p.wheelbase;
  d.contactLoads = { front: d.frontLoad, rear: d.rearLoad };
  bike.gear = 1;
  bike.rpm = 12000;
  bike.aiOffset = 0;
  const driver = new DemandDriver(bike, path, correction) as unknown as {
    steerIntent(track: Track, steer: number): number;
    steeringThrottle(): number;
  };
  bike.input.steer = driver.steerIntent(track, 0);
  return { intent: bike.input.steer, throttle: driver.steeringThrottle() };
}

describe('GP AI charges the total requested lateral acceleration once', () => {
  const track = new Track('clear', true);

  it.each([-1, 1])(
    'keeps the same %s turn budget when path correction agrees with or opposes its curve',
    (sign) => {
      const total = sign * 6;
      const plain = plannedThrottle(track, total, 0);
      expect(plain.throttle).toBeGreaterThan(0);
      expect(plain.throttle).toBeLessThan(1);
      for (const correction of [sign * 2, -sign * 2]) {
        const result = plannedThrottle(track, total - correction, correction);
        expect(result.intent).toBeCloseTo(plain.intent, 12);
        expect(result.throttle).toBeCloseTo(plain.throttle, 12);
      }
    },
  );

  it('inverts intent with the same normal reaction used to encode its path demand', () => {
    const nominal = plannedThrottle(track, 6, 0);
    for (const support of [0.7, 1.3]) {
      const result = plannedThrottle(track, 6, 0, support);
      expect(result.intent).not.toBeCloseTo(nominal.intent, 3);
      expect(result.throttle).toBeCloseTo(nominal.throttle, 12);
    }
  });
});
