import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GHOST_FIELDS, ghostKey, type GhostLap } from '../src/core/ghost-lap.ts';
import { recordCategory } from '../src/core/session-identity.ts';
import { TimeTrialRecords } from '../src/session/time-trial-records.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { LapTracker } from '../src/simulation/race.ts';
import { Track } from '../src/simulation/track.ts';
import type { Simulation } from '../src/simulation/world.ts';
import { gameEvents, type TimeTrialLapEvent } from '../src/steam/events.ts';
import { SaveStore } from '../src/storage/data.ts';
import { DesktopMirror } from '../src/storage/desktop-mirror.ts';
import { leaderboardKey } from '../src/storage/leaderboard.ts';
import { TelemetryRecorder } from '../src/storage/recorders.ts';
import { TelemetryExport } from '../src/storage/telemetry-export.ts';
import { completeLaps } from '../src/storage/telemetry-plots.ts';
import { TelemetrySampler } from '../src/storage/telemetry-sampler.ts';
import { CHANNELS, TELEMETRY_STRIDE } from '../src/storage/telemetry-schema.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const release of cleanup.splice(0)) release();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Only the IndexedDB boundary is substituted: request-time structured clones
 * become visible at transaction completion. SaveStore and its callers are real.
 * This is not native-browser transaction-scheduling evidence. */
function clonedDatabase() {
  const committed = new Map<string, unknown>();
  const db = {
    onversionchange: null,
    onclose: null,
    close: vi.fn(),
    transaction: () => {
      const pending = new Map<string, unknown>();
      const reads: (() => void)[] = [];
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null,
        onabort: null,
        objectStore: () => ({
          get: (key: string) => {
            const request = {
              result: undefined as unknown,
              onsuccess: null as (() => void) | null,
              onerror: null,
            };
            reads.push(() => {
              request.result = structuredClone(committed.get(key));
              request.onsuccess?.();
            });
            return request;
          },
          getAllKeys: () => ({ result: [...committed.keys()], onerror: null }),
          put: (value: unknown, key: string) => pending.set(key, structuredClone(value)),
        }),
      };
      queueMicrotask(() => {
        for (const read of reads) read();
        for (const [key, value] of pending) committed.set(key, value);
        tx.oncomplete?.();
      });
      return tx;
    },
  };
  vi.spyOn(DesktopMirror, 'detect').mockReturnValue(null);
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request = { result: db, onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  return committed;
}

function sameBytes(actual: Float32Array, expected: Float32Array) {
  expect(actual.byteLength).toBe(expected.byteLength);
  expect(
    Buffer.compare(
      Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength),
      Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength),
    ),
  ).toBe(0);
}

/** One query witness, not another sweep of the first-passage algorithm. */
function firstCrossing(lap: GhostLap, distance: number) {
  const samples = lap.samples;
  for (let b = GHOST_FIELDS; b < samples.length; b += GHOST_FIELDS) {
    const a = b - GHOST_FIELDS;
    if (samples[a + 1] <= distance && samples[b + 1] >= distance && samples[b + 1] > samples[a + 1])
      return (
        samples[a] +
        ((distance - samples[a + 1]) / (samples[b + 1] - samples[a + 1])) *
          (samples[b] - samples[a])
      );
  }
  throw new Error('The witness must lie inside an observed forward segment');
}

/** Prescribed finite poses with real lap timing/gates, submitted through the
 * same TimeTrialRecords.observe boundary as accepted application snapshots. */
