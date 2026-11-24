import { afterEach, describe, expect, it, vi } from 'vitest';
import { FixedStepper } from '../src/core/math.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { H } from '../src/simulation/protocol.ts';
import { FixedStepClock } from '../src/workers/fixed-step-clock.ts';
import type { ClientMessage, WorkerMessage } from '../src/workers/diagnostics.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('worker fixed-step clock', () => {
  it.each([24, 30, 60, 90, 120, 144])(
    'keeps the same fixed ticks at %i callbacks per second',
    (fps) => {
      const clock = new FixedStepClock({ now: () => 0 });
      const steps: number[] = [];
      clock.reset(0);
      for (let i = 1; i <= fps * 10; i++) clock.advance((i * 1000) / fps, (dt) => steps.push(dt));
      expect(clock.ticks).toBe(1200);
      expect(steps.every((dt) => dt === 1 / 120)).toBe(true);
      expect(clock.droppedSeconds).toBe(0);
      expect(clock.accumulator).toBeCloseTo(0, 9);
    },
  );

  it('bounds a multi-second stall and retains its pre-existing fractional remainder', () => {
    const clock = new FixedStepClock({ now: () => 0 });
    clock.reset(0);
    clock.advance(5, () => {});
    clock.advance(2005, () => {});
    expect(clock.ticks).toBe(24);
    expect(clock.accumulator).toBeCloseTo(0.005, 10);
    expect(clock.elapsedDroppedSeconds).toBeCloseTo(1.8, 10);
    expect(clock.budgetDroppedSeconds).toBe(0);
    expect(clock.overloadedBatches).toBe(1);
    clock.advance(2009, () => {});
    expect(clock.ticks).toBe(25);
    expect(clock.ticks * clock.dt + clock.accumulator + clock.droppedSeconds).toBeCloseTo(
      2.009,
      10,
    );
  });

  it('yields between expensive ticks, accounts for discarded time, and leaves no catch-up debt', () => {
    let workTime = 0;
    const clock = new FixedStepClock({ maxWorkMs: 5, now: () => workTime });
    const steps: number[] = [];
    clock.reset(0);
    clock.advance(53, (dt) => {
      steps.push(dt);
      workTime += 3;
    });
    expect(steps).toEqual([1 / 120, 1 / 120]);
    expect(workTime).toBe(6); // The second atomic tick crosses the 5 ms budget.
    expect(clock.budgetDroppedSeconds).toBeCloseTo(4 / 120, 10);
    expect(clock.accumulator).toBeCloseTo(0.003, 10);
    expect(clock.elapsedDroppedSeconds).toBe(0);
    expect(clock.overloadedBatches).toBe(1);
    expect(clock.ticks * clock.dt + clock.accumulator + clock.droppedSeconds).toBeCloseTo(
      0.053,
      10,
    );
    clock.advance(57, (dt) => steps.push(dt));
    expect(steps).toHaveLength(2);
    clock.advance(59, (dt) => steps.push(dt));
    expect(steps).toHaveLength(3);
  });

  it('makes progress under sustained overload without claiming full realtime advancement', () => {
    let workTime = 0;
    const clock = new FixedStepClock({ now: () => workTime });
    clock.reset(0);
    for (let batch = 1; batch <= 10; batch++) {
      clock.advance(batch * 100, () => {
        workTime += 10;
      });
      expect(clock.accumulator).toBeLessThan(clock.dt);
    }
    expect(clock.ticks).toBe(10);
    expect(clock.overloadedBatches).toBe(10);
    expect(clock.budgetDroppedSeconds).toBeCloseTo(110 / 120, 10);
    expect(clock.ticks * clock.dt + clock.accumulator + clock.droppedSeconds).toBeCloseTo(1, 10);
  });

  it('excludes a long pause while preserving the active fractional remainder and counters', () => {
    const clock = new FixedStepClock({ now: () => 0 });
    clock.reset(0);
    clock.advance(6, () => {});
    clock.rebase(6);
    clock.rebase(90006);
    clock.advance(90008, () => {});
    expect(clock.ticks).toBe(0);
    clock.advance(90009, () => {});
    expect(clock.ticks).toBe(1);
    expect(clock.accumulator).toBeCloseTo(0.009 - clock.dt, 10);
    expect(clock.droppedSeconds).toBe(0);
  });

  it('ignores invalid and backward samples without recounting elapsed wall time', () => {
    const clock = new FixedStepClock({ now: () => 0 });
    clock.reset(1000);
    for (const time of [NaN, Infinity, -Infinity, 995]) clock.advance(time, () => {});
    expect(clock.ticks).toBe(0);
    expect(clock.rejectedTimestamps).toBe(4);
    clock.advance(1020, () => {});
    expect(clock.ticks).toBe(2);
    expect(clock.accumulator).toBeCloseTo(0.02 - 2 * clock.dt, 10);
    expect(clock.droppedSeconds).toBe(0);
    clock.rebase(NaN);
    clock.advance(90000, () => {}); // An invalid resume sample must not admit the pause.
    expect(clock.ticks).toBe(2);
    clock.advance(90005, () => {});
    expect(clock.ticks).toBe(3);
  });

  it('matches the deterministic stepper under jitter after a long clock uptime', () => {
    const clock = new FixedStepClock({ now: () => 0 });
    const reference = new FixedStepper();
    let now = 1e12;
    clock.reset(now);
    for (let i = 0; i < 10000; i++) {
      const delta = [0.125, 1.875, 4, 9, 16, 0][i % 6];
      now += delta;
      clock.advance(now, () => {});
      reference.advance(delta / 1000, () => {});
    }
    expect(clock.ticks).toBe(reference.ticks);
    expect(clock.accumulator).toBeCloseTo(reference.accumulator, 10);
    expect(clock.droppedSeconds).toBe(0);
  });

  it.each([NaN, Infinity, 9])(
    'yields after one tick if the CPU clock becomes invalid or backward (%s)',
    (sample) => {
      let calls = 0;
      const clock = new FixedStepClock({ now: () => (calls++ === 0 ? 10 : sample) });
      clock.reset(0);
      clock.advance(100, () => {});
      expect(clock.ticks).toBe(1);
      expect(clock.budgetDroppedSeconds).toBeCloseTo(11 / 120, 10);
      expect(clock.accumulator).toBeLessThan(clock.dt);
    },
  );

  it('stops a reentrantly paused batch and reports the remaining whole ticks as discarded', () => {
    const clock = new FixedStepClock({ now: () => 0 });
    clock.reset(0);
    clock.advance(103, () => clock.rebase(10000));
    expect(clock.ticks).toBe(1);
    expect(clock.interruptedSeconds).toBeCloseTo(11 / 120, 10);
    expect(clock.accumulator).toBeCloseTo(0.003, 10);
    clock.advance(10004, () => {});
    expect(clock.ticks).toBe(1);
  });

  it('does not restore old session counters after a reset inside a tick', () => {
    const clock = new FixedStepClock({ now: () => 0 });
    clock.reset(0);
    clock.advance(100, () => clock.reset(5000));
    expect(clock.ticks).toBe(0);
    expect(clock.accumulator).toBe(0);
    expect(clock.droppedSeconds).toBe(0);
    clock.advance(5009, () => {});
    expect(clock.ticks).toBe(1);
  });

  it('does not replay failed pending work after the caller handles a step exception', () => {
    const clock = new FixedStepClock({ now: () => 0 });
    clock.reset(0);
    expect(() =>
      clock.advance(100, () => {
        throw new Error('step failed');
      }),
    ).toThrow('step failed');
    expect(clock.ticks).toBe(0);
    expect(clock.interruptedSeconds).toBeCloseTo(0.1, 10);
    clock.rebase(1000);
    clock.advance(1004, () => {});
    expect(clock.ticks).toBe(0);
    clock.advance(1009, () => {});
    expect(clock.ticks).toBe(1);
  });
});

