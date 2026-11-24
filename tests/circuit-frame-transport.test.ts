import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { CAR_STRIDE, H, HEADER, PROTOCOL_VERSION } from '../src/simulation/protocol.ts';
import type { ClientMessage, WorkerMessage } from '../src/workers/diagnostics.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Exercise the real worker, serializer and simulation. Only scheduling and
 * the transport are controlled, including legacy non-transferring consumers. */
async function worker(detach = true) {
  const time = { now: 0 };
  const transport = { failFrame: false };
  const messages: WorkerMessage[] = [];
  let pump: (() => void) | undefined;
  const scope = {
    onmessage: null as ((event: { data: ClientMessage }) => void) | null,
    postMessage(message: WorkerMessage, transfer: Transferable[] = []) {
      if (message.type === 'frame' && transport.failFrame) throw new Error('frame post failed');
      messages.push(detach ? structuredClone(message, { transfer }) : message);
    },
  };
  vi.spyOn(performance, 'now').mockImplementation(() => time.now);
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    pump = callback;
    return 1;
  });
  vi.resetModules();
  const { Simulation } = await import('../src/simulation/world.ts');
  await import('../src/workers/physics.worker.ts');
  const send = (data: ClientMessage) => scope.onmessage!({ data });
  const advance = (milliseconds: number) => {
    time.now += milliseconds;
    pump!();
  };
  const frames = () => messages.filter((message) => message.type === 'frame');
  send({ type: 'init', options: { ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice' } });
  return { messages, transport, Simulation, send, advance, frames };
}

describe('circuit snapshot transport', () => {
  it.each([false, true])(
    'rejects duplicate returns without publishing detached or aliased storage (transfer=%s)',
    async (detach) => {
      const h = await worker(detach);
      h.send({ type: 'pause', value: false, sequence: 1 });
      for (let i = 0; i < 8; i++) h.advance(20);
      expect(h.frames()).toHaveLength(5);
      const first = h.frames()[0].buffer;
      const returned = detach ? structuredClone(first, { transfer: [first] }) : first;
      h.send({ type: 'recycle', buffer: new ArrayBuffer(returned.byteLength - 4) });
      h.send({ type: 'recycle', buffer: new ArrayBuffer(returned.byteLength + 4) });
      h.send({ type: 'recycle', buffer: returned });
      h.send({ type: 'recycle', buffer: returned });
      h.advance(20);
      expect(h.frames()).toHaveLength(6);
      const frame = new Float32Array(h.frames().at(-1)!.buffer);
      expect(frame.length).toBe(HEADER + CAR_STRIDE);
      expect(frame[H.CARS]).toBe(1);
      expect(frame[H.TICK]).toBeGreaterThan(0);
      for (let i = 0; i < 8; i++) h.advance(20);
      expect(h.frames()).toHaveLength(6);
      expect(h.messages.filter((message) => message.type === 'error')).toEqual([]);
      expect(PROTOCOL_VERSION).toBe(17);
    },
  );

  it.each(['write', 'post'] as const)(
    'recovers attached buffers after repeated %s failures without acknowledging an incomplete pause',
    async (failure) => {
      const h = await worker();
      const writer =
        failure === 'write'
          ? vi.spyOn(h.Simulation.prototype, 'writeFrame').mockImplementation(() => {
              throw new Error('frame write failed');
            })
          : undefined;
      h.transport.failFrame = failure === 'post';
      for (let sequence = 1; sequence <= 8; sequence++)
        h.send({ type: 'pause', value: true, sequence });
      expect(h.messages.filter((message) => message.type === 'error')).toHaveLength(8);
      expect(h.messages.filter((message) => message.type === 'pauseState')).toEqual([]);
      expect(h.frames()).toHaveLength(1);
      writer?.mockRestore();
      h.transport.failFrame = false;
      h.send({ type: 'pause', value: false, sequence: 9 });
      for (let i = 0; i < 8; i++) h.advance(20);
      // The initial frame is still held. Every other original slot survives all
      // eight failed required snapshots and remains usable for ordinary delivery.
      expect(h.frames()).toHaveLength(5);
      expect(h.messages.filter((message) => message.type === 'error')).toHaveLength(8);
      expect(h.messages.filter((message) => message.type === 'pauseState')).toEqual([
        { type: 'pauseState', sequence: 9, value: false, tick: 0 },
      ]);
    },
  );

  it('delivers the exact flashback frame while all ordinary snapshots are held', async () => {
    const h = await worker();
    h.send({ type: 'pause', value: false, sequence: 1 });
    for (let i = 0; i < 25; i++) h.advance(20);
    expect(h.frames()).toHaveLength(5);
    const start = h.messages.length;
    h.send({ type: 'flashback', tick: 16 });
    h.advance(4);
    const batch = h.messages.slice(start);
    expect(batch.map((message) => message.type)).toEqual([
      'telemetry',
      'replayFrames',
      'flashback',
      'surface',
      'frame',
    ]);
    expect(batch[2]).toMatchObject({ type: 'flashback', tick: 16 });
    const frame = h.frames().at(-1)!;
    expect(new Float32Array(frame.buffer)[H.TICK]).toBe(16);
    expect(frame.buffer.byteLength).toBe((HEADER + CAR_STRIDE) * 4);
    expect(h.frames()).toHaveLength(6);
    h.advance(10000);
    expect(h.frames()).toHaveLength(6);
    h.send({ type: 'pause', value: true, sequence: 2 });
    expect(h.messages.at(-2)?.type).toBe('frame');
    expect(h.messages.at(-1)).toEqual({ type: 'pauseState', sequence: 2, value: true, tick: 16 });
    expect(h.messages.filter((message) => message.type === 'error')).toEqual([]);
  });
});
