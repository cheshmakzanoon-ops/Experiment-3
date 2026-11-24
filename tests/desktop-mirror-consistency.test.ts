import { describe, expect, it, vi } from 'vitest';
import type { DesktopSaveSnapshot, MotoboundDesktop } from '../src/desktop/bridge.ts';
import {
  DesktopMirror,
  idbKv,
  REVISION_KEY,
  type MirrorKv,
} from '../src/storage/desktop-mirror.ts';

function kvOf(initial: Record<string, unknown>) {
  const data = new Map(Object.entries(initial));
  const kv: MirrorKv = {
    keys: async () => [...data.keys()],
    get: async (key) => data.get(key),
    entries: async () => Object.fromEntries(data),
    putMany: vi.fn(async (entries) => {
      for (const [key, value] of Object.entries(entries)) data.set(key, value);
    }),
  };
  return { data, kv };
}

function bridgeOf(snapshot: DesktopSaveSnapshot) {
  const saves = {
    info: vi.fn(async () => ({
      revision: snapshot.revision,
      savedAt: 0,
      source: 'primary',
      keys: Object.keys(snapshot.entries),
      path: '/unused-controlled-mirror',
    })),
    load: vi.fn(async () => snapshot),
    seed: vi.fn(async (_entries: Record<string, unknown>, _revision: number) => true),
    put: vi.fn(async (_key: string, _value: unknown, revision: number) => revision),
    flush: vi.fn(async () => true),
  };
  return { bridge: { version: 1, saves } as unknown as MotoboundDesktop, saves };
}

function stamp(mirror: DesktopMirror) {
  const put = vi.fn();
  return { revision: mirror.stamp({ put } as unknown as IDBObjectStore), put };
}

describe('desktop mirror snapshot revision ownership', () => {
  it('adopts the revision and key count from the snapshot loaded after metadata', async () => {
    const { kv, data } = kvOf({
      career: 'local old',
      'career:backup': 'recovery',
      [REVISION_KEY]: 3,
    });
    const { bridge, saves } = bridgeOf({ revision: 7, entries: { career: 'file old' } });
    saves.load.mockResolvedValueOnce({
      revision: 12,
      entries: { career: 'file latest', settings: { volume: 0.5 } },
    });
    const mirror = DesktopMirror.forBridge(bridge);

    await expect(mirror.reconcile(kv)).resolves.toEqual({
      action: 'restored',
      keys: 2,
      revision: 12,
    });
    expect(data.get('career')).toBe('file latest');
    expect(data.get('career:backup')).toBe('recovery');
    expect(data.get(REVISION_KEY)).toBe(12);
    expect(mirror.currentRevision).toBe(12);
    const next = stamp(mirror);
    expect(next.revision).toBe(13);
    expect(next.put).toHaveBeenCalledWith(13, REVISION_KEY);
    mirror.written([['career', 'next local']], next.revision);
    expect(saves.put).toHaveBeenCalledWith('career', 'next local', 13);
  });

  it('seeds from the revision belonging to the later local entries snapshot', async () => {
    const { kv, data } = kvOf({ career: 'local old', [REVISION_KEY]: 5 });
    const { bridge, saves } = bridgeOf({ revision: 2, entries: { career: 'file old' } });
    kv.entries = async () => {
      // A local write committed between the earlier get() and this snapshot.
      data.set('career', 'local latest');
      data.set('career:backup', 'local old');
      data.set(REVISION_KEY, 12);
      return Object.fromEntries(data);
    };
    const mirror = DesktopMirror.forBridge(bridge);

    await expect(mirror.reconcile(kv)).resolves.toEqual({
      action: 'seeded',
      keys: 2,
      revision: 13,
    });
    expect(saves.seed).toHaveBeenCalledWith(
      { career: 'local latest', 'career:backup': 'local old' },
      13,
    );
    expect(data.get(REVISION_KEY)).toBe(13);
    expect(stamp(mirror).revision).toBe(14);
  });

  it('never reuses a reserved revision after reconciling the same persisted state again', async () => {
    const { kv } = kvOf({ career: 'saved', [REVISION_KEY]: 10 });
    const { bridge } = bridgeOf({ revision: 10, entries: { career: 'saved' } });
    const mirror = DesktopMirror.forBridge(bridge);
    await mirror.reconcile(kv);
    expect(stamp(mirror).revision).toBe(11);

    // The stamped transaction may have aborted, leaving both persisted copies at 10.
    await expect(mirror.reconcile(kv)).resolves.toEqual({
      action: 'in-sync',
      keys: 1,
      revision: 11,
    });
    expect(stamp(mirror).revision).toBe(12);
  });

  it('retains an observed snapshot revision when the atomic restore fails without throwing', async () => {
    const { kv, data } = kvOf({ career: 'local', 'career:backup': 'recovery', [REVISION_KEY]: 3 });
    const before = new Map(data);
    const { bridge, saves } = bridgeOf({ revision: 7, entries: { career: 'file old' } });
    saves.load.mockResolvedValueOnce({ revision: 12, entries: { career: 'file latest' } });
    kv.putMany = vi.fn(async () => {
      throw new Error('Restore aborted');
    });
    const mirror = DesktopMirror.forBridge(bridge);

    await expect(mirror.reconcile(kv)).resolves.toEqual({
      action: 'failed',
      keys: 0,
      revision: 12,
      detail: 'Restore aborted',
    });
    expect(data).toEqual(before);
    expect(stamp(mirror).revision).toBe(13);
  });

  it('retains an observed file revision even if reading local metadata fails', async () => {
    const { kv, data } = kvOf({ career: 'local', [REVISION_KEY]: 3 });
    const before = new Map(data);
    const { bridge, saves } = bridgeOf({ revision: 12, entries: { career: 'file latest' } });
    kv.keys = async () => {
      throw new Error('Read transaction aborted');
    };
    const mirror = DesktopMirror.forBridge(bridge);

    await expect(mirror.reconcile(kv)).resolves.toEqual({
      action: 'failed',
      keys: 0,
      revision: 12,
      detail: 'Read transaction aborted',
    });
    expect(data).toEqual(before);
    expect(saves.load).not.toHaveBeenCalled();
    expect(saves.seed).not.toHaveBeenCalled();
    expect(stamp(mirror).revision).toBe(13);
  });
});

