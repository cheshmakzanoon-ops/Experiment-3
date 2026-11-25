import { InputLog, Resimulation, applyLoggedInput } from '../../src/core/flashback.ts';
import { DEFAULT_OPTIONS, controls } from '../../src/simulation/config.ts';
import { F, H, carBase } from '../../src/simulation/protocol.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { TelemetryRecorder } from '../../src/storage/recorders.ts';
import {
  IndexedReplayStore,
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../../src/storage/replay-pages.ts';
import { TelemetryExport } from '../../src/storage/telemetry-export.ts';
import { CHANNELS, TELEMETRY_STRIDE, telemetryCsv } from '../../src/storage/telemetry-schema.ts';

/** Only observations are added around the real private-session IndexedDB
 * store. The production recorder owns page sealing, hashing and cache reads. */
class ObservedPages implements ReplayPageStore {
  readonly native = new IndexedReplayStore();
  readonly reads: number[] = [];
  readonly writes: number[] = [];
  async put(page: ReplayPage) {
    await this.native.put(page);
    this.writes.push(page.id);
  }
  async get(id: number) {
    this.reads.push(id);
    return this.native.get(id);
  }
  dispose() {
    return this.native.dispose();
  }
}

function differentWords(a: Float32Array, b: Float32Array) {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  const left = new Uint32Array(a.buffer, a.byteOffset, a.length);
  const right = new Uint32Array(b.buffer, b.byteOffset, b.length);
  let different = 0;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) different++;
  return different;
}

