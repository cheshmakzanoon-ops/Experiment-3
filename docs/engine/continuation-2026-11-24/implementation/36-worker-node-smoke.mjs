import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Worker as Thread } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

const root = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const require = createRequire(join(root, 'package.json'));
const { build } = require('esbuild');
const temporary = mkdtempSync(join(tmpdir(), 'engine-native-worker-smoke-'));
const bundles = {};
for (const [name, path, format] of [
  ['fixture', 'e2e/fixtures/engine-native-workers.ts', 'cjs'],
  ['circuit', 'e2e/fixtures/engine-native-circuit.worker.ts', 'iife'],
  ['festival', 'e2e/fixtures/engine-native-festival.worker.ts', 'iife'],
]) {
  const result = await build({ entryPoints: [join(root, path)], bundle: true, write: false, format, platform: 'browser', target: 'es2022' });
  bundles[name] = result.outputFiles[0].text;
}
const bootstrap = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
const messageListeners = [];
globalThis.addEventListener = (name, callback) => {
 if (name !== 'message') throw new Error('Unexpected worker fixture listener: ' + name);
 messageListeners.push(callback);
};
globalThis.postMessage = (data, transfer = []) => parentPort.postMessage(data, transfer);
parentPort.on('message', (data) => {
 let stopped = false;
 const event = { data, stopImmediatePropagation() { stopped = true; } };
 for (const callback of messageListeners) {
   callback(event);
   if (stopped) return;
 }
 globalThis.onmessage?.(event);
});
`;
const sources = new Map();
const createURL = URL.createObjectURL;
const revokeURL = URL.revokeObjectURL;
URL.createObjectURL = (blob) => {
 const url = createURL(blob);
 sources.set(url, blob.text());
 return url;
};
URL.revokeObjectURL = (url) => {
 sources.delete(url);
 revokeURL(url);
};
const terminations = [];
globalThis.Worker = class NativeThreadAdapter {
 constructor(url) {
  this.terminated = false;
  sources.get(url).then((source) => {
   if (this.terminated) return;
   this.thread = new Thread(bootstrap + source, { eval: true, resourceLimits: { maxOldGenerationSizeMb: 512 } });
   this.thread.on('message', (data) => this.onmessage?.({ data }));
   this.thread.on('messageerror', () => this.onmessageerror?.());
   this.thread.on('error', (error) => this.onerror?.({ message: error.stack || String(error), preventDefault() {} }));
  });
 }
 postMessage(data, transfer = []) { this.thread.postMessage(data, transfer); }
 terminate() { this.terminated = true; if (this.thread) terminations.push(this.thread.terminate()); }
};
try {
 const module = join(temporary, 'fixture.cjs');
 writeFileSync(module, bundles.fixture);
 const fixture = require(module);
 const start = performance.now();
 const circuit = await fixture.circuitTransfers(bundles.circuit);
 await Promise.all(terminations.splice(0));
 const middle = performance.now();
 const festival = await fixture.festivalTransfers(bundles.festival);
 await Promise.all(terminations.splice(0));
 const end = performance.now();
 const report = {
  environment: { node: process.version, validation: 'Node worker_threads adapter, NOT a browser run', childHeapMiB: 512 },
  bundles: Object.fromEntries(Object.entries(bundles).map(([name, value]) => [name, Buffer.byteLength(value)])),
  elapsedMs: { circuit: middle - start, festival: end - middle },
  circuit, festival,
 };
 writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
 assert.deepEqual(circuit.errors, []);
 assert.deepEqual(circuit.stalled, { frames: 5, telemetry: 60, replay: 60, surfaces: 120 });
 assert.deepEqual(circuit.recovered, { frames: 6, telemetry: 61, replay: 61, surfaces: 120 });
 assert.deepEqual(circuit.restalled, circuit.recovered);
 assert.deepEqual(circuit.returned, { buffers: 3, detached: 3 });
 assert.deepEqual(circuit.pausedOrder, ['frame', 'pauseState']);
 assert.equal(circuit.paused.tick, 7680);
 assert.equal(circuit.coalesced.surface.captureGap, true);
 assert.deepEqual(circuit.rewound.order, ['flashback', 'surface', 'frame']);
 assert.equal(circuit.rewound.frame.tick, 60);
 assert.equal(circuit.beforeDuplicate, 122);
 assert.equal(circuit.afterDuplicate, 122);
 assert.equal(circuit.afterSecondAck, 123);
 assert.deepEqual(festival.errors, []);
 assert.equal(festival.soloFrames.length, 4);
 assert.equal(festival.raceFrames.length, 4);
 assert.equal(festival.afterOldReturn, 8);
 assert.equal(festival.afterCurrentReturn, 9);
 assert.equal(festival.afterRestall, 9);
 assert.equal(festival.shrunkFrames.length, 4);
 assert.equal(festival.afterOldRaceReturns, festival.beforeShrink + 4);
 assert.equal(festival.afterShrunkReturn, festival.afterOldRaceReturns + 1);
 assert.equal(festival.afterShrunkRestall, festival.afterShrunkReturn);
 assert.equal(festival.afterPausedAdvance, festival.pausedCount);
 assert.equal(festival.results, 1);
 for (const data of [circuit, festival]) {
  assert.equal(data.closed, true);
  assert.equal(data.pendingControls, 0);
  assert.equal(data.returned.buffers, data.returned.detached);
  for (const counts of Object.values(data.final.transfers)) assert.equal(counts.detached, counts.buffers);
 }
 console.log(JSON.stringify({ passed: true, elapsedMs: report.elapsedMs, bundles: report.bundles, circuit: { stalled: circuit.stalled, recovered: circuit.recovered, order: circuit.rewound.order, transferred: circuit.final.transfers }, festival: { solo: festival.soloFrames.length, race: festival.raceFrames.length, shrunk: festival.shrunkFrames.length, transferred: festival.final.transfers } }, null, 2));
} finally {
 await Promise.all(terminations);
 rmSync(temporary, { recursive: true, force: true });
 URL.createObjectURL = createURL;
 URL.revokeObjectURL = revokeURL;
}
