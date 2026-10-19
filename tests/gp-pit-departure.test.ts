import { describe, expect, it } from 'vitest';
import { AIDriver } from '../src/simulation/ai.ts';
import { BikeAIDriver, GP_PIT_DEPARTURE } from '../src/simulation/bike-ai.ts';
import type { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { updatePit } from '../src/simulation/race.ts';
import { SURFACE, type Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 120;

class DepartureProbe extends BikeAIDriver {
  lane(track: Track, s: number) {
    return this.pitLine(track, s);
  }
}

class SharedPitProbe extends AIDriver {
  lane(track: Track, s: number) {
    return this.pitLine(track, s);
  }
}

function stopped(vehicle = 'gpr1', opponents = 0) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    circuit: 'poggio-alto',
    ruleset: 'gp-motorcycle',
    opponents,
    vehicles: Array.from({ length: opponents + 1 }, () => vehicle),
  });
  sim.race.time = sim.race.greenAt + 1;
  const bike = sim.cars[0] as BikeVehicle;
  // Service accepts a real stop before the nominal box and off its centre.
  bike.place(sim.track, sim.track.boxS(0) - 1.86, sim.track.boxLateral() + 0.17);
  bike.inPit = true;
  bike.pitPhase = 5;
  const driver = new DepartureProbe(bike, 0.96, 30101);
  const update = () => driver.update(DT, sim.track, sim.cars, sim.race);
  return { sim, bike, driver, update };
}