function lapDriver(track: Track, accept: (frame: Float32Array) => void) {
  const tracker = new LapTracker(track.length, track.length - 5);
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  const base = carBase(0);
  frame[H.CARS] = frame[base + F.QW] = 1;
  let distance = track.length - 5;
  let time = 0;
  let tick = 0;
  return (secondsPerSample: number, reverse = false) => {
    const target = tracker.completed + 1;
    let reverseSamples = 0;
    let reversalStarted = false;
    for (let sample = 0; tracker.completed < target && sample < 1000; sample++) {
      if (
        reverse &&
        !reversalStarted &&
        distance >= track.length / 2 &&
        distance < track.length / 2 + 20
      ) {
        reversalStarted = true;
        reverseSamples = 5;
      }
      const movement = reverseSamples-- > 0 ? -10 : 10;
      distance = (distance + movement + track.length) % track.length;
      time += secondsPerSample;
      tick += Math.round(secondsPerSample * 120);
      tracker.update(distance, time, false);
      frame[H.TIME] = frame[H.RACE_TIME] = time;
      frame[H.TICK] = tick;
      frame[base + F.S] = frame[base + F.X] = distance;
      frame[base + F.Y] = 0.6;
      frame[base + F.Z] = -distance / 2;
      frame[base + F.STEER] = movement < 0 ? -0.2 : 0.2;
      frame[base + F.SPEED] = Math.abs(movement) / secondsPerSample;
      frame[base + F.LAPS] = tracker.completed;
      frame[base + F.LAP_TIME] = tracker.lapTime;
      frame[base + F.LAST_LAP] = tracker.last;
      frame[base + F.LAP_VALID] = +tracker.valid;
      frame[base + F.LAST_LAP_VALID] = +tracker.lastValid;
      frame[base + F.LAST_LAP_ASSISTED] = +tracker.lastAssisted;
      frame[base + F.SECTOR_1] = tracker.lastSectors[0];
      frame[base + F.SECTOR_2] = tracker.lastSectors[1];
      frame[base + F.SECTOR_3] = tracker.lastSectors[2];
      accept(frame);
    }
    expect(tracker.completed).toBe(target);
    expect(tracker.lastValid).toBe(true);
    expect(tracker.lastAssisted).toBe(false);
    return frame;
  };
}

