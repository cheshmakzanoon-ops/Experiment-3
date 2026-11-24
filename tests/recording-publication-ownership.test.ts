import { describe, expect, it } from 'vitest';
import { CAR_STRIDE, H, HEADER } from '../src/simulation/protocol.ts';
import type { Simulation } from '../src/simulation/world.ts';
import { CHANNELS, TELEMETRY_STRIDE } from '../src/storage/telemetry-schema.ts';
import {
  RECORDING_TRANSPORT_INITIAL_PAGES,
  RECORDING_TRANSPORT_MAX_PAGES,
  REPLAY_TICKS,
  TelemetrySampler,
} from '../src/storage/telemetry-sampler.ts';

type Stream = 'telemetry' | 'replay';
type Delivery = { buffer: ArrayBuffer; rows: number; ticks: number[]; transferred: boolean };

const transfer = (buffer: ArrayBuffer) => structuredClone(buffer, { transfer: [buffer] });

function harness(stream: Stream) {
  const frameLength = HEADER + CAR_STRIDE;
  const stride = stream === 'telemetry' ? TELEMETRY_STRIDE : frameLength;
  const column = stream === 'telemetry' ? CHANNELS.indexOf('tick') : H.TICK;
  const interval = stream === 'telemetry' ? 2 : REPLAY_TICKS;
  const deliveries: Delivery[] = [];
  const warnings: string[] = [];
  const otherTicks: number[] = [];
  const simulation = {
    tick: 0,
    makeFrame: () => new Float32Array(frameLength),
    writeFrame(out: Float32Array) {
      out[H.CARS] = 1;
      out[H.TICK] = this.tick;
      out[H.TIME] = this.tick / 120;
    },
  };
  const ticks = (buffer: ArrayBuffer, rows: number) => {
    const values = new Float32Array(buffer);
    return Array.from({ length: rows }, (_, row) => values[row * stride + column]);
  };
  const retain = (buffer: ArrayBuffer, rows: number, transferred = false) => {
    const received = transferred ? transfer(buffer) : buffer;
    deliveries.push({ buffer: received, rows, ticks: ticks(received, rows), transferred });
  };
  let send: (buffer: ArrayBuffer, rows: number) => void = retain;
  const sendOther = (buffer: ArrayBuffer, rows: number) => {
    const values = new Float32Array(buffer);
    const otherStride = stream === 'telemetry' ? frameLength : TELEMETRY_STRIDE;
    const otherColumn = stream === 'telemetry' ? H.TICK : CHANNELS.indexOf('tick');
    for (let row = 0; row < rows; row++) otherTicks.push(values[row * otherStride + otherColumn]);
    if (stream === 'telemetry') sampler.recycleReplay(buffer);
    else sampler.recycle(buffer);
  };
  const sampler = new TelemetrySampler(
    simulation as unknown as Simulation,
    stream === 'telemetry' ? (buffer, rows) => send(buffer, rows) : sendOther,
    (message) => warnings.push(message),
    stream === 'replay' ? (buffer, rows) => send(buffer, rows) : sendOther,
  );
  return {
    sampler,
    interval,
    deliveries,
    warnings,
    otherTicks,
    ticks,
    retain,
    next() {
      simulation.tick += interval;
      sampler.capture();
    },
    flush() {
      if (stream === 'telemetry') sampler.flush();
      else sampler.flushReplay();
    },
    flushOther() {
      if (stream === 'telemetry') sampler.flushReplay();
      else sampler.flush();
    },
    recycle(buffer: ArrayBuffer) {
      if (stream === 'telemetry') sampler.recycle(buffer);
      else sampler.recycleReplay(buffer);
    },
    setSend(callback: (buffer: ArrayBuffer, rows: number) => void = retain) {
      send = callback;
    },
  };
}

