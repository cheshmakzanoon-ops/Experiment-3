import { afterEach, describe, expect, it, vi } from 'vitest';
import { controls, DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { H } from '../src/simulation/protocol.ts';
import { FixedStepClock } from '../src/workers/fixed-step-clock.ts';
import type { ClientMessage, WorkerMessage } from '../src/workers/diagnostics.ts';
import type { FromOpenWorld, ToOpenWorld } from '../src/workers/open-world-protocol.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const SEEDS = [1, 77, 8191, 73021, 0x10203040, 0x13579bdf, 0x7fffffff, 0xfedcba98];
const EVENTS_PER_SEED = 4096;

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

interface Ledger {
  /** Integer eighth-milliseconds charged by the caller, excluding pauses. */
  elapsedUnits: number;
  /** Successful callbacks observed by the caller in the current clock epoch. */
  ticks: number;
  rejected: number;
}

const freshLedger = (): Ledger => ({ elapsedUnits: 0, ticks: 0, rejected: 0 });

/** This oracle does not predict the scheduling loop or its budget decisions.
 * Every charged second must be visible as completed fixed ticks, retained time,
 * or explicitly dropped time, regardless of the number of callbacks selected. */
function conserved(clock: FixedStepClock, ledger: Ledger, context: string, inCallback = false) {
  const error = Math.abs(
    ledger.ticks * clock.dt + clock.accumulator + clock.droppedSeconds - ledger.elapsedUnits / 8000,
  );
  const classificationError = Math.abs(
    clock.droppedSeconds -
      clock.elapsedDroppedSeconds -
      clock.budgetDroppedSeconds -
      clock.interruptedSeconds,
  );
  if (
    error > 1e-9 ||
    classificationError > 1e-9 ||
    clock.ticks !== ledger.ticks ||
    clock.rejectedTimestamps !== ledger.rejected ||
    clock.accumulator < 0 ||
    (!inCallback && clock.accumulator >= clock.dt) ||
    !Number.isFinite(error)
  ) {
    throw new Error(`${context}: ${JSON.stringify({ ledger, error, classificationError, clock })}`);
  }
  return Math.max(error, classificationError);
}

describe('independent fixed-step accounting', () => {
  it.each([120, 240])('conserves time across seeded mixed lifetimes at %i Hz', (hz) => {
    const totals = {
      hz,
      events: 0,
      callbacks: 0,
      pauses: 0,
      resets: 0,
      callbackResets: 0,
      callbackRebases: 0,
      failures: 0,
      rejected: 0,
      elapsedDrops: 0,
      budgetDrops: 0,
      interruptedDrops: 0,
      maxErrorSeconds: 0,
    };
    for (const seed of SEEDS) {
      const next = random(seed);
      let wallUnits = 8_000_000_000_000;
      let workMs = 0;
      let ledger = freshLedger();
      const clock = new FixedStepClock({ dt: 1 / hz, now: () => workMs });
      clock.reset(wallUnits / 8);
      const check = (event: number, inCallback = false) => {
        totals.maxErrorSeconds = Math.max(
          totals.maxErrorSeconds,
          conserved(clock, ledger, `seed=${seed}, event=${event}`, inCallback),
        );
      };
      for (let event = 0; event < EVENTS_PER_SEED; event++) {
        const action = next() % 100;
        totals.events++;
        if (action < 3) {
          check(event);
          clock.reset(wallUnits / 8);
          ledger = freshLedger();
          totals.resets++;
        } else if (action < 7) {
          clock.rebase(wallUnits / 8);
          wallUnits += 720_000 + (next() % 8000);
          clock.rebase(wallUnits / 8);
          totals.pauses++;
        } else if (action < 11) {
          const sample = [NaN, Infinity, -Infinity, wallUnits / 8 - 0.125][next() % 4];
          clock.advance(sample, () => {
            throw new Error('Rejected timestamp invoked a simulation callback');
          });
          ledger.rejected++;
          totals.rejected++;
        } else {
          const rebase = action < 15;
          const reset = !rebase && action < 18;
          const failure = !rebase && !reset && action < 23;
          // Interruptions always have enough admitted time to reach their
          // callback. Other events mix tiny intervals, duplicates and stalls.
          const interval = action < 23 ? 800 : [0, 1, 15, 32, 72, 128, 697, 9900][next() % 8];
          const cost = action < 23 ? 0 : [0, 0, 3, 6, 12][next() % 5];
          const failAt = 1 + (next() % 3);
          const sentinel = new Error('injected accounting callback failure');
          let calls = 0;
          let thrown: unknown;
          let alpha: number | undefined;
          const before = [
            clock.elapsedDroppedSeconds,
            clock.budgetDroppedSeconds,
            clock.interruptedSeconds,
          ];
          wallUnits += interval;
          ledger.elapsedUnits += interval;
          try {
            alpha = clock.advance(wallUnits / 8, (dt) => {
              if (dt !== 1 / hz) throw new Error('Worker stretched a fixed timestep');
              totals.callbacks++;
              calls++;
              workMs += cost;
              if (failure && calls === failAt) throw sentinel;
              if (reset) {
                // Close the old epoch before reset transfers ownership. Its
                // pending admitted time belongs to the retired epoch only.
                check(event, true);
                clock.reset(wallUnits / 8);
                ledger = freshLedger();
                totals.callbackResets++;
                return;
              }
              ledger.ticks++;
              if (rebase) {
                clock.rebase(wallUnits / 8);
                totals.callbackRebases++;
              }
            });
          } catch (error) {
            thrown = error;
          }
          if (failure) {
            if (thrown !== sentinel) throw new Error('Expected callback failure was not preserved');
            totals.failures++;
          } else if (thrown !== undefined) throw thrown;
          else if (alpha === undefined || alpha < 0 || alpha >= 1)
            throw new Error(`Invalid interpolation fraction ${alpha}`);
          if (!reset) {
            if (clock.elapsedDroppedSeconds > before[0]) totals.elapsedDrops++;
            if (clock.budgetDroppedSeconds > before[1]) totals.budgetDrops++;
            if (clock.interruptedSeconds > before[2]) totals.interruptedDrops++;
          }
        }
        check(event);
      }
    }
    expect(totals.events).toBe(SEEDS.length * EVENTS_PER_SEED);
    for (const [name, count] of Object.entries(totals)) {
      if (name !== 'maxErrorSeconds') expect(count, name).toBeGreaterThan(0);
    }
    expect(totals.maxErrorSeconds).toBeLessThan(1e-9);
    console.log('CLOCK_ACCOUNTING_SEEDED', JSON.stringify(totals));
  });
});

type Kind = 'circuit' | 'festival';
type Message = WorkerMessage | FromOpenWorld;
type Command = ClientMessage | ToOpenWorld;

/** Run the actual worker modules and physics sessions. Scheduling and measured
 * tick cost are controlled; messages retain real transferable detachment. */
async function actualWorker(kind: Kind) {
  vi.resetModules();
  const time = { now: 1_000_000, stepCostMs: 0, completed: 0, failNext: false };
  const dtCalls: number[] = [];
  const messages: Message[] = [];
  let pump: (() => void) | undefined;
  const observed: { clock?: FixedStepClock } = {};
  const scope = {
    onmessage: null as ((event: { data: Command }) => void) | null,
    postMessage(message: Message, transfer: Transferable[] = []) {
      messages.push(structuredClone(message, { transfer }));
    },
  };
  vi.spyOn(performance, 'now').mockImplementation(() => time.now);
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    pump = callback;
    return 1;
  });
  const { FixedStepClock: WorkerClock } = await import('../src/workers/fixed-step-clock.ts');
  const originalReset = WorkerClock.prototype.reset;
  vi.spyOn(WorkerClock.prototype, 'reset').mockImplementation(function (
    this: FixedStepClock,
    timestamp,
  ) {
    observed.clock = this;
    originalReset.call(this, timestamp);
  });
  function beforeStep(dt: number) {
    dtCalls.push(dt);
    if (time.failNext) {
      time.failNext = false;
      throw new Error('injected worker accounting failure');
    }
  }
  function completedStep() {
    time.completed++;
    time.now += time.stepCostMs;
  }
  if (kind === 'circuit') {
    const { Simulation } = await import('../src/simulation/world.ts');
    const original = Simulation.prototype.step;
    vi.spyOn(Simulation.prototype, 'step').mockImplementation(function (
      this: InstanceType<typeof Simulation>,
      dt,
    ) {
      beforeStep(dt);
      original.call(this, dt);
      completedStep();
    });
    await import('../src/workers/physics.worker.ts');
  } else {
    const { OpenWorldSimulation } = await import('../src/simulation/open-world/session.ts');
    const original = OpenWorldSimulation.prototype.step;
    vi.spyOn(OpenWorldSimulation.prototype, 'step').mockImplementation(function (
      this: InstanceType<typeof OpenWorldSimulation>,
      dt,
    ) {
      beforeStep(dt);
      original.call(this, dt);
      completedStep();
    });
    await import('../src/workers/open-world.worker.ts');
  }
  const send = (data: Command) => scope.onmessage!({ data });
  const init = () => {
    if (kind === 'circuit') {
      send({
        type: 'init',
        options: { ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice' as const },
      });
    } else {
      send({
        type: 'init',
        options: {
          vehicle: 'tc1',
          weather: 'clear',
          assist: 'sport',
          seed: 73021,
          discovered: [],
          traffic: false,
        },
      });
    }
  };
  const latestFrame = () => {
    const frame = messages.filter((message) => message.type === 'frame').at(-1)!;
    return new Float32Array(frame.buffer);
  };
  init();
  return {
    time,
    dtCalls,
    messages,
    send,
    init,
    latestFrame,
    pump: () => pump!(),
    clock: () => observed.clock!,
  };
}

