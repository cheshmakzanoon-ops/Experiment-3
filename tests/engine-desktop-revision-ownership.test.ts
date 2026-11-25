import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DesktopSaveInfo,
  DesktopSaveSnapshot,
  MotoboundDesktop,
} from '../src/desktop/bridge.ts';
import { SaveStore } from '../src/storage/data.ts';
import { DesktopMirror, REVISION_KEY, type MirrorKv } from '../src/storage/desktop-mirror.ts';

type Entries = readonly (readonly [string, unknown])[];
interface NativeMirror {
  timer: ReturnType<typeof setTimeout> | null;
  load(): DesktopSaveSnapshot;
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
  saveMirrorService(
    mirrors: { main: NativeMirror; ghosts: NativeMirror },
    path: string,
  ): NativeSaves;
};
const directories: string[] = [];
const nativeMirrors: NativeMirror[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const mirror of nativeMirrors.splice(0)) {
    if (mirror.timer) clearTimeout(mirror.timer);
    mirror.timer = null;
  }
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function disk(existing?: string) {
  const dir = existing ?? mkdtempSync(join(tmpdir(), 'motobound-revision-owners-'));
  if (!existing) directories.push(dir);
  const main = new SaveMirror({ dir, name: 'saves', debounceMs: 60_000 });
  const ghosts = new SaveMirror({ dir, name: 'ghosts', debounceMs: 60_000 });
  nativeMirrors.push(main, ghosts);
  main.load();
  ghosts.load();
  return { dir, native: saveMirrorService({ main, ghosts }, dir) };
}

function local(entries: Record<string, unknown>, revision: number) {
  const data = new Map<string, unknown>(
    Object.entries(structuredClone({ ...entries, [REVISION_KEY]: revision })),
  );
  const kv: MirrorKv = {
    keys: async () => [...data.keys()],
    get: async (key) => structuredClone(data.get(key)),
    entries: async () => structuredClone(Object.fromEntries(data)),
    putMany: async (values) => {
      for (const [key, value] of Object.entries(structuredClone(values))) data.set(key, value);
    },
  };
  return { data, kv };
}

function bridge(native: NativeSaves, modern = true) {
  const saves = {
    info: vi.fn(async () => {
      const info = native.info();
      if (!modern) delete info.complete;
      return info;
    }),
    load: vi.fn(async () => {
      const snapshot = native.load();
      if (!modern) delete snapshot.complete;
      return snapshot;
    }),
    put: vi.fn(async (key: string, value: unknown, revision: number) =>
      native.put(key, structuredClone(value), revision),
    ),
    commit: modern
      ? vi.fn(async (entries: Entries, revision: number, previous: number) =>
          native.commit(structuredClone(entries), revision, previous),
        )
      : undefined,
    seed: vi.fn(async (entries: Record<string, unknown>, revision: number) =>
      native.seed(structuredClone(entries), revision),
    ),
    flush: vi.fn(async () => native.flush()),
  };
  return {
    saves,
    mirror: DesktopMirror.forBridge({ version: 1, saves } as unknown as MotoboundDesktop),
  };
}

function fixture(modern = true, revision = 6) {
  const original = { career: 'old', settings: 'old' };
  const files = disk();
  files.native.seed(original, revision);
  files.native.flush();
  return {
    ...files,
    original,
    local: local(original, revision),
    a: bridge(files.native, modern),
    b: bridge(files.native, modern),
  };
}

