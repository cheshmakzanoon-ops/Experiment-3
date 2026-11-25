import { createHash, type Hash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FLASHBACK, type InputLog, supportsFlashback } from '../src/core/flashback.ts';
import {
  controls,
  DEFAULT_OPTIONS,
  type Controls,
  type SessionOptions,
} from '../src/simulation/config.ts';
import { CAR_STRIDE, HEADER } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';
import { TELEMETRY_STRIDE } from '../src/storage/telemetry-schema.ts';
import { flashbackAllowed } from '../src/ui/flashback.ts';
import type { ClientMessage, WorkerMessage } from '../src/workers/diagnostics.ts';

const observed = vi.hoisted(() => ({
  retainHistory: false,
  logs: [] as InputLog[],
  journal: undefined as InputLog | null | undefined,
  resimulations: 0,
}));
vi.mock('../src/core/flashback.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/flashback.ts')>();
  return {
    ...actual,
    // The baseline runs the actual worker in the SAME mode, restoring only its
    // former unconditional journal. The simulation and recorders stay real.
    supportsFlashback: (mode: SessionOptions['mode']) =>
      observed.retainHistory || actual.supportsFlashback(mode),
    InputLog: class extends actual.InputLog {
      constructor() {
        super();
        observed.logs.push(this);
      }
    },
    applyLoggedInput: (...args: Parameters<typeof actual.applyLoggedInput>) => {
      observed.journal = args[1];
      return actual.applyLoggedInput(...args);
    },
    Resimulation: class extends actual.Resimulation {
      constructor(...args: ConstructorParameters<typeof actual.Resimulation>) {
        super(...args);
        observed.resimulations++;
      }
    },
  };
});

