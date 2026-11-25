import { GHOST_FIELDS, ghostKey, type GhostLap } from '../../src/core/ghost-lap.ts';
import { recordCategory } from '../../src/core/session-identity.ts';
import { TimeTrialRecords } from '../../src/session/time-trial-records.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../../src/simulation/protocol.ts';
import { LapTracker } from '../../src/simulation/race.ts';
import { Track } from '../../src/simulation/track.ts';
import { SaveStore } from '../../src/storage/data.ts';
import { leaderboardKey } from '../../src/storage/leaderboard.ts';
import { TelemetryRecorder } from '../../src/storage/recorders.ts';
import { TelemetryExport } from '../../src/storage/telemetry-export.ts';
import { completeLaps } from '../../src/storage/telemetry-plots.ts';
import { CHANNELS, TELEMETRY_STRIDE } from '../../src/storage/telemetry-schema.ts';

const documentId = crypto.randomUUID();
const options = { ...DEFAULT_OPTIONS, mode: 'time-trial' as const, opponents: 0 };
const bytes = (array: Float32Array) =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
function differentBytes(a: Float32Array, b: Float32Array) {
  if (a.byteLength !== b.byteLength) return Math.max(a.byteLength, b.byteLength);
  const left = bytes(a),
    right = bytes(b);
  let differences = 0;
  for (let i = 0; i < left.length; i++) differences += +(left[i] !== right[i]);
  return differences;
}
async function digest(array: Float32Array | Uint8Array) {
  const data = array instanceof Float32Array ? bytes(array) : array;
  const hash = await crypto.subtle.digest('SHA-256', data.slice().buffer);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
function deadline<T>(promise: Promise<T>, label: string) {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), 10000);
    }),
  ]).finally(() => clearTimeout(timer));
}
function firstCrossing(lap: GhostLap, distance: number) {
  const d = lap.samples;
  for (let b = GHOST_FIELDS; b < d.length; b += GHOST_FIELDS) {
    const a = b - GHOST_FIELDS;
    if (d[a + 1] <= distance && d[b + 1] >= distance && d[b + 1] > d[a + 1])
      return d[a] + ((distance - d[a + 1]) / (d[b + 1] - d[a + 1])) * (d[b] - d[a]);
  }
  throw new Error('Missing forward-crossing witness');
}

/** Prescribed poses pass through real lap timing and the application record
 * consumer. This is not a vehicle-driving or handling benchmark. */
function recordReversal(track: Track, records: TimeTrialRecords) {
  const tracker = new LapTracker(track.length, track.length - 5);
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    base = carBase(0);
  frame[H.CARS] = frame[base + F.QW] = 1;
  let distance = track.length - 5,
    time = 0,
    tick = 0,
    reverse = 0;
  let reversalStarted = false;
  for (let sample = 0; tracker.completed < 1 && sample < 1000; sample++) {
    if (!reversalStarted && distance >= track.length / 2 && distance < track.length / 2 + 20) {
      reversalStarted = true;
      reverse = 5;
    }
    const movement = reverse-- > 0 ? -10 : 10;
    distance = (distance + movement + track.length) % track.length;
    time += 0.1;
    tick += 12;
    tracker.update(distance, time, false);
    frame[H.TIME] = frame[H.RACE_TIME] = time;
    frame[H.TICK] = tick;
    frame[base + F.S] = frame[base + F.X] = distance;
    frame[base + F.Y] = 0.6;
    frame[base + F.Z] = -distance / 2;
    frame[base + F.STEER] = movement < 0 ? -0.2 : 0.2;
    frame[base + F.SPEED] = 100;
    frame[base + F.LAPS] = tracker.completed;
    frame[base + F.LAP_TIME] = tracker.lapTime;
    frame[base + F.LAST_LAP] = tracker.last;
    frame[base + F.LAP_VALID] = +tracker.valid;
    frame[base + F.LAST_LAP_VALID] = +tracker.lastValid;
    frame[base + F.LAST_LAP_ASSISTED] = +tracker.lastAssisted;
    frame[base + F.SECTOR_1] = tracker.lastSectors[0];
    frame[base + F.SECTOR_2] = tracker.lastSectors[1];
    frame[base + F.SECTOR_3] = tracker.lastSectors[2];
    records.observe(frame, true, options, 'native-records-advancement');
  }
  if (tracker.completed !== 1 || !tracker.lastValid || tracker.lastAssisted)
    throw new Error('Prescribed lap did not complete validly');
}