async function databaseRows() {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('apex-replay-cache', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pages');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<number>((resolve, reject) => {
      const transaction = database.transaction('pages', 'readonly');
      const request = transaction.objectStore('pages').count();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function replayBoundary(target: 40 | 136 | 160) {
  const options = {
    ...DEFAULT_OPTIONS,
    mode: 'practice' as const,
    opponents: 0,
    seed: 72027,
  };
  const simulation = new Simulation(options);
  const log = new InputLog();
  applyLoggedInput(simulation, log, { ...controls(), throttle: 0.3 });
  const store = new ObservedPages();
  const notices: string[] = [];
  const replay = new SessionReplay(1, store, (message) => notices.push(message), 4);
  const original = new Map<number, Float32Array>();
  const branch = new Map<number, Float32Array>();
  const firstTick = target === 40 ? 40 : 8;
  const pageId = Math.floor((target - firstTick) / 8 / replay.pageFrames);
  let cutoff = 0;
  const report = await (async () => {
    replay.recordSurface(new Float32Array([0.1]), new Float32Array([0.2]), simulation.race.time);
    while (simulation.tick < 384) {
      simulation.step(1 / 120);
      if (simulation.tick === target) {
        cutoff = simulation.race.time;
        replay.recordSurface(new Float32Array([0.25]), new Float32Array([0.4]), cutoff);
        // Both times lie before the rounded-up pose time. Truncation must
        // nevertheless remove the later full-precision surface keyframe.
        replay.recordSurface(new Float32Array([0.9]), new Float32Array([0.8]), cutoff + 1e-10);
      }
      if (simulation.tick < firstTick || simulation.tick % 8) continue;
      const frame = simulation.makeFrame();
      simulation.writeFrame(frame);
      original.set(simulation.tick, frame);
      replay.append(frame);
      // Tiny pages expose storage boundaries quickly; native transaction
      // completion is allowed before another bounded batch is captured.
      await replay.settle();
    }
    const selected = original.get(target)!;
    const beforeRead = replay.diagnostics();
    replay.prepareSeek(selected[H.TIME] - replay.start);
    await replay.settle();
    const loadedFromDatabase = store.reads.includes(pageId);
    const couldTruncate = replay.canTruncate(cutoff);
    const truncated = replay.truncate(cutoff);
    if (!truncated) throw new Error('Native stored page rejected its simulation cutoff');
    const afterCut = { count: replay.count, end: replay.end };
    const a = replay.makeFrame();
    const b = replay.makeFrame();
    const cutAlpha = replay.sample(replay.duration, a, b);
    const cutSurface = {
      time: replay.surfaceState.time,
      water: replay.surfaceState.water[0],
    };
    const cutDifferences = differentWords(a, selected) + differentWords(b, selected);

    const rewind = new Resimulation(options, log.entries, target, { now: () => 0 });
    if (!rewind.run(1000)) throw new Error('Short native resimulation exceeded its tick budget');
    const resumed = rewind.simulation;
    const rebuilt = resumed.makeFrame();
    resumed.writeFrame(rebuilt);
    const rebuiltDifferences = differentWords(rebuilt, selected);
    log.truncate(target);
    applyLoggedInput(resumed, log, { ...controls(), brake: 0.7 });
    while (resumed.tick < target + 320) {
      resumed.step(1 / 120);
      if (resumed.tick % 8) continue;
      const frame = resumed.makeFrame();
      resumed.writeFrame(frame);
      branch.set(resumed.tick, frame);
      replay.append(frame);
      await replay.settle();
    }
    const afterBranch = replay.diagnostics();
    // Read through a fresh native transaction, independently of the page
    // retained by SessionReplay, then force SessionReplay to read it again.
    const persisted = await store.native.get(pageId);
    const expected = [...[...original].filter(([tick]) => tick <= target), ...branch];
    const expectedPage = expected.slice(
      pageId * replay.pageFrames,
      (pageId + 1) * replay.pageFrames,
    );
    let persistedDifferences = 0;
    for (let i = 0; i < expectedPage.length; i++) {
      persistedDifferences += differentWords(
        persisted.frames.subarray(i * replay.stride, (i + 1) * replay.stride),
        expectedPage[i][1],
      );
    }
    const readsBeforeReload = store.reads.length;
    replay.prepareSeek(selected[H.TIME] - replay.start);
    await replay.settle();
    const reloadedAlpha = replay.sample(selected[H.TIME] - replay.start, a, b);
    const reloadDifferences =
      differentWords(a, selected) + differentWords(b, branch.get(target + 8)!);
    const latest = replay.makeFrame();
    const next = replay.makeFrame();
    replay.sample(replay.duration, latest, next);
    return {
      target,
      firstTick,
      pageId,
      cutoff,
      poseTime: selected[H.TIME],
      roundedUp: selected[H.TIME] > cutoff,
      initiallyEvicted: !beforeRead.cached.includes(pageId),
      loadedFromDatabase,
      couldTruncate,
      truncated,
      afterCut,
      cutAlpha,
      cutSurface,
      cutDifferences,
      rebuiltDifferences,
      branchCount: replay.count,
      expectedCount: expected.length,
      evictedAgain: !afterBranch.cached.includes(pageId),
      reloadedFromDatabase: store.reads.slice(readsBeforeReload).includes(pageId),
      reloadedAlpha,
      reloadDifferences,
      persistedCount: persisted.count,
      persistedTicks: Array.from(
        { length: persisted.count },
        (_, i) => persisted.frames[i * replay.stride + H.TICK],
      ),
      expectedTicks: expectedPage.map(([tick]) => tick),
      persistedDifferences,
      persistedSurfaceTimes: persisted.surfaces.map((surface) => surface.time),
      targetPageWrites: store.writes.filter((id) => id === pageId).length,
      latestDifferences: differentWords(latest, branch.get(target + 320)!),
      latestBrake: latest[carBase(0) + F.BRAKE],
      error: replay.error,
      notices,
      rowsBeforeDisposal: await databaseRows(),
    };
  })().finally(() => replay.dispose());
  return { ...report, rowsAfterDisposal: await databaseRows() };
}

function rowValues(start: number, count: number) {
  const values = new Float32Array(count * TELEMETRY_STRIDE);
  for (let row = 0; row < count; row++)
    for (let column = 0; column < TELEMETRY_STRIDE; column++)
      values[row * TELEMETRY_STRIDE + column] =
        ((((start + row) * 17 + column * 3) % 8192) - 4096) / 64;
  return values;
}

async function sha256(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/** Observe native termination without replacing Worker or its message/event
 * machinery. The inline import adapter only constructs the actual worker. */
function observeTerminations() {
  const native = Worker.prototype.terminate;
  const calls: Worker[] = [];
  Worker.prototype.terminate = function (this: Worker) {
    calls.push(this);
    native.call(this);
  };
  return {
    calls,
    restore() {
      Worker.prototype.terminate = native;
    },
  };
}

export async function telemetryTransfer() {
  const recorder = new TelemetryRecorder(10);
  const values = rowValues(0, 843);
  recorder.appendBatch(values, 843);
  const snapshot = recorder.snapshot();
  const expectedValues = values.slice((843 - recorder.capacity) * recorder.stride);
  const expectedCsv = await telemetryCsv(expectedValues, recorder.capacity).text();
  const snapshotDifferences = differentWords(snapshot, expectedValues);
  const byteLength = snapshot.byteLength;
  const exporter = new TelemetryExport();
  const terminated = observeTerminations();
  try {
    const completion = exporter.export(snapshot, recorder.count);
    const detached = snapshot.byteLength === 0;
    recorder.appendBatch(rowValues(843, 2), 2);
    const continuing = recorder.snapshot();
    const continuingExpected = rowValues(245, recorder.capacity);
    const blob = await completion;
    const text = await blob.text();
    return {
      rows: recorder.capacity,
      columns: recorder.stride,
      byteLength,
      detached,
      snapshotDifferences,
      continuingDifferences: differentWords(continuing, continuingExpected),
      continuingBytes: continuing.byteLength,
      exactCsv: text === expectedCsv,
      csvBytes: blob.size,
      csvSha256: await sha256(new Uint8Array(await blob.arrayBuffer())),
      rowCount: text.trimEnd().split('\n').length - 1,
      headerMatches: text.slice(0, text.indexOf('\n')) === CHANNELS.join(','),
      lastRowMatches:
        text.trimEnd().split('\n').at(-1) === [...expectedValues.slice(-recorder.stride)].join(','),
      mime: blob.type,
      terminations: terminated.calls.length,
      uniqueTerminations: new Set(terminated.calls).size,
    };
  } finally {
    exporter.cancel();
    terminated.restore();
  }
}

export async function telemetryReplacement() {
  const count = 600;
  const exporter = new TelemetryExport();
  const terminated = observeTerminations();
  const first = rowValues(0, count);
  const second = rowValues(1000, count);
  const expectedSecond = await telemetryCsv(second.slice(), count).text();
  let staleSuccess = false;
  const outcome = (promise: Promise<Blob>) =>
    promise.then(
      () => 'unexpected success',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
  try {
    const retired = exporter.export(first, count).then(
      () => {
        staleSuccess = true;
        return 'unexpected success';
      },
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    const replacement = exporter.export(second, count);
    const firstDetached = first.byteLength === 0;
    const secondDetached = second.byteLength === 0;
    const [retiredMessage, replacementBlob] = await Promise.all([retired, replacement]);
    const replacementText = await replacementBlob.text();

    const cancelledValues = rowValues(2000, count);
    const cancelled = outcome(exporter.export(cancelledValues, count));
    const cancelledDetached = cancelledValues.byteLength === 0;
    exporter.cancel();
    exporter.cancel();
    const cancelledMessage = await cancelled;

    const invalidValues = rowValues(3000, 1);
    const invalid = outcome(exporter.export(invalidValues, 2));
    const invalidDetached = invalidValues.byteLength === 0;
    const invalidMessage = await invalid;

    const recoveredValues = rowValues(4000, 3);
    const expectedRecovered = await telemetryCsv(recoveredValues.slice(), 3).text();
    const recovered = await exporter.export(recoveredValues, 3);
    // Let any native message task queued around termination run before
    // reporting that the canceled result never regained its promise owner.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return {
      firstDetached,
      secondDetached,
      cancelledDetached,
      invalidDetached,
      recoveredDetached: recoveredValues.byteLength === 0,
      retiredMessage,
      cancelledMessage,
      invalidMessage,
      staleSuccess,
      replacementExact: replacementText === expectedSecond,
      replacementRows: replacementText.trimEnd().split('\n').length - 1,
      recoveredExact: (await recovered.text()) === expectedRecovered,
      terminations: terminated.calls.length,
      uniqueTerminations: new Set(terminated.calls).size,
    };
  } finally {
    exporter.cancel();
    terminated.restore();
  }
}
