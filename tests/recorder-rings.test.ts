import { describe, expect, it, vi } from 'vitest';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { ReplayRecorder, TelemetryRecorder } from '../src/storage/recorders.ts';
import { CHANNELS, packTelemetry } from '../src/storage/telemetry-schema.ts';

const SESSION_TIME = CHANNELS.indexOf('session_time_s');

function telemetryData(recorder: TelemetryRecorder) {
  return (recorder as unknown as { data: Float32Array }).data;
}

/** The original row-at-a-time ring is the reference for physical write positions. */
class RowWiseTelemetry {
  readonly data: Float32Array;
  count = 0;
  head = 0;
  constructor(
    readonly capacity: number,
    readonly stride: number,
  ) {
    this.data = new Float32Array(capacity * stride);
  }
  appendBatch(batch: Float32Array, rows: number) {
    for (let row = 0; row < rows; row++) {
      this.data.set(
        batch.subarray(row * this.stride, (row + 1) * this.stride),
        this.head * this.stride,
      );
      this.head = (this.head + 1) % this.capacity;
      this.count = Math.min(this.count + 1, this.capacity);
    }
  }
  truncate(time: number) {
    const cutoff = Math.fround(time);
    let removed = 0;
    while (this.count) {
      const newest = (this.head - 1 + this.capacity) % this.capacity;
      if (this.data[newest * this.stride + SESSION_TIME] <= cutoff) break;
      this.head = newest;
      this.count--;
      removed++;
    }
    return removed;
  }
  snapshot() {
    const result = new Float32Array(this.count * this.stride);
    for (let row = 0; row < this.count; row++) {
      const physical = (this.head - this.count + row + this.capacity) % this.capacity;
      for (let column = 0; column < this.stride; column++)
        result[row * this.stride + column] = this.data[physical * this.stride + column];
    }
    return result;
  }
  csvBytes() {
    const values = this.snapshot();
    let text = CHANNELS.join(',') + '\n';
    for (let row = 0; row < this.count; row++)
      text +=
        Array.from(values.subarray(row * this.stride, (row + 1) * this.stride)).join(',') + '\n';
    return new TextEncoder().encode(text);
  }
}

function telemetryBatch(start: number, rows: number, stride: number) {
  const batch = new Float32Array(rows * stride);
  for (let row = 0; row < rows; row++) {
    batch[row * stride] = (start + row) / 60;
    for (let column = 1; column < stride; column++)
      batch[row * stride + column] =
        ((start + row) * stride + column) * (column % 2 ? 0.125 : -0.25);
    batch[row * stride + SESSION_TIME] = 6 + (start + row) / 60;
  }
  return batch;
}

function expectSameRing(recorder: TelemetryRecorder, reference: RowWiseTelemetry) {
  const snapshot = reference.snapshot();
  expect(recorder.head).toBe(reference.head);
  expect(recorder.count).toBe(reference.count);
  expect(telemetryData(recorder)).toEqual(reference.data);
  expect(recorder.snapshot()).toEqual(snapshot);
  for (let row = 0; row < recorder.count; row++) {
    expect(recorder.offset(row)).toBe(
      ((reference.head - reference.count + row + reference.capacity) % reference.capacity) *
        reference.stride,
    );
    expect(recorder.at(row, 0)).toBe(snapshot[row * reference.stride]);
  }
}

describe('diagnostic replay ring configuration', () => {
  it.each([0, -1, NaN, Infinity, -Infinity, Number.MAX_VALUE])(
    'rejects invalid duration %s before creating a ring',
    (seconds) => {
      expect(() => new ReplayRecorder(1, seconds)).toThrow('Invalid replay capacity');
    },
  );

  it.each([0, -1, 0.5, NaN, Infinity, -Infinity])(
    'rejects invalid car count %s before creating a ring',
    (cars) => {
      expect(() => new ReplayRecorder(cars, 1)).toThrow('Invalid replay car count');
    },
  );

  it('rejects an unsafe computed allocation size', () => {
    expect(() => new ReplayRecorder(Number.MAX_SAFE_INTEGER, 1)).toThrow('Invalid replay capacity');
  });

  it.each([Number.MIN_VALUE, 1 / 60, 0.1, 1.01, 2.25])(
    'rounds the %s-second window up to whole frames and wraps without partial rows',
    (seconds) => {
      const recorder = new ReplayRecorder(2, seconds);
      const capacity = Math.ceil(seconds * 15);
      const frame = recorder.makeFrame();
      frame[H.CARS] = 2;
      expect(recorder.capacity).toBe(capacity);
      expect(recorder.bytes).toBe(capacity * recorder.stride * Float32Array.BYTES_PER_ELEMENT);
      for (let i = 0; i < capacity + 5; i++) {
        frame[H.TIME] = i / 10;
        frame[carBase(0) + F.X] = i;
        frame[carBase(1) + F.X] = -i;
        recorder.append(frame);
      }
      expect(recorder.count).toBe(capacity);
      expect(recorder.head).toBe(5 % capacity);
      expect(recorder.start).toBeCloseTo(0.5, 6);
      expect(recorder.end).toBeCloseTo((capacity + 4) / 10, 6);
      const a = recorder.makeFrame();
      const b = recorder.makeFrame();
      expect(recorder.sample(-100, a, b)).toBe(0);
      expect(a[carBase(0) + F.X]).toBe(5);
      expect(a[carBase(1) + F.X]).toBe(-5);
      recorder.sample(100, a, b);
      expect(b[carBase(0) + F.X]).toBe(capacity + 4);
      expect(b[carBase(1) + F.X]).toBe(-capacity - 4);
    },
  );

  it('keeps the existing 15 Hz capture cadence and bounded interpolation', () => {
    const recorder = new ReplayRecorder(1, 1.01);
    const frame = recorder.makeFrame();
    for (let tick = 0; tick < 120; tick++) {
      frame[H.TIME] = tick / 60;
      frame[carBase(0) + F.X] = tick;
      recorder.append(frame);
    }
    expect(recorder.capacity).toBe(16);
    expect(recorder.count).toBe(16);
    expect(recorder.head).toBe(30 % 16);
    expect(recorder.start).toBeCloseTo(56 / 60, 6);
    expect(recorder.end).toBeCloseTo(116 / 60, 6);
    const a = recorder.makeFrame();
    const b = recorder.makeFrame();
    expect(recorder.sample(0.1, a, b)).toBeCloseTo(0.5, 5);
    expect(a[carBase(0) + F.X]).toBe(60);
    expect(b[carBase(0) + F.X]).toBe(64);
  });
});

