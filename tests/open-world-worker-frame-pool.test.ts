import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TRAFFIC_HEADER,
  TRAFFIC_STRIDE,
  TRAFFIC_VERSION,
} from '../src/simulation/open-world/ambient-traffic.ts';
import { CAR_STRIDE, H, HEADER } from '../src/simulation/protocol.ts';
import type { FromOpenWorld, ToOpenWorld } from '../src/workers/open-world-protocol.ts';

type Frame = Extract<FromOpenWorld, { type: 'frame' }>;
type Init = Extract<ToOpenWorld, { type: 'init' }>;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Exercise the actual worker and session. Every normal message and buffer
 * return crosses structuredClone's transfer boundary in both directions. */
async function worker(options: Init['options'] = {}) {
  let now = 0;
  let pump: (() => void) | undefined;
  let postFailure: 'before-transfer' | 'after-transfer' | undefined;
  const messages: FromOpenWorld[] = [];
  const posted: { sent: Frame; received: Frame; transfer: Transferable[] }[] = [];
  const scope = {
    onmessage: null as ((event: { data: ToOpenWorld }) => void) | null,
    postMessage(message: FromOpenWorld, transfer: Transferable[] = []) {
      const failure = message.type === 'frame' ? postFailure : undefined;
      if (message.type === 'frame') postFailure = undefined;
      if (failure === 'before-transfer') throw new Error('Injected frame post failure');
      const received = structuredClone(message, { transfer });
      messages.push(received);
      if (message.type === 'frame' && received.type === 'frame')
        posted.push({ sent: message, received, transfer });
      if (failure === 'after-transfer') throw new Error('Injected failure after frame transfer');
    },
  };
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    pump = callback;
    return 1;
  });
  vi.resetModules();
  const { OpenWorldSimulation } = await import('../src/simulation/open-world/session.ts');
  const writes = vi.spyOn(OpenWorldSimulation.prototype, 'writeFrame');
  const steps = vi.spyOn(OpenWorldSimulation.prototype, 'step');
  await import('../src/workers/open-world.worker.ts');
  const send = (data: ToOpenWorld, transfer: Transferable[] = []) =>
    scope.onmessage!({ data: structuredClone(data, { transfer }) });
  const advance = (milliseconds: number) => {
    now += milliseconds;
    pump!();
  };
  const run = (count = 8) => {
    for (let i = 0; i < count; i++) advance(20);
  };
  const frames = () => messages.filter((message): message is Frame => message.type === 'frame');
  const errors = () => messages.filter((message) => message.type === 'error');
  const recycle = (frame: Frame) => {
    const data = structuredClone(
      { type: 'recycle' as const, buffer: frame.buffer },
      { transfer: [frame.buffer] },
    );
    scope.onmessage!({ data });
    return data.buffer;
  };
  const init = () => send({
    type: 'init',
    options: { vehicle: 'tc1', weather: 'clear', assist: 'sport', seed: 73021, discovered: [], ...options },
  });
  init();
  return {
    messages,
    posted,
    writes,
    steps,
    send,
    init,
    advance,
    run,
    frames,
    errors,
    recycle,
    failNextPost(stage: 'before-transfer' | 'after-transfer') {
      postFailure = stage;
    },
    duplicateReturn(buffer: ArrayBuffer) {
      // An in-process harness can replay one worker-side identity. A real
      // second transfer of its already-detached sender would fail earlier.
      scope.onmessage!({ data: { type: 'recycle', buffer } });
    },
  };
}

