import { expect, it } from 'vitest';
import { BikeAIDriver, bikePreviewDistance } from '../src/simulation/bike-ai.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { trackPoint, type Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

it.each(['sbk1000', 'ss600', 'nr900', 'cr750'])(
  '%s budgets the weaker contact and lane correction over actual path length',
  (id) => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      vehicles: [id],
      opponents: 0,
    });
    const bike = sim.cars[0] as BikeVehicle,
      track = sim.track;
    class Rider extends BikeAIDriver {
      protected override steeringLineOffset() {
        return 1.5;
      }
      protected override steeringLineCurvature() {
        return 0.035;
      }
    }
    const controls = new Rider(bike) as unknown as {
      roadPedals(track: Track): void;
      steeringCorrection: number;
      roadCorners: Float64Array;
      approachMetrics: Float64Array;
      approachDistances: Float64Array;
    };
    const station = track.length * 0.28;
    bike.place(track, station);
    bike.s = station;
    const point = track.at(station, trackPoint());
    bike.dynamics.heading = Math.atan2(point.tx, point.tz);
    bike.speed = bike.dynamics.speed = 32;
    bike.lateral = 1.5;
    bike.aiOffset = 1.5;
    bike.dynamics.grip = bike.dynamics.frontGrip = bike.dynamics.rearGrip = 1;
    const limit = (correction: number) => {
      bike.aiTarget = 90;
      controls.steeringCorrection = correction;
      controls.roadPedals(track);
      return controls.roadCorners[0];
    };
    const clean = limit(0);
    expect(clean).toBeGreaterThan(10);
    expect(limit(2.4)).toBeLessThan(clean);
    bike.dynamics.frontGrip = 0.65;
    const front = limit(0);
    expect(front).toBeLessThan(clean);
    bike.dynamics.frontGrip = 1;
    bike.dynamics.rearGrip = 0.65;
    expect(limit(0)).toBeCloseTo(front, 10);
    const s = station + bikePreviewDistance(32);
    for (const index of [0, 1])
      expect(controls.approachMetrics[index]).toBeCloseTo(
        Math.abs(1 - track.at(s + index * 12, trackPoint()).curvature * 1.5),
        10,
      );
    expect(controls.approachDistances[0]).toBeCloseTo(
      6 * (controls.approachMetrics[0] + controls.approachMetrics[1]),
      10,
    );
  },
);
