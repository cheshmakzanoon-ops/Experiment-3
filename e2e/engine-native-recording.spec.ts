import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/engine-native-recording.ts';

type NativeWindow = Window & { EngineNativeRecording: typeof Fixture };
let fixture: string;

test.beforeAll(async () => {
  const worker = await build({
    entryPoints: [resolve('src/workers/telemetry.worker.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
  });
  const workerSource = worker.outputFiles[0].text;
  const result = await build({
    entryPoints: [resolve('e2e/fixtures/engine-native-recording.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'EngineNativeRecording',
    platform: 'browser',
    target: 'es2022',
    plugins: [
      {
        name: 'native-telemetry-inline-worker',
        setup(builder) {
          builder.onResolve({ filter: /telemetry\.worker\.ts\?worker&inline$/ }, () => ({
            path: 'native-telemetry-worker',
            namespace: 'native-worker',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'native-worker' }, () => ({
            loader: 'js',
            // Adapt Vite's constructor import to esbuild while retaining the
            // unchanged production worker and the browser's native Worker API.
            contents: `export default class InlineTelemetryWorker {
            constructor(options) {
              const url = URL.createObjectURL(new Blob([${JSON.stringify(workerSource)}], { type: 'text/javascript' }));
              try { return new Worker(url, options); }
              finally { URL.revokeObjectURL(url); }
            }
          }`,
          }));
        },
      },
    ],
  });
  fixture = result.outputFiles[0].text;
});

async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_recording__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native engine recording</title>',
    }),
  );
  await page.goto('/__engine_native_recording__');
  await page.addScriptTag({ content: fixture });
  return errors;
}

for (const target of [40, 136, 160] as const) {
  test(`native IndexedDB branch retains the selected Float32 pose at tick ${target}`, async ({
    page,
  }, info) => {
    const errors = await load(page);
    const report = await page.evaluate(
      (tick) => (window as unknown as NativeWindow).EngineNativeRecording.replayBoundary(tick),
      target,
    );
    expect(report.roundedUp).toBe(true);
    expect(report.poseTime).toBe(Math.fround(report.cutoff));
    expect(report.initiallyEvicted).toBe(true);
    expect(report.loadedFromDatabase).toBe(true);
    expect(report.couldTruncate).toBe(true);
    expect(report.truncated).toBe(true);
    expect(report.afterCut).toEqual({
      count: (target - report.firstTick) / 8 + 1,
      end: report.poseTime,
    });
    expect(report.cutAlpha).toBe(0);
    expect(report.cutDifferences).toBe(0);
    expect(report.rebuiltDifferences).toBe(0);
    expect(report.cutSurface).toEqual({ time: report.cutoff, water: 0.25 });
    expect(report.branchCount).toBe(report.expectedCount);
    expect(report.evictedAgain).toBe(true);
    expect(report.reloadedFromDatabase).toBe(true);
    expect(report.reloadedAlpha).toBe(0);
    expect(report.reloadDifferences).toBe(0);
    expect(report.persistedCount).toBe(4);
    expect(report.persistedTicks).toEqual(report.expectedTicks);
    expect(report.persistedDifferences).toBe(0);
    expect(report.persistedSurfaceTimes).toContain(report.cutoff);
    expect(report.persistedSurfaceTimes).not.toContain(report.cutoff + 1e-10);
    expect(report.targetPageWrites).toBe(2);
    expect(report.latestDifferences).toBe(0);
    expect(report.latestBrake).toBe(Math.fround(0.7));
    expect(report.error).toBeNull();
    expect(report.notices).toEqual([]);
    expect(report.rowsBeforeDisposal).toBeGreaterThan(4);
    expect(report.rowsAfterDisposal).toBe(0);
    expect(errors).toEqual([]);
    await info.attach(`native-replay-branch-${target}.json`, {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
  });
}

test('native CSV worker transfers a wrapped snapshot while its recorder keeps writing', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeRecording.telemetryTransfer(),
  );
  expect(report.rows).toBe(600);
  expect(report.columns).toBe(228);
  expect(report.byteLength).toBe(600 * 228 * 4);
  expect(report.detached).toBe(true);
  expect(report.snapshotDifferences).toBe(0);
  expect(report.continuingDifferences).toBe(0);
  expect(report.continuingBytes).toBe(report.byteLength);
  expect(report.exactCsv).toBe(true);
  expect(report.csvBytes).toBeGreaterThan(report.byteLength);
  expect(report.csvSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.rowCount).toBe(600);
  expect(report.headerMatches).toBe(true);
  expect(report.lastRowMatches).toBe(true);
  expect(report.mime).toBe('text/csv;charset=utf-8');
  expect(report.terminations).toBe(1);
  expect(report.uniqueTerminations).toBe(1);
  expect(errors).toEqual([]);
  await info.attach('native-telemetry-snapshot-transfer.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});

test('native CSV cancellation, replacement and validation failure retain one result owner', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeRecording.telemetryReplacement(),
  );
  expect(report).toEqual({
    firstDetached: true,
    secondDetached: true,
    cancelledDetached: true,
    invalidDetached: true,
    recoveredDetached: true,
    retiredMessage: 'Telemetry export cancelled',
    cancelledMessage: 'Telemetry export cancelled',
    invalidMessage: 'Invalid telemetry export shape',
    staleSuccess: false,
    replacementExact: true,
    replacementRows: 600,
    recoveredExact: true,
    terminations: 5,
    uniqueTerminations: 5,
  });
  expect(errors).toEqual([]);
  await info.attach('native-telemetry-worker-ownership.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});
