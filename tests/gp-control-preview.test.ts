import { describe, expect, it } from 'vitest';
import { BIKE_AI, BikeAIDriver, GP_AI_HANDS } from '../src/simulation/bike-ai.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import type { Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

class PreviewProbe extends BikeAIDriver {
  readonly stations: number[] = [];
  protected override steeringLineCurvature(track: Track, s: number) {
    this.stations.push(s);
    return super.steeringLineCurvature(track, s);
  }
}

describe('GP steering and braking preview agreement', () => {
  it('plans brake capacity for the same future curve the production lean follower requests', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 0,
      vehicles: ['gpr1'],
    });
    sim.race.time = sim.race.greenAt + 10;
    const bike = sim.cars[0] as BikeVehicle;
    bike.place(sim.track, 500);
    for (const speed of [10, 40, 90]) {
      bike.dynamics.speed = bike.speed = speed;
      const probe = new PreviewProbe(bike),
        station = bike.s;
      probe.update(1 / 120, sim.track, sim.cars, sim.race);
      // The approach plan queries its first curve before the final steering
      // query. Their difference is only the lever's mean half-rise travel.
      expect(probe.stations.length).toBeGreaterThan(2);
      expect(probe.stations.at(-1)! - station).toBeCloseTo(speed * BIKE_AI.preview, 10);
      expect(probe.stations[0] - probe.stations.at(-1)!).toBeCloseTo(
        speed / (2 * GP_AI_HANDS.brakeApply),
        10,
      );
    }
  });
});