/** Outstanding and failed batches must each consume exactly one pool page. */
function checkCapacityAndReturns(h: ReturnType<typeof harness>, stream: Stream) {
  const remaining = RECORDING_TRANSPORT_MAX_PAGES - h.deliveries.length;
  for (let i = 0; i < remaining; i++) {
    h.next();
    h.flush();
  }
  expect(h.deliveries).toHaveLength(RECORDING_TRANSPORT_MAX_PAGES);
  expect(new Set(h.deliveries.map(({ buffer }) => buffer)).size).toBe(
    RECORDING_TRANSPORT_MAX_PAGES,
  );
  expect(h.sampler.transportPages[stream]).toBe(RECORDING_TRANSPORT_MAX_PAGES);
  h.next();
  h.flush();
  expect(h.deliveries).toHaveLength(RECORDING_TRANSPORT_MAX_PAGES);
  expect(h.warnings).toEqual([
    expect.stringContaining(`${RECORDING_TRANSPORT_MAX_PAGES}-page transport reserve`),
  ]);
  for (const delivery of h.deliveries) {
    expect(h.ticks(delivery.buffer, delivery.rows)).toEqual(delivery.ticks);
    const returned = delivery.transferred ? transfer(delivery.buffer) : delivery.buffer;
    h.recycle(returned);
    h.recycle(returned);
  }
  expect(h.sampler.transportPages[stream]).toBe(RECORDING_TRANSPORT_INITIAL_PAGES);
  const prior = h.deliveries.length;
  for (let i = 0; i < RECORDING_TRANSPORT_INITIAL_PAGES; i++) {
    h.next();
    h.flush();
  }
  expect(h.deliveries).toHaveLength(prior + RECORDING_TRANSPORT_INITIAL_PAGES);
  expect(h.sampler.transportPages[stream]).toBe(RECORDING_TRANSPORT_INITIAL_PAGES);
  h.next();
  h.flush();
  expect(h.sampler.transportPages[stream]).toBe(RECORDING_TRANSPORT_INITIAL_PAGES + 1);
}

