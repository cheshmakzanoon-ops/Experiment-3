/** One actual-source CSV export per fresh process. The parent owns pairing. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { CHANNELS, TelemetryRecorder, telemetryCsv } from 'engine:subject';
import { appendCsvRows, compareCsvStream } from './engine-followup-telemetry.fixture.mjs';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.ok(['timing', 'observe'].includes(config.kind));
assert.ok(config.capacity >= 600 && config.capacity <= 54000);
assert.equal(typeof globalThis.gc, 'function');
const memory = () => ({
  ...process.memoryUsage(),
  processMaxRssKiB: process.resourceUsage().maxRSS,
});
const collect = () => {
  globalThis.gc();
  globalThis.gc();
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytesOf = (values) => new Uint8Array(values.buffer, values.byteOffset, values.byteLength);

const recorder =
  config.capacity === 54000 ? new TelemetryRecorder() : new TelemetryRecorder(config.capacity / 60);
assert.equal(recorder.capacity, config.capacity);
assert.equal(recorder.stride, 228);
appendCsvRows(recorder, 0, config.capacity + 243);
const input = recorder.snapshot();
const inputSha256 = digest(bytesOf(input));
const ringSha256 = digest(bytesOf(recorder.data));
const warmups = [];
for (let index = 0; index < config.warmups; index++) {
  const started = performance.now();
  const blob = telemetryCsv(input.subarray(0, 600 * recorder.stride), 600);
  warmups.push({ elapsedMs: performance.now() - started, bytes: blob.size });
}
collect();

const constructorSamples = [];
const NativeBlob = globalThis.Blob;
if (config.kind === 'observe') {
  globalThis.Blob = class ObservedBlob extends NativeBlob {
    constructor(parts = [], options) {
      // Do not retain part references: observation must not keep CSV strings alive.
      const metadata = {
        index: constructorSamples.length,
        finalAssembly: options?.type === 'text/csv;charset=utf-8',
        partCount: parts.length,
        stringPartCount: 0,
        stringCodeUnits: 0,
        largestStringCodeUnits: 0,
        blobPartCount: 0,
        blobBytes: 0,
      };
      for (const part of parts) {
        if (typeof part === 'string') {
          metadata.stringPartCount++;
          metadata.stringCodeUnits += part.length;
          metadata.largestStringCodeUnits = Math.max(metadata.largestStringCodeUnits, part.length);
        } else {
          assert.ok(part instanceof NativeBlob);
          metadata.blobPartCount++;
          metadata.blobBytes += part.size;
        }
      }
      const before = memory();
      super(parts, options);
      constructorSamples.push({ ...metadata, before, after: memory(), outputBytes: this.size });
    }
  };
}

const beforeExport = memory();
let blob;
let elapsedMs;
try {
  const started = performance.now();
  blob = telemetryCsv(input, config.capacity);
  elapsedMs = performance.now() - started;
} finally {
  globalThis.Blob = NativeBlob;
}
const immediatelyAfterExport = memory();
assert.equal(blob.type, 'text/csv;charset=utf-8');
const outputBytes = blob.size;
collect();
const afterGcWithRingInputAndBlob = memory();
assert.equal(blob.size, outputBytes);

// Exact comparison and hashing begin only after the export timing/memory phase.
const startedVerification = performance.now();
const hash = createHash('sha256');
const exact = {
  ...(await compareCsvStream(blob, CHANNELS, 243, config.capacity, (chunk) => hash.update(chunk))),
  sha256: hash.digest('hex'),
};
if (config.capacity === 54000) {
  assert.equal(exact.comparedBytes, 115038761);
  assert.equal(exact.sha256, 'cfc38f4dd65c878d824866c817e65511b1287161c525e3c8cafaed9bf7ad0d9b');
}
const verificationMs = performance.now() - startedVerification;
const afterVerification = memory();
assert.equal(digest(bytesOf(input)), inputSha256);
assert.equal(digest(bytesOf(recorder.data)), ringSha256);
blob = null;
await setImmediate();
collect();
const afterBlobReleaseGc = memory();

const sampledMaxima = {};
const exportSamples = [beforeExport, immediatelyAfterExport];
for (const sample of constructorSamples) exportSamples.push(sample.before, sample.after);
for (const metric of [
  'rss',
  'heapUsed',
  'heapTotal',
  'external',
  'arrayBuffers',
  'processMaxRssKiB',
])
  sampledMaxima[metric] = Math.max(...exportSamples.map((sample) => sample[metric]));

const result = {
  role: config.role,
  kind: config.kind,
  measuredAt: new Date().toISOString(),
  capacity: config.capacity,
  stride: recorder.stride,
  input: {
    startRow: 243,
    ringBytes: recorder.data.byteLength,
    snapshotBytes: input.byteLength,
    ringSha256,
    snapshotSha256: inputSha256,
    headerSha256: digest(CHANNELS.join(',') + '\n'),
  },
  warmups,
  uninstrumentedElapsedMs: config.kind === 'timing' ? elapsedMs : null,
  observedElapsedMsNotForLatencyComparison: config.kind === 'observe' ? elapsedMs : null,
  outputBytes,
  mime: 'text/csv;charset=utf-8',
  beforeExport,
  immediatelyAfterExport,
  afterGcWithRingInputAndBlob,
  constructorSamples,
  exportPhaseSampledMaxima: sampledMaxima,
  exact,
  verificationMs,
  afterVerification,
  afterBlobReleaseGc,
  processLifetimeMaxRssKiB: process.resourceUsage().maxRSS,
  retainedAtEnd: { ringBytes: recorder.data.byteLength, snapshotBytes: input.byteLength },
  limits: [
    'Node/V8 memory categories overlap; rss, heapUsed, external and arrayBuffers must not be added.',
    'Sampled memory maxima are not exact peak live memory; process max RSS is a process-lifetime high-water mark.',
    'The immediately-after-export process max RSS precedes verification, but includes fixture construction and 600-row warmups.',
    'Instrumented Blob-boundary samples are separate from uninstrumented latency comparisons.',
    'Completed Blob payload still scales with output size; no constant-memory or browser-memory claim.',
  ],
};
writeFileSync(config.output, JSON.stringify(result, null, 2) + '\n');
process.stdout.write(
  JSON.stringify({
    role: result.role,
    kind: result.kind,
    ms: result.uninstrumentedElapsedMs,
    bytes: result.outputBytes,
    exportMaxRssKiB: immediatelyAfterExport.processMaxRssKiB,
  }) + '\n',
);
