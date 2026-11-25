import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import * as baseline from "engine:baseline";
import * as current from "engine:current";
import {
  appendCsvRows,
  compareCsvStream,
  fillSnapshotRows,
} from "./engine-followup-telemetry.fixture.mjs";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(typeof global.gc, "function", "Run with --expose-gc");
assert.deepEqual(baseline.CHANNELS, current.CHANNELS);
assert.equal(current.TELEMETRY_STRIDE, 228);
const stride = current.TELEMETRY_STRIDE;
const sessionColumn = current.CHANNELS.indexOf("session_time_s");
const tickColumn = current.CHANNELS.indexOf("tick");
const bytes = (array) =>
  Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const sha256 = (array) =>
  createHash("sha256").update(bytes(array)).digest("hex");
const memory = () => ({ ...process.memoryUsage() });
const collect = () => {
  global.gc();
  global.gc();
};
let sink = 0;

function statistics(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    median:
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0],
    max: sorted.at(-1),
    samples: sorted.length,
  };
}

function fixture(engine, capacity, state) {
  const recorder = new engine.TelemetryRecorder(capacity / 60);
  assert.equal(recorder.capacity, capacity);
  let logical = [];
  let nextSerial = 0;
  const batch = new Float32Array(60 * stride);
  function append(start, rows, branch = 0) {
    for (let offset = 0; offset < rows; offset += 60) {
      const count = Math.min(60, rows - offset);
      fillSnapshotRows(
        batch,
        start + offset,
        count,
        stride,
        sessionColumn,
        tickColumn,
        branch,
      );
      recorder.appendBatch(batch, count);
      for (let row = 0; row < count; row++)
        logical.push({ serial: start + offset + row, branch });
    }
    if (logical.length > capacity) logical = logical.slice(-capacity);
    nextSerial = start + rows;
  }
  if (state !== "empty") {
    const initial =
      state === "unwrapped-partial"
        ? Math.floor(capacity * 0.6)
        : state === "unwrapped-full"
          ? capacity
          : capacity + Math.floor(capacity / 3);
    append(0, initial);
    if (state.startsWith("truncated")) {
      const drop = Math.floor(capacity / 4);
      const cutoff = logical[logical.length - drop - 1].serial / 64;
      assert.equal(recorder.truncate(cutoff), drop);
      logical.length -= drop;
      nextSerial = logical.at(-1).serial + 1;
      if (state === "truncated-resumed")
        append(nextSerial, Math.floor(capacity / 2), 1);
    }
  }
  assert.equal(recorder.count, logical.length);
  return {
    recorder,
    append,
    get logical() {
      return logical;
    },
    get nextSerial() {
      return nextSerial;
    },
  };
}

function validateSnapshot(snapshot, logical) {
  assert.equal(snapshot.length, logical.length * stride);
  const expected = new Float32Array(stride);
  for (let row = 0; row < logical.length; row++) {
    const record = logical[row];
    fillSnapshotRows(
      expected,
      record.serial,
      1,
      stride,
      sessionColumn,
      tickColumn,
      record.branch,
    );
    assert.ok(
      bytes(snapshot)
        .subarray(row * stride * 4, (row + 1) * stride * 4)
        .equals(bytes(expected)),
      `Snapshot row ${row} differs from the independent chronological model`,
    );
  }
}

function measureSnapshot(recorder, iterations) {
  collect();
  const started = performance.now();
  for (let i = 0; i < iterations; i++) {
    const value = recorder.snapshot();
    sink += value.length ? value[(i * 37) % value.length] : 0;
  }
  const elapsedMs = performance.now() - started;
  return { elapsedMs, perSnapshotMs: elapsedMs / iterations, iterations };
}

function countSnapshotOperations(recorder) {
  const nativeSet = Float32Array.prototype.set;
  const nativeSubarray = Float32Array.prototype.subarray;
  const nativeOffset = recorder.offset;
  const operations = {
    setCalls: 0,
    sourceViewCalls: 0,
    copiedFloat32Values: 0,
    viewedFloat32Values: 0,
    offsetCalls: 0,
  };
  Float32Array.prototype.set = function (source, offset) {
    operations.setCalls++;
    operations.copiedFloat32Values += source.length;
    return nativeSet.call(this, source, offset);
  };
  Float32Array.prototype.subarray = function (start, end) {
    const result = nativeSubarray.call(this, start, end);
    operations.sourceViewCalls++;
    operations.viewedFloat32Values += result.length;
    return result;
  };
  recorder.offset = function (row) {
    operations.offsetCalls++;
    return nativeOffset.call(this, row);
  };
  try {
    const snapshot = recorder.snapshot();
    operations.outputBytes = snapshot.byteLength;
    operations.outputIndependentOfRing =
      snapshot.buffer !== recorder.data.buffer;
    assert.equal(operations.copiedFloat32Values, snapshot.length);
    assert.equal(operations.viewedFloat32Values, snapshot.length);
  } finally {
    Float32Array.prototype.set = nativeSet;
    Float32Array.prototype.subarray = nativeSubarray;
    delete recorder.offset;
  }
  return operations;
}

