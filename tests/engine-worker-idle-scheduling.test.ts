import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { controls, DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { CAR_STRIDE, H, HEADER } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';
import type { ClientMessage, SurfaceMessage, WorkerMessage } from '../src/workers/diagnostics.ts';
import { SURFACE_TRANSPORT_MAX_PACKETS } from '../src/workers/surface-channel.ts';

const options = {
  ...DEFAULT_OPTIONS,
  mode: 'practice' as const,
  opponents: 0,
  vehicles: ['apx01'],
  assist: 'raw' as const,
  seed: 76035,
};
const active = new Map<number, () => void>(),
  callbacks = new Map<number, () => void>(),
  delays: number[] = [],
  messages: WorkerMessage[] = [];
let nextInterval = 0,
  callbackCount = 0,
  maxActive = 0,
  now = 0,
  stepCostMs = 0,
  bootstrapIntervals = 0;
let current: Simulation;
let stepFailure: Error | null = null;
const steps: { simulation: Simulation; dt: number }[] = [];
const originalWrite = Simulation.prototype.writeFrame,
  originalStep = Simulation.prototype.step;
const scope = {
  onmessage: null as ((event: { data: ClientMessage }) => void) | null,
  postMessage(message: WorkerMessage, transfer: Transferable[] = []) {
    messages.push(structuredClone(message, { transfer }));
  },
};
function send(data: ClientMessage, transfer: Transferable[] = []) {
  scope.onmessage!({ data: structuredClone(data, { transfer }) });
}
function advance(milliseconds: number) {
  now += milliseconds;
  // A turn sees only requests that were active when that turn began.
  for (const [handle, callback] of [...active]) {
    if (!active.has(handle)) continue;
    callbackCount++;
    callback();
  }
}
const frames = () => messages.filter((message) => message.type === 'frame');
const surfaces = () =>
  messages.filter((message): message is SurfaceMessage => message.type === 'surface');
const errors = () => messages.filter((message) => message.type === 'error');
const resume = () => send({ type: 'pause', value: false });
const pause = () => send({ type: 'pause', value: true });
function ack(message: SurfaceMessage) {
  send({ type: 'surfaceAck', epoch: message.epoch, sequence: message.sequence });
}
function frame(simulation: Simulation) {
  const values = new Float32Array(HEADER + CAR_STRIDE);
  // Compare authoritative serialization with equal diagnostic arguments.
  originalWrite.call(simulation, values, 0, 0);
  return values;
}
function expectState(expected: Simulation) {
  expect(Buffer.from(frame(current).buffer).equals(Buffer.from(frame(expected).buffer))).toBe(true);
  expect(current.cars[0].body.position).toEqual(expected.cars[0].body.position);
  expect(current.cars[0].body.velocity).toEqual(expected.cars[0].body.velocity);
}
function onlyTimer() {
  expect(active.size).toBe(1);
  return [...active.keys()][0];
}

beforeAll(async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(Simulation.prototype, 'writeFrame').mockImplementation(function (
    this: Simulation,
    ...args
  ) {
    current = this;
    return originalWrite.apply(this, args);
  });
  vi.spyOn(Simulation.prototype, 'step').mockImplementation(function (this: Simulation, dt) {
    steps.push({ simulation: this, dt });
    originalStep.call(this, dt);
    now += stepCostMs;
    if (stepFailure) {
      const failure = stepFailure;
      stepFailure = null;
      throw failure;
    }
  });
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void, delay: number) => {
    const handle = ++nextInterval;
    active.set(handle, callback);
    callbacks.set(handle, callback);
    delays.push(delay);
    maxActive = Math.max(maxActive, active.size);
    return handle;
  });
  vi.stubGlobal('clearInterval', (handle: number) => active.delete(handle));
  await import('../src/workers/physics.worker.ts');
  bootstrapIntervals = active.size;
  // An uninitialized worker should release its bootstrap timer on that turn.
  advance(4);
  expect(active.size).toBe(0);
});
beforeEach(() => {
  stepFailure = null;
  stepCostMs = 0;
  // Delivered credits remain owned across init; retire them through the real
  // protocol rather than changing any private channel state between cases.
  send({ type: 'engineering', enabled: false });
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.type === 'surface') ack(message);
    if (message.type === 'engineering')
      send({ type: 'engineeringAck', epoch: message.epoch, sequence: message.sequence });
  }
  messages.length = 0;
  steps.length = 0;
  now += 1000;
  send({ type: 'init', options });
  expect(errors()).toEqual([]);
  expect(current.tick).toBe(0);
  expect(active.size).toBe(0);
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('actual circuit worker interval ownership', () => {
  it('parks uninitialized and initialized-paused workers without periodic idle callbacks', () => {
    expect(bootstrapIntervals).toBe(1);
    const callbacksBefore = callbackCount,
      issuedBefore = nextInterval,
      messagesBefore = messages.length;
    for (let turn = 0; turn < 1000; turn++) advance(4);
    expect(callbackCount).toBe(callbacksBefore);
    expect(nextInterval).toBe(issuedBefore);
    expect(messages).toHaveLength(messagesBefore);
    expect(current.tick).toBe(0);
    send({ type: 'input', input: { ...controls(), throttle: 0.2 } });
    send({ type: 'engineering', enabled: true });
    expect(messages.at(-1)?.type).toBe('engineering');
    expect(active.size).toBe(0);
    expect(delays.every((delay) => delay === 4)).toBe(true);
  });

  it('retains one four-millisecond interval and exact fixed-step state across active callback jitter', () => {
    const expected = new Simulation(options),
      input = { ...controls(), throttle: 0.2, steer: 0.005 };
    const elapsed = [4, 4, 9, 4, 16, 7, 20, 5];
    let wall = 0,
      expectedTicks = 0;
    resume();
    const handle = onlyTimer();
    for (let turn = 0; turn < 96; turn++) {
      send({ type: 'input', input });
      expected.setInput(input);
      const milliseconds = elapsed[turn % elapsed.length];
      wall += milliseconds;
      advance(milliseconds);
      const target = Math.floor((wall * 120) / 1000 + 1e-9);
      while (expectedTicks < target) {
        originalStep.call(expected, 1 / 120);
        expectedTicks++;
      }
      expect(current.tick).toBe(target);
      expect(onlyTimer()).toBe(handle);
      expectState(expected);
    }
    expect(expectedTicks).toBeGreaterThan(60);
    expect(steps.every((entry) => entry.dt === 1 / 120)).toBe(true);
    expect(maxActive).toBe(1);
    pause();
    const stopped = new Float32Array(frames().at(-1)!.buffer);
    expect(stopped[H.DROPPED]).toBe(0);
    expect(active.size).toBe(0);
  });

  it('excludes a long pause while retaining the active fractional tick and fresh-input watchdog grace', () => {
    resume();
    advance(6);
    expect(current.tick).toBe(0);
    pause();
    const callbacksBefore = callbackCount;
    advance(90000);
    expect(callbackCount).toBe(callbacksBefore);
    resume();
    send({ type: 'input', input: { ...controls(), throttle: 0.3 } });
    advance(2);
    expect(current.tick).toBe(0);
    advance(1);
    expect(current.tick).toBe(1);
    expect(current.cars[0].input.throttle).toBe(0.3);
    expect(current.cars[0].input.brake).toBe(0);
    pause();
    expect(new Float32Array(frames().at(-1)!.buffer)[H.DROPPED]).toBe(0);
    const expected = new Simulation(options);
    expected.setInput({ ...controls(), throttle: 0.3 });
    originalStep.call(expected, 1 / 120);
    expected.setInput(controls());
    expectState(expected);
  });

  it('rejects canceled callbacks across resume and session replacement without revoking the current timer', () => {
    resume();
    const retired = onlyTimer(),
      stale = callbacks.get(retired)!;
    advance(20);
    pause();
    resume();
    const successor = onlyTimer();
    expect(successor).not.toBe(retired);
    const tick = current.tick,
      publications = messages.length;
    now += 20;
    stale();
    expect(current.tick).toBe(tick);
    expect(messages).toHaveLength(publications);
    expect(onlyTimer()).toBe(successor);
    advance(1);
    expect(current.tick).toBeGreaterThan(tick);
    send({ type: 'init', options });
    expect(active.size).toBe(0);
    const fresh = current;
    callbacks.get(successor)!();
    expect(fresh.tick).toBe(0);
    resume();
    const latest = onlyTimer();
    stale();
    callbacks.get(successor)!();
    expect(onlyTimer()).toBe(latest);
    expect(fresh.tick).toBe(0);
    advance(20);
    expect(fresh.tick).toBe(2);
    expect(maxActive).toBe(1);
  });

  it('keeps resimulation runnable while paused, yields at the existing work budget, and parks after completion', () => {
    resume();
    send({ type: 'input', input: { ...controls(), throttle: 0.15 } });
    advance(100);
    expect(current.tick).toBe(12);
    pause();
    const original = current;
    send({ type: 'flashback', tick: 6 });
    const handle = onlyTimer();
    const before = steps.length;
    // Charge real completed ticks against the controlled monotonic work clock.
    // The production Resimulation budget decides when each turn yields.
    stepCostMs = 5;
    advance(4);
    expect(steps.length - before).toBe(2);
    expect(current).toBe(original);
    expect(onlyTimer()).toBe(handle);
    advance(4);
    expect(steps.length - before).toBe(4);
    expect(onlyTimer()).toBe(handle);
    advance(4);
    stepCostMs = 0;
    expect(steps.length - before).toBe(6);
    expect(current).not.toBe(original);
    expect(current.tick).toBe(6);
    expect(messages.filter((message) => message.type === 'flashback')).toHaveLength(1);
    expect(active.size).toBe(0);
    const callbacksBefore = callbackCount;
    advance(10000);
    expect(callbackCount).toBe(callbacksBefore);
    const expected = new Simulation(options);
    expected.setInput({ ...controls(), throttle: 0.15 });
    for (let tick = 0; tick < 6; tick++) originalStep.call(expected, 1 / 120);
    expectState(expected);
    expect(errors()).toEqual([]);
  });

  it('parks a terminal failure, ignores queued revival, and wakes only after fresh init and resume', () => {
    resume();
    const retired = onlyTimer();
    stepFailure = new Error('Failure after one completed physics tick');
    advance(100);
    expect(current.tick).toBe(1);
    expect(errors()).toHaveLength(1);
    expect(active.size).toBe(0);
    const old = current,
      publications = messages.length,
      callbacksBefore = callbackCount;
    resume();
    send({ type: 'input', input: { ...controls(), throttle: 1 } });
    send({ type: 'flashback', tick: 0 });
    advance(90000);
    callbacks.get(retired)!();
    expect(callbackCount).toBe(callbacksBefore);
    expect(old.tick).toBe(1);
    expect(messages).toHaveLength(publications);
    expect(active.size).toBe(0);
    send({ type: 'init', options });
    expect(current).not.toBe(old);
    expect(active.size).toBe(0);
    resume();
    advance(20);
    expect(current.tick).toBe(2);
    expect(onlyTimer()).not.toBe(retired);
  });

  it('waits without timers for real exhausted surface credit and excludes the blocked interval after an early resume', () => {
    resume();
    // Fill the actual 120-packet transport bound; no channel capacity or
    // publication method is substituted. The clock is the only time adapter.
    for (let batch = 0; batch < 600; batch++) {
      send({ type: 'input', input: controls() });
      advance(100);
    }
    const held = surfaces();
    expect(held).toHaveLength(SURFACE_TRANSPORT_MAX_PACKETS);
    expect(current.tick).toBe(7200);
    send({ type: 'init', options });
    resume();
    advance(100);
    expect(current.tick).toBe(12);
    send({ type: 'flashback', tick: 6 });
    advance(4);
    expect(active.size).toBe(0);
    expect(messages.filter((message) => message.type === 'flashback')).toEqual([]);
    const callbacksBefore = callbackCount;
    resume();
    expect(active.size).toBe(0);
    advance(90000);
    expect(callbackCount).toBe(callbacksBefore);
    const completionStart = messages.length;
    ack(held[0]);
    expect(messages.slice(completionStart).map((message) => message.type)).toEqual([
      'flashback', 'surface', 'frame',
    ]);
    expect(current.tick).toBe(6);
    const handle = onlyTimer();
    ack(held[0]);
    expect(onlyTimer()).toBe(handle);
    advance(4);
    expect(current.tick).toBe(6);
    advance(5);
    expect(current.tick).toBe(7);
    pause();
    expect(new Float32Array(frames().at(-1)!.buffer)[H.DROPPED]).toBe(0);
    expect(active.size).toBe(0);
    expect(errors()).toEqual([]);
  }, 30000);
});
