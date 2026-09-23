import { expect, it, vi } from 'vitest';
import { PauseHandshake, type ClientMessage, type WorkerMessage } from '../src/workers/diagnostics.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { H } from '../src/simulation/protocol.ts';

it('does not acknowledge pause before its exact final frame and ignores superseded receipts', () => {
  const pause = new PauseHandshake();
  const first = pause.request(true);
  const receipt = { type: 'pauseState' as const, sequence: first.sequence, value: true, tick: 20696 };
  expect(pause.status()).toMatchObject({ pending: true, tick: null });
  expect(() => pause.accept(receipt, 20695)).toThrow('final frame');
  expect(pause.status().pending).toBe(true);
  expect(pause.accept(receipt, 20696)).toBe(true);
  expect(pause.status()).toMatchObject({ pending: false, paused: true, tick: 20696 });
  const resume = pause.request(false);
  expect(pause.accept(receipt, 20696)).toBe(false);
  expect(pause.status().pending).toBe(true);
  expect(pause.accept({ ...receipt, sequence: resume.sequence, value: false }, 20696)).toBe(true);
  expect(pause.status()).toMatchObject({ pending: false, paused: false });
  const second = pause.request(true);
  expect(pause.accept({ ...receipt, sequence: resume.sequence, value: false }, 20700)).toBe(false);
  expect(pause.accept({ ...receipt, sequence: second.sequence, tick: 20700 }, 20700)).toBe(true);
  const copy = pause.status();
  copy.tick = -1;
  expect(pause.status().tick).toBe(20700);
});

it('rejects malformed acknowledged ticks without resolving the pending pause', () => {
  const pause = new PauseHandshake();
  const request = pause.request(true);
  for (const tick of [-1, NaN, Infinity, 0.5]) {
    expect(() =>
      pause.accept({ type: 'pauseState', sequence: request.sequence, value: true, tick }, tick),
    ).toThrow('Invalid worker pause tick');
    expect(pause.status().pending).toBe(true);
  }
});

it('matches the existing Float32 frame precision without changing recorded ticks', () => {
  const pause = new PauseHandshake();
  const request = pause.request(true);
  const tick = 16777217;
  expect(
    pause.accept({ type: 'pauseState', sequence: request.sequence, value: true, tick }, Math.fround(tick)),
  ).toBe(true);
  expect(pause.status().tick).toBe(tick);
});

it('the real worker flushes recording and sends a final frame before pause acknowledgement even with an exhausted frame pool', async () => {
  const messages: WorkerMessage[] = [];
  let now = 0;
  let pump: (() => void) | undefined;
  const scope = {
    onmessage: null as ((event: { data: ClientMessage }) => void) | null,
    postMessage(message: WorkerMessage, transfer: Transferable[] = []) {
      messages.push(structuredClone(message, { transfer }));
    },
  };
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    pump = callback;
    return 1;
  });
  try {
    vi.resetModules();
    await import('../src/workers/physics.worker.ts');
    const send = (data: ClientMessage) => scope.onmessage!({ data });
    send({ type: 'init', options: { ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice' } });
    send({ type: 'pause', value: false, sequence: 1 });
    expect(messages.at(-1)).toMatchObject({ type: 'pauseState', sequence: 1, value: false, tick: 0 });
    expect(pump).toBeDefined();
    // No frames are recycled: exercise the actual five-buffer transport limit.
    for (now = 10; now <= 1130; now += 10) pump!();
    expect(messages.filter((message) => message.type === 'frame')).toHaveLength(5);
    const beforePause = messages.length;
    send({ type: 'pause', value: true, sequence: 2 });
    const batch = messages.slice(beforePause);
    expect(batch.map((message) => message.type)).toEqual([
      'telemetry', 'replayFrames', 'frame', 'pauseState',
    ]);
    const frame = batch.at(-2);
    const receipt = batch.at(-1);
    if (frame?.type !== 'frame' || receipt?.type !== 'pauseState')
      throw new Error('Missing ordered pause frame and receipt');
    expect(receipt).toMatchObject({ sequence: 2, value: true });
    const tick = new Float32Array(frame.buffer)[H.TICK];
    expect(tick).toBe(receipt.tick);
    const afterPause = messages.length;
    for (let i = 0; i < 10; i++) {
      now += 10;
      pump!();
    }
    expect(messages).toHaveLength(afterPause);
    // A normal resume still advances the real simulation after the barrier.
    send({ type: 'recycle', buffer: frame.buffer });
    send({ type: 'pause', value: false, sequence: 3 });
    expect(messages.at(-1)).toMatchObject({ type: 'pauseState', sequence: 3, value: false, tick });
    now += 20;
    pump!();
    const resumed = messages.filter((message) => message.type === 'frame').at(-1)!;
    expect(new Float32Array(resumed.buffer)[H.TICK]).toBeGreaterThan(tick);
    expect(messages.filter((message) => message.type === 'recordingWarning' || message.type === 'error')).toEqual([]);
  } finally {
    clock.mockRestore();
    vi.unstubAllGlobals();
  }
});
