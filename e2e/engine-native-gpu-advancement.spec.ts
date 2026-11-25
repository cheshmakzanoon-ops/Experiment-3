import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/engine-native-gpu-advancement.ts';

type NativeWindow = Window & { EngineNativeGpuAdvancement: typeof Fixture };
let fixture: string;

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [resolve('e2e/fixtures/engine-native-gpu-advancement.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'EngineNativeGpuAdvancement',
    platform: 'browser',
    target: 'es2022',
  });
  fixture = result.outputFiles[0].text;
});

async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_gpu_advancement__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native engine GPU advancement</title>',
    }),
  );
  await page.goto('/__engine_native_gpu_advancement__');
  await page.addScriptTag({ content: fixture });
  return errors;
}

test('native Three uploads latest coalesced bytes and resumes narrow updates after a full upload', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeGpuAdvancement.attributeUploads(),
  );
  await info.attach('native-gpu-attribute-uploads.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  expect(report.backend.webgl2).toBe(true);
  expect(report.backend.renderer).toBeTruthy();
  expect(report.totalBytes).toBe(49152);
  expect(report.sourceByteOffset).toBe(20);
  expect(report.versions).toEqual({ initial: 0, duplicate: 25, disjoint: 42, narrow: 44 });
  expect(report.duplicatePending).toEqual([{ start: 300, count: 12 }]);
  expect(report.duplicateCleared).toBe(true);
  expect(report.sixteenPending).toBe(16);
  expect(report.disjointPending).toEqual([{ start: 0, count: 12288 }]);
  expect(report.narrowPending).toEqual([{ start: 210, count: 6 }]);
  expect(report.finalPending).toBe(0);
  expect(report.latestItems).toEqual(Array.from({ length: 12 }, (_, i) => 10384 + i));
  expect(report.uploadsBeforePublication).toBe(0);
  expect(report.unchangedUploads).toBe(0);
  expect(
    report.uploads.map(({ phase, destinationOffset, sourceOffset, sourceLength, bytes }) => ({
      phase,
      destinationOffset,
      sourceOffset,
      sourceLength,
      bytes,
    })),
  ).toEqual([
    { phase: 'duplicate', destinationOffset: 1200, sourceOffset: 300, sourceLength: 12, bytes: 48 },
    { phase: 'disjoint', destinationOffset: 0, sourceOffset: 0, sourceLength: 12288, bytes: 49152 },
    {
      phase: 'narrow-after-full',
      destinationOffset: 840,
      sourceOffset: 210,
      sourceLength: 6,
      bytes: 24,
    },
  ]);
  expect(
    report.uploads.every((upload) => upload.expectedBuffer && upload.sourceByteOffset === 20),
  ).toBe(true);
  for (const count of Object.values(report.checks)) expect(count).toBe(0);
  expect(report.hashes.deferred).toBe(report.hashes.initial);
  expect(report.hashes.duplicate).toBe(report.hashes.duplicateExpected);
  expect(report.hashes.disjoint).toBe(report.hashes.disjointExpected);
  expect(report.hashes.narrow).toBe(report.hashes.narrowExpected);
  expect(report.guardValues).toEqual(Array(8).fill(-1337));
  expect(report.removed).toBe(true);
  expect(report.glError).toBe(0);
  expect(report.contextLost).toBe(false);
  expect(errors).toEqual([]);
});

test('native shared fence ownership survives borrower handoff and releases each sync once', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeGpuAdvancement.sharedFenceOwnership(),
  );
  await info.attach('native-gpu-shared-fences.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  const idle = { pending: false, submitted: 0, completed: 0, failure: null };
  const first = { pending: true, submitted: 1, completed: 0, failure: null };
  const second = { pending: true, submitted: 2, completed: 1, failure: null };
  const completed = { pending: false, submitted: 2, completed: 2, failure: null };
  expect(report.backend.webgl2).toBe(true);
  expect(report.backend.renderer).toBeTruthy();
  expect(report.initial).toEqual({ circuit: true, festival: true, queue: idle });
  expect(report.submitted).toEqual({ circuit: first, festival: first });
  expect(report.firstHandoff).toEqual({
    queue: first,
    live: 1,
    deleted: 0,
    nativeFence: true,
    backendDisposals: 0,
  });
  expect(report.secondHandoff).toEqual({
    circuit: second,
    replacement: second,
    live: 1,
    deleted: [1],
    backendDisposals: 0,
    releasedReady: false,
    releasedSubmitRejected: true,
  });
  expect(report.completedQueues).toEqual({ circuit: completed, borrower: completed });
  expect(report.beforeFinalRelease).toEqual({
    queue: { pending: true, submitted: 3, completed: 2, failure: null },
    live: 1,
    deleted: [1, 2],
    nativeFence: true,
  });
  expect(report.afterFinalRelease).toEqual({
    live: 0,
    deleted: [1, 2, 3],
    nativeFence: false,
    backendDisposals: 0,
    contextLost: false,
  });
  expect(report.red.rgba).toEqual([255, 0, 0, 255]);
  expect(report.green.rgba).toEqual([0, 255, 0, 255]);
  expect(report.red.bytes).toBe(256);
  expect(report.green.bytes).toBe(256);
  expect(report.red.differences).toBe(0);
  expect(report.green.differences).toBe(0);
  expect(report.red.sha256).not.toBe(report.green.sha256);
  expect(report.submittedFences).toEqual(
    [1, 2, 3].map((id) => ({
      id,
      condition: report.constants.complete,
      flags: 0,
    })),
  );
  expect(report.deletedFences).toEqual([1, 2, 3]);
  expect(report.waits.length).toBe(report.firstCompletion.polls + report.secondCompletion.polls);
  expect(report.waits.filter((wait) => wait.result === report.constants.timeout).length).toBe(
    report.firstCompletion.deferred + report.secondCompletion.deferred,
  );
  expect(report.waits.every((wait) => wait.flags === 0 && wait.timeout === 0)).toBe(true);
  const nativeResults = new Set<number>([
    report.constants.timeout,
    report.constants.already,
    report.constants.satisfied,
  ]);
  expect(report.waits.every((wait) => nativeResults.has(wait.result))).toBe(true);
  expect(
    report.waits.filter((wait) => wait.result !== report.constants.timeout).map((wait) => wait.id),
  ).toEqual([1, 2]);
  expect(report.counts.finishes).toBe(0);
  expect(report.counts.flushes).toBeGreaterThanOrEqual(3);
  expect(report.releasedMemory).toEqual({ geometries: 0, textures: 0, programs: 0 });
  expect(report.backendDisposals).toBe(1);
  expect(report.glError).toBe(0);
  expect(report.contextLost).toBe(false);
  expect(errors).toEqual([]);
});