describe('actual worker clock ownership', () => {
  it.each<Kind>(['circuit', 'festival'])(
    '%s conserves active time through transport stalls, pauses, failure and reinitialization',
    async (kind) => {
      const h = await actualWorker(kind);
      const next = random(0x24112026);
      let ledger = freshLedger();
      let previous = h.time.now;
      let epochStart = h.time.completed;
      let expectedStepMs = 0;
      let maxErrorSeconds = 0;
      const check = () => {
        ledger.ticks = h.time.completed - epochStart;
        maxErrorSeconds = Math.max(
          maxErrorSeconds,
          conserved(h.clock(), ledger, `${kind}: completed=${h.time.completed}`),
        );
      };
      const advance = (units: number, paused = false) => {
        h.time.now += units / 8;
        const sample = h.time.now;
        const before = h.time.completed;
        if (!paused) ledger.elapsedUnits += (sample - previous) * 8;
        previous = sample;
        h.pump();
        if (h.time.completed > before)
          expectedStepMs = expectedStepMs * 0.9 + h.time.stepCostMs * 0.1;
        check();
      };
      const pause = (value: boolean) => {
        h.send({ type: 'pause', value });
        previous = h.time.now;
        check();
        if (value) {
          // Pause is a required publication even after ordinary buffers are
          // held. Compare wire diagnostics against external elapsed/tick data.
          const frame = h.latestFrame();
          const lost = ledger.elapsedUnits / 8000 - ledger.ticks / 120 - h.clock().accumulator;
          expect(frame[H.TICK]).toBe(ledger.ticks);
          expect(frame[H.DROPPED]).toBe(Math.fround(Math.abs(lost) < 1e-12 ? 0 : lost));
          expect(frame[H.STEP_MS]).toBe(Math.fround(expectedStepMs));
        }
      };
      pause(false);
      // No frame is recycled: the initial pool runs out, but physics time must
      // keep advancing and pause barriers must publish current diagnostics.
      for (let batch = 0; batch < 80; batch++) {
        h.time.stepCostMs = [0, 3, 6, 12][next() % 4];
        h.send({ type: 'input', input: { ...controls(), throttle: 0.2 } });
        advance([1, 15, 32, 72, 128, 697, 9900][next() % 7]);
        if (batch === 19 || batch === 53) {
          pause(true);
          advance(720_000, true);
          h.time.now += 720_000 / 8; // Also suspend interval callbacks entirely.
          pause(false);
        }
      }
      expect(h.messages.filter((message) => message.type === 'error')).toEqual([]);
      expect(h.clock().elapsedDroppedSeconds).toBeGreaterThan(0);
      expect(h.clock().budgetDroppedSeconds).toBeGreaterThan(0);
      pause(true);
      const completedBeforeFailure = h.time.completed;
      pause(false);
      h.time.failNext = true;
      advance(800);
      expect(h.time.completed).toBe(completedBeforeFailure);
      expect(h.clock().interruptedSeconds).toBeGreaterThan(0);
      expect(h.messages.filter((message) => message.type === 'error')).toHaveLength(1);
      pause(true);
      advance(960_000, true);
      expect(h.time.completed).toBe(completedBeforeFailure);
      console.log(
        'CLOCK_ACCOUNTING_WORKER',
        JSON.stringify({
          kind,
          completedTicks: ledger.ticks,
          chargedSeconds: ledger.elapsedUnits / 8000,
          remainderSeconds: h.clock().accumulator,
          elapsedDroppedSeconds: h.clock().elapsedDroppedSeconds,
          budgetDroppedSeconds: h.clock().budgetDroppedSeconds,
          interruptedSeconds: h.clock().interruptedSeconds,
          maxErrorSeconds,
        }),
      );
      h.init();
      ledger = freshLedger();
      epochStart = h.time.completed;
      previous = h.time.now;
      expectedStepMs = 0;
      check();
      expect(h.latestFrame()[H.TICK]).toBe(0);
      expect(h.latestFrame()[H.DROPPED]).toBe(0);
      expect(h.latestFrame()[H.STEP_MS]).toBe(0);
      advance(800_000, true);
      h.time.stepCostMs = 0;
      pause(false);
      advance(48);
      expect(h.time.completed).toBe(epochStart);
      advance(24);
      expect(h.time.completed).toBe(epochStart + 1);
      pause(true);
      expect(h.dtCalls.every((dt) => dt === 1 / 120)).toBe(true);
      expect(h.clock().droppedSeconds).toBe(0);
    },
  );
});