/** Keep request success separate from commit/abort; no browser or user storage is opened. */
class ControlledRequest {
  result: unknown;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;

  succeed(value: unknown) {
    this.result = value;
    this.onsuccess?.();
  }

  fail(error: DOMException) {
    this.error = error;
    this.onerror?.();
  }
}

class ControlledTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  requests: ControlledRequest[] = [];
  pending = new Map<IDBValidKey, unknown>();
  aborted = false;
  store = {
    get: vi.fn((_key: string) => this.request()),
    getAllKeys: vi.fn(() => this.request()),
    openCursor: vi.fn(() => this.request()),
    put: vi.fn((value: unknown, key: IDBValidKey) => {
      this.pending.set(key, structuredClone(value));
      return this.request();
    }),
  };
  objectStore = vi.fn((_name: string) => this.store);
  abort = vi.fn(() => {
    this.aborted = true;
    this.pending.clear();
    this.onabort?.();
  });

  constructor(private readonly data: Map<IDBValidKey, unknown>) {}

  private request() {
    const request = new ControlledRequest();
    this.requests.push(request);
    return request;
  }

  complete() {
    if (this.aborted) throw new Error('Cannot complete an aborted transaction');
    for (const [key, value] of this.pending) this.data.set(key, value);
    this.oncomplete?.();
  }
}