async function settle() {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

/** Prescribe serialized local commits but exercise both actual mirror classes
 * and the actual native certificate/predecessor rules. Native IndexedDB
 * scheduling is accepted separately; this deterministic witness exposes the
 * returning-owner and aborted-reservation sequences without timing races. */
function commit(mirror: DesktopMirror, state: ReturnType<typeof local>, entries: Entries) {
  const captured = structuredClone(entries);
  const staged = new Map<string, unknown>();
  const revision = mirror.stamp(
    {
      put: (value: unknown, key: string) => staged.set(key, structuredClone(value)),
    } as unknown as IDBObjectStore,
    state.data.get(REVISION_KEY) ?? 0,
  );
  for (const [key, value] of captured) staged.set(key, structuredClone(value));
  for (const [key, value] of staged) state.data.set(key, value);
  mirror.written(captured, revision);
  return revision;
}

describe('desktop revision owners and complete native prefixes', () => {
  it.each([true, false])(
    'keeps foreign writes recoverable when the original owner returns (modern=%s)',
    async (modern) => {
      const f = fixture(modern);
      await f.a.mirror.reconcile(f.local.kv);
      await f.b.mirror.reconcile(f.local.kv);
      expect(commit(f.a.mirror, f.local, [['career', 'first']])).toBe(7);
      await settle();
      expect(commit(f.b.mirror, f.local, [['ghost:lap', new Float32Array([4, -0, 6])]])).toBe(8);
      await settle();
      expect(commit(f.a.mirror, f.local, [['settings', 'last']])).toBe(9);
      await settle();
      const calls = (owner: typeof f.a) =>
        modern ? owner.saves.commit!.mock.calls.length : owner.saves.put.mock.calls.length;
      expect(calls(f.a)).toBe(1);
      expect(calls(f.b)).toBe(0);
      expect(f.native.load()).toMatchObject({
        revision: 7,
        entries: { career: 'first', settings: 'old' },
      });
      expect(f.native.load().entries).not.toHaveProperty('ghost:lap');
      expect(f.local.data.get(REVISION_KEY)).toBe(9);
      f.native.flush();

      const restart = disk(f.dir);
      const recovered = bridge(restart.native, modern);
      await expect(recovered.mirror.reconcile(f.local.kv)).resolves.toMatchObject({
        action: 'seeded',
        revision: 10,
      });
      expect(restart.native.load()).toEqual({
        revision: 10,
        complete: true,
        entries: {
          career: 'first',
          settings: 'last',
          'ghost:lap': new Float32Array([4, -0, 6]),
        },
      });
      expect(commit(recovered.mirror, f.local, [['career', 'after recovery']])).toBe(11);
      await settle();
      expect(restart.native.load()).toMatchObject({
        revision: 11,
        entries: { career: 'after recovery', settings: 'last' },
      });
      expect(restart.native.load().entries['ghost:lap']).toEqual(new Float32Array([4, -0, 6]));
      if (modern) expect(restart.native.info().complete).toBe(true);
    },
  );

  it('does not mistake an aborted reservation for a foreign committed revision of the same number', async () => {
    const f = fixture();
    await f.a.mirror.reconcile(f.local.kv);
    await f.b.mirror.reconcile(f.local.kv);
    commit(f.a.mirror, f.local, [['career', 'first']]);
    await settle();
    // Reserve 8, then abort: neither local data nor written() advances.
    expect(f.a.mirror.stamp({ put: vi.fn() } as unknown as IDBObjectStore, 7)).toBe(8);
    expect(f.a.mirror.currentRevision).toBe(8);
    expect(f.local.data.get(REVISION_KEY)).toBe(7);
    expect(commit(f.b.mirror, f.local, [['settings', 'foreign']])).toBe(8);
    await settle();
    expect(commit(f.a.mirror, f.local, [['career', 'returning owner']])).toBe(9);
    await settle();
    expect(f.a.saves.commit).toHaveBeenCalledTimes(1);
    expect(f.b.saves.commit).not.toHaveBeenCalled();
    expect(f.native.load()).toMatchObject({
      revision: 7,
      entries: { career: 'first', settings: 'old' },
    });
    expect(f.local.data.get(REVISION_KEY)).toBe(9);
  });

  it('retains ordinary single-owner aborted gaps and delayed-IPC coalescing', async () => {
    const f = fixture();
    await f.a.mirror.reconcile(f.local.kv);
    expect(f.a.mirror.stamp({ put: vi.fn() } as unknown as IDBObjectStore, 6)).toBe(7);
    let accept!: () => void;
    f.a.saves.commit!.mockImplementationOnce(
      (entries, revision, previous) =>
        new Promise<number>((resolve) => {
          accept = () => resolve(f.native.commit(entries, revision, previous));
        }),
    );
    expect(commit(f.a.mirror, f.local, [['career', 'first']])).toBe(8);
    expect(commit(f.a.mirror, f.local, [['settings', 'second']])).toBe(9);
    expect(commit(f.a.mirror, f.local, [['career', 'third']])).toBe(10);
    expect(f.a.saves.commit).toHaveBeenCalledTimes(1);
    expect(f.native.info().revision).toBe(6);
    accept();
    await settle();
    expect(f.a.saves.commit).toHaveBeenNthCalledWith(1, [['career', 'first']], 8, 6);
    expect(f.a.saves.commit).toHaveBeenNthCalledWith(
      2,
      [['settings', 'second'], ['career', 'third']],
      10,
      8,
    );
    expect(f.native.load()).toEqual({
      revision: 10,
      complete: true,
      entries: { career: 'third', settings: 'second' },
    });
  });

  it('blocks incremental certification after a failed full seed and unblocks after complete recovery', async () => {
    const files = disk();
    const state = local({ career: 'must survive' }, 6);
    const owner = bridge(files.native);
    owner.saves.seed.mockResolvedValueOnce(false);
    await expect(owner.mirror.reconcile(state.kv)).resolves.toMatchObject({
      action: 'failed',
      revision: 7,
      detail: 'Mirror seed rejected',
    });
    expect(commit(owner.mirror, state, [['settings', 'new']])).toBe(8);
    await settle();
    expect(owner.saves.commit).not.toHaveBeenCalled();
    expect(files.native.load()).toEqual({ revision: 0, complete: true, entries: {} });
    await expect(owner.mirror.reconcile(state.kv)).resolves.toMatchObject({
      action: 'seeded',
      revision: 9,
    });
    expect(files.native.load()).toEqual({
      revision: 9,
      complete: true,
      entries: { career: 'must survive', settings: 'new' },
    });
    expect(commit(owner.mirror, state, [['settings', 'after recovery']])).toBe(10);
    await settle();
    expect(owner.saves.commit).toHaveBeenCalledExactlyOnceWith(
      [['settings', 'after recovery']],
      10,
      9,
    );
  });

  it('fails a seed at the safe-integer limit before reserving or publishing an invalid revision', async () => {
    const f = fixture();
    f.local.data.set(REVISION_KEY, Number.MAX_SAFE_INTEGER);
    await expect(f.a.mirror.reconcile(f.local.kv)).resolves.toMatchObject({
      action: 'failed',
      revision: Number.MAX_SAFE_INTEGER,
      detail: 'Desktop save revision exhausted',
    });
    expect(f.local.data.get(REVISION_KEY)).toBe(Number.MAX_SAFE_INTEGER);
    expect(f.a.saves.seed).not.toHaveBeenCalled();
    const put = vi.fn();
    expect(() =>
      f.a.mirror.stamp({ put } as unknown as IDBObjectStore, Number.MAX_SAFE_INTEGER),
    ).toThrow(RangeError);
    expect(put).not.toHaveBeenCalled();
    expect(f.a.saves.commit).not.toHaveBeenCalled();
    expect(f.native.info().revision).toBe(6);
  });
});

class Request {
  result: unknown;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  succeed(value: unknown) {
    this.result = structuredClone(value);
    this.onsuccess?.();
  }
  fail(error: DOMException) {
    this.error = error;
    this.onerror?.();
  }
}

class Transaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readonly reads: { key: string; request: Request }[] = [];
  readonly pending = new Map<string, unknown>();
  aborted = false;
  readonly store = {
    get: vi.fn((key: string) => {
      const request = new Request();
      this.reads.push({ key, request });
      return request;
    }),
    put: vi.fn((value: unknown, key: string) => {
      this.pending.set(key, structuredClone(value));
      return new Request();
    }),
  };
  objectStore = vi.fn((_name: string) => this.store);
  abort = vi.fn(() => {
    this.aborted = true;
    this.pending.clear();
    this.onabort?.();
  });
  constructor(private readonly data: Map<string, unknown>) {}
  complete() {
    if (this.aborted) throw new Error('Cannot commit an aborted transaction');
    for (const [key, value] of this.pending) this.data.set(key, value);
    this.oncomplete?.();
  }
}

