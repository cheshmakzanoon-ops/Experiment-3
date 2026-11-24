import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/engine-native-lifecycle.ts';

type NativeWindow = Window & { EngineNativeLifecycle: typeof Fixture };
let fixture: string;

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [resolve('e2e/fixtures/engine-native-lifecycle.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'EngineNativeLifecycle',
    platform: 'browser',
    target: 'es2022',
  });
  fixture = result.outputFiles[0].text;
});

async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // A routed localhost origin permits native storage and a real dedicated
  // Worker without loading the application's rendering assets. Playwright
  // creates an isolated context for every test; no existing profile is used.
  await page.route('**/__engine_native_lifecycle__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native engine lifecycle</title>',
    }),
  );
  await page.goto('/__engine_native_lifecycle__');
  await page.addScriptTag({ content: fixture });
  return errors;
}

test('native replay caches isolate sessions and release only their owned pages', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeLifecycle.replaySessions(),
  );
  expect(report).toMatchObject({
    firstRead: { value: 11, negativeZero: true, surface: [1, 2, 3, 65535] },
    reread: 11,
    before: 2,
    afterFirst: 1,
    afterBoth: 0,
    otherSession: 22,
    idempotent: true,
  });
  expect(report.terminal?.message).toBe('Replay cache is closed');
  expect(errors).toEqual([]);
  await info.attach('native-replay-session-ownership.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});

test('native replay disposal rejects pending work and closes a late database open', async ({
  page,
}) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeLifecycle.replayPendingDisposal(),
  );
  expect(report.writeError?.message).toBe('Replay cache is closed');
  expect(report.readError?.message).toBe('Replay cache is closed');
  expect(report.rows).toBe(0);
  expect(report.idempotent).toBe(true);
  expect(errors).toEqual([]);
});

test('native save clone failure rolls back both primary and backup before recovery', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeLifecycle.saveBackupRollback(),
  );
  expect(report.failure?.name).toBe('DataCloneError');
  expect(report.afterFailure).toEqual({ primary: { revision: 2 }, backup: { revision: 1 } });
  expect(report.afterRecovery).toEqual({ primary: { revision: 4 }, backup: { revision: 2 } });
  expect(errors).toEqual([]);
  await info.attach('native-save-rollback.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});

test('native save connection retries after a database versionchange', async ({ page }) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeLifecycle.saveVersionChange(),
  );
  expect(report).toEqual({ missing: true, restored: { revision: 2 }, keys: ['profile'] });
  expect(errors).toEqual([]);
});

test('native mirror adapter publishes only committed reads and atomic batches', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeLifecycle.mirrorTransactions(),
  );
  expect(report.writeFailure?.name).toBe('DataCloneError');
  expect(report.afterFailure).toEqual({ primary: { revision: 1 }, untouched: 'retained' });
  expect(report.readFailure).not.toBeNull();
  // Native Chromium can reject the read before our separate abort observer
  // runs. Both must follow request success; a resolved read must never appear.
  expect(report.order[0]).toBe('request-success');
  expect(report.order.slice(1).sort()).toEqual(['promise-rejected', 'transaction-abort']);
  expect(report.recovered).toEqual({ revision: 1 });
  expect(errors).toEqual([]);
  await info.attach('native-mirror-transaction-boundary.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});

test('native worker transfers preserve bounded frame capacity across repeated reuse', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeLifecycle.workerTransfers(),
  );
  expect(report).toEqual({
    sent: 310,
    returned: 310,
    senderDetached: 310,
    workerDetached: 310,
    duplicateRejected: 310,
    blockedRounds: 101,
    available: 3,
  });
  expect(errors).toEqual([]);
  await info.attach('native-worker-transfer-reuse.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});