describe('record consumers across storage and session boundaries', () => {
  it('reloads a reversal into the live HUD and keeps cached samples private across later laps and sessions', async () => {
    const committed = clonedDatabase();
    const store = new SaveStore();
    const options = { ...DEFAULT_OPTIONS, mode: 'time-trial' as const, opponents: 0 };
    const track = new Track();
    const category = recordCategory(options);
    const key = ghostKey(track.circuit.id, category.vehicle);
    const boardKey = leaderboardKey(track.circuit.id, category.vehicle, category.physics);
    const events: TimeTrialLapEvent[] = [];
    cleanup.push(gameEvents.on('timetrial.lap', (event) => events.push(event)));
    const records = new TimeTrialRecords({
      store,
      toast: () => undefined,
      playerName: () => 'Driver',
    });
    await records.prepare(options, track, () => true);
    const drive = lapDriver(track, (frame) =>
      records.observe(frame, true, options, 'records-integration'),
    );
    drive(0.1, true);
    await vi.waitFor(() => expect(committed.get(boardKey)).toHaveLength(1));
    const originalPlayer = records.player!;
    const original = structuredClone(originalPlayer.lap);
    expect(original.version).toBe(1);
    expect(key).toBe(`ghost:v1:${track.circuit.id}`);
    expect(original.samples.length % GHOST_FIELDS).toBe(0);
    expect(committed.get(key)).toEqual(original);

    const reversed = Array.from(
      { length: originalPlayer.count - 1 },
      (_, i) => (i + 1) * GHOST_FIELDS,
    ).filter((b) => original.samples[b + 1] < original.samples[b - GHOST_FIELDS + 1]);
    expect(reversed).toHaveLength(5);
    const witness = original.samples[reversed[0] - GHOST_FIELDS + 1] - 15;
    const firstTime = firstCrossing(original, witness);

    // A new SaveStore opens the same committed database; neither its read result
    // nor validateGhost/player construction may borrow the previous live array.
    const reloaded = new TimeTrialRecords({
      store: new SaveStore(),
      toast: () => undefined,
      playerName: () => 'Driver',
    });
    await reloaded.prepare(options, track, () => true);
    expect(reloaded.player).not.toBe(originalPlayer);
    expect(reloaded.player!.lap.samples.buffer).not.toBe(originalPlayer.lap.samples.buffer);
    sameBytes(reloaded.player!.lap.samples, original.samples);
    const probe = new Float32Array(HEADER + CAR_STRIDE);
    const base = carBase(0);
    probe[base + F.S] = witness;
    probe[base + F.LAP_TIME] = 20;
    reloaded.observe(probe, true, options, 'reloaded-session');
    expect(reloaded.trial!.delta).toBe(20 - firstTime);
    expect(reloaded.trial!.best).toBe(original.lapTime);

    const a = reversed[0] - GHOST_FIELDS;
    const b = reversed[0];
    probe[base + F.LAP_TIME] = (original.samples[a] + original.samples[b]) / 2;
    const pose = reloaded.ghostAt(probe, probe, 0.5)!;
    const fraction =
      (probe[base + F.LAP_TIME] - original.samples[a]) /
      (original.samples[b] - original.samples[a]);
    expect(pose.s).toBe(
      original.samples[a + 1] + (original.samples[b + 1] - original.samples[a + 1]) * fraction,
    );
    expect(pose.x).toBe(pose.s);
    expect(pose.z).toBe(-pose.s / 2);
    expect(pose.vehicle).toBe(category.vehicle);

    drive(0.125);
    await vi.waitFor(() => expect(committed.get(boardKey)).toHaveLength(2));
    expect(records.player).toBe(originalPlayer);
    expect(committed.get(key)).toEqual(original);
    drive(0.075);
    await vi.waitFor(() => expect(committed.get(boardKey)).toHaveLength(3));
    expect(records.player).not.toBe(originalPlayer);
    expect(records.player!.lap.lapTime).toBeLessThan(original.lapTime);
    expect(records.player!.lap.samples.buffer).not.toBe(originalPlayer.lap.samples.buffer);
    sameBytes(originalPlayer.lap.samples, original.samples);
    sameBytes(reloaded.player!.lap.samples, original.samples);
    expect(originalPlayer.timeAt(witness)).toBe(firstTime);
    expect(reloaded.player!.timeAt(witness)).toBe(firstTime);
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.seconds)).toEqual([
      original.lapTime,
      (committed.get(boardKey) as { lapTime: number }[])[2].lapTime,
      records.player!.lap.lapTime,
    ]);

    const replacement = records.player!;
    const replacementSamples = replacement.lap.samples.slice();
    await records.prepare({ ...options, mode: 'qualifying' }, track, () => true);
    expect(records.player).toBeNull();
    expect(records.trial).toBeNull();
    await records.prepare(options, track, () => true);
    expect(records.player).not.toBe(replacement);
    sameBytes(records.player!.lap.samples, replacementSamples);
    sameBytes(replacement.lap.samples, replacementSamples);
    sameBytes(originalPlayer.lap.samples, original.samples);
    expect(await store.keys('ghost:')).toEqual([key]);
    expect(await store.read(key)).toEqual(records.player!.lap);
  });
});

interface CsvRequest {
  id: number;
  values: Float32Array;
  count: number;
}