export async function saveReversal() {
  const track = new Track(),
    store = new SaveStore(),
    category = recordCategory(options);
  const key = ghostKey(track.circuit.id, category.vehicle);
  const boardKey = leaderboardKey(track.circuit.id, category.vehicle, category.physics);
  const notices: string[] = [];
  let saved!: () => void, ranked!: () => void;
  const savedPromise = new Promise<void>((resolve) => {
    saved = resolve;
  });
  const rankedPromise = new Promise<void>((resolve) => {
    ranked = resolve;
  });
  const records = new TimeTrialRecords({
    store,
    playerName: () => 'Native records fixture',
    toast(message) {
      notices.push(message);
      if (message.includes('GHOST SAVED')) saved();
      if (message.includes('ON THE LOCAL LEADERBOARD')) ranked();
    },
  });
  await records.prepare(options, track, () => true);
  recordReversal(track, records);
  await deadline(Promise.all([savedPromise, rankedPromise]), 'Native ghost commits');
  const player = records.player;
  if (!player) throw new Error('Completed lap produced no player');
  const lap = player.lap,
    original = lap.samples.slice();
  const stored = (await store.read(key)) as GhostLap;
  const board = (await store.read(boardKey)) as { lapTime: number }[];
  const reversed: number[] = [];
  for (let b = GHOST_FIELDS; b < original.length; b += GHOST_FIELDS)
    if (original[b + 1] < original[b - GHOST_FIELDS + 1]) reversed.push(b);
  if (!reversed.length) throw new Error('No reversal in completed ghost');
  const a = reversed[0] - GHOST_FIELDS,
    b = reversed[0];
  const witness = original[a + 1] - 15;
  const firstTime = firstCrossing(lap, witness);
  // The application stores lap time in Float32 before asking for a pose.
  const reverseTime = Math.fround((original[a] + original[b]) / 2);
  const fraction = (reverseTime - original[a]) / (original[b] - original[a]);
  const reverseStation = original[a + 1] + (original[b + 1] - original[a + 1]) * fraction;
  return {
    documentId,
    key,
    boardKey,
    circuit: lap.circuit,
    vehicle: category.vehicle,
    version: lap.version,
    physics: lap.physics,
    lapTime: lap.lapTime,
    sampleCount: player.count,
    sampleBytes: original.byteLength,
    sampleSha256: await digest(original),
    storedSha256: await digest(stored.samples),
    storedDifferences: differentBytes(stored.samples, original),
    storedIndependent: stored.samples.buffer !== lap.samples.buffer,
    reverseSegments: reversed.length,
    witness,
    firstTime,
    expectedDelta: 20 - firstTime,
    reverseTime,
    reverseStation,
    boardTimes: board.map((entry) => entry.lapTime),
    keys: await store.keys(),
    notices,
  };
}
export type SavedReversal = Awaited<ReturnType<typeof saveReversal>>;

export async function reloadReversal(saved: SavedReversal) {
  const track = new Track(),
    store = new SaveStore();
  const records = new TimeTrialRecords({ store, playerName: () => 'Reloaded fixture', toast() {} });
  await records.prepare(options, track, () => true);
  const player = records.player;
  if (!player) throw new Error('Native reload did not find its ghost');
  const original = player.lap.samples.slice();
  const stored = (await store.read(saved.key)) as GhostLap;
  const independentRead = stored.samples.buffer !== player.lap.samples.buffer;
  const readDifferences = differentBytes(stored.samples, original);
  stored.samples.fill(9999);
  const reread = (await store.read(saved.key)) as GhostLap;
  const base = carBase(0),
    probe = new Float32Array(HEADER + CAR_STRIDE);
  probe[base + F.S] = saved.witness;
  probe[base + F.LAP_TIME] = 20;
  records.observe(probe, true, options, 'reloaded-native-records');
  const hud = { ...records.trial! };
  probe[base + F.LAP_TIME] = saved.reverseTime;
  const pose = { ...records.ghostAt(probe, probe, 0.5)! };
  await records.prepare({ ...options, mode: 'qualifying' }, track, () => true);
  const qualifyingCleared = records.player === null && records.trial === null;
  await records.prepare(options, track, () => true);
  const again = records.player;
  if (!again) throw new Error('Second native read did not load the ghost');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('apex-formula');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const schema = { name: db.name, version: db.version, stores: [...db.objectStoreNames] };
  db.close();
  return {
    documentId,
    navigationType: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)
      .type,
    schema,
    key: saved.key,
    version: player.lap.version,
    lapTime: player.lap.lapTime,
    sampleCount: player.count,
    sampleSha256: await digest(original),
    independentRead,
    readDifferences,
    rereadIndependent:
      reread.samples.buffer !== stored.samples.buffer &&
      reread.samples.buffer !== player.lap.samples.buffer,
    rereadDifferences: differentBytes(reread.samples, original),
    playerUnaffectedByReadMutation: differentBytes(player.lap.samples, original) === 0,
    hud,
    firstTime: player.timeAt(saved.witness),
    pose,
    qualifyingCleared,
    reloadedAgainIndependent:
      again !== player && again.lap.samples.buffer !== player.lap.samples.buffer,
    reloadedAgainDifferences: differentBytes(again.lap.samples, original),
    retainedFirstTime: player.timeAt(saved.witness),
    keys: await store.keys(),
  };
}

