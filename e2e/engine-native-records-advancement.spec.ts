import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/engine-native-records-advancement.ts';

type NativeWindow = Window & { EngineNativeRecordsAdvancement: typeof Fixture };
let fixture: string;
let captureWorker: string;

test.beforeAll(async () => {
  const bundle = async (path: string) => {
    const result = await build({
      entryPoints: [resolve(path)],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
    });
    return result.outputFiles[0].text;
  };
  const csvWorker = await bundle('src/workers/telemetry.worker.ts');
  captureWorker = await bundle('e2e/fixtures/engine-native-records-advancement.worker.ts');
  const result = await build({
    entryPoints: [resolve('e2e/fixtures/engine-native-records-advancement.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    globalName: 'EngineNativeRecordsAdvancement',
    // TimeTrialRecords imports Interface's ordinary lap formatter. Preserve its
    // real module graph; these Vite asset imports become values and unused UI
    // presentation is tree-shaken without constructing or changing game assets.
    loader: { '.css': 'text', '.woff2': 'dataurl' },
    plugins: [
      {
        name: 'actual-native-records-csv-worker',
        setup(builder) {
          builder.onResolve({ filter: /telemetry\.worker\.ts\?worker&inline$/ }, () => ({
            path: 'native-records-csv-worker',
            namespace: 'native-records-worker',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'native-records-worker' }, () => ({
            loader: 'js',
            // Only adapt Vite's constructor import. Browser Worker, transfer,
            // Blob cloning and the complete production CSV worker remain native.
            contents: `export default class InlineCsvWorker {
            constructor(options) {
              const url = URL.createObjectURL(new Blob([${JSON.stringify(csvWorker)}], {type:'text/javascript'}));
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
  await page.route('**/__engine_native_records_advancement__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native engine records advancement</title>',
    }),
  );
  await page.goto('/__engine_native_records_advancement__');
  await page.addScriptTag({ content: fixture });
  return errors;
}

test('native IndexedDB preserves reversal bytes and first crossing through a real page reload', async ({
  page,
}, info) => {
  const errors = await load(page);
  try {
    const saved = await page.evaluate(() =>
      (window as unknown as NativeWindow).EngineNativeRecordsAdvancement.saveReversal(),
    );
    await info.attach('native-ghost-before-reload.json', {
      body: JSON.stringify(saved, null, 2),
      contentType: 'application/json',
    });
    expect(saved.version).toBe(1);
    expect(saved.key).toBe(`ghost:v1:${saved.circuit}`);
    expect(saved.sampleCount).toBeGreaterThan(20);
    expect(saved.sampleBytes).toBe(saved.sampleCount * 11 * 4);
    expect(saved.reverseSegments).toBe(5);
    expect(saved.storedDifferences).toBe(0);
    expect(saved.storedIndependent).toBe(true);
    expect(saved.storedSha256).toBe(saved.sampleSha256);
    expect(saved.sampleSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.boardTimes).toEqual([saved.lapTime]);
    expect(saved.keys.sort()).toEqual([saved.key, saved.boardKey].sort());
    expect(saved.notices.some((message) => /not saved|unavailable/i.test(message))).toBe(false);

    // A full native navigation discards the first document's modules, caches
    // and database connection; only IndexedDB supplies the replacement owner.
    await page.reload();
    await page.addScriptTag({ content: fixture });
    const reloaded = await page.evaluate(
      (value) =>
        (window as unknown as NativeWindow).EngineNativeRecordsAdvancement.reloadReversal(value),
      saved,
    );
    await info.attach('native-ghost-after-reload.json', {
      body: JSON.stringify(reloaded, null, 2),
      contentType: 'application/json',
    });
    expect(reloaded.documentId).not.toBe(saved.documentId);
    expect(reloaded.navigationType).toBe('reload');
    expect(reloaded.schema).toEqual({ name: 'apex-formula', version: 1, stores: ['saved'] });
    expect(reloaded.version).toBe(saved.version);
    expect(reloaded.key).toBe(saved.key);
    expect(reloaded.lapTime).toBe(saved.lapTime);
    expect(reloaded.sampleCount).toBe(saved.sampleCount);
    expect(reloaded.sampleSha256).toBe(saved.sampleSha256);
    expect(reloaded.firstTime).toBe(saved.firstTime);
    expect(reloaded.hud).toEqual({ best: saved.lapTime, delta: saved.expectedDelta });
    expect(reloaded.pose).toMatchObject({
      s: saved.reverseStation,
      x: saved.reverseStation,
      z: -saved.reverseStation / 2,
      vehicle: saved.vehicle,
    });
    expect(
      reloaded.independentRead &&
        reloaded.rereadIndependent &&
        reloaded.playerUnaffectedByReadMutation,
    ).toBe(true);
    expect(reloaded.readDifferences).toBe(0);
    expect(reloaded.rereadDifferences).toBe(0);
    expect(reloaded.qualifyingCleared).toBe(true);
    expect(reloaded.reloadedAgainIndependent).toBe(true);
    expect(reloaded.reloadedAgainDifferences).toBe(0);
    expect(reloaded.retainedFirstTime).toBe(saved.firstTime);
    expect(reloaded.keys.sort()).toEqual(saved.keys.sort());
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(() =>
      (window as unknown as NativeWindow).EngineNativeRecordsAdvancement.removeSavedRecords(),
    );
  }
});

test('native capture and CSV workers preserve the closing gap through ring wrap and chunk transfer', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(
    (source) =>
      (window as unknown as NativeWindow).EngineNativeRecordsAdvancement.closingGapExport(source),
    captureWorker,
  );
  await info.attach('native-records-closing-gap.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  expect(report.count).toBe(630);
  expect(report.head).toBe(100);
  expect(report.stride).toBe(228);
  expect(report.batches.map((batch) => batch.rows)).toEqual([...Array<number>(12).fill(60), 10]);
  expect(report.batches[10].first - report.batches[9].last).toBeGreaterThan(1);
  expect(report.replayPages).toBe(13);
  expect(report.replayRows).toBe(182);
  expect(report.capture).toEqual({
    detached: 26,
    recycled: 26,
    returnDetached: 26,
    pages: { telemetry: 6, replay: 6, maximum: 60 },
    warnings: [],
  });
  const ranges = [
    { lap: 1, start: 20, end: 139, valid: true },
    { lap: 2, start: 140, end: 259, valid: false },
    { lap: 3, start: 260, end: 379, valid: true },
    { lap: 5, start: 500, end: 619, valid: true },
  ];
  expect(report.ranges).toEqual(ranges);
  expect(report.exportedRanges).toEqual(ranges);
  expect(report.exportDetached).toBe(true);
  expect(report.beforeContinuationDifferences).toBe(0);
  expect(report.exportedDifferences).toBe(0);
  expect(report.exportedSha256).toBe(report.retainedSha256);
  expect(report.rowCount).toBe(630);
  expect(report.columnsMatch && report.headerMatches).toBe(true);
  expect(report.boundary.after - report.boundary.before).toBeGreaterThan(1);
  expect(report.followingLapInvalidOpening).toBe(0);
  expect(report.continuingLast).toBe(123);
  expect(report.csvSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.csvBytes).toBeGreaterThan(100000);
  expect(report.mime).toBe('text/csv;charset=utf-8');
  expect(report.csvTerminations).toBe(1);
  expect(report.uniqueCsvTerminations).toBe(1);
  expect(report.cleanup).toEqual({ captureTerminated: 1 });
  expect(errors).toEqual([]);
});
