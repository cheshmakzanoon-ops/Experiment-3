import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveStore } from '../src/storage/data.ts';
import { DesktopMirror, REVISION_KEY } from '../src/storage/desktop-mirror.ts';

class Request {
  result: unknown;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;

  fail(error: DOMException) {
    this.error = error;
    this.onerror?.();
  }
}

/** Requests and commit/abort are driven independently. This checks SaveStore's
 * callback/ownership contract, not native IndexedDB scheduling between tabs. */
class Transaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readonly read = new Request();
  readonly writes: Request[] = [];
  readonly pending = new Map<string, unknown>();
  private reading = false;
  private aborted = false;
  private readonly reads: { key: string; request: Request }[] = [];
  readonly store = {
    get: vi.fn((key: string) => {
      const request = this.reads.length ? new Request() : this.read;
      this.reads.push({ key, request });
      return request;
    }),
    put: vi.fn((value: unknown, key: string) => {
      // A deferred updater/write would run after this request event is inactive.
      if (!this.reading) throw new Error('Write outside the read-success callback');
      this.pending.set(key, structuredClone(value));
      const request = new Request();
      this.writes.push(request);
      return request;
    }),
  };
  objectStore = vi.fn((_name: string) => this.store);
  abort = vi.fn(() => {
    this.aborted = true;
    this.pending.clear();
    this.onabort?.();
  });

  constructor(private readonly data: Map<string, unknown>) {}

  readSuccess() {
    // Deliver the primary read, then any revision read queued by its callback.
    for (const { key, request } of this.reads) {
      if (this.aborted) break;
      request.result = structuredClone(
        this.pending.has(key) ? this.pending.get(key) : this.data.get(key),
      );
      this.reading = true;
      try {
        request.onsuccess?.();
      } finally {
        this.reading = false;
      }
    }
  }

  complete() {
    if (this.aborted) throw new Error('Cannot complete an aborted transaction');
    for (const [key, value] of this.pending) this.data.set(key, value);
    this.oncomplete?.();
  }
}

