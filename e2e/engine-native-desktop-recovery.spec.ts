import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DesktopSaveInfo, DesktopSaveSnapshot } from '../src/desktop/bridge.ts';
import type * as Fixture from './fixtures/engine-native-desktop-recovery.ts';

type NativeWindow = Window & { EngineNativeDesktopRecovery: typeof Fixture };
type Entries = readonly (readonly [string, unknown])[];
interface NativeMirror {
  load(): { revision: number; source: string };
}
interface NativeSaves {
  info(): DesktopSaveInfo;
  load(): DesktopSaveSnapshot;
  put(key: string, value: unknown, revision: number): number;
  commit(entries: Entries, revision: number, previous: number): number;
  seed(entries: Record<string, unknown>, revision: number): boolean;
  flush(): boolean;
}
const { SaveMirror, saveMirrorService } = createRequire(import.meta.url)(
  '../desktop/src/save-mirror.cjs',
) as {
  SaveMirror: new (options: { dir: string; name: string; debounceMs: number }) => NativeMirror;
  saveMirrorService(mirrors: { main: NativeMirror; ghosts: NativeMirror }, path: string): NativeSaves;
};
interface BridgeCall {
  owner: string;
  method: Fixture.BridgeMethod;
  args: unknown[];
  result?: unknown;
  error?: string;
}
const revisionKey = '__desktop_revision';
let fixture: string;

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [resolve('e2e/fixtures/engine-native-desktop-recovery.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'EngineNativeDesktopRecovery',
    platform: 'browser',
    target: 'es2022',
  });
  fixture = result.outputFiles[0].text;
});

