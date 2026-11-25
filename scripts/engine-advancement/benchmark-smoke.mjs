/** Harness correctness only; this command never collects workload timings. */
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  ORIGINAL_BASELINE,
  median,
  prepareModule,
  runPaired,
  seeded,
  sha256,
  writeReport,
} from './benchmark-support.mjs';

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    current: { type: 'string' },
    output: { type: 'string' },
  },
});
for (const option of ['baseline', 'current', 'output'])
  assert(values[option], `Required: --${option} /absolute/path`);
assert.equal(median([9, 1, 5]), 5);
assert.equal(median([9, 1, 7, 3]), 5);
const one = seeded(0),
  two = seeded(0);
for (let i = 0; i < 16; i++) assert.equal(one(), two());

const sources = {};
for (const side of ['baseline', 'current']) {
  sources[side] = await prepareModule({
    root: values[side],
    entry: 'src/core/math.ts',
    expectedCommit: side === 'baseline' ? ORIGINAL_BASELINE : undefined,
  });
}
assert.equal(
  sources.baseline.identity.files['src/core/math.ts'].sha256,
  sources.current.identity.files['src/core/math.ts'].sha256,
  'Smoke uses an unchanged real pure module',
);
const report = await runPaired({
  name: 'unchanged core math harness smoke',
  sources,
  workloadFile: fileURLToPath(import.meta.url),
  seed: 0x24f,
  purpose: 'smoke',
  warmupPairs: 2,
  samplePairs: 3,
  iterations: 1,
  unitsPerIteration: 64,
  scope: {
    timedWork:
      'No workload durations: the smoke invokes the actual smooth/clamp exports over 64 values per side/pair.',
    setupWork:
      'Seed and allocate one input and one output Float64Array per side/pair; import real modules before pairs.',
    allocationScope:
      'Input/output buffers and checksum work are outside run(); run() fills the existing output.',
    limitations:
      'Harness correctness only. The unchanged pure module establishes no engine feature or performance result.',
  },
  prepare({ api, random }) {
    return {
      api,
      input: Float64Array.from({ length: 64 }, () => random() * 20 - 10),
      output: new Float64Array(64),
    };
  },
  run({ api, input, output }) {
    for (let i = 0; i < input.length; i++)
      output[i] = api.smooth(-4, 4, input[i]) + api.clamp(input[i], -1, 1);
    return output;
  },
  observe(output) {
    const bytes = Buffer.from(output.buffer, output.byteOffset, output.byteLength);
    return { bytes, checksum: sha256(bytes) };
  },
  compare(baseline, current) {
    return {
      equal: baseline.bytes.equals(current.bytes),
      checksums: { baseline: baseline.checksum, current: current.checksum },
      comparedBytes: baseline.bytes.length,
    };
  },
});
// Exercise the complete-graph fresh loader separately, without timing or
// invoking an optimized production workload. Distinct classes prove evaluation.
const bundled = await prepareModule({
  root: values.baseline,
  entry: 'src/core/math.ts',
  expectedCommit: ORIGINAL_BASELINE,
  mode: 'bundle',
});
const first = await bundled.load({ fresh: true }),
  second = await bundled.load({ fresh: true });
assert.notEqual(first, second);
assert.notEqual(first.Vec3, second.Vec3);
bundled.assertStable();
report.freshModuleSmoke = {
  source: bundled.identity,
  distinctNamespaces: true,
  distinctVec3Constructors: true,
};
assert.equal(report.equivalence.passed, true);
assert.equal(report.timing.validForComparison, false);
assert.equal(report.timing.medianMs, null);
assert.deepEqual(
  report.samples.map((row) => row.order),
  [
    ['baseline', 'current'],
    ['current', 'baseline'],
    ['baseline', 'current'],
  ],
);
for (const row of [...report.warmups, ...report.samples]) {
  assert.equal(row.baseline.elapsedMs, null);
  assert.equal(row.current.elapsedMs, null);
}
writeReport(values.output, report);
process.stdout.write(
  JSON.stringify({
    output: values.output,
    equivalentPairs: report.equivalence.checkedPairs,
    comparedBytes: [...report.warmups, ...report.samples].reduce(
      (total, row) => total + row.equivalence.comparedBytes,
      0,
    ),
    workloadTimingsCollected: false,
    freshModuleSmoke: true,
  }) + '\n',
);
