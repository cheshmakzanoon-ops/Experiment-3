import { describe, expect, it } from 'vitest';
import { CAR_STRIDE, H, HEADER } from '../src/simulation/protocol.ts';
import type { Simulation } from '../src/simulation/world.ts';
import {
  CHANNELS,
  TELEMETRY_BATCH_ROWS,
  TELEMETRY_STRIDE,
} from '../src/storage/telemetry-schema.ts';
import {
  RECORDING_TRANSPORT_INITIAL_PAGES,
  RECORDING_TRANSPORT_MAX_PAGES,
  REPLAY_TICKS,
  TelemetrySampler,
} from '../src/storage/telemetry-sampler.ts';

type Stream = 'telemetry' | 'replay';
type Delivery = { buffer: ArrayBuffer; rows: number; ticks: number[] };

function harness(stream: Stream, transfer = false) {
  const frameLength = HEADER + CAR_STRIDE;
  const deliveries: Delivery[] = [];
  const otherTicks: number[] = [];
  const warnings: string[] = [];
  const stride = stream === 'telemetry' ? TELEMETRY_STRIDE : frameLength;
  const tickColumn = stream === 'telemetry' ? CHANNELS.indexOf('tick') : H.TICK;
  const batchRows = stream === 'telemetry' ? TELEMETRY_BATCH_ROWS : 15;
  const tickInterval = stream === 'telemetry' ? 2 : REPLAY_TICKS;
  let beforeSend: (() => void) | undefined;
  let afterSend: (() => void) | undefined;
  const simulation = {
    tick: 0,
    makeFrame: () => new Float32Array(frameLength),
    writeFrame(out: Float32Array) {
      out[H.CARS] = 1;
      out[H.TICK] = this.tick;
      out[H.TIME] = this.tick / 120;
      out[H.RACE_TIME] = this.tick / 120;
    },
  };
  const send = (buffer: ArrayBuffer, rows: number) => {
    beforeSend?.();
    const received = transfer ? structuredClone(buffer, { transfer: [buffer] }) : buffer;
    const values = new Float32Array(received);
    deliveries.push({
      buffer: received,
      rows,
      ticks: Array.from({ length: rows }, (_, row) => values[row * stride + tickColumn]),
    });
    afterSend?.();
  };
  const sendOther = (buffer: ArrayBuffer, rows: number) => {
    const values = new Float32Array(buffer);
    const otherStride = stream === 'telemetry' ? frameLength : TELEMETRY_STRIDE;
    const otherTickColumn = stream === 'telemetry' ? H.TICK : CHANNELS.indexOf('tick');
    for (let row = 0; row < rows; row++)
      otherTicks.push(values[row * otherStride + otherTickColumn]);
  };
  const sampler = new TelemetrySampler(
    simulation as unknown as Simulation,
    stream === 'telemetry' ? send : sendOther,
    (message) => warnings.push(message),
    stream === 'replay' ? send : sendOther,
  );
  return {
    sampler,
    deliveries,
    otherTicks,
    warnings,
    batchRows,
    byteLength: batchRows * stride * Float32Array.BYTES_PER_ELEMENT,
    tickInterval,
    next() {
      simulation.tick += tickInterval;
      sampler.capture();
    },
    flush() {
      if (stream === 'telemetry') sampler.flush();
      else sampler.flushReplay();
    },
    recycle(buffer: ArrayBuffer) {
      if (stream === 'telemetry') sampler.recycle(buffer);
      else sampler.recycleReplay(buffer);
    },
    setBeforeSend(callback?: () => void) {
      beforeSend = callback;
    },
    setAfterSend(callback?: () => void) {
      afterSend = callback;
    },
    ticks(buffer: ArrayBuffer, rows: number) {
      const values = new Float32Array(buffer);
      return Array.from({ length: rows }, (_, row) => values[row * stride + tickColumn]);
    },
  };
}

