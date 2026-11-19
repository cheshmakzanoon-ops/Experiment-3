import { expect, it } from 'vitest';
import { BikeAIDriver } from '../src/simulation/bike-ai.ts';
import type { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import type { RaceDirector } from '../src/simulation/race.ts';
import { racingLineFor } from '../src/simulation/racing-line.ts';
import type { Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

class WidthProbe extends BikeAIDriver {
  plan(track: Track, race: RaceDirector) {
    this.freeSpeed = 91.08;
    return this.limitSpeed(this.freeSpeed, track, race, this.bike.aiOffset);
  }
  passing(track: Track) {
    return this.passPace(track);
  }
}

const samples = (driver: BikeAIDriver) =>
  driver as unknown as {
    approachMetrics: Float64Array;
    approachDistances: Float64Array;
    approachCurvatures: Float64Array;
    approachGradients: Float64Array;
    approachCorners: Float64Array;
  };

it.each([
  { beforeWater: 0.8, afterWater: 0 },
  { beforeWater: 0, afterWater: 0.8 },
])(
  'extends the same authored path snapshot when front water changes from $beforeWater to $afterWater',
  ({ beforeWater, afterWater }) => {
    const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'practice',
        circuit: 'vellamar',
        ruleset: 'gp-motorcycle',
        opponents: 0,
        vehicles: ['gpr1'],
        seed: 3303,
      }),
      bike = sim.cars[0] as BikeVehicle,
      line = racingLineFor(sim.track),
      station = 165.06075214680368,
      speed = 68.88404586322334,
      driver = new WidthProbe(bike, 0.988, 3303);
    bike.place(sim.track, station, line.offsetAt(station));
    bike.speed = bike.dynamics.speed = speed;
    bike.dynamics.grip = bike.dynamics.frontGrip = bike.dynamics.rearGrip = 1;
    bike.dynamics.contactLoads = { front: 1250, rear: 1200 };
    bike.dynamics.frontLoad = 1250;
    bike.dynamics.rearLoad = 1200;
    bike.contacts[0].water = beforeWater;
    bike.contacts[2].water = 0;
    bike.aiOffset = line.offsetAt(station + 6 + speed * 0.48);
    expect(Number.isFinite(driver.plan(sim.track, sim.race))).toBe(true);
    const native = samples(driver),
      count = native.approachMetrics.findIndex((metric) => metric === 0);
    expect(count).toBeGreaterThan(2);
    const prefix = () => ({
      metrics: [...native.approachMetrics.slice(0, count)],
      distances: [...native.approachDistances.slice(0, count - 1)],
      curvatures: [...native.approachCurvatures.slice(0, count)],
      gradients: [...native.approachGradients.slice(0, count)],
      corners: [...native.approachCorners.slice(0, count)],
    });
    const before = prefix();
    // Passing extends the preceding control step's physical/path snapshot.
    // A later contact sample must not silently replace that snapshot's lane.
    bike.contacts[0].water = afterWater;
    expect(driver.passing(sim.track)).not.toBeNull();
    expect(native.approachMetrics[count]).toBeGreaterThan(0);
    expect(prefix()).toEqual(before);
    // Only the next ordinary solve adopts the new contact's authored path.
    // This rules out a permanently frozen helper or a no-op passing solve.
    driver.plan(sim.track, sim.race);
    expect([...native.approachMetrics.slice(0, count)]).not.toEqual(before.metrics);
  },
);