describe('festival worker frame buffer ownership', () => {
  it('refills for field growth and shrink without accepting old-size returns or losing current returns', async () => {
    const h = await worker();
    const soloBytes = (HEADER + CAR_STRIDE) * 4;
    const raceBytes = (HEADER + 4 * CAR_STRIDE) * 4;
    h.send({ type: 'pause', value: false });
    h.run();
    const solo = h.frames();
    expect(solo).toHaveLength(4);
    expect(solo.every((frame) => frame.buffer.byteLength === soloBytes)).toBe(true);

    let before = h.messages.length;
    h.send({ type: 'command', command: { type: 'start', event: 'valley-sprint' }, requestId: 11 });
    expect(h.messages.slice(before).map((message) => message.type)).toEqual(['frame', 'status', 'command-result']);
    h.recycle(solo[0]);
    h.run();
    const race = h.frames().slice(solo.length);
    expect(race).toHaveLength(4);
    expect(race.every((frame) => frame.buffer.byteLength === raceBytes)).toBe(true);
    for (const frame of solo.slice(1)) h.recycle(frame);
    h.run();
    expect(h.frames()).toHaveLength(8);
    h.recycle(race[0]);
    h.run();
    expect(h.frames()).toHaveLength(9);

    h.send({ type: 'command', command: { type: 'cancel' }, requestId: 12 });
    h.advance(100);
    expect(h.messages.filter((message) => message.type === 'result')).toHaveLength(1);
    before = h.messages.length;
    const beforeShrink = h.frames().length;
    h.send({ type: 'command', command: { type: 'continue' }, requestId: 13 });
    expect(h.messages.slice(before).map((message) => message.type)).toEqual(['frame', 'status', 'command-result']);
    for (const frame of h.frames().slice(solo.length, beforeShrink))
      if (frame.buffer.byteLength) h.recycle(frame);
    h.run();
    const shrunk = h.frames().slice(beforeShrink);
    expect(shrunk).toHaveLength(4);
    expect(shrunk.every((frame) => frame.buffer.byteLength === soloBytes)).toBe(true);
    h.run();
    expect(h.frames()).toHaveLength(beforeShrink + 4);
    h.recycle(shrunk[0]);
    h.run();
    expect(h.frames()).toHaveLength(beforeShrink + 5);
    expect(h.errors()).toEqual([]);
  });

  it('ignores repeated returns of one identity while simulation and status continue under backpressure', async () => {
    const h = await worker();
    h.send({ type: 'pause', value: false });
    h.run(10);
    expect(h.frames()).toHaveLength(4);
    const returned = h.recycle(h.frames()[0]);
    h.duplicateReturn(returned);
    h.duplicateReturn(returned);
    h.run(10);
    expect(h.frames()).toHaveLength(5);
    expect(returned.byteLength).toBe(0);
    h.run(30);
    expect(h.frames()).toHaveLength(5);
    expect(h.steps).toHaveBeenCalledTimes(120);
    expect(h.steps.mock.calls.every(([dt]) => dt === 1 / 120)).toBe(true);
    expect(h.messages.filter((message) => message.type === 'status')).toHaveLength(11);
    expect(h.errors()).toEqual([]);
  });

  it('publishes required paused and travel frames with ordered receipts, then bounds returned idle storage to six', async () => {
    const h = await worker();
    expect(h.messages.map((message) => message.type)).toEqual(['ready', 'frame', 'status']);
    h.send({ type: 'pause', value: false });
    h.run(10);
    expect(h.frames()).toHaveLength(4);
    let before = h.messages.length;
    h.send({ type: 'pause', value: true });
    expect(h.messages.slice(before).map((message) => message.type)).toEqual(['frame', 'status']);
    expect(new Float32Array(h.frames().at(-1)!.buffer)[H.TICK]).toBe(24);
    before = h.messages.length;
    h.send({ type: 'command', command: { type: 'travel', event: 'valley-sprint' }, requestId: 21 });
    expect(h.messages.slice(before).map((message) => message.type)).toEqual(['frame', 'status', 'command-result']);
    expect(h.messages.at(-1)).toEqual({ type: 'command-result', requestId: 21 });
    for (let i = 0; i < 3; i++) h.send({ type: 'pause', value: true });
    const held = h.frames();
    expect(held).toHaveLength(9);
    for (const frame of held) h.recycle(frame);
    h.send({ type: 'pause', value: false });
    h.run(15);
    expect(h.frames()).toHaveLength(held.length + 6);
    h.run();
    expect(h.frames()).toHaveLength(held.length + 6);
    expect(h.errors()).toEqual([]);
  });

  it.each(['write', 'post'] as const)('keeps %s failure terminal and restarts with a fresh bounded pool', async (failure) => {
    const h = await worker();
    const failedBuffers: ArrayBufferLike[] = [];
    const bytes = (HEADER + CAR_STRIDE) * 4;
    for (let i = 0; i < 5; i++) {
      if (failure === 'write') h.writes.mockImplementationOnce(() => { throw new Error('Injected frame write failure'); });
      else h.failNextPost('before-transfer');
      h.send({ type: 'pause', value: false });
      h.advance(20);
      failedBuffers.push(h.writes.mock.calls.at(-1)![0].buffer);
      expect(failedBuffers.at(-1)!.byteLength).toBe(bytes);
      const steps = h.steps.mock.calls.length;
      h.send({ type: 'pause', value: false });
      h.advance(20);
      expect(h.steps).toHaveBeenCalledTimes(steps);
      expect(h.errors()).toHaveLength(i + 1);
      expect(h.frames()).toHaveLength(i + 1);
      if (i < 4) h.init();
    }
    expect(h.errors()).toHaveLength(5);
    expect(failedBuffers.every((buffer) => buffer.byteLength === bytes)).toBe(true);
    h.init();
    h.send({ type: 'pause', value: false });
    h.run();
    expect(h.frames()).toHaveLength(9); // five failed-session frames + four fresh credits
    h.run();
    expect(h.frames()).toHaveLength(9);
    expect(h.errors()).toHaveLength(5);
  });

  it('does not revive after a transferred post failure and recycles only after a fresh init', async () => {
    const h = await worker();
    h.failNextPost('after-transfer');
    h.send({ type: 'pause', value: false });
    h.advance(20);
    expect(h.frames()).toHaveLength(2);
    expect(h.errors()).toHaveLength(1);
    const failedPost = h.posted.at(-1)!;
    expect(failedPost.sent.buffer.byteLength).toBe(0);
    expect(failedPost.received.buffer.byteLength).toBe((HEADER + CAR_STRIDE) * 4);
    const steps = h.steps.mock.calls.length;
    h.send({ type: 'pause', value: false });
    h.run();
    expect(h.frames()).toHaveLength(2);
    expect(h.steps).toHaveBeenCalledTimes(steps);
    h.recycle(h.frames()[1]);
    h.run();
    expect(h.frames()).toHaveLength(2);
    expect(h.steps).toHaveBeenCalledTimes(steps);
    expect(failedPost.received.buffer.byteLength).toBe(0);
    h.init();
    h.send({ type: 'pause', value: false });
    h.run();
    expect(h.frames()).toHaveLength(6); // two old frames + four new credits
    h.recycle(h.frames()[2]);
    h.run();
    expect(h.frames()).toHaveLength(7);
    expect(h.errors()).toHaveLength(1);
  });

  it('transfers ambient traffic with its matching main frame and recycles only main-frame storage', async () => {
    const h = await worker({ traffic: true });
    h.send({ type: 'pause', value: false });
    let paired: Frame | undefined;
    for (let i = 0; i < 30 && !paired; i++) {
      h.advance(20);
      paired = h.frames().find((frame) => frame.buffer.byteLength > 0 && frame.traffic);
      if (!paired) for (const frame of h.frames()) if (frame.buffer.byteLength) h.recycle(frame);
    }
    expect(paired).toBeDefined();
    const main = new Float32Array(paired!.buffer);
    const traffic = new Float32Array(paired!.traffic!);
    expect(traffic[0]).toBeGreaterThan(0);
    expect(traffic.length).toBe(TRAFFIC_HEADER + traffic[0] * TRAFFIC_STRIDE);
    expect(traffic[1]).toBe(main[H.TIME]);
    expect(traffic[2]).toBe(TRAFFIC_VERSION);
    const post = h.posted.find((entry) => entry.received === paired)!;
    expect(post.transfer).toEqual([post.sent.buffer, post.sent.traffic]);
    expect(post.sent.buffer.byteLength).toBe(0);
    expect(post.sent.traffic!.byteLength).toBe(0);
    const trafficBytes = paired!.traffic!.byteLength;
    const returned = h.recycle(paired!);
    h.send({ type: 'pause', value: true });
    expect(returned.byteLength).toBe(0);
    expect(paired!.traffic!.byteLength).toBe(trafficBytes);
    const latest = h.frames().at(-1)!;
    expect(latest.traffic).toBeDefined();
    expect(new Float32Array(latest.traffic!)[1]).toBe(new Float32Array(latest.buffer)[H.TIME]);
    expect(h.errors()).toEqual([]);
  });
});