async function storage(revision = 6) {
  const f = fixture(true, revision);
  const report = await f.a.mirror.reconcile(f.local.kv);
  // Connection opening is covered elsewhere. This harness starts both actual
  // mirror implementations in sync and isolates SaveStore's write transaction.
  vi.spyOn(f.a.mirror, 'reconcile').mockResolvedValue(report);
  vi.spyOn(DesktopMirror, 'detect').mockReturnValue(f.a.mirror);
  const transactions: Transaction[] = [];
  const db = {
    close: vi.fn(),
    transaction: vi.fn((_name: string, _mode: IDBTransactionMode) => {
      const tx = new Transaction(f.local.data);
      transactions.push(tx);
      return tx;
    }),
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request = { result: db, onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  return { ...f, db, transactions, store: new SaveStore() };
}

function observe<T>(promise: Promise<T>) {
  const settled = vi.fn();
  const result = promise.then(
    (value) => {
      settled();
      return { value };
    },
    (error: unknown) => {
      settled();
      return { error };
    },
  );
  return { result, settled };
}
const methods = ['write', 'writeWithBackup', 'update'] as const;
type Method = (typeof methods)[number];

async function begin(f: Awaited<ReturnType<typeof storage>>, method: Method) {
  const operation = observe(
    method === 'update'
      ? f.store.update('career', () => 'latest')
      : f.store[method]('career', 'latest'),
  );
  await settle();
  const tx = f.transactions.at(-1)!;
  if (method !== 'write') tx.reads[0].request.succeed(f.local.data.get('career'));
  expect(tx.reads.map(({ key }) => key)).toEqual(
    method === 'write' ? [REVISION_KEY] : ['career', REVISION_KEY],
  );
  return { operation, tx, revisionRead: tx.reads.at(-1)!.request };
}

describe.each(methods)('SaveStore %s transaction revision reservation', (method) => {
  it('reads the persisted revision under the same lock and mirrors only after commit', async () => {
    const f = await storage();
    const { tx, operation, revisionRead } = await begin(f, method);
    expect(tx.pending.has(REVISION_KEY)).toBe(false);
    revisionRead.succeed(f.local.data.get(REVISION_KEY));
    expect(tx.pending.get(REVISION_KEY)).toBe(7);
    await settle();
    expect(operation.settled).not.toHaveBeenCalled();
    expect(f.local.data.get('career')).toBe('old');
    expect(f.native.info().revision).toBe(6);
    expect(f.a.saves.commit).not.toHaveBeenCalled();
    tx.complete();
    await expect(operation.result).resolves.toEqual({
      value: method === 'update' ? 'latest' : undefined,
    });
    await settle();
    expect(f.local.data.get(REVISION_KEY)).toBe(7);
    expect(f.native.load()).toMatchObject({ revision: 7, entries: { career: 'latest' } });
    expect(f.a.saves.commit).toHaveBeenCalledTimes(1);
  });

  it('rolls back staged data when the revision read fails', async () => {
    const f = await storage();
    const before = new Map(f.local.data);
    const { tx, operation, revisionRead } = await begin(f, method);
    const error = new DOMException('Revision request failed', 'UnknownError');
    revisionRead.fail(error);
    await expect(operation.result).resolves.toEqual({ error });
    expect(tx.abort).toHaveBeenCalledTimes(1);
    expect(f.local.data).toEqual(before);
    expect(f.a.saves.commit).not.toHaveBeenCalled();
    expect(f.native.info().revision).toBe(6);
  });

  it('aborts at revision exhaustion instead of committing data with an invalid counter', async () => {
    const f = await storage(Number.MAX_SAFE_INTEGER);
    const before = new Map(f.local.data);
    const { tx, operation, revisionRead } = await begin(f, method);
    revisionRead.succeed(Number.MAX_SAFE_INTEGER);
    await expect(operation.result).resolves.toMatchObject({
      error: { name: 'RangeError', message: 'Desktop save revision exhausted' },
    });
    expect(tx.abort).toHaveBeenCalledTimes(1);
    expect(f.local.data).toEqual(before);
    expect(f.a.saves.commit).not.toHaveBeenCalled();
    expect(f.native.info().revision).toBe(Number.MAX_SAFE_INTEGER);
  });
});

it('passes an absent persisted revision as zero instead of the direct-owner default', async () => {
  const f = await storage();
  f.local.data.delete(REVISION_KEY);
  const stamp = vi.spyOn(f.a.mirror, 'stamp');
  const { tx, operation, revisionRead } = await begin(f, 'update');
  revisionRead.succeed(undefined);
  expect(stamp).toHaveBeenCalledExactlyOnceWith(tx.store, 0);
  tx.complete();
  await operation.result;
  await settle();
  expect(f.local.data.get(REVISION_KEY)).toBe(7);
  expect(f.a.saves.commit).not.toHaveBeenCalled();
  expect(f.native.info().revision).toBe(6);
});