export async function removeSavedRecords() {
  await deadline(
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('apex-formula');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error('Native SaveStore failed to close on versionchange'));
    }),
    'Native records cleanup',
  );
}

type CaptureReply =
  | { kind: 'telemetry' | 'replay'; buffer: ArrayBuffer; rows: number }
  | { kind: 'captured' }
  | {
      kind: 'settled';
      detached: number;
      recycled: number;
      pages: { telemetry: number; replay: number; maximum: number };
      warnings: string[];
    }
  | { kind: 'error'; message: string };

export async function closingGapExport(workerSource: string) {
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  const worker = new Worker(url, { name: 'native-records-capture' });
  URL.revokeObjectURL(url);
  const recorder = new TelemetryRecorder(10.5);
  const batches: { rows: number; first: number; last: number }[] = [];
  let returnDetached = 0,
    replayPages = 0,
    replayRows = 0;
  const cleanup = { captureTerminated: 0 };
  const exporter = new TelemetryExport();
  try {
    const captured = await deadline(
      new Promise<Extract<CaptureReply, { kind: 'settled' }>>((resolve, reject) => {
        worker.onerror = (event) => {
          event.preventDefault();
          reject(new Error(event.message));
        };
        worker.onmessageerror = () => reject(new Error('Native capture clone failed'));
        worker.onmessage = (event: MessageEvent<CaptureReply>) => {
          try {
            const message = event.data;
            if (message.kind === 'error') throw new Error(message.message);
            if (message.kind === 'captured') {
              worker.postMessage({ kind: 'settle' });
              return;
            }
            if (message.kind === 'settled') {
              resolve(message);
              return;
            }
            const { buffer, rows } = message;
            if (message.kind === 'telemetry') {
              const values = new Float32Array(buffer);
              batches.push({ rows, first: values[0], last: values[(rows - 1) * TELEMETRY_STRIDE] });
              recorder.appendBatch(values, rows);
            } else {
              replayPages++;
              replayRows += rows;
            }
            worker.postMessage({ kind: `${message.kind}-return`, buffer }, [buffer]);
            if (buffer.byteLength !== 0) throw new Error('Native recycle did not detach');
            returnDetached++;
          } catch (error) {
            reject(error);
          }
        };
        worker.postMessage({ kind: 'capture' });
      }),
      'Native capture round trip',
    );
    const head = recorder.head,
      count = recorder.count,
      retained = recorder.snapshot();
    const ranges = completeLaps(recorder, 100);
    const snapshot = recorder.snapshot();
    const originalTerminate = Worker.prototype.terminate,
      terminated: Worker[] = [];
    Worker.prototype.terminate = function () {
      terminated.push(this);
      originalTerminate.call(this);
    };
    try {
      const exporting = exporter.export(snapshot, count);
      const exportDetached = snapshot.byteLength === 0;
      const beforeContinuationDifferences = differentBytes(recorder.snapshot(), retained);
      recorder.appendBatch(new Float32Array(TELEMETRY_STRIDE).fill(123), 1);
      const blob = await exporting,
        text = await blob.text();
      const lines = text.trimEnd().split('\n'),
        header = lines.shift();
      const rows = lines.map((line) => line.split(',').map(Number));
      const exported = Float32Array.from(rows.flat());
      return {
        count,
        head,
        stride: TELEMETRY_STRIDE,
        batches,
        replayPages,
        replayRows,
        capture: {
          detached: captured.detached,
          recycled: captured.recycled,
          returnDetached,
          pages: captured.pages,
          warnings: captured.warnings,
        },
        ranges,
        exportedRanges: completeLaps(
          { count: rows.length, at: (row, column) => rows[row][column] },
          100,
        ),
        exportDetached,
        beforeContinuationDifferences,
        exportedDifferences: differentBytes(exported, retained),
        retainedSha256: await digest(retained),
        exportedSha256: await digest(exported),
        rowCount: rows.length,
        columnsMatch: rows.every((row) => row.length === TELEMETRY_STRIDE),
        headerMatches: header === CHANNELS.join(','),
        boundary: { before: rows[499][0], after: rows[500][0] },
        followingLapInvalidOpening: rows[620][CHANNELS.indexOf('lap_valid')],
        continuingLast: recorder.at(recorder.count - 1, 0),
        csvBytes: blob.size,
        csvSha256: await digest(new Uint8Array(await blob.arrayBuffer())),
        mime: blob.type,
        csvTerminations: terminated.length,
        uniqueCsvTerminations: new Set(terminated).size,
        cleanup,
      };
    } finally {
      exporter.cancel();
      Worker.prototype.terminate = originalTerminate;
    }
  } finally {
    exporter.cancel();
    worker.terminate();
    cleanup.captureTerminated++;
  }
}