describe('GP service-bay departure', () => {
  it.each(['gpr1', 'gpr2'])(
    '%s connects its actual stopped position to the lane without a position or slope step',
    (id) => {
      const { sim, bike, driver, update } = stopped(id);
      const origin = bike.s;
      const bay = bike.lateral;
      update();
      bike.pitPhase = 6;
      update();
      const shared = new SharedPitProbe(bike);
      const lane = shared.lane(sim.track, origin);
      expect(bay - lane).toBeGreaterThan(3.6);
      expect(driver.lane(sim.track, origin)).toBeCloseTo(bay, 12);
      expect(driver.lane(sim.track, origin + 60)).toBe(lane);
      // Read the planner's profile as geometry. No expected cubic formula is
      // copied here: require a continuous merge inside the paved corridor.
      let previous = bay;
      let laneEnd = 0;
      for (let distance = 0.05; distance <= 60; distance += 0.05) {
        const next = driver.lane(sim.track, origin + distance);
        expect(next).toBeLessThanOrEqual(previous + 1e-12);
        expect(next).toBeGreaterThanOrEqual(lane);
        expect((previous - next) / 0.05).toBeLessThanOrEqual(GP_PIT_DEPARTURE.maxSlope);
        if (!laneEnd && next === lane) laneEnd = distance;
        previous = next;
      }
      expect(laneEnd).toBeGreaterThanOrEqual(GP_PIT_DEPARTURE.minimumDistance);
      expect(laneEnd).toBeLessThan(60);
      const derivative = (s: number) =>
        (driver.lane(sim.track, s + 0.001) - driver.lane(sim.track, s - 0.001)) / 0.002;
      expect(Math.abs(derivative(origin))).toBeLessThan(0.0001);
      expect(Math.abs(derivative(origin + laneEnd - 0.05))).toBeLessThan(0.002);
      expect(Math.abs(derivative(origin + laneEnd))).toBeLessThan(0.0001);
      // Planning writes commands, never moves or reorients the parked bike.
      expect(bike.s).toBe(origin);
      expect(bike.lateral).toBe(bay);
      expect(bike.speed).toBe(0);
    },
  );

  it('keeps a held departure anchored to distance, handles lap-equivalent samples, and resets after exit', () => {
    const { sim, bike, driver, update } = stopped();
    const origin = bike.s;
    update();
    bike.pitPhase = 6;
    update();
    const target = bike.aiOffset;
    for (let i = 0; i < 3 / DT; i++) {
      sim.race.time += DT;
      update();
    }
    expect(bike.aiOffset).toBe(target);
    for (const distance of [-0.1, 0, 4, 15, 30, 60]) {
      const value = driver.lane(sim.track, origin + distance);
      for (const lap of [-1, 1])
        expect(driver.lane(sim.track, origin + distance + lap * sim.track.length)).toBeCloseTo(
          value,
          10,
        );
    }
    bike.inPit = false;
    bike.pitPhase = 0;
    update();
    bike.inPit = true;
    bike.pitPhase = 6;
    update();
    expect(driver.lane(sim.track, origin)).toBe(new SharedPitProbe(bike).lane(sim.track, origin));
    bike.pitPhase = 5;
    bike.place(sim.track, origin + 0.3, sim.track.boxLateral() - 0.2);
    update();
    bike.pitPhase = 6;
    update();
    expect(driver.lane(sim.track, bike.s)).toBeCloseTo(bike.lateral, 12);
  });

  it('does not arm a missed box or alter the service paths of other motorcycles', () => {
    for (const id of ['gpr1', 'sbk1000', 'ss600', 'nr900', 'cr750', 'mx450']) {
      const { sim, bike, driver, update } = stopped(id);
      bike.pitPhase = id === 'gpr1' ? 1 : 5;
      update();
      bike.pitPhase = 6;
      update();
      const shared = new SharedPitProbe(bike);
      for (const distance of [0, 5, 15, 40])
        expect(driver.lane(sim.track, bike.s + distance)).toBe(
          shared.lane(sim.track, bike.s + distance),
        );
    }
  });

  it('retains moving fast-lane priority and releases ahead of a safely stopped follower', () => {
    const { sim, bike, driver, update } = stopped('gpr1', 1);
    const follower = sim.cars[1] as BikeVehicle;
    follower.place(sim.track, bike.s - 12, sim.track.pit.offset - 1.5);
    follower.inPit = true;
    follower.pitPhase = 6;
    follower.dynamics.speed = follower.speed = 10;
    bike.pitClock = 8;
    update();
    updatePit(bike, sim.track, DT, sim.cars);
    expect(bike.pitPhase).toBe(5);
    expect(bike.pitStops).toBe(0);
    follower.dynamics.speed = follower.speed = 0;
    updatePit(bike, sim.track, DT, sim.cars);
    update();
    expect(bike.pitPhase).toBe(6);
    expect(bike.pitStops).toBe(1);
    expect(driver.lane(sim.track, bike.s)).toBeCloseTo(bike.lateral, 12);
  });

  it.each([
    ['gpr1', 'gpr2'],
    ['gpr2', 'gpr1'],
  ])('physically queues %s behind an occupied %s bay in rain and merges both safely', (a, b) => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      circuit: 'poggio-alto',
      weather: 'rain',
      compound: 'wet',
      ruleset: 'gp-motorcycle',
      opponents: 1,
      vehicles: [a, b],
      seed: 30101,
    });
    sim.autoPlayer = true;
    sim.race.time = sim.race.greenAt + 1;
    const bikes = sim.cars as BikeVehicle[];
    for (const bike of bikes) {
      bike.place(
        sim.track,
        sim.track.boxS(bike.id) - 1.86,
        sim.track.boxLateral() + (bike.id ? 0.02 : 0.17),
      );
      bike.inPit = true;
      bike.pitRequested = true;
      bike.pitPhase = bike.id ? 4 : 5;
      bike.pitClock = bike.id ? 4 : 8;
    }
    let impact = 0;
    let gap = Infinity;
    let held = 0;
    let looseContacts = 0;
    for (let i = 0; i < 30 / DT; i++) {
      sim.step(DT);
      for (const bike of bikes) {
        impact = Math.max(impact, bike.impact);
        if (bike.inPit && bike.s < sim.track.pit.mergeStart)
          for (const contact of [bike.contacts[0], bike.contacts[2]])
            if (contact.surface === SURFACE.GRASS || contact.surface === SURFACE.GRAVEL)
              looseContacts++;
      }
      if (bikes[0].inPit && bikes[1].inPit)
        gap = Math.min(
          gap,
          Math.hypot(
            bikes[0].dynamics.x - bikes[1].dynamics.x,
            bikes[0].dynamics.z - bikes[1].dynamics.z,
          ),
        );
      if (bikes[0].pitPhase === 6 && bikes[0].speed < 0.5 && bikes[1].pitPhase <= 5) held += DT;
    }
    expect(held).toBeGreaterThan(3);
    expect(gap).toBeGreaterThan(6.9);
    expect(impact).toBe(0);
    expect(looseContacts).toBe(0);
    for (const bike of bikes) {
      expect(bike.pitStops).toBe(1);
      expect(bike.inPit).toBe(false);
      expect(bike.dynamics.crashes).toBe(0);
    }
    expect(sim.makeFrame().every(Number.isFinite)).toBe(true);
  });
});
