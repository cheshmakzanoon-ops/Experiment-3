import { expect, it } from 'vitest';
import { mod } from '../src/core/math.ts';
import { BikeAIDriver } from '../src/simulation/bike-ai.ts';
import type { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { PHASE } from '../src/simulation/race.ts';
import { racingLineFor } from '../src/simulation/racing-line.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 120;

class PitCancelProbe extends BikeAIDriver {
  sampledTraffic() {
    return this.trafficRefreshed;
  }
  roadSelection() {
    return { ...this.selectedRoadPath };
  }
}

it('retains the last road decision when an absolute pit approach is cancelled before the next traffic sample', () => {
  const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 0,
      vehicles: ['gpr1'],
      circuit: 'montejaral',
      seed: 5111,
    }),
    bike = sim.cars[0] as BikeVehicle,
    track = sim.track,
    driver = new PitCancelProbe(bike),
    native = driver as unknown as {
      desiredOffset: number;
      desiredTactical: number;
      tactical: number;
      preparingPit: boolean;
    },
    station = mod(track.pitEntryS() - 10, track.length),
    line = racingLineFor(track).offsetAt(station);
  sim.race.phase = PHASE.RACING;
  sim.race.time = sim.race.greenAt + 2;
  bike.place(track, station, line);
  bike.speed = bike.dynamics.speed = 15;
  const tick = () => {
    sim.race.time += DT;
    driver.update(DT, track, sim.cars, sim.race);
  };
  const sampleTraffic = () => {
    for (let frame = 0; frame < 13; frame++) {
      tick();
      if (driver.sampledTraffic()) return;
    }
    throw new Error('Native traffic planner did not refresh at its tactical cadence');
  };

  // Establish ordinary road intent through the real planner, then let that
  // same planner choose an absolute entry corridor at its normal cadence.
  sampleTraffic();
  expect(native.preparingPit).toBe(false);
  expect(driver.decision).toBe('RACING LINE');
  const roadIntent = native.desiredTactical;
  bike.pitRequested = true;
  sampleTraffic();
  expect(native.preparingPit).toBe(true);
  expect(driver.roadSelection().valid).toBe(false);
  // Let the newly sampled corridor move the native lane for three frames,
  // while staying well inside the next tactical sampling interval.
  tick();
  tick();
  expect(driver.sampledTraffic()).toBe(false);
  const corridor = native.desiredOffset,
    beforeCancel = native.tactical;
  expect(Math.abs(corridor - line - roadIntent)).toBeGreaterThan(2 * DT * 1.6);
  expect(Math.abs(beforeCancel - roadIntent)).toBeGreaterThan(2 * DT * 1.6);

  // No station change or physics step: this isolates frame ownership at
  // handback, without attributing authored spatial motion to a lane change.
  bike.pitRequested = false;
  tick();
  expect(driver.sampledTraffic()).toBe(false);
  expect(native.preparingPit).toBe(false);
  expect(driver.roadSelection().valid).toBe(true);
  expect(native.desiredOffset).toBe(corridor);
  expect(native.desiredTactical).toBe(roadIntent);
  expect(Math.abs(native.tactical - roadIntent)).toBeLessThan(
    Math.abs(beforeCancel - roadIntent),
  );
});
