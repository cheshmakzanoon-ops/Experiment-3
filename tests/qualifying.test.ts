import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/simulation/world.ts';
import {
  DEFAULT_OPTIONS,
  QUALIFYING_TIMED_LAPS,
  startingGrid,
  validateOptions,
} from '../src/simulation/config.ts';
import { PHASE } from '../src/simulation/race.ts';
import { CAR_STRIDE, F, HEADER, carBase } from '../src/simulation/protocol.ts';
import { qualifyingGrid } from '../src/core/championship.ts';

describe('race weekend: qualifying sets the grid', () => {
  it('validates grid orders and keeps Time Trial solo', () => {
    const base = { ...DEFAULT_OPTIONS, opponents: 3 };
    expect(validateOptions({ ...base, grid: [2, 0, 3, 1] }).grid).toEqual([2, 0, 3, 1]);
    expect(validateOptions({ ...base, grid: [2, 0, 3] }).grid).toBeUndefined();
    expect(validateOptions({ ...base, grid: [2, 0, 3, 3] }).grid).toBeUndefined();
    expect(validateOptions({ ...base, grid: [2, 0, 3, 4] }).grid).toBeUndefined();
    expect('grid' in validateOptions(base)).toBe(false);
    expect(validateOptions({ ...base, mode: 'qualifying' }).mode).toBe('qualifying');
    expect(validateOptions({ ...base, mode: 'time-trial' }).opponents).toBe(0);
  });
  it('places a race grid in the given order, pole at the front', () => {
    const grid = [2, 0, 3, 1];
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 3, grid });
    const length = sim.track.length;
    // Two cars per row, 10 m apart; pole on the left (-2.2 m).
    grid.forEach((id, slot) => {
      expect(sim.cars[id].s).toBeCloseTo(length - 32 - Math.floor(slot / 2) * 10, 9);
      expect(sim.cars[id].lateral).toBe(slot % 2 === 0 ? -2.2 : 2.2);
    });
  });
  it(
    'runs a full qualifying session through the production AI and classifies by best lap',
    async () => {
      const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'qualifying',
        opponents: 7,
        seed: 2718,
      });
      sim.autoPlayer = true;
      // Released spread around the lap: no two cars start within 300 m.
      const starts = sim.cars.map((c) => c.s).sort((a, b) => a - b);
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThan(300);
      expect(sim.race.phase).toBe(PHASE.RACING);
      let maximumImpact = 0;
      for (let tick = 0; tick < 120 * 600 && sim.race.phase !== PHASE.FINISHED; tick++) {
        sim.step(1 / 120);
        for (const c of sim.cars) maximumImpact = Math.max(maximumImpact, c.impact);
        // Yield so the long real-simulation run does not starve the test runner.
        if (tick % 2400 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(sim.race.phase).toBe(PHASE.FINISHED);
      for (const [id, lap] of sim.race.laps.entries()) {
        expect(sim.cars[id].retired).toBe(false);
        expect(lap.completed).toBeGreaterThanOrEqual(QUALIFYING_TIMED_LAPS);
        expect(lap.best).toBeGreaterThan(45);
      }
      const best = sim.race.order.map((id) => sim.race.laps[id].best);
      expect(best).toEqual([...best].sort((a, b) => a - b));
      expect(maximumImpact).toBeLessThan(1);
      const frame = new Float32Array(HEADER + sim.cars.length * CAR_STRIDE);
      sim.writeFrame(frame);
      const grid = qualifyingGrid(frame);
      expect(grid).toEqual(sim.race.order);
      for (const id of grid) expect(frame[carBase(id) + F.BEST_LAP]).toBeCloseTo(sim.race.laps[id].best, 3);
      // The race then starts from that grid.
      const race = new Simulation({ ...DEFAULT_OPTIONS, opponents: 7, grid });
      grid.forEach((id, slot) =>
        expect(race.cars[id].s).toBeCloseTo(race.track.length - 32 - Math.floor(slot / 2) * 10, 9),
      );
    },
    240000,
  );
});

describe('starting grid slot', () => {
  it('places the player at pole, mid-field or the back with rivals in order', () => {
    expect(startingGrid(8, 'pole')).toBeUndefined();
    expect(startingGrid(8, 'midfield')).toEqual([1, 2, 3, 4, 0, 5, 6, 7]);
    expect(startingGrid(8, 'back')).toEqual([1, 2, 3, 4, 5, 6, 7, 0]);
    expect(startingGrid(1, 'back')).toBeUndefined();
    expect(() => startingGrid(0, 'midfield')).toThrow();
  });
  it('starts a wet race behind rivals, so the player follows through their spray', () => {
    const grid = startingGrid(8, 'midfield')!;
    const sim = new Simulation(
      validateOptions({ ...DEFAULT_OPTIONS, opponents: 7, weather: 'rain', compound: 'wet', grid }),
    );
    sim.autoPlayer = true;
    const frame = sim.makeFrame();
    for (let i = 0; i < 120 * 12; i++) sim.step(1 / 120);
    sim.writeFrame(frame);
    // Four rivals started ahead; the player is racing in their wake.
    expect(frame[carBase(0) + F.RANK]).toBeGreaterThan(1);
  });
});
