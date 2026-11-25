import { describe, expect, it, vi } from 'vitest';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { TelemetryRecorder } from '../src/storage/recorders.ts';
import { CHANNELS, packTelemetry } from '../src/storage/telemetry-schema.ts';

const SESSION_TIME = CHANNELS.indexOf('session_time_s');
const TICK = CHANNELS.indexOf('tick');

function frame(tick: number, greenAt = 6, marker = tick) {
  const values = Float32Array.from(
    { length: HEADER + CAR_STRIDE },
    (_, column) => (marker + column / 8) * (column % 2 ? -1 : 1),
  );
  values[H.TIME] = tick / 120;
  values[H.RACE_TIME] = values[H.TIME] - greenAt;
  values[H.TICK] = tick;
  values[carBase(0) + F.S] = marker;
  return values;
}

function batch(ticks: number[], greenAt = 6, markerOffset = 0) {
  const values = new Float32Array(ticks.length * CHANNELS.length);
  ticks.forEach((tick, row) => {
    packTelemetry(frame(tick, greenAt, tick + markerOffset), values, row * CHANNELS.length);
  });
  return values;
}

describe('telemetry session-clock flashback', () => {
  it.each([
    { mode: 'race', greenAt: 6 },
    { mode: 'practice', greenAt: 0 },
  ])('uses the host session time in $mode and keeps exact rows on resume', ({ greenAt }) => {
    const recorder = new TelemetryRecorder(1);
    const ticks = Array.from({ length: 11 }, (_, row) => (10 + row) * 120);
    const original = batch(ticks, greenAt);
    recorder.appendBatch(original, ticks.length);

    // GameApp passes the worker's H.TIME, not the race clock in CSV column 0.
    expect(recorder.truncate(frame(15 * 120, greenAt)[H.TIME])).toBe(5);
    expect(recorder.snapshot()).toEqual(original.slice(0, 6 * recorder.stride));
    expect(recorder.at(5, SESSION_TIME)).toBe(15);
    expect(recorder.at(5, 0)).toBe(15 - greenAt);

    const resumed = batch([16 * 120, 17 * 120, 18 * 120], greenAt, 10000);
    recorder.appendBatch(resumed, 3);
    const expected = new Float32Array(9 * recorder.stride);
    expected.set(original.subarray(0, 6 * recorder.stride));
    expected.set(resumed, 6 * recorder.stride);
    expect(recorder.snapshot()).toEqual(expected);
    expect(
      Array.from({ length: recorder.count }, (_, row) => recorder.at(row, SESSION_TIME)),
    ).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });

  it.each([12, 1204, 432012, 4320012])(
    'retains target tick %s when its packed time rounds above the worker cutoff',
    (tick) => {
      const recorder = new TelemetryRecorder(1);
      const original = batch([tick - 2, tick, tick + 2]);
      recorder.appendBatch(original, 3);
      const cutoff = tick / 120;
      expect(Math.fround(cutoff)).toBeGreaterThan(cutoff);
      expect(recorder.truncate(cutoff)).toBe(1);
      expect(recorder.at(1, TICK)).toBe(tick);
      expect(recorder.snapshot()).toEqual(original.slice(0, 2 * recorder.stride));
    },
  );

  it('cuts the wrapped tail and resumes in chronological order across another wrap', () => {
    const recorder = new TelemetryRecorder(1);
    const ticks = Array.from({ length: 90 }, (_, row) => 1200 + row * 2);
    const original = batch(ticks);
    recorder.appendBatch(original, ticks.length);
    const cutoff = original[48 * recorder.stride + SESSION_TIME];

    expect(recorder.truncate(cutoff)).toBe(41);
    expect(recorder.snapshot()).toEqual(original.slice(30 * recorder.stride, 49 * recorder.stride));

    const resumed = batch(
      Array.from({ length: 50 }, (_, row) => 1298 + row * 2),
      6,
      10000,
    );
    recorder.appendBatch(resumed, 50);
    const expected = new Float32Array(recorder.capacity * recorder.stride);
    expected.set(original.subarray(39 * recorder.stride, 49 * recorder.stride));
    expected.set(resumed, 10 * recorder.stride);
    expect(recorder.snapshot()).toEqual(expected);
    for (let row = 1; row < recorder.count; row++)
      expect(recorder.at(row, SESSION_TIME)).toBeGreaterThan(recorder.at(row - 1, SESSION_TIME));
  });

  it('deduplicates the retained tick and records a reused discarded tick after rewind', () => {
    const recorder = new TelemetryRecorder(1);
    recorder.append(frame(1200));
    recorder.append(frame(1202));
    recorder.append(frame(1204));
    const retained = recorder.snapshot().slice(0, 2 * recorder.stride);
    expect(recorder.truncate(frame(1202)[H.TIME])).toBe(1);
    recorder.append(frame(1202));
    expect(recorder.snapshot()).toEqual(retained);

    recorder.append(frame(1204, 6, 9000));
    recorder.append(frame(1204, 6, 9999));
    expect(recorder.count).toBe(3);
    expect(recorder.at(2, TICK)).toBe(1204);
    expect(recorder.at(2, 1)).toBe(9000);
    expect(recorder.truncate(Infinity)).toBe(0);
    recorder.append(frame(1204));
    expect(recorder.count).toBe(3);

    expect(recorder.truncate(-Infinity)).toBe(3);
    recorder.append(frame(1204));
    expect(recorder.count).toBe(1);
    expect(recorder.at(0, TICK)).toBe(1204);
  });
});

describe('telemetry snapshot spans', () => {
  it.each([
    { state: 'empty', rows: 0, drop: 0 },
    { state: 'partial', rows: 17, drop: 0 },
    { state: 'full', rows: 60, drop: 0 },
    { state: 'wrapped', rows: 77, drop: 0 },
    { state: 'oversized batch', rows: 187, drop: 0 },
    { state: 'truncated wrap', rows: 77, drop: 12 },
  ])('copies every value in a $state ring with at most two source views', ({ rows, drop }) => {
    const recorder = new TelemetryRecorder(1);
    const original = batch(Array.from({ length: rows }, (_, row) => 1200 + row * 2));
    recorder.appendBatch(original, rows);
    if (drop) recorder.truncate(original[(rows - drop - 1) * recorder.stride + SESSION_TIME]);
    const expected = original.slice(
      Math.max(0, rows - recorder.capacity) * recorder.stride,
      (rows - drop) * recorder.stride,
    );
    const storage = (recorder as unknown as { data: Float32Array }).data;
    const views = vi.spyOn(storage, 'subarray');
    let snapshot: Float32Array;
    try {
      snapshot = recorder.snapshot();
      expect(views.mock.calls.length).toBeLessThanOrEqual(2);
      expect(views.mock.results.reduce((total, result) => total + result.value.length, 0)).toBe(
        expected.length,
      );
    } finally {
      views.mockRestore();
    }
    expect(new Uint8Array(snapshot.buffer)).toEqual(new Uint8Array(expected.buffer));
    recorder.append(frame(9999));
    expect(new Uint8Array(snapshot.buffer)).toEqual(new Uint8Array(expected.buffer));
  });
});
