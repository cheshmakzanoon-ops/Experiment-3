import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PerformanceCapture, comparePerformance, summarizePerformance, readPerformanceReport,
  type FrameMetrics,
} from '../src/core/performance.ts';

// Synthetic oracle fixtures validate mathematics/exit codes, NOT hardware FPS.
const context = { machine: 'synthetic-oracle', workload: 'synthetic', configuration: '{}',
  browser: 'node-oracle', source: 'a'.repeat(64) };
const sample: FrameMetrics = { renderCPUms: 2, physicsMs: 0.4, drawCalls: 50,
  triangles: 50000, gpuMs: null, gpuSequence: 0 };
function run(frameMs: number) {
  const capture = new PerformanceCapture(0, 10000);
  capture.start(context, 0); capture.record(1, sample);
  for (let now = 1 + frameMs; capture.active; now += frameMs) capture.record(now, sample);
  return capture.report()!;
}
const good = run(20), slow = run(30);
assert.equal(good.summary.averageFPS, 50);
assert.equal(good.summary.onePercentLowFPS, 50);
assert.equal(good.summary.medianGPUms, null);
assert(comparePerformance(good, good).passed);
assert(!comparePerformance(good, slow).passed);
assert(!comparePerformance(good, { ...good, context: { ...context, machine: 'other' } }).comparable);
assert.throws(() => readPerformanceReport({ ...good, rows: [] }));
assert.throws(() => readPerformanceReport({ ...good, targetMs: undefined }));
assert.equal(summarizePerformance([[10, 1, 1, 1, 1, -1], [30, 1, 1, 1, 1, -1]]).averageFPS, 50);
const hitch = new PerformanceCapture(1000, 10000);
hitch.start(context, 0); hitch.record(1200, sample); hitch.record(6200, sample);
hitch.interrupt('visibility loss'); hitch.record(11200, sample);
assert.equal(hitch.report()!.summary.maximumFrameMs, 5000);
assert.equal(hitch.report()!.state, 'interrupted');
const dir = mkdtempSync(join(tmpdir(), 'apex-perf-'));
try {
  const a = join(dir, 'baseline.json'), b = join(dir, 'candidate.json');
  writeFileSync(a, JSON.stringify(good));
  for (const [report, expected] of [[good, 0], [slow, 1], [hitch.report()!, 2]] as const) {
    writeFileSync(b, JSON.stringify(report));
    const result = spawnSync(process.execPath, ['--experimental-transform-types',
      'scripts/performance-compare.ts', a, b], { encoding: 'utf8' });
    assert.equal(result.status, expected, result.stdout + result.stderr);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('PASS: timing mathematics, hitches, interruption, identity and regression CLI exit codes (synthetic fixtures only)');