describe.each<Stream>(['telemetry', 'replay'])('%s recording transport ownership', (stream) => {
  it('rejects duplicate returns without aliasing a later in-flight page', () => {
    const h = harness(stream);
    h.next();
    h.flush();
    h.next();
    h.flush();
    const first = h.deliveries[0].buffer;
    h.recycle(first);
    h.recycle(first);
    h.next();
    h.flush();
    const second = h.deliveries[2];
    h.next();
    h.flush();
    expect(h.deliveries[3].buffer).not.toBe(second.buffer);
    expect(h.ticks(second.buffer, second.rows)).toEqual(second.ticks);
    expect(h.sampler.transportPages[stream]).toBe(RECORDING_TRANSPORT_INITIAL_PAGES);
  });

  it('does not accept foreign, wrong-sized, or active buffers as returned pages', () => {
    const h = harness(stream);
    h.recycle(new ArrayBuffer(h.byteLength));
    h.next();
    h.flush();
    const first = h.deliveries[0].buffer;
    h.recycle(new ArrayBuffer(h.byteLength));
    h.recycle(new ArrayBuffer(h.byteLength - 4));
    h.recycle(new ArrayBuffer(h.byteLength + 4));
    h.recycle(first);
    h.next();
    h.recycle(first);
    h.flush();
    const active = h.deliveries[1];
    h.next();
    h.flush();
    expect(h.deliveries[2].buffer).not.toBe(active.buffer);
    expect(h.ticks(active.buffer, active.rows)).toEqual(active.ticks);
    for (let i = 0; i < RECORDING_TRANSPORT_INITIAL_PAGES - 2; i++) {
      h.next();
      h.flush();
    }
    expect(h.sampler.transportPages[stream]).toBe(RECORDING_TRANSPORT_INITIAL_PAGES);
    h.next();
    h.flush();
    expect(h.sampler.transportPages[stream]).toBe(RECORDING_TRANSPORT_INITIAL_PAGES + 1);
  });

  it('shrinks only once per returned page while other deliveries are still outstanding', () => {
    const h = harness(stream);
    for (let i = 0; i < 20; i++) {
      h.next();
      h.flush();
    }
    for (let i = 0; i < RECORDING_TRANSPORT_INITIAL_PAGES; i++) h.recycle(h.deliveries[i].buffer);
    for (let i = 0; i < 30; i++) h.recycle(h.deliveries[6].buffer);
    expect(h.sampler.transportPages[stream]).toBe(19);
    for (let i = 7; i < h.deliveries.length; i++) h.recycle(h.deliveries[i].buffer);
    expect(h.sampler.transportPages[stream]).toBe(RECORDING_TRANSPORT_INITIAL_PAGES);
  });

  it('round-trips detached partial pages, stays bounded during gaps, and resumes at the real tick', () => {
    const h = harness(stream, true);
    for (let i = 0; i < RECORDING_TRANSPORT_MAX_PAGES + 5; i++) {
      h.next();
      h.flush();
    }
    expect(h.deliveries).toHaveLength(RECORDING_TRANSPORT_MAX_PAGES);
    expect(h.deliveries.every((delivery) => delivery.rows === 1)).toBe(true);
    expect(h.sampler.transportPages[stream]).toBe(RECORDING_TRANSPORT_MAX_PAGES);
    expect(
      h.warnings.filter((message) =>
        message.startsWith(stream === 'telemetry' ? 'Telemetry' : 'Replay'),
      ),
    ).toEqual([expect.stringContaining(`${RECORDING_TRANSPORT_MAX_PAGES}-page transport reserve`)]);
    const first = h.deliveries[0].buffer;
    const returned = structuredClone(first, { transfer: [first] });
    expect(first.byteLength).toBe(0);
    h.recycle(new ArrayBuffer(h.byteLength - 4));
    h.recycle(returned);
    h.recycle(returned);
    h.next();
    h.flush();
    expect(returned.byteLength).toBe(0);
    expect(h.deliveries.at(-1)?.ticks).toEqual([
      (RECORDING_TRANSPORT_MAX_PAGES + 6) * h.tickInterval,
    ]);
    expect(h.sampler.transportPages[stream]).toBe(RECORDING_TRANSPORT_MAX_PAGES);
    for (const delivery of h.deliveries.slice(1)) {
      const recycled = structuredClone(delivery.buffer, { transfer: [delivery.buffer] });
      h.recycle(recycled);
      h.recycle(recycled);
    }
    expect(h.sampler.transportPages[stream]).toBe(RECORDING_TRANSPORT_INITIAL_PAGES);
  });

  it('retains a partial page for retry when delivery throws before transfer', () => {
    const h = harness(stream);
    h.next();
    h.next();
    const failure = new Error('transport unavailable');
    h.setBeforeSend(() => {
      throw failure;
    });
    for (let i = 0; i < RECORDING_TRANSPORT_MAX_PAGES + 5; i++)
      expect(() => h.flush()).toThrow(failure);
    expect(h.deliveries).toEqual([]);
    expect(h.sampler.transportPages[stream]).toBe(RECORDING_TRANSPORT_INITIAL_PAGES);
    h.setBeforeSend();
    h.flush();
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0].ticks).toEqual([h.tickInterval, 2 * h.tickInterval]);
    h.flush();
    expect(h.deliveries).toHaveLength(1);
  });

  it('retries a full failed page before appending the next captured row', () => {
    const h = harness(stream);
    const failure = new Error('transport unavailable');
    h.setBeforeSend(() => {
      throw failure;
    });
    for (let i = 0; i < h.batchRows - 1; i++) h.next();
    expect(() => h.next()).toThrow(failure);
    h.setBeforeSend();
    h.next();
    h.flush();
    expect(h.deliveries.map((delivery) => delivery.rows)).toEqual([h.batchRows, 1]);
    expect(h.deliveries.flatMap((delivery) => delivery.ticks)).toEqual(
      Array.from({ length: h.batchRows + 1 }, (_, row) => (row + 1) * h.tickInterval),
    );
  });

  it('does not resurrect a detached page when a callback throws after transfer', () => {
    const h = harness(stream, true);
    h.next();
    const failure = new Error('callback failed after posting');
    h.setAfterSend(() => {
      throw failure;
    });
    expect(() => h.flush()).toThrow(failure);
    h.setAfterSend();
    h.next();
    h.flush();
    expect(h.deliveries.map((delivery) => delivery.ticks)).toEqual([
      [h.tickInterval],
      [2 * h.tickInterval],
    ]);
    for (const delivery of h.deliveries) {
      h.recycle(structuredClone(delivery.buffer, { transfer: [delivery.buffer] }));
    }
    expect(h.sampler.transportPages[stream]).toBe(RECORDING_TRANSPORT_INITIAL_PAGES);
  });

  it('keeps the other stream sample from the tick whose full-page send fails', () => {
    const h = harness(stream);
    const failure = new Error('transport unavailable');
    h.setBeforeSend(() => {
      throw failure;
    });
    for (let i = 0; i < h.batchRows - 1; i++) h.next();
    expect(() => h.next()).toThrow(failure);
    if (stream === 'telemetry') h.sampler.flushReplay();
    else h.sampler.flush();
    expect(h.otherTicks).toEqual(Array.from({ length: 15 }, (_, row) => (row + 1) * REPLAY_TICKS));
  });
});