describe('telemetry capture, ring and export composition', () => {
  it('preserves a closing gap at both a transport-page and CSV-chunk boundary after ring wrap', async () => {
    const recorder = new TelemetryRecorder(10.5); // 630 retained rows.
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    const base = carBase(0);
    const source = {
      get tick() {
        return frame[H.TICK];
      },
      makeFrame: () => new Float32Array(frame.length),
      writeFrame: (out: Float32Array) => out.set(frame),
    };
    const warnings: string[] = [];
    const batches: { rows: number; first: number; last: number }[] = [];
    const sampler = new TelemetrySampler(
      source as Simulation,
      (buffer, rows) => {
        const received = structuredClone(buffer, { transfer: [buffer] });
        const values = new Float32Array(received);
        batches.push({ rows, first: values[0], last: values[(rows - 1) * TELEMETRY_STRIDE] });
        recorder.appendBatch(values, rows);
        sampler.recycle(structuredClone(received, { transfer: [received] }));
      },
      (message) => warnings.push(message),
      (buffer) => {
        const received = structuredClone(buffer, { transfer: [buffer] });
        sampler.recycleReplay(structuredClone(received, { transfer: [received] }));
      },
    );
    // Seven short observed lap segments. The producer's clock deliberately skips
    // one second immediately before row 600, the first row of lap 5/page 11.
    for (let row = 0; row < 730; row++) {
      const lap = Math.floor(row / 120);
      const gap = row >= 600 ? 1 : 0;
      frame[H.TIME] = frame[H.RACE_TIME] = (row + 1) / 60 + gap;
      frame[H.TICK] = (row + 1) * 2 + gap * 120;
      frame[base + F.S] = ((row % 120) * 100) / 120;
      frame[base + F.LAPS] = lap;
      frame[base + F.LAP_TIME] = ((row % 120) + 1) / 60;
      frame[base + F.LAP_VALID] = lap === 2 || lap === 6 ? 0 : 1;
      sampler.capture();
    }
    sampler.flush();
    sampler.flushReplay();
    expect(warnings).toEqual([]);
    expect(batches.map((batch) => batch.rows)).toEqual([...Array<number>(12).fill(60), 10]);
    expect(batches[10].first - batches[9].last).toBeGreaterThan(1);
    expect(recorder.count).toBe(630);
    expect(recorder.head).toBe(100);
    expect(recorder.at(0, 1)).toBeGreaterThan(80); // Partial oldest lap.
    expect(recorder.at(500, 0) - recorder.at(499, 0)).toBeGreaterThan(1);
    const expected = [
      { lap: 1, start: 20, end: 139, valid: true },
      { lap: 2, start: 140, end: 259, valid: false },
      { lap: 3, start: 260, end: 379, valid: true },
      { lap: 5, start: 500, end: 619, valid: true },
    ];
    expect(completeLaps(recorder, 100)).toEqual(expected);
    const retained = recorder.snapshot();

    // Substitute only Worker transport; execute the production CSV worker's
    // message handler after the real export controller transfers its snapshot.
    let request: CsvRequest | null = null;
    let reply: ((event: MessageEvent<unknown>) => void) | null = null;
    const terminate = vi.fn();
    vi.stubGlobal(
      'Worker',
      class {
        set onmessage(handler: (event: MessageEvent<unknown>) => void) {
          reply = handler;
        }
        postMessage(message: CsvRequest, transfer: Transferable[]) {
          request = structuredClone(message, { transfer });
        }
        terminate = terminate;
      },
    );
    const scope = {
      onmessage: null as ((event: { data: CsvRequest }) => void) | null,
      postMessage: (data: unknown) =>
        reply?.({ data: structuredClone(data) } as MessageEvent<unknown>),
    };
    vi.stubGlobal('self', scope);
    await import('../src/workers/telemetry.worker.ts');
    const exporter = new TelemetryExport();
    cleanup.push(() => exporter.cancel());
    const snapshot = recorder.snapshot();
    const exporting = exporter.export(snapshot, recorder.count);
    expect(snapshot.byteLength).toBe(0);
    sameBytes(recorder.snapshot(), retained);
    recorder.appendBatch(new Float32Array(TELEMETRY_STRIDE).fill(123), 1);
    scope.onmessage!({ data: request! });
    const blob = await exporting;
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(terminate).toHaveBeenCalledTimes(1);
    const lines = (await blob.text()).trimEnd().split('\n');
    expect(lines.shift()).toBe(CHANNELS.join(','));
    const rows = lines.map((line) => line.split(',').map(Number));
    expect(rows).toHaveLength(630);
    expect(rows.every((row) => row.length === TELEMETRY_STRIDE)).toBe(true);
    sameBytes(Float32Array.from(rows.flat()), retained);
    expect(
      completeLaps({ count: rows.length, at: (row, column) => rows[row][column] }, 100),
    ).toEqual(expected);
    expect(rows[500][0] - rows[499][0]).toBeGreaterThan(1);
    expect(recorder.at(recorder.count - 1, 0)).toBe(123);
  });
});