function nativeFiles(rejectFirstSeed = false) {
  const dir = mkdtempSync(join(tmpdir(), 'motobound-native-desktop-'));
  const calls: BridgeCall[] = [];
  let rejectSeed = rejectFirstSeed;
  function open() {
    const main = new SaveMirror({ dir, name: 'saves', debounceMs: 60000 });
    const ghosts = new SaveMirror({ dir, name: 'ghosts', debounceMs: 60000 });
    const loaded = { main: main.load(), ghosts: ghosts.load() };
    return { loaded, service: saveMirrorService({ main, ghosts }, dir) };
  }
  let current = open();
  const snapshot = () => structuredClone(current.service.load());
  const info = () => structuredClone(current.service.info());
  function invoke(owner: string, request: Fixture.BridgeRequest) {
    const args = structuredClone(request.args);
    const call: BridgeCall = { owner, method: request.method, args };
    calls.push(call);
    try {
      const saves = current.service;
      let result: unknown;
      switch (request.method) {
        case 'info': result = saves.info(); break;
        case 'load': result = saves.load(); break;
        case 'put':
          result = saves.put(args[0] as string, args[1], args[2] as number);
          break;
        case 'commit':
          result = saves.commit(args[0] as Entries, args[1] as number, args[2] as number);
          break;
        case 'seed':
          // Reject only this explicit transport boundary. No production mirror
          // state or native filesystem behavior is replaced.
          if (rejectSeed) {
            rejectSeed = false;
            result = false;
          } else result = saves.seed(args[0] as Record<string, unknown>, args[1] as number);
          break;
        case 'flush': result = saves.flush(); break;
        default: throw new Error('Unknown desktop test bridge method');
      }
      call.result = structuredClone(result);
      return result;
    } catch (error) {
      call.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
  return {
    calls,
    invoke,
    snapshot,
    info,
    restart() {
      if (!current.service.flush()) throw new Error('Native mirror files did not flush');
      // Fresh production loaders parse the checksums and completion certificate
      // from real files. The old service is quiescent before this replacement.
      current = open();
      return {
        snapshot: snapshot(),
        info: info(),
        loaded: structuredClone(current.loaded),
        files: readdirSync(dir).sort(),
      };
    },
    dispose() {
      current.service.flush(); // Public flush also retires native debounce timers.
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
type Files = ReturnType<typeof nativeFiles>;
type Changed = Awaited<ReturnType<typeof Fixture.change>>;

async function openOwner(
  context: BrowserContext,
  files: Files,
  pages: Page[],
  errors: string[],
  label: string,
  desktop = true,
) {
  const page = await context.newPage();
  pages.push(page);
  page.on('pageerror', (error) => errors.push(label + ': ' + error.message));
  await page.exposeFunction('__engineNativeDesktopCall', (request: Fixture.BridgeRequest) =>
    files.invoke(label, request),
  );
  await page.route('**/__engine_native_desktop_recovery__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native desktop save recovery</title>',
    }),
  );
  await page.goto('/__engine_native_desktop_recovery__');
  await page.addScriptTag({ content: fixture });
  const identity = await page.evaluate(
    (desktop) => (window as unknown as NativeWindow).EngineNativeDesktopRecovery.initialize(desktop),
    desktop,
  );
  expect(identity.connections).toBe(1);
  expect(identity.desktop).toBe(desktop);
  expect(identity.schema).toEqual([{ name: 'apex-formula', version: 1, stores: ['saved'] }]);
  return { page, identity };
}
const change = (page: Page, input: Fixture.Change) =>
  page.evaluate(
    (input) => (window as unknown as NativeWindow).EngineNativeDesktopRecovery.change(input),
    input,
  );

function expectRevisionWrite(
  report: Changed,
  reads: string[],
  writes: string[],
  previous: number,
  revision: number,
) {
  expect(report.transactions).toHaveLength(1);
  const tx = report.transactions[0];
  expect(tx.mode).toBe('readwrite');
  expect(tx.reads).toEqual(reads);
  expect(tx.writes).toEqual(writes);
  expect(tx.readRevisions).toEqual([previous]);
  expect(tx.writtenRevisions).toEqual([revision]);
  expect(tx.events.filter((event) => event === 'put')).toHaveLength(writes.length);
  expect(tx.events.filter((event) => event === 'put-success')).toHaveLength(writes.length);
  expect(tx.events).not.toContain('abort');
  expect(tx.events.slice(-2)).toEqual(['complete', 'promise-resolved']);
  expect(report.pending).toBe(0);
  expect(report.state.revision).toBe(revision);
}
async function finish(
  pages: Page[],
  files: Files,
  errors: string[],
  evidence: Record<string, unknown>,
  info: TestInfo,
  passed: boolean,
) {
  const cleanup = await Promise.allSettled(
    pages.map((page) =>
      page.evaluate(() =>
        (window as unknown as NativeWindow).EngineNativeDesktopRecovery?.cleanup(),
      ),
    ),
  );
  evidence.cleanup = cleanup.map((result) =>
    result.status === 'fulfilled'
      ? { status: result.status, value: result.value }
      : { status: result.status, error: String(result.reason) },
  );
  evidence.bridgeCalls = files.calls;
  evidence.pageErrors = errors;
  evidence.boundaries = {
    indexedDB: 'native Chromium IndexedDB in separate same-origin pages',
    mirror: 'production SaveMirror and saveMirrorService over real temporary files',
    bridge: 'explicit Playwright binding; not Electron preload or IPC',
    scheduling: 'native requests and promises; no clock or transaction substitution',
    simultaneousReconciliationValidated: false,
  };
  try {
    await info.attach('native-desktop-recovery.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  } finally {
    files.dispose();
  }
  if (passed) {
    expect(errors).toEqual([]);
    for (const result of cleanup) {
      expect(result.status).toBe('fulfilled');
      if (result.status === 'fulfilled') {
        expect(result.value).toMatchObject({ pending: 0, restored: true, unhandled: [] });
        if (!result.value) throw new Error('Native cleanup did not return its ownership report');
        expect(result.value.closedConnections).toBe(1);
      }
    }
  }
}

test('native independent save owners keep the complete file prefix behind foreign writes until full recovery', async ({
  context,
}, info) => {
  test.setTimeout(90000);
  const files = nativeFiles();
  const pages: Page[] = [];
  const errors: string[] = [];
  const evidence: Record<string, unknown> = {};
  let passed = false;
  try {
    // Establish both owners at revision zero before any write. Reconciliation
    // is deliberately sequential; concurrent full seeding is outside this case.
    const a = await openOwner(context, files, pages, errors, 'A');
    const b = await openOwner(context, files, pages, errors, 'B');
    evidence.initial = [a.identity, b.identity];
    expect(a.identity.documentId).not.toBe(b.identity.documentId);
    expect(a.identity.origin).toBe(b.identity.origin);
    expect(a.identity.state).toEqual({ revision: 0, entries: {} });
    expect(b.identity.state).toEqual(a.identity.state);

    const first = await change(a.page, { method: 'write', key: 'career', value: { laps: 1 } });
    expectRevisionWrite(first, [revisionKey], ['career', revisionKey], 0, 1);
    expect(files.snapshot()).toEqual({
      revision: 1, complete: true, entries: { career: { laps: 1 } },
    });
    const foreign = await change(b.page, {
      method: 'update', key: 'ghost:engine-native', value: [4, 0, 6],
    });
    expectRevisionWrite(
      foreign, ['ghost:engine-native', revisionKey], ['ghost:engine-native', revisionKey], 1, 2,
    );
    const returning = await change(a.page, {
      method: 'writeWithBackup', key: 'career', value: { laps: 2 },
    });
    expectRevisionWrite(
      returning, ['career', revisionKey], ['career:backup', 'career', revisionKey], 2, 3,
    );
    const expected = {
      career: { laps: 2 },
      'career:backup': { laps: 1 },
      'ghost:engine-native': [4, 0, 6],
    };
    evidence.interleaved = { first, foreign, returning };
    expect(returning.state).toEqual({ revision: 3, entries: expected });
    expect(files.calls.filter((call) => call.method === 'commit')).toEqual([
      { owner: 'A', method: 'commit', args: [[['career', { laps: 1 }]], 1, 0], result: 1 },
    ]);
    expect(files.calls.filter((call) => call.method === 'seed')).toEqual([]);
    const behind = files.restart();
    evidence.behind = behind;
    expect(behind.snapshot).toEqual({
      revision: 1, complete: true, entries: { career: { laps: 1 } },
    });
    expect(behind.loaded.main.source).toBe('primary');
    expect(behind.loaded.ghosts.source).toBe('empty');

    const recovered = await openOwner(context, files, pages, errors, 'recovered');
    evidence.recovered = recovered.identity;
    expect(recovered.identity.documentId).not.toBe(a.identity.documentId);
    expect(recovered.identity.state).toEqual({ revision: 4, entries: expected });
    expect(files.calls.filter((call) => call.method === 'seed')).toEqual([
      { owner: 'recovered', method: 'seed', args: [expected, 4], result: true },
    ]);
    expect(files.snapshot()).toEqual({ revision: 4, complete: true, entries: expected });

    const after = await change(recovered.page, {
      method: 'update', key: 'settings', value: { volume: 0.4 },
    });
    expectRevisionWrite(after, ['settings', revisionKey], ['settings', revisionKey], 4, 5);
    const finalEntries = { ...expected, settings: { volume: 0.4 } };
    expect(after.state).toEqual({ revision: 5, entries: finalEntries });
    expect(files.calls.filter((call) => call.method === 'commit').at(-1)).toEqual({
      owner: 'recovered', method: 'commit',
      args: [[['settings', { volume: 0.4 }]], 5, 4], result: 5,
    });
    const reopened = files.restart();
    evidence.after = after;
    evidence.reopened = reopened;
    expect(reopened.snapshot).toEqual({ revision: 5, complete: true, entries: finalEntries });
    expect(reopened.loaded).toMatchObject({
      main: { revision: 5, source: 'primary' },
      ghosts: { revision: 4, source: 'primary' },
    });
    expect(reopened.files).toEqual(expect.arrayContaining(['saves.json', 'ghosts.json']));
    expect(reopened.files.some((name) => name.endsWith('.tmp'))).toBe(false);
    expect(files.calls.some((call) => call.error !== undefined)).toBe(false);
    passed = true;
  } finally {
    await finish(pages, files, errors, evidence, info, passed);
  }
});

test('native failed full seed cannot be hidden by a later partial write and a fresh owner recovers it', async ({
  context,
}, info) => {
  test.setTimeout(90000);
  const files = nativeFiles(true);
  const pages: Page[] = [];
  const errors: string[] = [];
  const evidence: Record<string, unknown> = {};
  let passed = false;
  try {
    // Ordinary browser saves predate this desktop owner. No private revision,
    // mirror state, fake request or native file is injected into the database.
    const browser = await openOwner(context, files, pages, errors, 'browser', false);
    await change(browser.page, { method: 'write', key: 'career', value: 'must survive' });
    const browserState = await change(browser.page, {
      method: 'write', key: 'settings', value: 'old',
    });
    expect(browserState.state).toEqual({
      revision: 0, entries: { career: 'must survive', settings: 'old' },
    });
    expect(browserState.transactions[0].readRevisions).toEqual([]);
    expect(browserState.transactions[0].writtenRevisions).toEqual([]);
    expect(files.calls).toEqual([]);

    const failed = await openOwner(context, files, pages, errors, 'failed-seed');
    evidence.initial = { browser: browser.identity, browserState, failed: failed.identity };
    expect(failed.identity.origin).toBe(browser.identity.origin);
    expect(failed.identity.documentId).not.toBe(browser.identity.documentId);
    expect(failed.identity.state).toEqual({
      revision: 1, entries: { career: 'must survive', settings: 'old' },
    });
    expect(files.calls.filter((call) => call.method === 'seed')).toEqual([
      {
        owner: 'failed-seed', method: 'seed',
        args: [{ career: 'must survive', settings: 'old' }, 1], result: false,
      },
    ]);
    const later = await change(failed.page, { method: 'update', key: 'settings', value: 'new' });
    expectRevisionWrite(later, ['settings', revisionKey], ['settings', revisionKey], 1, 2);
    expect(later.state).toEqual({
      revision: 2, entries: { career: 'must survive', settings: 'new' },
    });
    expect(files.calls.filter((call) => call.method === 'commit')).toEqual([]);
    const empty = files.restart();
    evidence.blocked = { later, empty };
    expect(empty.snapshot).toEqual({ revision: 0, complete: true, entries: {} });
    expect(empty.files).toEqual([]);

    const recovered = await openOwner(context, files, pages, errors, 'recovered');
    const complete = { career: 'must survive', settings: 'new' };
    evidence.recovered = recovered.identity;
    expect(recovered.identity.state).toEqual({ revision: 3, entries: complete });
    expect(files.snapshot()).toEqual({ revision: 3, complete: true, entries: complete });
    expect(files.calls.filter((call) => call.method === 'seed').at(-1)).toEqual({
      owner: 'recovered', method: 'seed', args: [complete, 3], result: true,
    });
    const after = await change(recovered.page, {
      method: 'writeWithBackup', key: 'settings', value: 'after recovery',
    });
    expectRevisionWrite(
      after, ['settings', revisionKey], ['settings:backup', 'settings', revisionKey], 3, 4,
    );
    const expected = {
      career: 'must survive', settings: 'after recovery', 'settings:backup': 'new',
    };
    expect(after.state).toEqual({ revision: 4, entries: expected });
    expect(files.calls.filter((call) => call.method === 'commit')).toEqual([
      {
        owner: 'recovered', method: 'commit',
        args: [[['settings:backup', 'new'], ['settings', 'after recovery']], 4, 3], result: 4,
      },
    ]);
    const reopened = files.restart();
    evidence.after = after;
    evidence.reopened = reopened;
    expect(reopened.snapshot).toEqual({ revision: 4, complete: true, entries: expected });
    expect(reopened.loaded).toMatchObject({
      main: { revision: 4, source: 'primary' },
      ghosts: { revision: 3, source: 'primary' },
    });
    expect(reopened.files.some((name) => name.endsWith('.tmp'))).toBe(false);
    expect(files.calls.some((call) => call.error !== undefined)).toBe(false);
    passed = true;
  } finally {
    await finish(pages, files, errors, evidence, info, passed);
  }
});
