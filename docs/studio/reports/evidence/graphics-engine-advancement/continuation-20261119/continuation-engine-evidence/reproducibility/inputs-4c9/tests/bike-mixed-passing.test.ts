import { expect, it } from 'vitest';
import type { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Simulation } from '../src/simulation/world.ts';

// Passing a slower class is where mixed GP/superbike fields fell (docs/studio/reports/qa-bikes-3.md):
// a GP that could get close to a superbike brake-stepped at 250 km/h behind it, tailed it into a
// hairpin and ran wide, or was set across the track against a chicane. Each of these seeded races
// fell once to three times with the first pace-aware passing (physics v22 as first built); none may.
const DT = 1 / 120;
// Steps in 10 s chunks and lets the test runner's messages through between them: a file of
// back-to-back synchronous races longer than a minute times its own worker out (vitest).
const run = async (sim: Simulation, seconds: number, each?: () => void) => {
  for (let t = 0; t < seconds && sim.race.phase !== PHASE.FINISHED; t += 10) {
    for (let i = 0; i < 1200 && sim.race.phase !== PHASE.FINISHED; i++) {
      sim.step(DT);
      each?.();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
it.each([
  ['parco-reale', 5259],
  ['parco-reale', 5074],
  ['haarveld', 5000],
  ['vellamar', 5222],
  ['montejaral', 5111],
])(
  'a mixed GP/superbike race at %s (seed %i) has no fall',
  async (circuit, seed) => {
    const vehicles = ['gpr1', 'sbk1000', 'gpr1', 'sbk1000', 'gpr1', 'sbk1000'];
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      circuit: circuit as never,
      mode: 'race',
      ruleset: 'gp-motorcycle',
      laps: 2,
      opponents: vehicles.length - 1,
      vehicles,
      seed,
    });
    sim.autoPlayer = true;
    await run(sim, 400);
    expect(sim.race.phase).toBe(PHASE.FINISHED);
    expect(sim.cars.reduce((n, c) => n + (c as BikeVehicle).dynamics.crashes, 0)).toBe(0);
  },
  120000,
);

// A field of one class never meets the slower-class rules: no rider sees a slower class ahead
// and none sets up a pass, so a single-class GP race is the launch-only behaviour of v22.
it('a field of one class is not touched by the mixed-class passing rules', async () => {
  const vehicles = ['gpr1', 'gpr1', 'gpr1', 'gpr1'];
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit: 'haarveld',
    mode: 'race',
    laps: 1,
    opponents: vehicles.length - 1,
    vehicles,
    seed: 5000,
  });
  sim.autoPlayer = true;
  let met = false;
  await run(sim, 200, () => {
    for (const ai of sim.ai) {
      const planner = (ai as unknown as { planner: { slower: boolean; blocker: number } }).planner;
      if (planner.slower || planner.blocker >= 0) met = true;
    }
  });
  expect(sim.race.phase).toBe(PHASE.FINISHED);
  expect(met).toBe(false);
}, 120000);
