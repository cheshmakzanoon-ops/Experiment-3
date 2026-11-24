import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MotoboundDesktop } from '../src/desktop/bridge.ts';
import { SaveStore } from '../src/storage/data.ts';
import { DesktopMirror, REVISION_KEY } from '../src/storage/desktop-mirror.ts';

/** Preserve the real split between request-time cloning and later transaction
 * completion. DesktopMirror itself is real; the IPC boundary clones its input
 * when invoked, just as an Electron structured-clone message does. */
class SaveTransaction {
  oncomplete: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: DOMException | null = null;
  aborted = false;
  readonly pending = new Map<string, unknown>();
  readonly reads: { result: unknown; onsuccess: (() => void) | null; onerror: null }[] = [];
  readonly put = vi.fn((value: unknown, key: string) => {
    this.pending.set(key, structuredClone(value));
    return {};
  });
  readonly objectStore = vi.fn(() => ({
    put: this.put,
    get: (key: string) => this.request(structuredClone(this.data.get(key))),
    getAllKeys: () => this.request([...this.data.keys()]),
  }));

  constructor(private readonly data: Map<string, unknown>) {}

  private request(result: unknown) {
    const request = { result, onsuccess: null as (() => void) | null, onerror: null };
    this.reads.push(request);
    return request;
  }

  succeedReads() {
    for (const request of this.reads.splice(0)) request.onsuccess?.();
  }

  complete() {
    if (this.aborted) throw new Error('Cannot commit an aborted transaction');
    this.succeedReads();
    for (const [key, value] of this.pending) this.data.set(key, value);
    this.oncomplete?.();
  }

  abort() {
    this.aborted = true;
    this.pending.clear();
    queueMicrotask(() => this.onabort?.());
  }
}

function storage(initial: Record<string, unknown> = {}, desktop = true, delayedOpen = false) {
  const data = new Map(Object.entries(structuredClone(initial)));
  const writes: SaveTransaction[] = [];
  const mirrored: { key: string; value: unknown; revision: number }[] = [];
  const bridge = {
    saves: {
      info: async () => ({
        revision: data.get(REVISION_KEY) ?? 0,
        keys: [...data.keys()].filter((key) => key !== REVISION_KEY),
      }),
      put: async (key: string, value: unknown, revision: number) => {
        mirrored.push({ key, value: structuredClone(value), revision });
        return revision;
      },
    },
  } as unknown as MotoboundDesktop;
  const mirror = desktop ? DesktopMirror.forBridge(bridge) : null;
  vi.spyOn(DesktopMirror, 'detect').mockReturnValue(mirror);
  const db = {
    onversionchange: null,
    onclose: null,
    close: vi.fn(),
    transaction: (_name: string, mode: IDBTransactionMode) => {
      const tx = new SaveTransaction(data);
      if (mode === 'readonly') queueMicrotask(() => tx.complete());
      else writes.push(tx);
      return tx;
    },
  };
  const request = {
    result: db,
    onsuccess: null as (() => void) | null,
    onerror: null,
    onblocked: null,
    onupgradeneeded: null,
  };
  const open = () => request.onsuccess?.();
  vi.stubGlobal('indexedDB', {
    open: vi.fn(() => {
      if (!delayedOpen) queueMicrotask(open);
      return request;
    }),
  });
  return { store: new SaveStore(), data, writes, mirrored, mirror, open };
}

function observe(promise: Promise<void>) {
  return promise.then(
    () => ({ error: null }),
    (error: unknown) => ({ error }),
  );
}

