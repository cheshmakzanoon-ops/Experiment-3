import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/engine-native-atomic-storage.ts';

type NativeWindow = Window & { EngineNativeAtomicStorage: typeof Fixture };
let fixture: string;

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [resolve('e2e/fixtures/engine-native-atomic-storage.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'EngineNativeAtomicStorage',
    platform: 'browser',
    target: 'es2022',
  });
  fixture = result.outputFiles[0].text;
});

async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_atomic_storage__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native atomic storage</title>',
    }),
  );
  await page.goto('/__engine_native_atomic_storage__');
  await page.addScriptTag({ content: fixture });
  const identity = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeAtomicStorage.initialize(),
  );
  return { errors, identity };
}

const cleanup = (page: Page) =>
  page.evaluate(() => (window as unknown as NativeWindow).EngineNativeAtomicStorage.cleanup());

test('native atomic updates across two tabs retain every concurrently queued append', async ({
  page,
  context,
}, info) => {
  const other = await context.newPage();
  const [first, second] = await Promise.all([load(page), load(other)]);
  const key = 'native-atomic:concurrent';
  const tokens = ['first', 'second'].map((owner) =>
    Array.from({ length: 12 }, (_, index) => `${owner}:${index}`),
  );
  try {
    expect(first.identity.documentId).not.toBe(second.identity.documentId);
    expect(first.identity.origin).toBe(second.identity.origin);
    for (const owner of [first, second]) {
      expect(owner.identity.connections).toBe(1);
      expect(owner.identity.schema).toEqual([
        { name: 'apex-formula', version: 1, stores: ['saved'] },
      ]);
    }
    await page.evaluate(
      (key) => (window as unknown as NativeWindow).EngineNativeAtomicStorage.seed(key, []),
      key,
    );
    await page.evaluate(() =>
      (window as unknown as NativeWindow).EngineNativeAtomicStorage.holdWrites(),
    );
    const queued = await Promise.all(
      [page, other].map((owner, index) =>
        owner.evaluate(
          ({ key, tokens }) =>
            (window as unknown as NativeWindow).EngineNativeAtomicStorage.queueUpdates(key, tokens),
          { key, tokens: tokens[index] },
        ),
      ),
    );
    await info.attach('native-atomic-queued.json', {
      body: JSON.stringify({ identities: [first.identity, second.identity], queued }, null, 2),
      contentType: 'application/json',
    });
    // Prove both connections have pending native transactions before release;
    // a serial JavaScript loop or a lucky fast browser cannot satisfy this gate.
    for (const owner of queued)
      expect(owner).toEqual({
        transactions: Array<string>(12).fill('readwrite'),
        updaterCalls: 0,
        settled: 0,
      });
    await page.evaluate(() =>
      (window as unknown as NativeWindow).EngineNativeAtomicStorage.releaseWrites(),
    );
    const completed = await Promise.all(
      [page, other].map((owner) =>
        owner.evaluate(() =>
          (window as unknown as NativeWindow).EngineNativeAtomicStorage.finishUpdates(),
        ),
      ),
    );
    const visible = await Promise.all(
      [page, other].map((owner) =>
        owner.evaluate(
          (key) => (window as unknown as NativeWindow).EngineNativeAtomicStorage.read(key),
          key,
        ),
      ),
    );
    await info.attach('native-atomic-cross-tab.json', {
      body: JSON.stringify(
        { identities: [first.identity, second.identity], queued, completed, visible },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(visible[0]).toEqual(visible[1]);
    expect([...(visible[0] as string[])].sort()).toEqual(tokens.flat().sort());
    for (const owner of completed) {
      expect(owner.settled).toBe(12);
      expect(owner.outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
      expect(owner.transactions).toEqual(
        Array.from({ length: 12 }, () => ({
          mode: 'readwrite',
          writes: [key],
          events: ['put', 'put-success', 'complete'],
        })),
      );
    }
    expect(
      completed
        .flatMap((owner) => owner.callbacks.map((callback) => callback.previousLength))
        .sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 24 }, (_, index) => index));
    expect(
      completed
        .flatMap((owner) =>
          owner.outcomes.map((outcome) => (outcome.status === 'fulfilled' ? outcome.length : -1)),
        )
        .sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
    expect([...first.errors, ...second.errors]).toEqual([]);
  } finally {
    await other.close();
    await cleanup(page);
  }
});

test('native atomic updater and clone failures roll back before another connection recovers', async ({
  page,
}, info) => {
  const { errors } = await load(page);
  try {
    const report = await page.evaluate(() =>
      (window as unknown as NativeWindow).EngineNativeAtomicStorage.rollbackAndRecovery(),
    );
    await info.attach('native-atomic-rollback.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    expect(report.connections).toBe(2);
    expect(report.updaterFailure).toEqual({ name: 'Error', message: 'Native updater failed' });
    expect(report.followerValue).toEqual(['seed', 'survivor']);
    expect(report.afterThrow).toEqual(report.followerValue);
    expect(report.failedTransactions).toEqual([
      { mode: 'readwrite', writes: [], events: ['abort'] },
      {
        mode: 'readwrite',
        writes: ['native-atomic:rollback'],
        events: ['put', 'put-success', 'complete'],
      },
    ]);
    expect(report.cloneFailure?.name).toBe('DataCloneError');
    expect(report.afterClone).toEqual(report.afterThrow);
    expect(report.cloneTransactions).toEqual([
      { mode: 'readwrite', writes: ['native-atomic:rollback'], events: ['put', 'abort'] },
    ]);
    expect(report.recovered).toEqual(['seed', 'survivor', 'recovered']);
    expect(report.visible).toEqual(report.recovered);
    expect(report.recoveryTransactions).toEqual([
      {
        mode: 'readwrite',
        writes: ['native-atomic:rollback'],
        events: ['put', 'put-success', 'complete', 'promise-resolved'],
      },
    ]);
    expect(report.backup).toEqual(['recovery-copy']);
    expect(report.untouched).toBe('retained');
    expect(errors).toEqual([]);
  } finally {
    await cleanup(page);
  }
});

test('native atomic identity no-ops commit without a put or an absent-key insertion', async ({
  page,
}, info) => {
  const { errors } = await load(page);
  try {
    const report = await page.evaluate(() =>
      (window as unknown as NativeWindow).EngineNativeAtomicStorage.identityNoops(),
    );
    await info.attach('native-atomic-noop.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    expect(report.connections).toBe(2);
    expect(report.sameReference).toBe(true);
    expect(report.returned).toEqual(['retained', 'unsaved-mutation']);
    expect(report.visible).toEqual(['retained']);
    expect(report.missingIsUndefined).toBe(true);
    expect(report.keys).toEqual(['native-atomic:noop:existing']);
    for (const transactions of [report.existingTransactions, report.missingTransactions])
      expect(transactions).toEqual([
        { mode: 'readwrite', writes: [], events: ['complete', 'promise-resolved'] },
      ]);
    expect(errors).toEqual([]);
  } finally {
    await cleanup(page);
  }
});