describe.each<Stream>(['telemetry', 'replay'])('%s recording publication ownership', (stream) => {
  it.each([1, 3])(
    'preserves the newest attached publication after %i older callbacks fail',
    (depth) => {
      const h = harness(stream);
      const failure = new Error('older send failed');
      const identities: ArrayBuffer[] = [];
      h.setSend((buffer, rows) => {
        identities.push(buffer);
        if (identities.length > depth) {
          h.retain(buffer, rows);
          return;
        }
        h.recycle(buffer);
        h.next();
        h.next();
        try {
          h.flush();
        } catch (error) {
          expect(error).toBe(failure);
        }
        throw failure;
      });
      h.next();
      expect(() => h.flush()).toThrow(failure);
      expect(new Set(identities).size).toBe(1);
      const latest = h.deliveries[0];
      expect(latest.ticks).toEqual([2 * depth * h.interval, (2 * depth + 1) * h.interval]);
      h.setSend();
      h.next();
      h.flush();
      expect(h.deliveries[1].buffer).not.toBe(latest.buffer);
      expect(h.ticks(latest.buffer, latest.rows)).toEqual(latest.ticks);
      checkCapacityAndReturns(h, stream);
    },
  );

  it.each(['new transfer', 'synchronous round trip'] as const)(
    'keeps ownership through a %s followed by an older throw',
    (mode) => {
      const h = harness(stream);
      const failure = new Error('older send failed after transfer');
      let original: ArrayBuffer | undefined;
      h.setSend((buffer, rows) => {
        if (original) {
          h.retain(buffer, rows, mode === 'new transfer');
          return;
        }
        original = buffer;
        const returned = mode === 'synchronous round trip' ? transfer(transfer(buffer)) : buffer;
        h.recycle(returned);
        h.recycle(returned);
        h.next();
        h.next();
        h.flush();
        throw failure;
      });
      h.next();
      expect(() => h.flush()).toThrow(failure);
      expect(original!.byteLength).toBe(0);
      expect(h.deliveries[0].ticks).toEqual([2 * h.interval, 3 * h.interval]);
      h.setSend();
      checkCapacityAndReturns(h, stream);
    },
  );

  it('retries the newest failed republication without restoring the older row count', () => {
    const h = harness(stream);
    const failure = new Error('new send failed');
    let first = true;
    h.setSend((buffer) => {
      if (first) {
        first = false;
        h.recycle(buffer);
        h.next();
        h.next();
        h.flush();
      }
      throw failure;
    });
    h.next();
    expect(() => h.flush()).toThrow(failure);
    for (let i = 0; i < 3; i++) expect(() => h.flush()).toThrow(failure);
    h.setSend();
    h.next();
    h.flush();
    expect(h.deliveries.map(({ ticks }) => ticks)).toEqual([
      [2 * h.interval, 3 * h.interval, 4 * h.interval],
    ]);
    checkCapacityAndReturns(h, stream);
  });

  it.each(['flush', 'capture'] as const)(
    'preserves the older failed batch and newer partial page when %s triggers retry',
    (retry) => {
      const h = harness(stream);
      const failure = new Error('send failed with newer samples staged');
      let reenter = true;
      h.setSend(() => {
        if (reenter) {
          reenter = false;
          h.next();
          h.next();
        }
        throw failure;
      });
      h.next();
      h.next();
      for (let i = 0; i < 3; i++) expect(() => h.flush()).toThrow(failure);
      h.setSend();
      if (retry === 'capture') h.next();
      h.flush();
      expect(h.deliveries.map(({ ticks }) => ticks)).toEqual([
        [h.interval, 2 * h.interval],
        [3 * h.interval, 4 * h.interval],
        ...(retry === 'capture' ? [[5 * h.interval]] : []),
      ]);
      h.flushOther();
      expect(h.otherTicks).toEqual(
        stream === 'telemetry'
          ? [REPLAY_TICKS]
          : Array.from(
              { length: retry === 'capture' ? 5 : 4 },
              (_, index) => (index + 1) * h.interval,
            ),
      );
      checkCapacityAndReturns(h, stream);
    },
  );

  it('retries an older batch without reclaiming a newer independent batch already delivered', () => {
    const h = harness(stream);
    const failure = new Error('older send failed after a newer delivery');
    let first = true;
    h.setSend((buffer, rows) => {
      if (first) {
        first = false;
        h.next();
        h.flush();
        throw failure;
      }
      h.retain(buffer, rows);
    });
    h.next();
    expect(() => h.flush()).toThrow(failure);
    h.setSend();
    h.flush();
    // A callback can deliver a newer batch before the older failure is known;
    // preserving that consumer's ownership cannot retroactively reorder it.
    expect(h.deliveries.map(({ ticks }) => ticks)).toEqual([[2 * h.interval], [h.interval]]);
    checkCapacityAndReturns(h, stream);
  });

  it.each([3, RECORDING_TRANSPORT_MAX_PAGES - 1])(
    'preserves every captured row through %i nested independent failures within the pool bound',
    (depth) => {
      const h = harness(stream);
      const failure = new Error('nested independent send failed');
      let attempts = 0;
      h.setSend(() => {
        attempts++;
        h.next();
        if (attempts < depth) expect(() => h.flush()).toThrow(failure);
        throw failure;
      });
      h.next();
      expect(() => h.flush()).toThrow(failure);
      expect(h.sampler.transportPages[stream]).toBe(
        Math.max(RECORDING_TRANSPORT_INITIAL_PAGES, depth + 1),
      );
      h.setSend();
      h.flush();
      expect(h.deliveries.map(({ ticks }) => ticks)).toEqual(
        Array.from({ length: depth + 1 }, (_, index) => [(index + 1) * h.interval]),
      );
      checkCapacityAndReturns(h, stream);
    },
  );

  it('keeps ordinary partial-page retries appendable without allocating another page', () => {
    const h = harness(stream);
    const failure = new Error('nonreentrant send failed');
    const attempted: ArrayBuffer[] = [];
    h.setSend((buffer) => {
      attempted.push(buffer);
      throw failure;
    });
    h.next();
    expect(() => h.flush()).toThrow(failure);
    h.next();
    expect(() => h.flush()).toThrow(failure);
    expect(new Set(attempted).size).toBe(1);
    h.setSend();
    h.flush();
    expect(h.deliveries[0].buffer).toBe(attempted[0]);
    expect(h.deliveries[0].ticks).toEqual([h.interval, 2 * h.interval]);
    expect(h.sampler.transportPages[stream]).toBe(RECORDING_TRANSPORT_INITIAL_PAGES);
    checkCapacityAndReturns(h, stream);
  });
});
