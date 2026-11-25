import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Resimulation } from '../src/core/flashback.ts';
import { controls, DEFAULT_OPTIONS, type Controls } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import type {
  ClientMessage,
  EngineeringMessage,
  SurfaceMessage,
  WorkerMessage,
} from '../src/workers/diagnostics.ts';

const options = {
  ...DEFAULT_OPTIONS,
  mode: 'practice' as const,
  opponents: 0,
  vehicles: ['apx01'],
  assist: 'raw' as const,
  seed: 75025,
};
let now = 0;
let pump: () => void;
let current: Simulation;
let pitFailure: Error | null = null;
let stepFailure: Error | null = null;
let rewindFailure: Error | null = null;
let frameFailure: Error | null = null;
let publicationFailure: WorkerMessage['type'] | null = null;
let rewindRuns = 0;
const applied = new WeakMap<Simulation, Controls[]>();
const messages: WorkerMessage[] = [];
const scope = {
  onmessage: null as ((event: { data: ClientMessage }) => void) | null,
  postMessage(message: WorkerMessage, transfer: Transferable[] = []) {
    if (publicationFailure === message.type) {
      publicationFailure = null;
      throw new Error(`${message.type} publication failed`);
    }
    messages.push(structuredClone(message, { transfer }));
  },
};
const send = (data: ClientMessage, transfer: Transferable[] = []) =>
  scope.onmessage!({ data: structuredClone(data, { transfer }) });
const errors = () => messages.filter((message) => message.type === 'error');
const engineering = () =>
  messages.filter((message): message is EngineeringMessage => message.type === 'engineering');
const surfaces = () =>
  messages.filter((message): message is SurfaceMessage => message.type === 'surface');
function observe(simulation: Simulation) {
  current = simulation;
}
const advance = (ms: number) => {
  now += ms;
  pump();
};
const resume = () => send({ type: 'pause', value: false });
function state(simulation = current) {
  const car = simulation.cars[0];
  return {
    tick: simulation.tick,
    time: simulation.race.time,
    auto: simulation.autoPlayer,
    input: { ...car.input },
    pit: car.pitRequested,
    compound: car.nextCompound,
    position: { ...car.body.position },
    velocity: { ...car.body.velocity },
    gear: car.gear,
  };
}
function queuedTraffic() {
  send({ type: 'pause', value: false, sequence: 71 });
  send({ type: 'input', input: { ...controls(), throttle: 1, shift: 1, pit: true } });
  send({ type: 'autopilot', value: true });
  send({ type: 'pit', compound: 'soft' });
  send({ type: 'flashback', tick: 0 });
  send({ type: 'engineering', enabled: true });
  for (const type of ['recycle', 'recycleTelemetry', 'recycleReplay'] as const) {
    const buffer = new ArrayBuffer(16);
    send({ type, buffer }, [buffer]);
    expect(buffer.byteLength).toBe(0);
  }
  for (let turn = 0; turn < 5; turn++) advance(100);
}

