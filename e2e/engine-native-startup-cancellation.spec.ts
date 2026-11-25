import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/engine-native-startup-cancellation.ts';

type NativeWindow = Window & { EngineNativeStartupCancellation: typeof Fixture };
let fixture: string;

test.beforeAll(async () => {
  const bundled = await build({
    entryPoints: [resolve('e2e/fixtures/engine-native-startup-cancellation.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'EngineNativeStartupCancellation',
    platform: 'browser',
    target: 'es2022',
  });
  fixture = bundled.outputFiles[0].text;
});

async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_startup_cancellation__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native engine startup cancellation</title>',
    }),
  );
  await page.goto('/__engine_native_startup_cancellation__');
  await page.addScriptTag({ content: fixture });
  return errors;
}

const resolved = { outcome: 'resolved', count: 1, error: null };
const pending = { outcome: 'pending', count: 0, error: null };

test('native cancellation settles by the next task while deferred startup remains pending', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeStartupCancellation.pendingCancellation(),
  );
  const rejections = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeStartupCancellation.nativeRejections(),
  );
  await info.attach('native-startup-pending-cancellation.json', {
    body: JSON.stringify({ report, rejections, errors }, null, 2),
    contentType: 'application/json',
  });
  expect(report.map((row) => row.stage)).toEqual(['load', 'create']);
  for (const row of report) {
    expect(row.beforeCancel).toEqual({ result: pending, work: 'pending', starting: true });
    expect(row.synchronousOutcome).toBe('pending');
    expect(row.order).toEqual(['cancel', 'cancel-returned', 'start-resolved', 'next-task']);
    expect(row.afterCancel).toEqual({
      result: resolved,
      work: 'pending',
      starting: true,
      sessionAbsent: true,
      oldAborted: row.stage === 'create' ? true : null,
      oldCurrent: row.stage === 'create' ? false : null,
    });
    expect(row.afterLateRejection).toEqual({
      result: resolved,
      work: 'rejected',
      starting: true,
      sessionAbsent: true,
      firstReady: 0,
      firstFailed: 0,
    });
    expect(row.recovered).toEqual({
      result: resolved,
      owned: true,
      starting: false,
      replacementReady: 1,
      replacementDisposed: 0,
    });
    expect(row.replacementDisposed).toBe(1);
  }
  expect(rejections).toEqual([]);
  expect(errors).toEqual([]);
});

test('native late creation disposes once and keeps stale cleanup promise jobs out of successor UI', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeStartupCancellation.lateCreationCleanup(),
  );
  const rejections = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeStartupCancellation.nativeRejections(),
  );
  await info.attach('native-startup-late-cleanup.json', {
    body: JSON.stringify({ report, rejections, errors }, null, 2),
    contentType: 'application/json',
  });
  expect(report.beforeLateCreation).toEqual({
    result: resolved,
    work: 'pending',
    replacementWork: 'pending',
    starting: true,
    text: 'successor:preparing',
  });
  expect(report.afterLateCreation).toEqual({
    result: resolved,
    staleDisposed: 1,
    staleWrites: 0,
    firstReady: 0,
    firstFailed: 0,
    oldAborted: true,
    oldCurrent: false,
    current: true,
    aborted: false,
    starting: true,
    sessionAbsent: true,
    text: 'successor:preparing',
  });
  expect(report.recovered).toEqual({
    result: resolved,
    owned: true,
    starting: false,
    replacementReady: 1,
    replacementDisposed: 0,
    text: 'successor:ready',
  });
  expect(report.final).toEqual({
    staleDisposed: 1,
    replacementDisposed: 1,
    staleWrites: 0,
    sessionAbsent: true,
  });
  expect(rejections).toEqual([]);
  expect(errors).toEqual([]);
});

test('native abort and recovery reentry keep old cleanup failures away from the successor', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeStartupCancellation.reentrantRecovery(),
  );
  const rejections = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeStartupCancellation.nativeRejections(),
  );
  await info.attach('native-startup-reentrant-recovery.json', {
    body: JSON.stringify({ report, rejections, errors }, null, 2),
    contentType: 'application/json',
  });
  expect(report.map((row) => row.boundary)).toEqual(['abort', 'recovery']);
  for (const row of report) {
    expect(row.order).toEqual(
      row.boundary === 'abort'
        ? ['ready', 'abort', 'successor-start', 'dispose']
        : ['ready', 'abort', 'dispose', 'recover', 'successor-start'],
    );
    expect(row.afterRecovery).toEqual({
      result: resolved,
      successorResult: pending,
      revokedAtAbort: true,
      firstDisposed: 1,
      firstFailed: row.boundary === 'recovery' ? 1 : 0,
      outerFailures: 0,
      staleWrites: 0,
      replacementStarts: 1,
      oldAborted: true,
      oldCurrent: false,
      current: true,
      aborted: false,
      starting: true,
      sessionAbsent: true,
      text: 'successor:preparing',
    });
    expect(row.recovered).toEqual({
      result: resolved,
      owned: true,
      starting: false,
      replacementReady: 1,
      replacementDisposed: 0,
      outerFailures: 0,
      text: 'successor:ready',
    });
    expect(row.final).toEqual({
      firstDisposed: 1,
      replacementDisposed: 1,
      outerFailures: 0,
      staleWrites: 0,
    });
  }
  expect(rejections).toEqual([]);
  expect(errors).toEqual([]);
});