function verifyIndependence(value) {
  const retained = value.recorder.snapshot();
  const originalHash = sha256(retained);
  const start = value.nextSerial;
  // Overwrite every physical ring slot while the earlier snapshot stays alive.
  const appendedRows = value.recorder.capacity + 17;
  value.append(start, appendedRows, 2);
  assert.equal(sha256(retained), originalHash);
  assert.notEqual(retained.buffer, value.recorder.data.buffer);
  const continuing = value.recorder.snapshot();
  validateSnapshot(continuing, value.logical);
  return {
    appendedRows,
    allRingSlotsOverwritten: true,
    retainedSha256: originalHash,
    unchangedBytes: retained.byteLength,
    continuingRows: value.recorder.count,
    continuingSha256: sha256(continuing),
    independentBuffer: true,
  };
}

function snapshotFixture() {
  const before = fixture(baseline, config.capacity, config.state);
  const after = fixture(current, config.capacity, config.state);
  assert.equal(before.recorder.head, after.recorder.head);
  const exact = (() => {
    const oldValues = before.recorder.snapshot();
    const newValues = after.recorder.snapshot();
    assert.ok(
      bytes(oldValues).equals(bytes(newValues)),
      "Committed implementations differ byte-for-byte",
    );
    validateSnapshot(oldValues, before.logical);
    validateSnapshot(newValues, after.logical);
    return {
      bytesCompared: oldValues.byteLength,
      differingBytes: 0,
      sha256: sha256(oldValues),
      rows: before.recorder.count,
      physicalHead: before.recorder.head,
      firstPhysicalRow: before.recorder.count
        ? before.recorder.offset(0) / stride
        : null,
    };
  })();
  collect();
  const warmups = [];
  for (let i = 0; i < config.warmups; i++) {
    const order = i % 2 ? ["current", "baseline"] : ["baseline", "current"];
    const pair = { pair: i, order };
    for (const role of order)
      pair[role] = measureSnapshot(
        role === "baseline" ? before.recorder : after.recorder,
        config.iterations,
      );
    warmups.push(pair);
  }
  const pairs = [];
  for (let i = 0; i < config.pairs; i++) {
    const order = i % 2 ? ["current", "baseline"] : ["baseline", "current"];
    const pair = { pair: i, order };
    for (const role of order)
      pair[role] = measureSnapshot(
        role === "baseline" ? before.recorder : after.recorder,
        config.iterations,
      );
    pair.ratioBaselineOverCurrent =
      pair.baseline.perSnapshotMs / pair.current.perSnapshotMs;
    pairs.push(pair);
  }
  const counts = {
    baseline: countSnapshotOperations(before.recorder),
    current: countSnapshotOperations(after.recorder),
  };
  assert.ok(counts.current.sourceViewCalls <= 2);
  assert.equal(counts.baseline.sourceViewCalls, exact.rows);
  const independence = {
    baseline: verifyIndependence(before),
    current: verifyIndependence(after),
  };
  collect();
  return {
    kind: "snapshot",
    capacity: config.capacity,
    state: config.state,
    stride,
    ringBytesPerRecorder: config.capacity * stride * 4,
    exact,
    warmups,
    pairs,
    summaryMs: {
      baseline: statistics(pairs.map((pair) => pair.baseline.perSnapshotMs)),
      current: statistics(pairs.map((pair) => pair.current.perSnapshotMs)),
      pairedBaselineOverCurrent: statistics(
        pairs.map((pair) => pair.ratioBaselineOverCurrent),
      ),
    },
    operationsUntimed: counts,
    independenceUntimed: independence,
    memoryAfterGc: memory(),
    processMaxRssKiB: process.resourceUsage().maxRSS,
    sink,
  };
}