async function queued(writes: SaveTransaction[], index = 0) {
  await vi.waitFor(() => expect(writes.length).toBeGreaterThan(index));
  const tx = writes[index];
  tx.succeedReads();
  return tx;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SaveStore and desktop mirror commit payload ownership', () => {
  it.each(['write', 'writeWithBackup'] as const)(
    '%s mirrors the committed private snapshot after caller mutation',
    async (method) => {
      const { store, writes, data, mirrored } = storage({
        profile: { laps: 3 },
        [REVISION_KEY]: 7,
      });
      const value = { profile: { laps: 4 }, options: ['wet', 'manual'] };
      const saving = observe(store[method]('profile', value));
      const tx = await queued(writes);
      value.profile.laps = 99;
      value.options.splice(0, 2, 'changed');
      tx.complete();
      expect(await saving).toEqual({ error: null });
      expect(data.get('profile')).toEqual({ profile: { laps: 4 }, options: ['wet', 'manual'] });
      expect(mirrored.find((entry) => entry.key === 'profile')).toEqual({
        key: 'profile',
        value: data.get('profile'),
        revision: 8,
      });
      expect(data.get(REVISION_KEY)).toBe(8);
      if (method === 'writeWithBackup') {
        expect(data.get('profile:backup')).toEqual({ laps: 3 });
        expect(mirrored[0]).toEqual({ key: 'profile:backup', value: { laps: 3 }, revision: 8 });
      }
    },
  );

  it.each(['write', 'writeWithBackup'] as const)(
    '%s captures at enqueue after opening, rather than before the connection is ready',
    async (method) => {
      const { store, writes, data, mirrored, open } = storage({}, true, true);
      const value = { version: 1 };
      const saving = observe(store[method]('profile', value));
      value.version = 2;
      open();
      const tx = await queued(writes);
      value.version = 3;
      tx.complete();
      expect(await saving).toEqual({ error: null });
      expect(data.get('profile')).toEqual({ version: 2 });
      expect(mirrored).toEqual([{ key: 'profile', value: { version: 2 }, revision: 1 }]);
    },
  );

  it('keeps successive revisions attached to their own snapshots of one reused object', async () => {
    const { store, writes, data, mirrored } = storage();
    const value = { lap: 1 };
    const first = observe(store.write('profile', value));
    const firstTx = await queued(writes);
    value.lap = 2;
    firstTx.complete();
    await first;
    const second = observe(store.write('profile', value));
    const secondTx = await queued(writes, 1);
    value.lap = 3;
    secondTx.complete();
    await second;
    expect(mirrored).toEqual([
      { key: 'profile', value: { lap: 1 }, revision: 1 },
      { key: 'profile', value: { lap: 2 }, revision: 2 },
    ]);
    expect(data.get('profile')).toEqual({ lap: 2 });
    expect(data.get(REVISION_KEY)).toBe(2);
  });

  it.each(['write', 'writeWithBackup'] as const)(
    '%s rolls back a clone failure without publishing a mirror or revision',
    async (method) => {
      const original = { profile: { lap: 7 }, 'profile:backup': { lap: 6 }, [REVISION_KEY]: 12 };
      const { store, writes, data, mirrored, mirror } = storage(original);
      const saving = observe(store[method]('profile', { cannotClone: () => undefined }));
      const tx = await queued(writes);
      const result = await saving;
      expect(result.error).toBeInstanceOf(DOMException);
      expect((result.error as DOMException).name).toBe('DataCloneError');
      expect(tx.aborted).toBe(true);
      expect(Object.fromEntries(data)).toEqual(original);
      expect(mirrored).toEqual([]);
      expect(mirror!.currentRevision).toBe(12);
    },
  );

  it.each(['write', 'writeWithBackup'] as const)(
    '%s never publishes a captured payload from an aborted transaction',
    async (method) => {
      const { store, writes, data, mirrored } = storage({ profile: { lap: 3 }, [REVISION_KEY]: 4 });
      const value = { lap: 4 };
      const saving = observe(store[method]('profile', value));
      const tx = await queued(writes);
      value.lap = 5;
      tx.abort();
      expect((await saving).error).toBeInstanceOf(Error);
      expect(data.get('profile')).toEqual({ lap: 3 });
      expect(data.get(REVISION_KEY)).toBe(4);
      expect(mirrored).toEqual([]);
    },
  );

  it.each(['write', 'writeWithBackup'] as const)(
    '%s evaluates desktop caller getters once for both persisted copies',
    async (method) => {
      const { store, writes, data, mirrored } = storage();
      let reads = 0;
      const value = {
        get lap() {
          return ++reads;
        },
      };
      const saving = observe(store[method]('profile', value));
      const tx = await queued(writes);
      expect(reads).toBe(1);
      tx.complete();
      expect(await saving).toEqual({ error: null });
      expect(reads).toBe(1);
      expect(mirrored).toEqual([{ key: 'profile', value: data.get('profile'), revision: 1 }]);
    },
  );

  it.each(['write', 'writeWithBackup'] as const)(
    '%s leaves browser-only values to the ordinary IndexedDB clone',
    async (method) => {
      const { store, writes, data, mirrored } = storage({}, false);
      let reads = 0;
      const value = {
        get lap() {
          return ++reads;
        },
      };
      const saving = observe(store[method]('profile', value));
      const tx = await queued(writes);
      expect(reads).toBe(1);
      tx.complete();
      expect(await saving).toEqual({ error: null });
      expect(data.get('profile')).toEqual({ lap: 1 });
      expect(mirrored).toEqual([]);
    },
  );
});
