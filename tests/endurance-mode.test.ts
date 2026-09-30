import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/simulation/world.ts';
import {
  DEFAULT_OPTIONS,
  ENDURANCE_MAX_LAPS,
  MANDATORY_STOP_PENALTY_SECONDS,
  alternateDryCompound,
  mandatoryStopSatisfied,
  validateOptions,
} from '../src/simulation/config.ts';
import { PHASE } from '../src/simulation/race.ts';
import { plannedStopLap } from '../src/simulation/driver-brain.ts';

function run(sim: Simulation, seconds: number) {
  for (let tick = 0; tick < 120 * seconds && sim.race.phase !== PHASE.FINISHED; tick++) sim.step(1 / 120);
}

describe('endurance: long race with the mandatory stop rule', () => {
  it('defines the rule, the distance and the planned stop window', () => {
    expect(mandatoryStopSatisfied(new Set(['medium']))).toBe(false);
    expect(mandatoryStopSatisfied(new Set(['medium', 'medium']))).toBe(false);
    expect(mandatoryStopSatisfied(new Set(['medium', 'hard']))).toBe(true);
    expect(mandatoryStopSatisfied(new Set(['soft', 'intermediate']))).toBe(true);
    expect(alternateDryCompound('medium')).toBe('hard');
    expect(alternateDryCompound('hard')).toBe('medium');
    expect(alternateDryCompound('soft')).toBe('medium');
    expect(validateOptions({ ...DEFAULT_OPTIONS, mode: 'endurance', laps: 25 }).laps).toBe(25);
    expect(validateOptions({ ...DEFAULT_OPTIONS, mode: 'endurance', laps: 99 }).laps).toBe(ENDURANCE_MAX_LAPS);
    expect(validateOptions({ ...DEFAULT_OPTIONS, mode: 'race', laps: 25 }).laps).toBe(10);
    for (const care of [0.65, 0.8, 0.95]) {
      const lap = plannedStopLap(20, care);
      expect(lap).toBeGreaterThanOrEqual(6);
      expect(lap).toBeLessThanOrEqual(18);
    }
  });
  it('carries fuel for the distance as real mass', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'endurance', laps: 25, opponents: 1 });
    expect(sim.cars[0].fuel).toBeGreaterThan(25 * 2.97 * 0.37);
    expect(sim.race.phase).toBe(PHASE.GRID);
    const race = new Simulation({ ...DEFAULT_OPTIONS, opponents: 1 });
    expect(race.cars[0].fuel).toBe(24);
  });
  it('penalises a finish without the stop', () => {
    // One lap leaves no stop window: every finisher takes the time penalty.
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'endurance', laps: 1, opponents: 2 });
    sim.autoPlayer = true;
    run(sim, 200);
    expect(sim.race.phase).toBe(PHASE.FINISHED);
    for (const car of sim.cars) {
      expect(car.finishTime).toBeGreaterThan(0);
      expect(sim.race.laps[car.id].penalty).toBeGreaterThanOrEqual(MANDATORY_STOP_PENALTY_SECONDS);
    }
    const codes = sim.race.control.events.filter((e) => e.kind === 'penalty').map((e) => e.code);
    expect(codes.filter((c) => c === 'MANDATORY_STOP')).toHaveLength(3);
  });
  it(
    'runs a full endurance race: every car stops once onto a second dry compound',
    async () => {
      const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'endurance',
        laps: 6,
        opponents: 5,
        seed: 9091,
      });
      sim.autoPlayer = true;
      let lowestFuel = Infinity;
      for (let tick = 0; tick < 120 * 900 && sim.race.phase !== PHASE.FINISHED; tick++) {
        sim.step(1 / 120);
        if (tick % 120 === 0) for (const c of sim.cars) lowestFuel = Math.min(lowestFuel, c.fuel);
        // Yield so the long real-simulation run does not starve the test runner.
        if (tick % 2400 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(sim.race.phase).toBe(PHASE.FINISHED);
      for (const car of sim.cars) {
        expect(car.retired).toBe(false);
        expect(car.pitStops).toBeGreaterThanOrEqual(1);
        expect(mandatoryStopSatisfied(car.compoundsUsed)).toBe(true);
        expect(sim.race.laps[car.id].completed).toBe(6);
      }
      expect(lowestFuel).toBeGreaterThan(0.5);
      const codes = sim.race.control.events.map((e) => e.code);
      expect(codes).not.toContain('MANDATORY_STOP');
    },
    300000,
  );
});