function observeBlobConstruction(callback) {
  const NativeBlob = globalThis.Blob;
  let observation;
  globalThis.Blob = class ObservedBlob extends NativeBlob {
    constructor(parts, options) {
      const retainedStringCodeUnits = parts.reduce(
        (sum, part) => sum + part.length,
        0,
      );
      const largestStringCodeUnits = Math.max(
        ...parts.map((part) => part.length),
      );
      const beforeNativeConstructor = memory();
      super(parts, options);
      observation = {
        parts: parts.length,
        retainedStringCodeUnits,
        largestStringCodeUnits,
        beforeNativeConstructor,
        afterNativeConstructor: memory(),
        outputBytes: this.size,
      };
    }
  };
  try {
    return { blob: callback(), observation };
  } finally {
    globalThis.Blob = NativeBlob;
  }
}

async function csvFixture() {
  const recorder = new current.TelemetryRecorder(config.capacity / 60);
  appendCsvRows(recorder, 0, config.capacity + 243);
  const input = recorder.snapshot();
  assert.equal(input.byteLength, config.capacity * stride * 4);
  const retainedInput = {
    rows: recorder.count,
    stride,
    ringBytes: recorder.data.byteLength,
    snapshotBytes: input.byteLength,
    combinedTypedPayloadBytes: recorder.data.byteLength + input.byteLength,
  };
  // This is a same-code cost characterization: the committed CSV source blob is
  // identical at both refs, so there is deliberately no claimed CSV speedup.
  const warmups = [];
  const tiny = input.subarray(0, Math.min(600, config.capacity) * stride);
  for (let i = 0; i < config.warmups; i++) {
    const start = performance.now();
    const blob = current.telemetryCsv(tiny, tiny.length / stride);
    warmups.push({
      rows: tiny.length / stride,
      elapsedMs: performance.now() - start,
      outputBytes: blob.size,
    });
  }
  collect();
  const runs = [];
  let exact;
  for (let i = 0; i < config.csvRepeats; i++) {
    collect();
    const memoryBefore = memory();
    const started = performance.now();
    let blob = current.telemetryCsv(input, config.capacity);
    const elapsedMs = performance.now() - started;
    const memoryImmediatelyAfter = memory();
    const outputBytes = blob.size;
    if (i === 0) {
      const hash = createHash("sha256");
      exact = {
        ...(await compareCsvStream(
          blob,
          current.CHANNELS,
          243,
          config.capacity,
          (chunk) => hash.update(chunk),
        )),
        sha256: hash.digest("hex"),
      };
    }
    collect();
    const memoryAfterGcWithInputRingAndBlob = memory();
    assert.equal(blob.size, outputBytes);
    blob = null;
    collect();
    runs.push({
      run: i,
      elapsedMs,
      outputBytes,
      memoryBefore,
      memoryImmediatelyAfter,
      memoryAfterGcWithInputRingAndBlob,
      memoryAfterBlobReleaseGc: memory(),
    });
  }
  collect();
  let observed = observeBlobConstruction(() =>
    current.telemetryCsv(input, config.capacity),
  );
  const construction = observed.observation;
  assert.equal(construction.parts, 1 + Math.ceil(config.capacity / 500));
  assert.equal(
    construction.retainedStringCodeUnits,
    construction.outputBytes,
    "Fixture is ASCII",
  );
  collect();
  construction.afterGcWithInputRingAndBlob = memory();
  assert.equal(observed.blob.size, construction.outputBytes);
  observed = null;
  collect();
  return {
    kind: "csv-node",
    capacity: config.capacity,
    retainedInput,
    warmups,
    runs,
    elapsedMs: statistics(runs.map((run) => run.elapsedMs)),
    exact,
    blobConstructionUntimed: construction,
    memoryAfterGc: memory(),
    stillLiveRingBytes: recorder.data.byteLength,
    stillLiveSnapshotBytes: input.byteLength,
    processMaxRssKiB: process.resourceUsage().maxRSS,
    limits: [
      "Node/V8 only; these are not browser worker memory measurements.",
      "process.memoryUsage samples and process max RSS are not exact per-export peak live bytes.",
      "All completed CSV strings remain in the production chunks array until Blob construction.",
      "The 216000-row configured maximum is reported arithmetically, not allocated or timed.",
    ],
  };
}

const result =
  config.kind === "snapshot" ? snapshotFixture() : await csvFixture();
writeFileSync(config.output, JSON.stringify(result, null, 2) + "\n");
process.stdout.write(
  JSON.stringify({
    kind: result.kind,
    capacity: result.capacity,
    state: result.state,
    medianMs: result.summaryMs ?? result.elapsedMs,
    outputBytes: result.exact.bytesCompared ?? result.exact.comparedBytes,
  }) + "\n",
);