function database(initial: Record<string, unknown> = {}) {
  const data = new Map<IDBValidKey, unknown>(Object.entries(initial));
  const transactions: ControlledTransaction[] = [];
  const db = {
    transaction: vi.fn((_name: string, _mode: IDBTransactionMode) => {
      const tx = new ControlledTransaction(data);
      transactions.push(tx);
      return tx;
    }),
  };
  return { data, db, transactions, kv: idbKv(db as unknown as IDBDatabase) };
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

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const reads = [
  {
    name: 'keys',
    start: (kv: MirrorKv) => kv.keys(),
    succeed: (request: ControlledRequest) => request.succeed(['career', 'career:backup']),
    expected: ['career', 'career:backup'],
  },
  {
    name: 'get',
    start: (kv: MirrorKv) => kv.get(REVISION_KEY),
    succeed: (request: ControlledRequest) => request.succeed(12),
    expected: 12,
  },
  {
    name: 'entries',
    start: (kv: MirrorKv) => kv.entries(),
    succeed: (request: ControlledRequest) => {
      const next = vi.fn();
      request.succeed({ key: 'career', value: 'latest', continue: next });
      request.succeed({ key: 'career:backup', value: 'recovery', continue: next });
      request.succeed(null);
      expect(next).toHaveBeenCalledTimes(2);
    },
    expected: { career: 'latest', 'career:backup': 'recovery' },
  },
];

describe('desktop mirror IndexedDB transaction boundaries', () => {
  it.each(reads)('$name waits for transaction completion after request success', async (read) => {
    const { kv, transactions } = database();
    const observed = observe(read.start(kv));
    const tx = transactions[0];
    read.succeed(tx.requests[0]);
    await flush();
    expect(observed.settled).not.toHaveBeenCalled();
    tx.complete();
    await expect(observed.result).resolves.toEqual({ value: read.expected });
  });

  it.each(reads)('$name rejects a late abort instead of returning request data', async (read) => {
    const { kv, transactions } = database();
    const observed = observe(read.start(kv));
    const tx = transactions[0];
    read.succeed(tx.requests[0]);
    await flush();
    const error = new DOMException('Read transaction lost', 'AbortError');
    tx.error = error;
    tx.abort();
    await expect(observed.result).resolves.toEqual({ error });
  });

  it.each(reads)('$name rejects aborts even when the transaction has no error', async (read) => {
    const { kv, transactions } = database();
    const observed = observe(read.start(kv));
    read.succeed(transactions[0].requests[0]);
    transactions[0].abort();
    const result = await observed.result;
    expect(result).toHaveProperty('error');
    expect('error' in result && result.error).toBeInstanceOf(Error);
  });

  it.each(reads)(
    '$name retains the request error when the transaction error is unavailable',
    async (read) => {
      const { kv, transactions } = database();
      const observed = observe(read.start(kv));
      const error = new DOMException('Read failed', 'UnknownError');
      transactions[0].requests[0].fail(error);
      transactions[0].abort();
      await expect(observed.result).resolves.toEqual({ error });
    },
  );

  it('only publishes a batch after its transaction commits', async () => {
    const { kv, data, transactions } = database({ career: 'old', 'career:backup': 'older' });
    const observed = observe(
      kv.putMany({ career: 'latest', 'career:backup': 'old', [REVISION_KEY]: 12 }),
    );
    const tx = transactions[0];
    for (const request of tx.requests) request.succeed(undefined);
    await flush();
    expect(observed.settled).not.toHaveBeenCalled();
    expect(data.get('career')).toBe('old');
    tx.complete();
    await expect(observed.result).resolves.toEqual({ value: undefined });
    expect(Object.fromEntries(data)).toEqual({
      career: 'latest',
      'career:backup': 'old',
      [REVISION_KEY]: 12,
    });
  });

  it('aborts all queued writes when a later value fails synchronous cloning', async () => {
    const initial = { career: 'old', 'career:backup': 'recovery', [REVISION_KEY]: 3 };
    const { kv, data, transactions } = database(initial);
    const observed = observe(
      kv.putMany({ career: 'new', bad: () => undefined, [REVISION_KEY]: 12 }),
    );
    const tx = transactions[0];
    const result = await observed.result;
    expect('error' in result && result.error).toMatchObject({ name: 'DataCloneError' });
    // Without abort(), IndexedDB can still commit the earlier queued write.
    if (!tx.aborted) tx.complete();
    expect(tx.abort).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(data)).toEqual(initial);
  });

  it('rejects an aborted restore without publishing data or its revision', async () => {
    const initial = { career: 'old', 'career:backup': 'recovery', [REVISION_KEY]: 3 };
    const { kv, data, transactions } = database(initial);
    const observed = observe(kv.putMany({ career: 'latest', [REVISION_KEY]: 12 }));
    const tx = transactions[0];
    for (const request of tx.requests) request.succeed(undefined);
    const error = new DOMException('Quota reached', 'QuotaExceededError');
    tx.error = error;
    tx.abort();
    await expect(observed.result).resolves.toEqual({ error });
    expect(Object.fromEntries(data)).toEqual(initial);
  });

  it('retains a write request error and rolls back its batch before a transaction error is set', async () => {
    const initial = { career: 'old', [REVISION_KEY]: 3 };
    const { kv, data, transactions } = database(initial);
    const observed = observe(kv.putMany({ career: 'latest', [REVISION_KEY]: 12 }));
    const tx = transactions[0];
    const error = new DOMException('Write failed', 'QuotaExceededError');
    tx.requests[0].fail(error);
    tx.onerror?.();
    await expect(observed.result).resolves.toEqual({ error });
    expect(tx.abort).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(data)).toEqual(initial);
  });

  it('rejects cursor continuation failures without exposing partial entries', async () => {
    const { kv, transactions } = database();
    const observed = observe(kv.entries());
    const tx = transactions[0];
    const error = new DOMException('Cursor inactive', 'TransactionInactiveError');
    tx.requests[0].succeed({
      key: 'career',
      value: 'partial',
      continue: () => {
        throw error;
      },
    });
    await expect(observed.result).resolves.toEqual({ error });
    expect(tx.abort).toHaveBeenCalledTimes(1);
  });
});