const SAMPLES = 36_000;
const FRAME_LENGTH = HEADER + CAR_STRIDE;
let now = 0;
let active = false;
let current: Simulation;
let pump: () => void;
const outgoing: WorkerMessage[] = [];
const digest = () => createHash('sha256');
const newCapture = () => ({
  input: digest(),
  steps: digest(),
  frames: digest(),
  telemetry: digest(),
  replay: digest(),
  inputCalls: 0,
  ticks: 0,
  frameCount: 0,
  telemetryPages: 0,
  telemetryRows: 0,
  replayPages: 0,
  replayRows: 0,
  surfaces: 0,
  shifts: [] as number[],
  lastBrake: 0,
  completions: [] as number[],
  errors: [] as string[],
  warnings: [] as string[],
});
let capture = newCapture();
// Fixed test scratch avoids retaining a parallel list of controls or frames.
const inputWords = new Float64Array(14);
function hashInput(hash: Hash, tick: number, input: Controls) {
  inputWords.set([
    tick,
    input.throttle,
    input.brake,
    input.clutch,
    Number(!!input.manualClutch),
    input.steer,
    input.riderLean ?? 0,
    input.rearBrake ?? 0,
    input.shift,
    input.ers,
    Number(!!input.pit),
    Number(!!input.reverse),
    Number(!!input.drs),
    Number(!!input.overtake),
  ]);
  hash.update(new Uint8Array(inputWords.buffer));
}
const original = {
  input: Simulation.prototype.setInput,
  step: Simulation.prototype.step,
  frame: Simulation.prototype.writeFrame,
};
function observe(simulation: Simulation) {
  current = simulation;
}
const scope = {
  onmessage: null as ((event: { data: ClientMessage }) => void) | null,
  postMessage(message: WorkerMessage, transfer: Transferable[] = []) {
    outgoing.push(structuredClone(message, { transfer }));
  },
};
function inWorker(operation: () => void) {
  active = true;
  try {
    operation();
  } finally {
    active = false;
  }
}
function deliver(data: ClientMessage, transfer: Transferable[] = []) {
  inWorker(() => scope.onmessage!({ data: structuredClone(data, { transfer }) }));
}
function receive() {
  // Return pages after postMessage completes, just as an asynchronous host does.
  // Every publication and return really transfers/detaches its ArrayBuffer.
  while (outgoing.length) {
    const message = outgoing.shift()!;
    switch (message.type) {
      case 'frame':
        capture.frames.update(new Uint8Array(message.buffer));
        capture.frameCount++;
        deliver({ type: 'recycle', buffer: message.buffer }, [message.buffer]);
        break;
      case 'telemetry':
        capture.telemetry.update(
          new Uint8Array(message.buffer, 0, message.rows * TELEMETRY_STRIDE * 4),
        );
        capture.telemetryPages++;
        capture.telemetryRows += message.rows;
        deliver({ type: 'recycleTelemetry', buffer: message.buffer }, [message.buffer]);
        break;
      case 'replayFrames':
        capture.replay.update(new Uint8Array(message.buffer, 0, message.rows * FRAME_LENGTH * 4));
        capture.replayPages++;
        capture.replayRows += message.rows;
        deliver({ type: 'recycleReplay', buffer: message.buffer }, [message.buffer]);
        break;
      case 'surface':
        capture.surfaces++;
        deliver({ type: 'surfaceAck', epoch: message.epoch, sequence: message.sequence });
        break;
      case 'engineering':
        deliver({ type: 'engineeringAck', epoch: message.epoch, sequence: message.sequence });
        break;
      case 'flashback':
        capture.completions.push(message.tick);
        break;
      case 'error':
        capture.errors.push(message.message);
        break;
      case 'recordingWarning':
        capture.warnings.push(message.message);
        break;
    }
  }
}
function send(message: ClientMessage) {
  deliver(message);
  receive();
}
function advance(ms: number) {
  now += ms;
  inWorker(pump);
  receive();
}
function start(mode: SessionOptions['mode'], retainHistory = false) {
  observed.retainHistory = retainHistory;
  observed.logs.length = observed.resimulations = 0;
  observed.journal = undefined;
  capture = newCapture();
  now += 1000;
  send({
    type: 'init',
    options: {
      ...DEFAULT_OPTIONS,
      mode,
      vehicles: ['apx01'],
      opponents: 0,
      assist: 'raw',
      seed: 60316,
    },
  });
  expect(capture.errors).toEqual([]);
  send({ type: 'pause', value: false });
}
const input = (patch: Partial<Controls>) =>
  send({ type: 'input', input: { ...controls(), ...patch } });
function varied(sample: number) {
  input({
    throttle: (sample % 17) / 100,
    brake: 0.3,
    steer: ((sample % 1000) - 500) / 1500,
    clutch: (sample % 11) / 100,
    riderLean: Math.sin(sample / 10) * 0.1,
    rearBrake: (sample % 13) / 100,
  });
  advance(1000 / 60);
}
function retention() {
  const journal = observed.journal;
  return {
    created: observed.logs.length,
    entries: journal?.entries.length ?? 0,
    // InputLog keeps one copied Controls per input entry plus its lastInput.
    controls:
      (journal?.entries.filter((entry) => entry.kind === 'input').length ?? 0) +
      Number(!!journal && Reflect.get(journal, 'lastInput') !== null),
  };
}
function result() {
  const { input, steps, frames, telemetry, replay, ...counts } = capture;
  return {
    ...counts,
    input: input.digest('hex'),
    steps: steps.digest('hex'),
    frames: frames.digest('hex'),
    telemetry: telemetry.digest('hex'),
    replay: replay.digest('hex'),
  };
}
function state() {
  const frame = new Float32Array(FRAME_LENGTH);
  current.writeFrame(frame, 0, 0);
  return {
    frame: new Uint32Array(frame.buffer),
    input: { ...current.cars[0].input },
    autoPlayer: current.autoPlayer,
    pit: current.cars[0].pitRequested,
    compound: current.cars[0].nextCompound,
  };
}
function ownershipChanges() {
  for (const shift of [1, -1, 1]) input({ throttle: 0.2, shift });
  input({ throttle: 0.3, steer: 0.01 });
  advance(50);
  expect(capture.shifts).toEqual([1, -1, 1]);
  input({ shift: 1 });
  send({ type: 'autopilot', value: true });
  input({ shift: -1 });
  send({ type: 'autopilot', value: false });
  advance(50);
  send({ type: 'pit', compound: 'soft' });
  expect(current.cars[0].pitRequested).toBe(true);
  advance(100);
  send({ type: 'pit', compound: 'medium' });
  expect(current.cars[0].pitRequested).toBe(false);
  send({ type: 'autopilot', value: true });
  advance(100);
  send({ type: 'autopilot', value: false });
  input({ throttle: 0.3, steer: 0.01, drs: true, overtake: true });
  advance(50);
  for (const shift of [1, -1]) input({ shift });
  advance(800);
  expect(capture.lastBrake).toBe(0.4);
  send({ type: 'pause', value: true });
  input({ shift: 1 });
  send({ type: 'pause', value: false });
  advance(20);
  expect(capture.shifts).toEqual([1, -1, 1]);
}