function fixture(initial: Record<string, unknown> = {}, mirrored = false) {
  const data = new Map(Object.entries(initial));
  const transactions: Transaction[] = [];
  let revision = 6;
  const desktop = {
    reconcile: vi.fn(async () => ({ action: 'none', keys: 0, revision: 6 })),
    stamp: vi.fn((store: IDBObjectStore) => {
      store.put(++revision, REVISION_KEY);
      return revision;
    }),
    written: vi.fn(),
  };
  const db = {
    close: vi.fn(),
    transaction: vi.fn((_name: string, _mode: IDBTransactionMode) => {
      const tx = new Transaction(data);
      transactions.push(tx);
      return tx;
    }),
  };
  const open = vi.fn(() => {
    const request = { result: db, onsuccess: null as (() => void) | null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  });
  vi.spyOn(DesktopMirror, 'detect').mockReturnValue(
    mirrored ? (desktop as unknown as DesktopMirror) : null,
  );
  vi.stubGlobal('indexedDB', { open });
  return { store: new SaveStore(), data, db, transactions, desktop, open };
}

function observe(promise: Promise<unknown>) {
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

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SaveStore atomic updates', () => {
  it('reads and transforms in one readwrite transaction, resolving only after commit', async () => {
    const f = fixture({ board: ['old'], 'board:backup': ['recovery'] });
    const updater = vi.fn((stored: unknown) => [...(stored as string[]), 'new']);
    const operation = observe(f.store.update('board', updater));
    await flush();
    expect(f.db.transaction).toHaveBeenCalledExactlyOnceWith('saved', 'readwrite');
    const tx = f.transactions[0];
    expect(tx.store.get).toHaveBeenCalledExactlyOnceWith('board');
    expect(updater).not.toHaveBeenCalled();
    tx.readSuccess();
    expect(updater).toHaveBeenCalledExactlyOnceWith(['old']);
    expect(tx.store.put).toHaveBeenCalledExactlyOnceWith(['old', 'new'], 'board');
    await flush();
    expect(operation.settled).not.toHaveBeenCalled();
    expect(f.data.get('board')).toEqual(['old']);
    tx.complete();
    await expect(operation.result).resolves.toEqual({ value: ['old', 'new'] });
    expect(f.data.get('board')).toEqual(['old', 'new']);
    expect(f.data.get('board:backup')).toEqual(['recovery']);
    expect(f.open).toHaveBeenCalledExactlyOnceWith('apex-formula', 1);
  });

  it('uses each transaction read result when separate instances update an existing board', async () => {
    const f = fixture({ board: ['old'] });
    const other = new SaveStore();
    const first = observe(f.store.update('board', (stored) => [...(stored as string[]), 'a']));
    const second = observe(other.update('board', (stored) => [...(stored as string[]), 'b']));
    await flush();
    expect(f.db.transaction.mock.calls).toEqual([
      ['saved', 'readwrite'],
      ['saved', 'readwrite'],
    ]);
    // Prescribe serialized transaction delivery; native scheduling is tested separately.
    f.transactions[0].readSuccess();
    f.transactions[0].complete();
    f.transactions[1].readSuccess();
    f.transactions[1].complete();
    await expect(first.result).resolves.toEqual({ value: ['old', 'a'] });
    await expect(second.result).resolves.toEqual({ value: ['old', 'a', 'b'] });
    expect(f.data.get('board')).toEqual(['old', 'a', 'b']);
  });

  it('keeps the committed IndexedDB and mirror snapshots private from updater and result mutation', async () => {
    const f = fixture({}, true);
    const value = { laps: [90], samples: new Float32Array([1, 2]) };
    const operation = observe(f.store.update('board', () => value));
    await flush();
    const tx = f.transactions[0];
    tx.readSuccess();
    const expected = structuredClone(value);
    value.laps.push(70);
    value.samples[0] = 99;
    expect(f.desktop.stamp).toHaveBeenCalledExactlyOnceWith(tx.store, 0);
    expect(tx.pending.get(REVISION_KEY)).toBe(7);
    expect(f.data.size).toBe(0);
    expect(f.desktop.written).not.toHaveBeenCalled();
    f.desktop.written.mockImplementationOnce(() => {
      expect(f.data.get('board')).toEqual(expected);
      expect(f.data.get(REVISION_KEY)).toBe(7);
    });
    tx.complete();
    const result = await operation.result;
    expect('value' in result && result.value).toBe(value);
    value.laps.length = 0;
    value.samples.fill(-1);
    expect(f.desktop.written).toHaveBeenCalledExactlyOnceWith([['board', expected]], 7);
    expect(f.data.get('board')).toEqual(expected);
  });

  it.each([false, true])(
    'treats the same stored reference as a no-op, including unsupported in-place mutation: %s',
    async (mutate) => {
      const f = fixture({ board: [90], [REVISION_KEY]: 6 }, true);
      let returned: unknown;
      const operation = observe(
        f.store.update('board', (stored) => {
          if (mutate) (stored as number[]).push(70);
          return (returned = stored);
        }),
      );
      await flush();
      const tx = f.transactions[0];
      tx.readSuccess();
      await flush();
      expect(operation.settled).not.toHaveBeenCalled();
      expect(tx.store.put).not.toHaveBeenCalled();
      expect(f.desktop.stamp).not.toHaveBeenCalled();
      tx.complete();
      const result = await operation.result;
      expect('value' in result && result.value).toBe(returned);
      expect(f.data.get('board')).toEqual([90]);
      expect(f.data.get(REVISION_KEY)).toBe(6);
      expect(f.desktop.written).not.toHaveBeenCalled();
    },
  );

  it('keeps an absent value absent on identity return and writes an equal fresh object', async () => {
    const f = fixture({}, true);
    const absent = observe(f.store.update('board', (stored) => stored));
    await flush();
    f.transactions[0].readSuccess();
    f.transactions[0].complete();
    await expect(absent.result).resolves.toEqual({ value: undefined });
    expect(f.data.has('board')).toBe(false);
    expect(f.desktop.stamp).not.toHaveBeenCalled();

    f.data.set('board', [90]);
    const equal = observe(f.store.update('board', (stored) => [...(stored as number[])]));
    await flush();
    f.transactions[1].readSuccess();
    expect(f.transactions[1].store.put).toHaveBeenCalledWith([90], 'board');
    f.transactions[1].complete();
    await expect(equal.result).resolves.toEqual({ value: [90] });
    expect(f.desktop.stamp).toHaveBeenCalledTimes(1);
    expect(f.desktop.written).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Promise', () => Promise.resolve([70])],
    ['object thenable', () => ({ then: vi.fn() })],
    ['callable thenable', () => Object.assign(() => undefined, { then: vi.fn() })],
  ] as const)('rejects a %s result before writing or stamping', async (_kind, output) => {
    const f = fixture({ board: [90] }, true);
    const operation = observe(f.store.update('board', output));
    await flush();
    const tx = f.transactions[0];
    tx.readSuccess();
    await expect(operation.result).resolves.toMatchObject({
      error: { name: 'TypeError', message: expect.stringContaining('must be synchronous') },
    });
    expect(tx.abort).toHaveBeenCalledTimes(1);
    expect(tx.store.put).not.toHaveBeenCalled();
    expect(f.data.get('board')).toEqual([90]);
    expect(f.desktop.stamp).not.toHaveBeenCalled();
    expect(f.desktop.written).not.toHaveBeenCalled();
  });

  it.each(['Promise', 'thenable'] as const)(
    'observes a rejected %s without accepting its result or causing an unhandled rejection',
    async (kind) => {
      const f = fixture({ board: [90] }, true);
      const error = new Error('Asynchronous updater failed');
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        const operation = observe(
          f.store.update('board', () =>
            kind === 'Promise'
              ? Promise.reject(error)
              : { then: (_resolve: unknown, reject: (reason: unknown) => void) => reject(error) },
          ),
        );
        await flush();
        const tx = f.transactions[0];
        tx.readSuccess();
        await expect(operation.result).resolves.toMatchObject({
          error: { name: 'TypeError', message: expect.stringContaining('must be synchronous') },
        });
        // Node reports unhandled rejections after the microtask checkpoint.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(unhandled).not.toHaveBeenCalled();
        expect(tx.abort).toHaveBeenCalledTimes(1);
        expect(tx.store.put).not.toHaveBeenCalled();
        expect(f.data.get('board')).toEqual([90]);
        expect(f.desktop.stamp).not.toHaveBeenCalled();
        expect(f.desktop.written).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    },
  );

  it('aborts a throwing updater and allows a later update to recover on the same connection', async () => {
    const f = fixture({ board: [90] }, true);
    const error = new Error('Invalid record');
    const failed = observe(
      f.store.update('board', (stored) => {
        (stored as number[]).push(70);
        throw error;
      }),
    );
    await flush();
    f.transactions[0].readSuccess();
    await expect(failed.result).resolves.toEqual({ error });
    expect(f.transactions[0].abort).toHaveBeenCalledTimes(1);
    expect(f.data.get('board')).toEqual([90]);
    expect(f.desktop.written).not.toHaveBeenCalled();

    const recovered = observe(f.store.update('board', (stored) => [...(stored as number[]), 80]));
    await flush();
    f.transactions[1].readSuccess();
    f.transactions[1].complete();
    await expect(recovered.result).resolves.toEqual({ value: [90, 80] });
    expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.data.get('board')).toEqual([90, 80]);
    expect(f.desktop.written).toHaveBeenCalledExactlyOnceWith([['board', [90, 80]]], 7);
  });

  it.each(['read', 'write'] as const)(
    'preserves a %s request failure and rolls back',
    async (phase) => {
      const f = fixture({ board: [90], [REVISION_KEY]: 6 }, true);
      const updater = vi.fn(() => [70]);
      const operation = observe(f.store.update('board', updater));
      await flush();
      const tx = f.transactions[0];
      const error = new DOMException('Request failed', 'UnknownError');
      if (phase === 'read') {
        tx.read.fail(error);
        expect(updater).not.toHaveBeenCalled();
      } else {
        tx.readSuccess();
        tx.writes[0].fail(error);
      }
      await expect(operation.result).resolves.toEqual({ error });
      expect(tx.abort).toHaveBeenCalledTimes(1);
      expect(f.data.get('board')).toEqual([90]);
      expect(f.data.get(REVISION_KEY)).toBe(6);
      expect(f.desktop.written).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'rejects a late transaction abort, including a no-op: %s',
    async (noop) => {
      const f = fixture({ board: [90], [REVISION_KEY]: 6 }, true);
      const operation = observe(f.store.update('board', (stored) => (noop ? stored : [70])));
      await flush();
      const tx = f.transactions[0];
      tx.readSuccess();
      tx.abort();
      await expect(operation.result).resolves.toEqual({ error: new Error('Save aborted') });
      expect(f.data.get('board')).toEqual([90]);
      expect(f.data.get(REVISION_KEY)).toBe(6);
      expect(f.desktop.written).not.toHaveBeenCalled();
    },
  );

  it('rejects transaction errors and never mirrors their staged writes', async () => {
    const f = fixture({ board: [90] }, true);
    const operation = observe(f.store.update('board', () => [70]));
    await flush();
    const tx = f.transactions[0];
    tx.readSuccess();
    const error = new DOMException('Quota exhausted', 'QuotaExceededError');
    tx.error = error;
    tx.onerror?.();
    tx.abort();
    await expect(operation.result).resolves.toEqual({ error });
    expect(f.data.get('board')).toEqual([90]);
    expect(f.desktop.written).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'aborts an uncloneable result with desktop mirror: %s',
    async (mirrored) => {
      const f = fixture({ board: [90] }, mirrored);
      const operation = observe(f.store.update('board', () => () => undefined));
      await flush();
      const tx = f.transactions[0];
      tx.readSuccess();
      await expect(operation.result).resolves.toMatchObject({ error: { name: 'DataCloneError' } });
      expect(tx.abort).toHaveBeenCalledTimes(1);
      expect(f.data.get('board')).toEqual([90]);
      expect(f.desktop.stamp).not.toHaveBeenCalled();
      expect(f.desktop.written).not.toHaveBeenCalled();
    },
  );

  it('rolls back the queued value and revision when mirror stamping throws', async () => {
    const f = fixture({ board: [90], [REVISION_KEY]: 6 }, true);
    const error = new DOMException('Revision could not be saved', 'UnknownError');
    f.desktop.stamp.mockImplementationOnce((store) => {
      store.put(7, REVISION_KEY);
      throw error;
    });
    const operation = observe(f.store.update('board', () => [70]));
    await flush();
    const tx = f.transactions[0];
    tx.readSuccess();
    await expect(operation.result).resolves.toEqual({ error });
    expect(tx.store.put).toHaveBeenCalledTimes(2);
    expect(tx.abort).toHaveBeenCalledTimes(1);
    expect(f.data.get('board')).toEqual([90]);
    expect(f.data.get(REVISION_KEY)).toBe(6);
    expect(f.desktop.written).not.toHaveBeenCalled();
  });
});
