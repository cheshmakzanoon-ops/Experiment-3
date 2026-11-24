import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLASHBACK, Resimulation, applyEntry, type FlashbackEntry } from '../src/core/flashback.ts';
import { DEFAULT_OPTIONS, controls } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';

const OPTIONS = { ...DEFAULT_OPTIONS, mode: 'practice' as const, opponents: 0, seed: 64021 };

afterEach(() => vi.restoreAllMocks());

function snapshot(sim: Simulation) {
  return {
    frame: new Uint32Array(sim.makeFrame().buffer.slice(0)),
    autoPlayer: sim.autoPlayer,
    cars: sim.cars.map((car) => ({
      input: { ...car.input },
      engine: { ...car.engine },
      shiftClock: car.shiftClock,
      tires: car.tires.map((tire) => ({ ...tire })),
    })),
  };
}

describe('flashback work budget', () => {
  it('bounds default and explicit batches with the production clock, retaining every tick', () => {
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    const replay = new Resimulation(OPTIONS, [], 7);
    const ticks: number[] = [];
    const step = vi.spyOn(replay.simulation, 'step').mockImplementation(() => {
      ticks.push(replay.simulation.tick++);
      time += 3;
    });

    expect(replay.run()).toBe(false);
    expect(replay.simulation.tick).toBe(3);
    expect(time).toBe(9); // Only the last complete tick crosses the 8 ms budget.
    time += 10000; // Time spent outside run is not replay work or a reason to skip ticks.
    expect(replay.run(FLASHBACK.slice)).toBe(false);
    expect(replay.simulation.tick).toBe(6);
    expect(replay.run()).toBe(true);
    expect(replay.run()).toBe(true);
    expect(ticks).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(step.mock.calls.every(([dt]) => dt === 1 / 120)).toBe(true);
  });

  it('makes one complete tick of progress even when that tick exceeds the whole budget', () => {
    let time = 100;
    const replay = new Resimulation(OPTIONS, [], 3, { maxWorkMs: 5, now: () => time });
    vi.spyOn(replay.simulation, 'step').mockImplementation(() => {
      replay.simulation.tick++;
      time += 50;
    });
    for (let tick = 1; tick <= 3; tick++) {
      expect(replay.run()).toBe(tick === 3);
      expect(replay.simulation.tick).toBe(tick);
    }
    expect(time).toBe(250);
  });

  it('yields exactly at the time budget and still respects small or default step caps', () => {
    let time = 0;
    const replay = new Resimulation(OPTIONS, [], 2010, { maxWorkMs: 6, now: () => time });
    let cost = 3;
    vi.spyOn(replay.simulation, 'step').mockImplementation(() => {
      replay.simulation.tick++;
      time += cost;
    });
    expect(replay.run()).toBe(false);
    expect(replay.simulation.tick).toBe(2);
    cost = 0;
    expect(replay.run()).toBe(false);
    expect(replay.simulation.tick).toBe(2002);
    expect(replay.run(3)).toBe(false);
    expect(replay.simulation.tick).toBe(2005);
    expect(replay.run(10000)).toBe(true);
    expect(replay.simulation.tick).toBe(2010);
  });

  it('keeps same-tick entries atomic and ordered, leaving target-tick entries for the new timeline', () => {
    let time = 0;
    const entries: FlashbackEntry[] = [
      { tick: 0, kind: 'input', input: { ...controls(), throttle: 0.2 } },
      { tick: 0, kind: 'pit', compound: 'soft' },
      { tick: 0, kind: 'autopilot', value: true },
      { tick: 0, kind: 'input', input: { ...controls(), throttle: 0.7 } },
      { tick: 1, kind: 'autopilot', value: false },
      { tick: 1, kind: 'input', input: { ...controls(), throttle: 0.4 } },
      { tick: 2, kind: 'input', input: { ...controls(), throttle: 1 } },
      { tick: 2, kind: 'autopilot', value: true },
      { tick: 2, kind: 'pit', compound: 'hard' },
    ];
    const replay = new Resimulation(OPTIONS, entries, 2, { maxWorkMs: 5, now: () => time });
    const sim = replay.simulation;
    const applied: string[] = [];
    const setInput = sim.setInput.bind(sim);
    vi.spyOn(sim, 'setInput').mockImplementation((input) => {
      applied.push(`input:${input.throttle}`);
      time += 3;
      setInput(input);
    });
    vi.spyOn(sim, 'requestPit').mockImplementation((compound) => {
      applied.push(`pit:${compound}`);
      time += 3;
    });
    vi.spyOn(sim, 'step').mockImplementation((dt) => {
      expect(dt).toBe(1 / 120);
      applied.push(`step:${sim.tick}:${sim.cars[0].input.throttle}:${sim.autoPlayer}`);
      sim.tick++;
      time += 3;
    });

    expect(replay.run()).toBe(false);
    expect(applied).toEqual(['input:0.2', 'pit:soft', 'input:0.7', 'step:0:0.7:true']);
    expect(replay.run()).toBe(true);
    expect(replay.run()).toBe(true);
    expect(applied).toEqual([
      'input:0.2', 'pit:soft', 'input:0.7', 'step:0:0.7:true', 'input:0.4', 'step:1:0.4:false',
    ]);
  });

  it('matches an unsliced physics replay and its continuation under variable costs and step caps', () => {
    const target = 720;
    const entries: FlashbackEntry[] = [
      { tick: 0, kind: 'input', input: { ...controls(), throttle: 0.35 } },
      { tick: 83, kind: 'input', input: { ...controls(), throttle: 0.7, shift: 1 } },
      { tick: 83, kind: 'input', input: { ...controls(), throttle: 0.6, shift: 1 } },
      { tick: 144, kind: 'input', input: { ...controls(), brake: 0.4 } },
      { tick: 199, kind: 'autopilot', value: true },
      { tick: 241, kind: 'pit', compound: 'soft' },
      { tick: 241, kind: 'pit', compound: 'hard' },
      { tick: 400, kind: 'autopilot', value: false },
      { tick: 400, kind: 'input', input: { ...controls(), throttle: 0.6, steer: 0.04 } },
      { tick: target, kind: 'input', input: { ...controls(), brake: 1 } },
      { tick: target, kind: 'autopilot', value: true },
    ];
    const reference = new Simulation(OPTIONS);
    let index = 0;
    while (reference.tick < target) {
      while (index < entries.length && entries[index].tick <= reference.tick)
        applyEntry(reference, entries[index++]);
      reference.step(1 / 120);
    }
    let time = 0;
    const replay = new Resimulation(OPTIONS, entries, target, { maxWorkMs: 5, now: () => time });
    const realStep = replay.simulation.step.bind(replay.simulation);
    const ticks: number[] = [];
    const step = vi.spyOn(replay.simulation, 'step').mockImplementation((dt) => {
      ticks.push(replay.simulation.tick);
      realStep(dt);
      time += [1, 6, 2, 0.25][replay.simulation.tick % 4];
    });
    const lengths = new Set<number>();
    let calls = 0;
    while (!replay.done && calls < target) {
      const before = replay.simulation.tick;
      const cap = [31, 1, 17, 2000][calls++ % 4];
      replay.run(cap);
      const length = replay.simulation.tick - before;
      expect(length).toBeGreaterThanOrEqual(1);
      expect(length).toBeLessThanOrEqual(cap);
      lengths.add(length);
      time += 1000;
    }
    expect(replay.done).toBe(true);
    expect(lengths.size).toBeGreaterThan(1);
    expect(ticks).toEqual(Array.from({ length: target }, (_, tick) => tick));
    expect(step.mock.calls.every(([dt]) => dt === 1 / 120)).toBe(true);
    expect(snapshot(replay.simulation)).toEqual(snapshot(reference));

    for (let i = 0; i < 120; i++) {
      reference.step(1 / 120);
      realStep(1 / 120);
    }
    expect(snapshot(replay.simulation)).toEqual(snapshot(reference));
  });

  it('does no work or clock reads for zero caps and already completed targets', () => {
    const now = vi.fn(() => 0);
    const replay = new Resimulation(OPTIONS, [], 1, { now });
    const step = vi.spyOn(replay.simulation, 'step');
    expect(replay.run(0)).toBe(false);
    expect(now).not.toHaveBeenCalled();
    expect(step).not.toHaveBeenCalled();
    const empty = new Resimulation(OPTIONS, [], 0, { now });
    expect(empty.run()).toBe(true);
    expect(now).not.toHaveBeenCalled();
  });

  it.each([
    [[NaN, 0], 1],
    [[0, NaN], 1],
    [[0, Infinity], 1],
    [[10, 9], 1],
    [[10, 13, 12], 2],
  ] as const)('yields on an invalid or regressing clock (%j)', (samples, expectedTicks) => {
    let index = 0;
    const replay = new Resimulation(OPTIONS, [], 10, {
      now: () => samples[Math.min(index++, samples.length - 1)],
    });
    vi.spyOn(replay.simulation, 'step').mockImplementation(() => { replay.simulation.tick++; });
    expect(replay.run()).toBe(false);
    expect(replay.simulation.tick).toBe(expectedTicks);
  });

  it('rejects invalid budgets, caps, and unrepresentable target ticks before advancing', () => {
    for (const maxWorkMs of [0, -1, NaN, Infinity, -Infinity])
      expect(() => new Resimulation(OPTIONS, [], 1, { maxWorkMs })).toThrow('Invalid flashback work options');
    for (const target of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => new Resimulation(OPTIONS, [], target)).toThrow('Invalid flashback tick');
    const now = vi.fn(() => 0);
    const replay = new Resimulation(OPTIONS, [], 1, { now });
    for (const cap of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => replay.run(cap)).toThrow('Invalid flashback step count');
    expect(now).not.toHaveBeenCalled();
    expect(replay.simulation.tick).toBe(0);
  });
});