beforeAll(async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  // Observe real methods without a mock's unbounded per-call argument history.
  Simulation.prototype.setInput = function (value) {
    if (active) {
      hashInput(capture.input, this.tick, value);
      capture.inputCalls++;
      capture.lastBrake = value.brake;
    }
    original.input.call(this, value);
  };
  Simulation.prototype.step = function (dt) {
    if (active) {
      observe(this);
      hashInput(capture.steps, this.tick, this.cars[0].input);
      capture.ticks++;
      if (this.cars[0].input.shift) capture.shifts.push(this.cars[0].input.shift);
    }
    original.step.call(this, dt);
  };
  Simulation.prototype.writeFrame = function (...args) {
    if (active) observe(this);
    return original.frame.apply(this, args);
  };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    pump = callback;
    return 1;
  });
  // Load once, then drive each fresh session through the actual init protocol.
  await import('../src/workers/physics.worker.ts');
  expect(observed.logs).toHaveLength(0);
});
afterAll(() => {
  Simulation.prototype.setInput = original.input;
  Simulation.prototype.step = original.step;
  Simulation.prototype.writeFrame = original.frame;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('flashback eligibility and actual worker retention', () => {
  it.each([
    ['race', true],
    ['endurance', true],
    ['practice', true],
    ['time-trial', false],
    ['qualifying', false],
  ] as const)('shares %s eligibility without changing the UI use limit', (mode, allowed) => {
    observed.retainHistory = false;
    expect(supportsFlashback(mode)).toBe(allowed);
    expect(flashbackAllowed(mode, 0)).toBe(allowed);
    expect(flashbackAllowed(mode, FLASHBACK.perRace - 1)).toBe(allowed);
    expect(flashbackAllowed(mode, FLASHBACK.perRace)).toBe(false);
  });

  it.each(['time-trial', 'qualifying'] as const)(
    '%s retains no journal over 36,000 varying samples and matches all baseline inputs and recordings',
    (mode) => {
      const run = (retainHistory: boolean) => {
        start(mode, retainHistory);
        for (let sample = 0; sample < SAMPLES; sample++) {
          varied(sample);
          // Bound the test clock spy's own metadata; the production journal is
          // deliberately untouched, so a retained-history regression is visible.
          if (sample % 1200 === 0) vi.mocked(performance.now).mockClear();
        }
        expect(current.tick).toBe(SAMPLES * 2);
        const retained = retention();
        send({ type: 'pause', value: true });
        return { retained, output: result() };
      };
      const baseline = run(true);
      expect(baseline.retained).toEqual({ created: 1, entries: SAMPLES, controls: SAMPLES + 1 });
      const disabled = run(false);
      expect(observed.journal).toBeNull();
      expect(disabled.retained).toEqual({ created: 0, entries: 0, controls: 0 });
      expect(disabled.output).toEqual(baseline.output);
      expect(disabled.output).toMatchObject({
        inputCalls: SAMPLES + 1,
        ticks: SAMPLES * 2,
        frameCount: SAMPLES + 2,
        telemetryPages: 600,
        telemetryRows: SAMPLES,
        replayPages: 600,
        replayRows: 9000,
        errors: [],
        warnings: [],
      });
    },
  );

  it.each(['time-trial', 'qualifying'] as const)(
    '%s preserves shift, pit, AI handback, pause and watchdog application without history',
    (mode) => {
      start(mode, true);
      ownershipChanges();
      send({ type: 'pause', value: true });
      const baseline = result();
      start(mode);
      ownershipChanges();
      send({ type: 'pause', value: true });
      expect(retention()).toEqual({ created: 0, entries: 0, controls: 0 });
      expect(result()).toEqual(baseline);
    },
  );

  it.each(['time-trial', 'qualifying'] as const)(
    '%s rejects rewind before flushing recordings or replacing the live simulation',
    (mode) => {
      start(mode);
      for (let sample = 0; sample < 10; sample++) varied(sample);
      const live = current,
        before = state(),
        publications = capture.frameCount;
      expect(capture.telemetryPages).toBe(0);
      expect(capture.replayPages).toBe(0);
      send({ type: 'flashback', tick: 8 });
      expect(capture.errors).toEqual(['Invalid flashback request']);
      expect(observed.resimulations).toBe(0);
      expect(capture.telemetryPages).toBe(0);
      expect(capture.replayPages).toBe(0);
      expect(capture.frameCount).toBe(publications);
      expect(current).toBe(live);
      expect(state()).toEqual(before);
      // Rejected worker requests retain the existing terminal-error contract.
      send({ type: 'pause', value: false });
      input({ throttle: 1, shift: 1 });
      advance(100);
      expect(state()).toEqual(before);
      expect(capture.completions).toEqual([]);
    },
  );

  it.each(['race', 'endurance', 'practice'] as const)(
    '%s keeps history from tick zero and rewinds the actual command timeline beyond 30 seconds',
    (mode) => {
      start(mode);
      ownershipChanges();
      for (let sample = 0; sample < 2000; sample++) varied(sample);
      const journal = observed.journal!;
      expect(observed.logs).toHaveLength(1);
      expect(current.tick).toBeGreaterThan(FLASHBACK.window / FLASHBACK.dt);
      expect(journal.entries[0].tick).toBe(0);
      expect(journal.entries.filter((entry) => entry.kind === 'pit')).toHaveLength(2);
      expect(journal.entries.filter((entry) => entry.kind === 'autopilot')).toHaveLength(4);
      expect(
        journal.entries.some((entry) => entry.kind === 'input' && entry.input.brake === 0.4),
      ).toBe(true);
      const target = current.tick,
        expected = state();
      input({ throttle: 0.8, shift: 1 });
      advance(50);
      send({ type: 'pit', compound: 'wet' });
      send({ type: 'autopilot', value: true });
      send({ type: 'flashback', tick: target });
      for (let turn = 0; turn < 10 && !capture.completions.length; turn++) advance(4);
      expect(observed.resimulations).toBe(1);
      expect(capture.completions).toEqual([target]);
      expect(state()).toEqual(expected);
      expect(journal.entries[0].tick).toBe(0);
      expect(journal.entries.every((entry) => entry.tick < target)).toBe(true);
      expect(capture.errors).toEqual([]);
      expect(capture.warnings).toEqual([]);
      // Reinit into a competitive session drops the former journal entirely.
      const previousLength = journal.entries.length;
      start('time-trial');
      input({ throttle: 0.1 });
      send({ type: 'pit' });
      send({ type: 'autopilot', value: true });
      expect(observed.journal).toBeNull();
      expect(retention()).toEqual({ created: 0, entries: 0, controls: 0 });
      expect(journal.entries).toHaveLength(previousLength);
    },
  );
});
