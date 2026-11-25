/** Correctness-only comparison using the identical live integration workload.
 * Both roots must contain the actual production implementations and dependencies.
 * The coordinator pins the archival baseline; this runner records source hashes
 * without invoking Git. Only the compact summary is retained at --output. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

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
const testPath = join(currentRoot, 'tests/engine-network-advancement-composition.test.ts');
const testSource = readFileSync(testPath, 'utf8');
const marker = "describe('network advancement composition through live peers', () => {";
assert.equal(testSource.split(marker).length, 2, 'Integration workload marker changed');
const workload = testSource.slice(0, testSource.indexOf(marker))
  .replace("import { describe, expect, it } from 'vitest';\n", '');
const relevantFiles = [
  'src/net/server.ts', 'src/net/client.ts', 'src/net/interpolation.ts',
  'src/net/codec.ts', 'src/net/snapshot.ts', 'src/net/input.ts',
  'src/net/transport.ts', 'tests/net-helpers.ts',
];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sources = {};
const reports = {};
const scratch = mkdtempSync(join(tmpdir(), 'network-composition-proof-'));
try {
  for (const [side, root] of [['baseline', baselineRoot], ['current', currentRoot]]) {
    sources[side] = Object.fromEntries(relevantFiles.map((file) => [
      file, sha256(readFileSync(join(root, file))),
    ]));
    const runtimePath = join(scratch, `${side}.ts`);
    const reportPath = join(scratch, `${side}.json`);
    // Only the workload's module locations change. Each side imports the real
    // implementations from its own tree, including the ordinary race fixture.
    const code = workload
      .replaceAll("from '../src/", `from '${pathToFileURL(`${root}/src/`).href}`)
      .replace("from './net-helpers.ts'", `from '${pathToFileURL(`${root}/tests/net-helpers.ts`).href}'`);
    writeFileSync(runtimePath, code + `
import { writeFileSync } from 'node:fs';
const results = [17, 48177].map((seed) => {
  const result = runLiveComposition(seed);
  const packets = result.wire.map(({ peer, direction, at, channel, retained, corrupted }) => ({
    peer, direction, at, channel, corrupted, hex: Buffer.from(retained).toString('hex'),
  }));
  const peers = result.peers.map(({ playback: _playback, ...peer }) => peer);
  return {
    comparable: {
      seed, transitionTick: result.transitionTick, boundaries: result.boundaries,
      packets, peers, server: result.server, lifetime: result.lifetime,
    },
    summary: {
      seed, packets: packets.length,
      inputPackets: packets.filter((packet) => packet.direction === 'up').length,
      snapshotAttempts: packets.filter((packet) => packet.direction === 'down').length,
      inputBytes: result.wire.filter((p) => p.direction === 'up').reduce((sum, p) => sum + p.retained.length, 0),
      snapshotBytes: result.wire.filter((p) => p.direction === 'down').reduce((sum, p) => sum + p.retained.length, 0),
      transitionTick: result.transitionTick,
      worldTick: result.server.tick,
      sentSnapshots: result.server.snapshots,
      missingTicks: result.server.inputs.reduce((sum, s) => sum + s.missingTicks, 0),
      duplicatedCommands: result.server.inputs.reduce((sum, s) => sum + s.duplicates, 0),
      quietBoundaries: result.boundaries.filter((b) => b.recipients === 0).length,
      rawRewinds: result.peers[0].playback.rawRewinds,
      correctionFrames: result.peers[0].playback.correcting,
      boundedPlayback: result.peers.every((p) => p.playback.bounded),
      packetOwnership: result.wire.every((p) => p.corrupted || Buffer.from(p.data).equals(Buffer.from(p.retained))),
    },
  };
});
writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify(results));
`);
    // Separate sequential processes avoid retaining two physics module graphs.
    execFileSync(process.execPath, ['--no-warnings', '--experimental-transform-types', runtimePath], {
      stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1024 * 1024,
    });
    reports[side] = JSON.parse(readFileSync(reportPath, 'utf8'));
    for (const file of relevantFiles)
      assert.equal(sha256(readFileSync(join(root, file))), sources[side][file], `Source changed during probe: ${side}/${file}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

function firstDifference(a, b, path = '$') {
  if (Object.is(a, b)) return null;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return { path, baseline: a, current: b };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const difference = firstDifference(a[key], b[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return null;
}
const comparisons = reports.current.map((current, i) => {
  const baseline = reports.baseline[i];
  const difference = firstDifference(baseline.comparable, current.comparable);
  assert.equal(difference, null, JSON.stringify(difference));
  assert.equal(baseline.summary.packetOwnership, true);
  assert.equal(current.summary.packetOwnership, true);
  assert.equal(baseline.summary.boundedPlayback, false);
  assert.equal(current.summary.boundedPlayback, true);
  return {
    baseline: baseline.summary,
    current: current.summary,
    matchedComparableSha256: sha256(JSON.stringify(current.comparable)),
    matchedPacketSha256: sha256(JSON.stringify(current.comparable.packets)),
  };
});
assert.equal(readFileSync(testPath, 'utf8'), testSource, 'Integration workload changed during probe');
const report = {
  purpose: 'correctness only; no timing samples',
  baseline: {
    root: baselineRoot,
    suppliedCommit: '350119e8ec0606e8c5de5b3ab80df41104025679',
    commitVerification: 'Coordinator-provided pin; this runner checks file hashes without invoking Git.',
  },
  current: { root: currentRoot },
  node: process.version,
  runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  workloadSha256: sha256(testSource),
  sources,
  comparisons,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
