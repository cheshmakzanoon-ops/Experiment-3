import { describe, expect, it } from 'vitest';
import { envelopeProfile } from '../src/simulation/ai.ts';
import { BikeAIDriver, GP_AI_HANDS } from '../src/simulation/bike-ai.ts';
import type { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import type { RaceDirector } from '../src/simulation/race.ts';
import { PHASE } from '../src/simulation/race.ts';
import type { Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 120;

/** Exposes the planned-stop controller of the GP rider for inspection. */
class PlanProbe extends BikeAIDriver {
  plan(desired: number, track: Track, race: RaceDirector) {
    return this.limitSpeed(desired, track, race);
  }
  get planned() {
    return this.planNext;
  }
  demand(error: number) {
    return this.brakeDemand(error);
  }
}

/** A seeded all-AI GP race (the player rides the autopilot too): every fall with the
 * station it happened at and whether the rider had already taken the flag. */
function aiRace(circuit: string, seed: number, laps: number, vehicles: string[]) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    ruleset: 'gp-motorcycle',
    circuit: circuit as never,
    laps,
    opponents: vehicles.length - 1,
    vehicles,
    seed,
  });
  sim.autoPlayer = true;
  const seen = sim.cars.map(() => 0);
  const falls: { car: number; s: number; afterFlag: boolean }[] = [];
  for (let i = 0; i < 120 * 600 && sim.race.phase !== PHASE.FINISHED; i++) {
    sim.step(DT);
    sim.cars.forEach((c, id) => {
      const crashes = (c as BikeVehicle).dynamics.crashes;
      if (crashes > seen[id]) falls.push({ car: id, s: c.s, afterFlag: c.finishTime > 0 });
      seen[id] = crashes;
    });
  }
  return { sim, finished: sim.race.phase === PHASE.FINISHED, falls };
}

describe('GP rider follows its braking plan', () => {
  it('reports the plan speed at every active sample without touching the tail', () => {
    const curvature = [0, 0.002, 0.009, 0.018, 0.04];
    const corners = [100, 70, 44, 28, 18];
    const out = new Float64Array(8).fill(NaN);
    const first = envelopeProfile(curvature, corners, 0.7, 1, undefined, 5, out);
    expect(out[0]).toBe(first);
    expect(first).toBe(envelopeProfile(curvature, corners, 0.7, 1));
    expect(out[4]).toBe(18);
    for (let i = 0; i < 5; i++) expect(out[i]).toBeLessThanOrEqual(corners[i]);
    // The plan only ever slows towards the corner: no sample is slower than a later one
    // by more than the braking that can be spent in one step.
    for (let i = 0; i < 4; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i + 1]);
    expect(Number.isNaN(out[5])).toBe(true);
  });

  it('feeds the planned deceleration forward instead of waiting for a speed error', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      circuit: 'poggio-alto',
      ruleset: 'gp-motorcycle',
      opponents: 0,
      vehicles: ['gpr1'],
    });
    const bike = sim.cars[0] as BikeVehicle;
    const driver = new PlanProbe(bike, 0.96, 4417);
    expect(Number.isNaN(driver.planned)).toBe(true);
    // Sweep the lap at 80 m/s: wherever the plan one sample ahead is slower than the
    // bike, the controller must ask for the stop although the speed error to the plan's
    // present value is zero; everywhere else it keeps the plain proportional law.
    let braking = 0,
      coasting = 0;
    for (let s = 0; s < sim.track.length; s += 40) {
      bike.place(sim.track, s);
      bike.dynamics.speed = bike.speed = 80;
      bike.dynamics.grip = bike.dynamics.frontGrip = bike.dynamics.rearGrip = 1;
      driver.plan(100, sim.track, sim.race);
      const demand = driver.demand(0);
      expect(demand).toBeGreaterThanOrEqual(0);
      expect(demand).toBeLessThanOrEqual(1);
      if (driver.planned < 80) {
        braking++;
        expect(demand).toBeGreaterThan(0);
      } else {
        coasting++;
        expect(demand).toBe(0);
      }
    }
    expect(braking).toBeGreaterThan(3);
    expect(coasting).toBeGreaterThan(3);
    // A pit-lane or off-line rider has no plan this step.
    bike.inPit = true;
    driver.plan(100, sim.track, sim.race);
    expect(Number.isNaN(driver.planned)).toBe(true);
    expect(driver.demand(-10)).toBe(1);
  });

  it('brakes gently once the flag has fallen', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      circuit: 'poggio-alto',
      ruleset: 'gp-motorcycle',
      opponents: 0,
      vehicles: ['gpr1'],
    });
    const bike = sim.cars[0] as BikeVehicle;
    const driver = new PlanProbe(bike, 0.96, 4417);
    expect(driver.demand(-20)).toBe(1);
    bike.finishTime = 90;
    expect(driver.demand(-20)).toBe(GP_AI_HANDS.cooldownBrake);
  });

  // Reproduce with `node --experimental-transform-types scripts/studio/tools/ai-only-race.mjs
  // ardennes gpr1 4 1 1000`: on the previous controller (a proportional law that needed a
  // 20 km/h excess for the full lever, so it trailed its own plan by 8 to 25 km/h) two riders
  // left the last Ardennes hairpin at 72 km/h against a 47 km/h plan, ran 18 m wide and fell
  // (stations 3182 and 3199), and the Montejaral final hairpin (4135 to 4160) cost three more.
  it.each([
    ['ardennes', 1000, 3050, 3260],
    ['ardennes', 1037, 3050, 3260],
    ['montejaral', 1000, 4100, 4200],
  ])(
    'no rider falls at the %s hairpin (seed %i)',
    (circuit, seed, from, to) => {
      const { finished, falls } = aiRace(circuit, seed, 1, Array(4).fill('gpr1'));
      expect(finished).toBe(true);
      expect(falls.filter((f) => f.s >= from && f.s <= to)).toEqual([]);
    },
    60000,
  );

  // Before: a rider that had taken the flag stamped the lever from 230 km/h down to the
  // 137 km/h cool-down speed, the near-weightless rear fishtailed and it fell on the
  // straight beyond the line (Montejaral 1 lap: car 2 at station 162, 129 km/h).
  it.each([
    ['montejaral', 1000],
    ['ardennes', 1000],
    ['ardennes', 1037],
  ])(
    'no rider falls after taking the flag at %s (seed %i)',
    (circuit, seed) => {
      const { finished, falls } = aiRace(circuit, seed, 1, Array(4).fill('gpr1'));
      expect(finished).toBe(true);
      expect(falls.filter((f) => f.afterFlag)).toEqual([]);
    },
    60000,
  );
});
