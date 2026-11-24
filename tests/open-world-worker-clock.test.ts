import { afterEach, describe, expect, it, vi } from 'vitest';
import { controls } from '../src/simulation/config.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';
import type { FromOpenWorld, ToOpenWorld } from '../src/workers/open-world-protocol.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Run the real worker and session, including transferable frame ownership.
 * Only wall time, interval scheduling and the measured cost of a tick vary. */
async function worker(stepCostMs = 0) {
  const time = { now: 0, stepCostMs };
  const messages: FromOpenWorld[] = [];
  let pump: (() => void) | undefined;
  const scope = {
    onmessage: null as ((event: { data: ToOpenWorld }) => void) | null,
    postMessage(message: FromOpenWorld, transfer: Transferable[] = []) {
      messages.push(structuredClone(message, { transfer }));
    },
  };
  vi.spyOn(performance, 'now').mockImplementation(() => time.now);
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    pump = callback;
    return 1;
  });
  vi.resetModules();
  const { OpenWorldSimulation } = await import('../src/simulation/open-world/session.ts');
  const originalStep = OpenWorldSimulation.prototype.step;
  const steps = vi.spyOn(OpenWorldSimulation.prototype, 'step').mockImplementation(function (
    this: InstanceType<typeof OpenWorldSimulation>,
    dt,
  ) {
    originalStep.call(this, dt);
    time.now += time.stepCostMs;
  });
  const inputs = vi.spyOn(OpenWorldSimulation.prototype, 'setInput');
  await import('../src/workers/open-world.worker.ts');
  const send = (data: ToOpenWorld) => scope.onmessage!({ data });
  const init = () =>
    send({
      type: 'init',
      options: { vehicle: 'tc1', weather: 'clear', assist: 'sport', seed: 73021, discovered: [] },
    });
  const advance = (milliseconds: number) => {
    time.now += milliseconds;
    pump!();
  };
  const latestFrame = () => {
    const message = messages.filter((value) => value.type === 'frame').at(-1)!;
    return new Float32Array(message.buffer);
  };
  init();
  return { time, messages, steps, inputs, send, init, advance, latestFrame };
}