describe('telemetry batch ring', () => {
  it.each([1, 1.01])(
    'matches row-wise physical storage, snapshots, CSV bytes, and flashback at %s seconds',
    async (seconds) => {
      const recorder = new TelemetryRecorder(seconds);
      const reference = new RowWiseTelemetry(recorder.capacity, recorder.stride);
      let next = 0;
      for (const rows of [
        0,
        1,
        5,
        recorder.capacity - 7,
        0,
        1,
        recorder.capacity,
        recorder.capacity + 7,
        recorder.capacity * 3 + 11,
        1,
        0,
      ]) {
        // A partial worker flush can leave unused rows at the end of its page.
        const batch = telemetryBatch(next, rows + 3, recorder.stride);
        recorder.appendBatch(batch, rows);
        reference.appendBatch(batch, rows);
        next += rows;
        expectSameRing(recorder, reference);
      }
      expect(new Uint8Array(await recorder.csv().arrayBuffer())).toEqual(reference.csvBytes());

      const cutoff = 6 + (next - 19) / 60;
      expect(recorder.truncate(cutoff)).toBe(reference.truncate(cutoff));
      expectSameRing(recorder, reference);
      const resumed = telemetryBatch(next - 18, recorder.capacity + 5, recorder.stride);
      recorder.appendBatch(resumed, recorder.capacity + 5);
      reference.appendBatch(resumed, recorder.capacity + 5);
      expectSameRing(recorder, reference);
      expect(new Uint8Array(await recorder.csv().arrayBuffer())).toEqual(reference.csvBytes());

      expect(recorder.truncate(-Infinity)).toBe(reference.truncate(-Infinity));
      expectSameRing(recorder, reference);
      const refill = telemetryBatch(0, 3, recorder.stride);
      recorder.appendBatch(refill, 3);
      reference.appendBatch(refill, 3);
      expectSameRing(recorder, reference);
    },
  );

  it('preserves single-frame tick deduplication when batches and snapshots are interleaved', () => {
    const recorder = new TelemetryRecorder(1);
    const reference = new RowWiseTelemetry(recorder.capacity, recorder.stride);
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    frame[H.TICK] = 1;
    const packed = new Float32Array(recorder.stride);
    packTelemetry(frame, packed, 0);
    recorder.append(frame);
    reference.appendBatch(packed, 1);
    const batch = telemetryBatch(1, 7, recorder.stride);
    recorder.appendBatch(batch, 7);
    reference.appendBatch(batch, 7);
    const snapshot = recorder.snapshot();
    batch.fill(999);
    recorder.append(frame);
    expectSameRing(recorder, reference);
    expect(snapshot).toEqual(recorder.snapshot());

    frame[H.TICK] = 2;
    frame[H.RACE_TIME] = 8 / 60;
    packTelemetry(frame, packed, 0);
    recorder.append(frame);
    reference.appendBatch(packed, 1);
    expectSameRing(recorder, reference);
    expect(snapshot).toHaveLength(8 * recorder.stride);
  });

  it.each([-1, 0.5, NaN, Infinity, 4])(
    'rejects invalid batch rows %s without changing the ring',
    (rows) => {
      const recorder = new TelemetryRecorder(1);
      const reference = new RowWiseTelemetry(recorder.capacity, recorder.stride);
      const batch = telemetryBatch(0, 3, recorder.stride);
      recorder.appendBatch(batch, 3);
      reference.appendBatch(batch, 3);
      expect(() => recorder.appendBatch(batch, rows)).toThrow('Invalid telemetry batch');
      expectSameRing(recorder, reference);
    },
  );

  it.each([
    { initial: 0, rows: 0, copies: 0 },
    { initial: 0, rows: 60, copies: 1 },
    { initial: 17, rows: 60, copies: 2 },
    { initial: 17, rows: 6000, copies: 2 },
  ])(
    'copies only retained rows in $copies segments for a $rows-row batch at head $initial',
    ({ initial, rows, copies }) => {
      const recorder = new TelemetryRecorder(1);
      recorder.appendBatch(telemetryBatch(0, initial, recorder.stride), initial);
      const batch = telemetryBatch(initial, rows, recorder.stride);
      const set = vi.spyOn(telemetryData(recorder), 'set');
      try {
        recorder.appendBatch(batch, rows);
        expect(set).toHaveBeenCalledTimes(copies);
        expect(set.mock.calls.reduce((total, [values]) => total + values.length, 0)).toBe(
          Math.min(rows, recorder.capacity) * recorder.stride,
        );
      } finally {
        set.mockRestore();
      }
    },
  );
});