it('the circuit worker bounds costly catch-up and exposes the lost time in its frame', async () => {
  let now = 0;
  let pump: (() => void) | undefined;
  const messages: WorkerMessage[] = [];
  const scope = {
    onmessage: null as ((event: { data: ClientMessage }) => void) | null,
    postMessage(message: WorkerMessage, transfer: Transferable[] = []) {
      messages.push(structuredClone(message, { transfer }));
    },
  };
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    pump = callback;
    return 1;
  });
  vi.resetModules();
  const { Simulation } = await import('../src/simulation/world.ts');
  const originalStep = Simulation.prototype.step;
  const steps = vi.spyOn(Simulation.prototype, 'step').mockImplementation(function (
    this: InstanceType<typeof Simulation>,
    dt,
  ) {
    originalStep.call(this, dt);
    now += 6;
  });
  await import('../src/workers/physics.worker.ts');
  const send = (data: ClientMessage) => scope.onmessage!({ data });
  const latestFrame = () => {
    const message = messages.filter((value) => value.type === 'frame').at(-1)!;
    return new Float32Array(message.buffer);
  };
  send({ type: 'init', options: { ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice' } });
  send({ type: 'pause', value: false, sequence: 1 });
  now = 100;
  pump!();
  expect(steps).toHaveBeenCalledTimes(2);
  expect(steps.mock.calls.every(([dt]) => dt === 1 / 120)).toBe(true);
  expect(latestFrame()[H.TICK]).toBe(2);
  expect(latestFrame()[H.DROPPED]).toBeCloseTo(10 / 120, 6);
  send({ type: 'pause', value: true, sequence: 2 });
  now += 90000;
  pump!();
  send({ type: 'pause', value: false, sequence: 3 });
  now += 4;
  pump!();
  expect(steps).toHaveBeenCalledTimes(2);
  now += 6;
  pump!();
  expect(steps).toHaveBeenCalledTimes(3);
  send({ type: 'pause', value: true, sequence: 4 });
  expect(latestFrame()[H.TICK]).toBe(3);
  expect(latestFrame()[H.DROPPED]).toBeCloseTo(10 / 120, 6);
  expect(messages.filter((message) => message.type === 'error')).toEqual([]);
});