describe('festival worker fixed-step scheduling', () => {
  it('bounds a live stall to 24 fixed ticks, reports lost time and applies the stale-input brake', async () => {
    const h = await worker();
    h.send({ type: 'pause', value: false });
    h.send({ type: 'input', input: { ...controls(), throttle: 1 } });
    h.advance(10000);
    expect(h.steps).toHaveBeenCalledTimes(24);
    expect(h.steps.mock.calls.every(([dt]) => dt === 1 / 120)).toBe(true);
    expect(h.inputs).toHaveBeenLastCalledWith({ ...controls(), brake: 0.4 });
    expect(h.latestFrame()[H.TICK]).toBe(24);
    expect(h.latestFrame()[H.DROPPED]).toBeCloseTo(9.8, 5);
    expect(h.latestFrame()[carBase(0) + F.THROTTLE]).toBe(0);
    expect(h.latestFrame()[carBase(0) + F.BRAKE]).toBeCloseTo(0.4, 6);
    h.advance(4);
    expect(h.steps).toHaveBeenCalledTimes(24);
    h.advance(5);
    expect(h.steps).toHaveBeenCalledTimes(25);
    expect(h.messages.filter((message) => message.type === 'error')).toEqual([]);
  });

  it('excludes a long pause and preserves the active fractional tick', async () => {
    const h = await worker();
    h.send({ type: 'pause', value: false });
    h.advance(6);
    h.send({ type: 'pause', value: true });
    // A suspended worker receives no interval callbacks before the resume message.
    h.time.now += 90000;
    h.send({ type: 'pause', value: false });
    h.advance(2);
    expect(h.steps).not.toHaveBeenCalled();
    h.advance(1);
    expect(h.steps).toHaveBeenCalledExactlyOnceWith(1 / 120);
    h.send({ type: 'pause', value: true });
    expect(h.latestFrame()[H.TICK]).toBe(1);
    expect(h.latestFrame()[H.DROPPED]).toBe(0);
    expect(h.inputs.mock.calls.some(([input]) => input.brake === 0.4)).toBe(false);
  });

  it('yields after costly ticks and resumes without carrying whole-tick work debt', async () => {
    const h = await worker(6);
    h.send({ type: 'pause', value: false });
    h.advance(100);
    // Two atomic six-millisecond ticks cross the default 1000/120 ms budget.
    expect(h.steps).toHaveBeenCalledTimes(2);
    expect(h.steps.mock.calls.every(([dt]) => dt === 1 / 120)).toBe(true);
    expect(h.time.now).toBe(112);
    expect(h.latestFrame()[H.TICK]).toBe(2);
    expect(h.latestFrame()[H.DROPPED]).toBeCloseTo(10 / 120, 6);
    expect(h.latestFrame()[H.STEP_MS]).toBeCloseTo(0.6, 6);
    h.time.stepCostMs = 0;
    h.advance(4); // Twelve milliseconds of prior work plus four idle milliseconds.
    expect(h.steps).toHaveBeenCalledTimes(3);
    h.advance(1);
    expect(h.steps).toHaveBeenCalledTimes(4);
    expect(h.latestFrame()[H.TICK]).toBe(4);
    expect(h.latestFrame()[H.DROPPED]).toBeCloseTo(10 / 120, 6);
  });

  it('reinitializes paused with clean clock counters, fractional time and step-cost diagnostics', async () => {
    const h = await worker(6);
    h.send({ type: 'pause', value: false });
    h.advance(103);
    expect(h.steps).toHaveBeenCalledTimes(2);
    expect(h.latestFrame()[H.DROPPED]).toBeGreaterThan(0);
    expect(h.latestFrame()[H.STEP_MS]).toBeGreaterThan(0);
    h.time.now += 90000;
    h.init();
    expect(h.latestFrame()[H.TICK]).toBe(0);
    expect(h.latestFrame()[H.DROPPED]).toBe(0);
    expect(h.latestFrame()[H.STEP_MS]).toBe(0);
    h.advance(100000);
    expect(h.steps).toHaveBeenCalledTimes(2);
    h.time.stepCostMs = 0;
    h.send({ type: 'pause', value: false });
    h.advance(6);
    expect(h.steps).toHaveBeenCalledTimes(2);
    h.advance(3);
    expect(h.steps).toHaveBeenCalledTimes(3);
    h.send({ type: 'pause', value: true });
    expect(h.latestFrame()[H.TICK]).toBe(1);
    expect(h.latestFrame()[H.DROPPED]).toBe(0);
  });

  it('sends status at exact 100 ms deadlines even when every pooled frame is held', async () => {
    const h = await worker();
    expect(h.messages.map((message) => message.type)).toEqual(['ready', 'frame', 'status']);
    h.messages.length = 0;
    h.send({ type: 'pause', value: false });
    h.advance(99);
    expect(h.messages.filter((message) => message.type === 'status')).toHaveLength(0);
    h.advance(1);
    expect(h.messages.filter((message) => message.type === 'status')).toHaveLength(1);
    h.advance(0);
    expect(h.messages.filter((message) => message.type === 'status')).toHaveLength(1);
    for (let i = 1; i < 10; i++) h.advance(100);
    expect(h.messages.filter((message) => message.type === 'status')).toHaveLength(10);
    expect(h.messages.filter((message) => message.type === 'frame')).toHaveLength(3);
    expect(h.steps).toHaveBeenCalledTimes(120);
    h.send({ type: 'pause', value: true });
    expect(h.latestFrame()[H.TICK]).toBe(120);
  });

  it('delivers each event result before its batch frame and status, preserving command receipts', async () => {
    const h = await worker();
    h.send({ type: 'pause', value: false });
    h.messages.length = 0;
    h.send({ type: 'command', command: { type: 'start', event: 'valley-sprint' }, requestId: 7 });
    expect(h.messages.map((message) => message.type)).toEqual(['frame', 'status', 'command-result']);
    expect(h.messages.at(-1)).toEqual({ type: 'command-result', requestId: 7 });
    h.send({ type: 'command', command: { type: 'cancel' }, requestId: 8 });
    expect(h.messages.at(-2)?.type).toBe('status');
    expect(h.messages.at(-1)).toEqual({ type: 'command-result', requestId: 8 });
    h.messages.length = 0;
    h.advance(100);
    expect(h.messages.map((message) => message.type)).toEqual(['result', 'frame', 'status']);
    expect(h.messages[0]).toMatchObject({ type: 'result', result: { abandoned: true, entrants: 4 } });
    h.advance(100);
    expect(h.messages.filter((message) => message.type === 'result')).toHaveLength(1);
    expect(h.messages.filter((message) => message.type === 'error')).toEqual([]);
  });
});
