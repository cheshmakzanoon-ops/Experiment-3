import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, controls, type Controls } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { FLASHBACK, InputLog, Resimulation, applyEntry } from '../src/core/flashback.ts';
import { H } from '../src/simulation/protocol.ts';

const OPTIONS = { ...DEFAULT_OPTIONS, mode: 'race' as const, opponents: 3, seed: 2026 };
const TICKS = 3000;

/** A scripted driver: throttle/steer changes, the 0.4 watchdog brake, a pit
 * request and an AI-demonstration hand-over, all logged as the worker does. */
function drive(sim: Simulation, log: InputLog, until: number, frames: Map<number, Uint32Array>) {
  const input = (patch: Partial<Controls>) => {
    const value = { ...controls(), ...patch };
    log.input(sim.tick, value);
    applyEntry(sim, { tick: sim.tick, kind: 'input', input: value });
  };
  while (sim.tick < until) {
    const t = sim.tick;
    if (t === 0) input({ brake: 1 });
    if (t === 700) input({ throttle: 1 });
    if (t === 900) input({ throttle: 0.85, steer: 0.06 });
    if (t === 1100) input({ throttle: 1, steer: -0.03, ers: 2 });
    // The worker's stale-input watchdog: brake 0.4, nothing else.
    if (t === 1300) input({ brake: 0.4 });
    if (t === 1450) input({ throttle: 1, drs: true });
    if (t === 1500) {
      log.pit(t, 'soft');
      sim.requestPit('soft');
    }
    if (t === 1800) {
      log.autopilot(t, true);
      sim.autoPlayer = true;
    }
    if (t === 2500) {
      log.autopilot(t, false);
      sim.autoPlayer = false;
      input({ throttle: 0.7, overtake: true });
    }
    sim.step(FLASHBACK.dt);
    if (sim.tick % 250 === 0) frames.set(sim.tick, snapshot(sim));
  }
}
function snapshot(sim: Simulation) {
  const frame = sim.makeFrame();
  return new Uint32Array(frame.buffer.slice(0));
}

describe('flashback determinism', () => {
  it('re-simulates 3000 logged ticks to bitwise-identical frames, twice', () => {
    const live = new Simulation(OPTIONS),
      log = new InputLog(),
      frames = new Map<number, Uint32Array>();
    drive(live, log, TICKS, frames);
    expect(log.entries.length).toBeGreaterThan(8);
    expect(log.entries.some((e) => e.kind === 'input' && e.input.brake === 0.4)).toBe(true);
    for (let pass = 0; pass < 2; pass++) {
      const replay = new Resimulation(OPTIONS, log.entries, TICKS);
      let checked = 0;
      while (!replay.done) {
        replay.run(250);
        const expected = frames.get(replay.simulation.tick);
        if (expected) {
          expect(snapshot(replay.simulation)).toEqual(expected);
          checked++;
        }
      }
      expect(checked).toBe(TICKS / 250);
    }
  }, 120_000);

  it('rewinds to a past tick and resumes on a new timeline', () => {
    const live = new Simulation(OPTIONS),
      log = new InputLog(),
      frames = new Map<number, Uint32Array>();
    drive(live, log, TICKS, frames);
    const target = 2000;
    const rewind = new Resimulation(OPTIONS, log.entries, target);
    let slices = 1;
    while (!rewind.run(FLASHBACK.slice)) slices++;
    expect(slices).toBe(Math.ceil(target / FLASHBACK.slice));
    expect(rewind.simulation.tick).toBe(target);
    expect(snapshot(rewind.simulation)).toEqual(frames.get(target));
    // The resumed timeline forgets the old future and records its own.
    log.truncate(target);
    expect(log.entries.every((e) => e.tick < target)).toBe(true);
    const resumed = rewind.simulation;
    log.input(resumed.tick, { ...controls(), brake: 1 });
    resumed.setInput({ ...controls(), brake: 1 });
    for (let i = 0; i < 240; i++) resumed.step(FLASHBACK.dt);
    // A second flashback reproduces the resumed timeline exactly.
    const again = new Resimulation(OPTIONS, log.entries, resumed.tick);
    while (!again.run()) {
      /* slices */
    }
    expect(snapshot(again.simulation)).toEqual(snapshot(resumed));
    expect(resumed.makeFrame()[H.TICK]).toBe(target + 240);
  }, 120_000);
});