beforeAll(async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const writeFrame = Simulation.prototype.writeFrame;
  vi.spyOn(Simulation.prototype, 'writeFrame').mockImplementation(function (
    this: Simulation,
    ...args
  ) {
    observe(this);
    const value = writeFrame.apply(this, args);
    if (frameFailure) {
      const failure = frameFailure;
      frameFailure = null;
      throw failure;
    }
    return value;
  });
  const step = Simulation.prototype.step;
  vi.spyOn(Simulation.prototype, 'step').mockImplementation(function (this: Simulation, dt) {
    let inputs = applied.get(this);
    if (!inputs) applied.set(this, (inputs = []));
    inputs.push({ ...this.cars[0].input });
    const result = step.call(this, dt);
    if (stepFailure) {
      const failure = stepFailure;
      stepFailure = null;
      throw failure;
    }
    return result;
  });
  const requestPit = Simulation.prototype.requestPit;
  vi.spyOn(Simulation.prototype, 'requestPit').mockImplementation(function (
    this: Simulation,
    ...args
  ) {
    const result = requestPit.apply(this, args);
    if (pitFailure) {
      const failure = pitFailure;
      pitFailure = null;
      throw failure;
    }
    return result;
  });
  const run = Resimulation.prototype.run;
  vi.spyOn(Resimulation.prototype, 'run').mockImplementation(function (
    this: Resimulation,
    ...args
  ) {
    rewindRuns++;
    const result = run.apply(this, args);
    if (rewindFailure) {
      const failure = rewindFailure;
      rewindFailure = null;
      throw failure;
    }
    return result;
  });
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    pump = callback;
    return 1;
  });
  // Load the real graph once; each case exercises its public init boundary.
  await import('../src/workers/physics.worker.ts');
});
beforeEach(() => {
  pitFailure = stepFailure = rewindFailure = frameFailure = null;
  publicationFailure = null;
  send({ type: 'engineering', enabled: false });
  for (const message of messages) {
    if (message.type === 'engineering')
      send({ type: 'engineeringAck', epoch: message.epoch, sequence: message.sequence });
    if (message.type === 'surface')
      send({ type: 'surfaceAck', epoch: message.epoch, sequence: message.sequence });
  }
  messages.length = 0;
  rewindRuns = 0;
  now += 1000;
  send({ type: 'init', options });
  expect(errors()).toEqual([]);
  expect(current.tick).toBe(0);
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('terminal ownership in the actual circuit worker', () => {
  it('keeps a command failure terminal after its real mutation and ignores queued resumes, inputs and returns', () => {
    resume();
    send({ type: 'input', input: { ...controls(), shift: 1 } });
    const priorPit = current.cars[0].pitRequested;
    pitFailure = new Error('pit execution failed');
    send({ type: 'pit' });
    expect(current.cars[0].pitRequested).toBe(!priorPit);
    expect(errors()).toEqual([{ type: 'error', message: 'pit execution failed' }]);
    const stopped = state(),
      publications = messages.length;
    queuedTraffic();
    expect(state()).toEqual(stopped);
    expect(applied.get(current) ?? []).toEqual([]);
    expect(rewindRuns).toBe(0);
    expect(messages).toHaveLength(publications);
  });

  it('does not advance again after a tick completed before an interval exception', () => {
    resume();
    send({ type: 'input', input: { ...controls(), throttle: 0.2, shift: 1 } });
    send({ type: 'input', input: { ...controls(), throttle: 0.3, shift: -1 } });
    stepFailure = new Error('after physics step');
    advance(100);
    expect(current.tick).toBe(1);
    expect(applied.get(current)?.map((input) => input.shift)).toEqual([1]);
    expect(errors()).toHaveLength(1);
    expect(errors()[0].message).toContain('after physics step');
    const stopped = state(),
      publications = messages.length;
    queuedTraffic();
    expect(state()).toEqual(stopped);
    expect(applied.get(current)).toHaveLength(1);
    expect(messages).toHaveLength(publications);
  });

  it('reinitializes paused and removes old and failed-session shifts before accepting fresh one-shot input', () => {
    resume();
    for (const shift of [1, -1]) send({ type: 'input', input: { ...controls(), shift } });
    pitFailure = new Error('old session failed');
    send({ type: 'pit' });
    const old = current;
    queuedTraffic();
    send({ type: 'init', options });
    const fresh = current;
    expect(fresh).not.toBe(old);
    advance(1000);
    expect(fresh.tick).toBe(0);
    resume();
    advance(20);
    expect(applied.get(fresh)?.map((input) => input.shift)).toEqual([0, 0]);
    for (const shift of [1, -1, 1])
      send({ type: 'input', input: { ...controls(), throttle: 0.2, shift } });
    send({ type: 'input', input: { ...controls(), throttle: 0.4 } });
    advance(50);
    expect(
      applied
        .get(fresh)
        ?.slice(2)
        .map((input) => input.shift),
    ).toEqual([1, -1, 1, 0, 0, 0]);
    expect(
      applied
        .get(fresh)
        ?.slice(2)
        .every((input) => input.throttle === 0.4),
    ).toBe(true);
    expect(old.tick).toBe(0);
    expect(errors()).toHaveLength(1);
  });

  it.each(['active rewind', 'duplicate rewind'] as const)(
    'cancels an %s before a queued worker turn can execute it',
    (failure) => {
      resume();
      advance(100);
      expect(current.tick).toBe(12);
      send({ type: 'flashback', tick: 6 });
      if (failure === 'active rewind') send({ type: 'pause', value: false, sequence: 0 });
      else send({ type: 'flashback', tick: 4 });
      expect(errors()).toEqual([
        {
          type: 'error',
          message:
            failure === 'active rewind'
              ? 'Invalid worker pause sequence'
              : 'Invalid flashback request',
        },
      ]);
      const stopped = state(),
        publications = messages.length;
      queuedTraffic();
      expect(rewindRuns).toBe(0);
      expect(state()).toEqual(stopped);
      expect(messages).toHaveLength(publications);
      send({ type: 'init', options });
      resume();
      advance(20);
      expect(current.tick).toBe(2);
      expect(rewindRuns).toBe(0);
    },
  );

  it('discards a failed resimulation after its real ticks have run and never commits its completion', () => {
    resume();
    advance(100);
    const original = current;
    send({ type: 'flashback', tick: 6 });
    rewindFailure = new Error('rewind execution failed');
    advance(10);
    expect(rewindRuns).toBe(1);
    expect(current).toBe(original);
    expect(current.tick).toBe(12);
    expect(errors()).toEqual([{ type: 'error', message: 'rewind execution failed' }]);
    const publications = messages.length;
    queuedTraffic();
    expect(rewindRuns).toBe(1);
    expect(current.tick).toBe(12);
    expect(messages).toHaveLength(publications);
    expect(messages.some((message) => message.type === 'flashback')).toBe(false);
  });

  it('does not publish a pending rewind completion after its surface transport failed', () => {
    resume();
    for (let batch = 0; batch < 5; batch++) advance(100);
    const oldSurface = surfaces()[0];
    expect(oldSurface).toBeDefined();
    send({ type: 'flashback', tick: 12 });
    publicationFailure = 'surface';
    advance(10);
    expect(errors()).toEqual([{ type: 'error', message: 'surface publication failed' }]);
    const publications = messages.length;
    send({ type: 'surfaceAck', epoch: oldSurface.epoch, sequence: oldSurface.sequence });
    queuedTraffic();
    expect(messages).toHaveLength(publications);
    expect(messages.filter((message) => message.type === 'flashback')).toHaveLength(1);
    send({ type: 'init', options });
    resume();
    advance(20);
    expect(current.tick).toBe(2);
    expect(messages.filter((message) => message.type === 'flashback')).toHaveLength(1);
  });

  it('retires delivered diagnostics while failed without publishing, preserving fresh-init credit', () => {
    send({ type: 'engineering', enabled: true });
    const old = engineering()[0];
    expect(old).toBeDefined();
    pitFailure = new Error('fail with a delivered packet');
    send({ type: 'pit' });
    const publications = messages.length;
    send({ type: 'engineeringAck', epoch: old.epoch + 1, sequence: old.sequence });
    send({ type: 'engineeringAck', epoch: old.epoch, sequence: old.sequence });
    send({ type: 'engineeringAck', epoch: old.epoch, sequence: old.sequence });
    queuedTraffic();
    expect(messages).toHaveLength(publications);
    send({ type: 'init', options });
    send({ type: 'engineering', enabled: true });
    const fresh = engineering()[1];
    expect(fresh.sample.tick).toBe(0);
    expect(fresh.epoch).toBeGreaterThan(old.epoch);
    send({ type: 'engineeringAck', epoch: old.epoch, sequence: old.sequence });
    resume();
    advance(100);
    expect(engineering()).toHaveLength(2);
    send({ type: 'engineeringAck', epoch: fresh.epoch, sequence: fresh.sequence });
    expect(engineering()[2].sample.tick).toBe(12);
  });

  it('keeps failed initialization terminal until a complete new initialization publishes its frame', () => {
    frameFailure = new Error('initial frame construction failed');
    send({ type: 'init', options });
    expect(errors()).toEqual([{ type: 'error', message: 'initial frame construction failed' }]);
    const failed = current,
      publications = messages.length;
    queuedTraffic();
    expect(failed.tick).toBe(0);
    expect(messages).toHaveLength(publications);
    send({ type: 'init', options });
    expect(current).not.toBe(failed);
    advance(100);
    expect(current.tick).toBe(0);
    resume();
    advance(20);
    expect(current.tick).toBe(2);
    expect(errors()).toHaveLength(1);
  });
});
