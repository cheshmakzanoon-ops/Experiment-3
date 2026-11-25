/** Correctness-only probe: import each tree's actual EngineVoices graph and run
 * the exported integration scenario in separate sequential Node processes.
 * The coordinator pins the baseline; this runner records named source hashes
 * without invoking Git. It retains only the compact summary at --output. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { deserialize } from 'node:v8';
import ts from 'typescript';

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    current: { type: 'string' },
    output: { type: 'string' },
  },
});
for (const name of ['baseline', 'current', 'output'])
  assert(values[name], 'Provide explicit --baseline, --current, and --output paths');
const baselineRoot = realpathSync(resolve(values.baseline));
const currentRoot = realpathSync(resolve(values.current));
const outputPath = resolve(values.output);
assert.notEqual(baselineRoot, currentRoot, 'Use distinct baseline and current roots');
const testPath = join(currentRoot, 'tests/engine-audio-advancement-composition.test.ts');
const testSource = readFileSync(testPath, 'utf8');
const source = ts.createSourceFile(testPath, testSource, ts.ScriptTarget.Latest, true);
const names = ['Wave', 'WaveContext', 'audioFrame', 'audioView', 'nodeRecord', 'recordVoiceRun'];
const workload = names
  .map((name) => {
    const members = source.statements.filter((node) => node.name?.getText(source) === name);
    assert.equal(members.length, 1, `Missing or duplicate workload declaration: ${name}`);
    return members[0].getText(source);
  })
  .join('\n');
const relevantFiles = [
  'src/audio/engine-voices.ts',
  'src/audio/engine-loudness.ts',
  'src/audio/sound-profiles.ts',
  'src/audio/spatial.ts',
  'src/audio/airborne-audio.ts',
  'src/audio/limiter-cue.ts',
  'src/audio/mixer.ts',
  'src/simulation/protocol.ts',
  'src/simulation/vehicles.ts',
  'src/core/math.ts',
  'tests/fake-audio.ts',
];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const runnerPath = fileURLToPath(import.meta.url);
const runnerHash = sha256(readFileSync(runnerPath));
const sources = {};
const observations = {};
const scratch = mkdtempSync(join(tmpdir(), 'audio-composition-proof-'));
try {
  for (const [side, root] of [
    ['baseline', baselineRoot],
    ['current', currentRoot],
  ]) {
    sources[side] = Object.fromEntries(
      relevantFiles.map((file) => [file, sha256(readFileSync(join(root, file)))]),
    );
    const runtimePath = join(scratch, `${side}.ts`);
    const reportPath = join(scratch, `${side}.bin`);
    const location = (path) => JSON.stringify(pathToFileURL(join(root, path)).href);
    writeFileSync(
      runtimePath,
      `
import { writeFileSync } from 'node:fs';
import { serialize } from 'node:v8';
import { EngineVoices } from ${location('src/audio/engine-voices.ts')};
import type { AudioView } from ${location('src/audio/spatial.ts')};
import { CAR_STRIDE, F, H, HEADER, R, RACE_BASE, carBase } from ${location('src/simulation/protocol.ts')};
import { vehicleIndex } from ${location('src/simulation/vehicles.ts')};
import { FakeContext, FakeParam, asContext, type FakeNode } from ${location('tests/fake-audio.ts')};
${workload}
const runs = [44100, 48000, 96000].map(rate => ({
  rate, ...recordVoiceRun(EngineVoices, rate).observations,
}));
writeFileSync(${JSON.stringify(reportPath)}, serialize(runs));
`,
    );
    execFileSync(
      process.execPath,
      ['--no-warnings', '--experimental-transform-types', runtimePath],
      {
        stdio: ['ignore', 'pipe', 'inherit'],
        maxBuffer: 1024 * 1024,
      },
    );
    observations[side] = readFileSync(reportPath);
    for (const file of relevantFiles)
      assert.equal(
        sha256(readFileSync(join(root, file))),
        sources[side][file],
        `Source changed during probe: ${side}/${file}`,
      );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// V8 serialization retains signed zero, NaN and undefined. Compare the actual
// observations before recording a digest; JSON alone could erase differences.
const baseline = deserialize(observations.baseline);
const current = deserialize(observations.current);
assert.deepStrictEqual(current, baseline);
assert.equal(observations.baseline.equals(observations.current), true);
assert.equal(
  readFileSync(testPath, 'utf8'),
  testSource,
  'Integration workload changed during probe',
);
assert.equal(sha256(readFileSync(runnerPath)), runnerHash, 'Probe runner changed during execution');
const scheduledParamEvents = current.reduce(
  (sum, run) =>
    sum +
    run.active.reduce(
      (n, node) => n + Object.values(node.params).reduce((p, param) => p + param.events.length, 0),
      0,
    ),
  0,
);
const report = {
  purpose: 'correctness only; no timing samples or rendered PCM',
  baseline: {
    root: baselineRoot,
    suppliedCommit: '350119e8ec0606e8c5de5b3ab80df41104025679',
    commitVerification:
      'Coordinator-provided pin; this runner checks named file hashes without invoking Git.',
  },
  current: { root: currentRoot },
  node: process.version,
  typescript: ts.version,
  runnerSha256: runnerHash,
  workloadSha256: sha256(testSource),
  scope:
    'Actual EngineVoices modules, actual protocol and vehicle fixtures from each tree, recording AudioContext boundaries; named hashes are not a full dependency manifest.',
  contextSampleRates: current.map((run) => run.rate),
  framesPerGraph: 12,
  voicesPerGraph: 4,
  oscillatorsPerGraph: 13,
  scheduledParamEvents,
  periodicWavesPerGraph: current.map((run) => run.waves.length),
  observationBytes: observations.current.length,
  byteIdentical: true,
  baselineSha256: sha256(observations.baseline),
  currentSha256: sha256(observations.current),
  sources,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify(
    {
      output: outputPath,
      scheduledParamEvents,
      observationBytes: report.observationBytes,
      sha256: report.currentSha256,
    },
    null,
    2,
  ),
);
