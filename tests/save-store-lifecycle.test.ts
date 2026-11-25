import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveStore } from '../src/storage/data.ts';
import { DesktopMirror, REVISION_KEY } from '../src/storage/desktop-mirror.ts';

/** Drive request and transaction events separately, without opening browser or user storage. */
class ControlledRequest<T = unknown> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;

  succeed(value: T) {
    this.result = value;
    this.onsuccess?.();
  }

  fail(error: DOMException | null) {
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
    put: vi.fn((value: unknown, key: IDBValidKey) => {
      this.pending.set(key, structuredClone(value));
      return new ControlledRequest();
    }),
  };
  objectStore = vi.fn((_name: string) => this.store);
  abort = vi.fn(() => {
    this.aborted = true;
    this.pending.clear();
    this.onabort?.();
  });

  constructor(private data: Map<IDBValidKey, unknown>) {}

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

  fail(error: DOMException | null) {
    this.error = error;
    this.onerror?.();
    this.abort();
  }
}

class ControlledDatabase {
  onversionchange: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  transactions: ControlledTransaction[] = [];
  close = vi.fn(() => {
    this.closed = true;
  });
  createObjectStore = vi.fn();
  transaction = vi.fn((_name: string, _mode: IDBTransactionMode) => {
    if (this.closed) throw new DOMException('Connection closed', 'InvalidStateError');
    const transaction = new ControlledTransaction(this.data);
    this.transactions.push(transaction);
    return transaction;
  });

  constructor(public data = new Map<IDBValidKey, unknown>()) {}
}

class ControlledOpenRequest extends ControlledRequest<IDBDatabase> {
  onblocked: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  transaction: IDBTransaction | null = null;

  open(db: ControlledDatabase) {
    this.succeed(db as unknown as IDBDatabase);
  }
}

function factory() {
  const requests: ControlledOpenRequest[] = [];
  return {
    requests,
    open: vi.fn(() => {
      const request = new ControlledOpenRequest();
      requests.push(request);
      return request;
    }),
  };
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

function mirror() {
  const mock = {
    reconcile: vi.fn(async () => ({ action: 'none' as const, keys: 0, revision: 0 })),
    stamp: vi.fn((store: IDBObjectStore) => {
      store.put(7, REVISION_KEY);
      return 7;
    }),
    written: vi.fn(),
  };
  vi.mocked(DesktopMirror.detect).mockReturnValue(mock as unknown as DesktopMirror);
  return mock;
}

let indexed: ReturnType<typeof factory>;
beforeEach(() => {
  indexed = factory();
  vi.stubGlobal('indexedDB', indexed);
  vi.spyOn(DesktopMirror, 'detect').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function connected(data = new Map<IDBValidKey, unknown>()) {
  const store = new SaveStore();
  const opening = observe(store.read('probe'));
  const db = new ControlledDatabase(data);
  indexed.requests.at(-1)!.open(db);
  await flush();
  const tx = db.transactions[0];
  tx.requests[0].succeed(undefined);
  tx.complete();
  await expect(opening.result).resolves.toEqual({ value: undefined });
  db.transactions.length = 0;
  db.transaction.mockClear();
  return { store, db };
}

describe('SaveStore connection ownership', () => {
  it('shares an in-flight open and reuses the successful connection', async () => {
    const store = new SaveStore();
    const first = observe(store.read('one'));
    const second = observe(store.read('two'));
    expect(indexed.open).toHaveBeenCalledTimes(1);
    expect(indexed.open).toHaveBeenCalledWith('apex-formula', 1);
    const db = new ControlledDatabase();
    indexed.requests[0].open(db);
    await flush();
    for (const [i, tx] of db.transactions.entries()) {
      tx.requests[0].succeed(i);
      tx.complete();
    }
    await expect(first.result).resolves.toEqual({ value: 0 });
    await expect(second.result).resolves.toEqual({ value: 1 });
    const third = observe(store.keys());
    await flush();
    db.transactions[2].requests[0].succeed(['one', 'two']);
    db.transactions[2].complete();
    await expect(third.result).resolves.toEqual({ value: ['one', 'two'] });
    expect(indexed.open).toHaveBeenCalledTimes(1);
  });

  it('retries when IndexedDB becomes available after an unavailable attempt', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const store = new SaveStore();
    await expect(store.read('profile')).rejects.toThrow('IndexedDB unavailable');
    vi.stubGlobal('indexedDB', indexed);
    const retry = observe(store.read('profile'));
    expect(indexed.open).toHaveBeenCalledTimes(1);
    const error = new DOMException('Retry reached the factory', 'UnknownError');
    indexed.requests[0].fail(error);
    await expect(retry.result).resolves.toEqual({ error });
  });

  it('retries a synchronous factory exception', async () => {
    const error = new DOMException('Access denied', 'SecurityError');
    indexed.open.mockImplementationOnce(() => {
      throw error;
    });
    const store = new SaveStore();
    await expect(store.read('profile')).rejects.toBe(error);
    const retry = observe(store.read('profile'));
    expect(indexed.open).toHaveBeenCalledTimes(2);
    indexed.requests[0].fail(error);
    await expect(retry.result).resolves.toEqual({ error });
  });

  it('retries a failed open request', async () => {
    const error = new DOMException('Cannot open', 'UnknownError');
    const store = new SaveStore();
    const first = observe(store.read('profile'));
    indexed.requests[0].fail(error);
    await expect(first.result).resolves.toEqual({ error });
    const second = observe(store.read('profile'));
    expect(indexed.open).toHaveBeenCalledTimes(2);
    indexed.requests[1].fail(error);
    await expect(second.result).resolves.toEqual({ error });
  });

  it('retries a blocked open and closes its late success without disturbing the new owner', async () => {
    const desktop = mirror();
    const store = new SaveStore();
    const first = observe(store.read('profile'));
    const blocked = indexed.requests[0];
    blocked.onblocked?.();
    await expect(first.result).resolves.toEqual({
      error: new Error('Close older MOTOBOUND tabs to update local storage.'),
    });
    const retry = observe(store.read('profile'));
    expect(indexed.open).toHaveBeenCalledTimes(2);
    const db = new ControlledDatabase();
    indexed.requests[1].open(db);
    await flush();
    const late = new ControlledDatabase();
    blocked.open(late);
    blocked.fail(new DOMException('Old attempt failed', 'AbortError'));
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(late.transaction).not.toHaveBeenCalled();
    expect(desktop.reconcile).toHaveBeenCalledTimes(1);
    const tx = db.transactions[0];
    tx.requests[0].succeed({ progress: 3 });
    tx.complete();
    await expect(retry.result).resolves.toEqual({ value: { progress: 3 } });
    const again = observe(store.read('profile'));
    await flush();
    expect(indexed.open).toHaveBeenCalledTimes(2);
    db.transactions[1].requests[0].succeed(4);
    db.transactions[1].complete();
    await expect(again.result).resolves.toEqual({ value: 4 });
    expect(db.close).not.toHaveBeenCalled();
  });

  it('aborts a late upgrade belonging to an already blocked attempt', async () => {
    const store = new SaveStore();
    const first = observe(store.read('profile'));
    const blocked = indexed.requests[0];
    blocked.onblocked?.();
    await first.result;
    const db = new ControlledDatabase();
    const upgrade = new ControlledTransaction(db.data);
    blocked.result = db as unknown as IDBDatabase;
    blocked.transaction = upgrade as unknown as IDBTransaction;
    blocked.onupgradeneeded?.();
    expect(upgrade.abort).toHaveBeenCalledTimes(1);
    expect(db.createObjectStore).not.toHaveBeenCalled();
  });

  it.each(['versionchange', 'close'] as const)('reopens after connection %s', async (event) => {
    const { store, db } = await connected();
    if (event === 'versionchange') db.onversionchange?.();
    else db.onclose?.();
    expect(db.close).toHaveBeenCalledTimes(1);
    const retry = observe(store.read('profile'));
    expect(indexed.open).toHaveBeenCalledTimes(2);
    const next = new ControlledDatabase();
    indexed.requests[1].open(next);
    await flush();
    // An old connection's repeated event cannot clear the new connection's cached promise.
    db.onversionchange?.();
    next.transactions[0].requests[0].succeed('reopened');
    next.transactions[0].complete();
    await expect(retry.result).resolves.toEqual({ value: 'reopened' });
    const again = observe(store.keys());
    await flush();
    expect(indexed.open).toHaveBeenCalledTimes(2);
    next.transactions[1].requests[0].succeed([]);
    next.transactions[1].complete();
    await again.result;
  });

  it('waits for desktop reconciliation before starting caller transactions', async () => {
    const desktop = mirror();
    let reconciled!: () => void;
    desktop.reconcile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reconciled = () => resolve({ action: 'none', keys: 0, revision: 0 });
        }),
    );
    const store = new SaveStore();
    const reading = observe(store.read('profile'));
    const db = new ControlledDatabase();
    indexed.requests[0].open(db);
    await flush();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(reading.settled).not.toHaveBeenCalled();
    reconciled();
    await flush();
    db.transactions[0].requests[0].succeed('ready');
    db.transactions[0].complete();
    await expect(reading.result).resolves.toEqual({ value: 'ready' });
  });

  it('rejects a connection invalidated during reconciliation and ignores late reconciliation', async () => {
    const desktop = mirror();
    let reconciled!: () => void;
    desktop.reconcile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reconciled = () => resolve({ action: 'none', keys: 0, revision: 0 });
        }),
    );
    const store = new SaveStore();
    const reading = observe(store.read('profile'));
    const db = new ControlledDatabase();
    indexed.requests[0].open(db);
    db.onversionchange?.();
    await expect(reading.result).resolves.toEqual({
      error: new Error('Local storage changed in another tab. Try again.'),
    });
    expect(db.close).toHaveBeenCalledTimes(1);
    const retry = observe(store.read('profile'));
    const next = new ControlledDatabase();
    indexed.requests[1].open(next);
    reconciled();
    await flush();
    expect(db.transaction).not.toHaveBeenCalled();
    next.transactions[0].requests[0].succeed('new connection');
    next.transactions[0].complete();
    await expect(retry.result).resolves.toEqual({ value: 'new connection' });
    expect(next.close).not.toHaveBeenCalled();
  });

  it.each(['sync', 'async'] as const)(
    'closes and retries after %s reconciliation failure',
    async (kind) => {
      const desktop = mirror();
      const error = new Error('Reconciliation failed');
      desktop.reconcile.mockImplementationOnce(() => {
        if (kind === 'sync') throw error;
        return Promise.reject(error);
      });
      const store = new SaveStore();
      const reading = observe(store.read('profile'));
      const db = new ControlledDatabase();
      indexed.requests[0].open(db);
      await expect(reading.result).resolves.toEqual({ error });
      expect(db.close).toHaveBeenCalledTimes(1);
      const retry = observe(store.read('profile'));
      expect(indexed.open).toHaveBeenCalledTimes(2);
      indexed.requests[1].fail(new DOMException('End test', 'AbortError'));
      await retry.result;
    },
  );
});

describe.each(['read', 'keys'] as const)('SaveStore %s transaction completion', (method) => {
  const start = (store: SaveStore) =>
    method === 'read' ? store.read('leaderboard:a') : store.keys('leaderboard:');
  const requestValue = () =>
    method === 'read'
      ? { samples: new Float32Array([1, 2.5]), nested: { enabled: true } }
      : ['leaderboard:a', 42, 'settings', 'leaderboard:b'];

  it('waits for transaction commit and preserves the read value or filtered keys', async () => {
    const { store, db } = await connected();
    const operation = observe(start(store));
    await flush();
    const tx = db.transactions[0];
    const value = requestValue();
    tx.requests[0].succeed(value);
    await flush();
    expect(operation.settled).not.toHaveBeenCalled();
    tx.complete();
    await expect(operation.result).resolves.toEqual({
      value: method === 'read' ? value : ['leaderboard:a', 'leaderboard:b'],
    });
    expect(db.transaction).toHaveBeenCalledWith('saved', 'readonly');
  });

  it('rejects an abort after request success', async () => {
    const { store, db } = await connected();
    const operation = observe(start(store));
    await flush();
    const tx = db.transactions[0];
    tx.requests[0].succeed(requestValue());
    tx.abort();
    await expect(operation.result).resolves.toEqual({ error: new Error('Read aborted') });
  });

  it('rejects an abort before the request completes', async () => {
    const { store, db } = await connected();
    const operation = observe(start(store));
    await flush();
    const error = new DOMException('Connection lost', 'AbortError');
    db.transactions[0].error = error;
    db.transactions[0].abort();
    await expect(operation.result).resolves.toEqual({ error });
  });

  it('preserves the request error', async () => {
    const { store, db } = await connected();
    const operation = observe(start(store));
    await flush();
    const error = new DOMException('Request failed', 'UnknownError');
    db.transactions[0].requests[0].fail(error);
    db.transactions[0].fail(error);
    await expect(operation.result).resolves.toEqual({ error });
  });

  it.each([true, false])('rejects a transaction error (has cause: %s)', async (hasCause) => {
    const { store, db } = await connected();
    const operation = observe(start(store));
    await flush();
    const error = hasCause ? new DOMException('Transaction failed', 'UnknownError') : null;
    db.transactions[0].fail(error);
    await expect(operation.result).resolves.toEqual({ error: error ?? new Error('Read failed') });
  });
});

describe.each(['write', 'writeWithBackup'] as const)('SaveStore %s atomic completion', (method) => {
  const before = { laps: 3, samples: new Float32Array([1, 2]) };
  const backup = { laps: 2 };
  const after = { laps: 4, samples: new Float32Array([3, 4]) };

  async function writing() {
    const desktop = mirror();
    const data = new Map<IDBValidKey, unknown>([
      ['profile', before],
      ['profile:backup', backup],
    ]);
    const { store, db } = await connected(data);
    const operation = observe(store[method]('profile', after));
    await flush();
    const tx = db.transactions[0];
    if (method === 'writeWithBackup') tx.requests[0].succeed(before);
    tx.requests.at(-1)!.succeed(data.get(REVISION_KEY));
    return { desktop, data, db, operation, tx };
  }

  it('commits the value and revision together, then forwards the completed writes', async () => {
    const { desktop, data, db, operation, tx } = await writing();
    await flush();
    expect(operation.settled).not.toHaveBeenCalled();
    expect(desktop.written).not.toHaveBeenCalled();
    expect(data.get('profile')).toEqual(before);
    expect(data.get('profile:backup')).toEqual(backup);
    tx.complete();
    await expect(operation.result).resolves.toEqual({ value: undefined });
    expect(data.get('profile')).toEqual(after);
    expect(data.get('profile:backup')).toEqual(method === 'writeWithBackup' ? before : backup);
    expect(data.get(REVISION_KEY)).toBe(7);
    expect(desktop.written).toHaveBeenCalledExactlyOnceWith(
      [...(method === 'writeWithBackup' ? [['profile:backup', before]] : []), ['profile', after]],
      7,
    );
    expect(db.transaction).toHaveBeenCalledWith('saved', 'readwrite');
    expect(desktop.stamp).toHaveBeenCalledTimes(1);
  });

  it('preserves the old values and never mirrors an aborted write', async () => {
    const { desktop, data, operation, tx } = await writing();
    tx.abort();
    await expect(operation.result).resolves.toEqual({ error: new Error('Save aborted') });
    expect(data.get('profile')).toEqual(before);
    expect(data.get('profile:backup')).toEqual(backup);
    expect(data.has(REVISION_KEY)).toBe(false);
    expect(desktop.written).not.toHaveBeenCalled();
  });

  it('aborts queued changes if mirror stamping throws synchronously', async () => {
    const desktop = mirror();
    const error = new DOMException('Cannot stamp revision', 'DataError');
    desktop.stamp.mockImplementationOnce(() => {
      throw error;
    });
    const data = new Map<IDBValidKey, unknown>([
      ['profile', before],
      ['profile:backup', backup],
    ]);
    const { store, db } = await connected(data);
    const operation = observe(store[method]('profile', after));
    await flush();
    const tx = db.transactions[0];
    if (method === 'writeWithBackup') tx.requests[0].succeed(before);
    tx.requests.at(-1)!.succeed(data.get(REVISION_KEY));
    await expect(operation.result).resolves.toEqual({ error });
    expect(tx.abort).toHaveBeenCalledTimes(1);
    expect(data.get('profile')).toEqual(before);
    expect(data.get('profile:backup')).toEqual(backup);
    expect(desktop.written).not.toHaveBeenCalled();
  });

  it('rejects transaction errors even when the browser supplies no error object', async () => {
    const { desktop, operation, tx } = await writing();
    tx.fail(null);
    await expect(operation.result).resolves.toEqual({ error: new Error('Save failed') });
    expect(desktop.written).not.toHaveBeenCalled();
  });
});

describe('SaveStore backup request failures', () => {
  it('aborts the queued backup when the primary value cannot be cloned', async () => {
    const desktop = mirror();
    const before = { laps: 3 };
    const backup = { laps: 2 };
    const data = new Map<IDBValidKey, unknown>([
      ['profile', before],
      ['profile:backup', backup],
    ]);
    const { store, db } = await connected(data);
    const operation = observe(store.writeWithBackup('profile', () => undefined));
    await flush();
    const tx = db.transactions[0];
    tx.requests[0].succeed(before);
    await expect(operation.result).resolves.toMatchObject({ error: { name: 'DataCloneError' } });
    // The desktop snapshot rejects before the primary put; the already queued
    // backup must still roll back with the rest of the transaction.
    expect(tx.store.put).toHaveBeenCalledTimes(1);
    expect(tx.store.put).toHaveBeenCalledWith(before, 'profile:backup');
    expect(tx.abort).toHaveBeenCalledTimes(1);
    expect(data.get('profile')).toEqual(before);
    expect(data.get('profile:backup')).toEqual(backup);
    expect(desktop.stamp).not.toHaveBeenCalled();
    expect(desktop.written).not.toHaveBeenCalled();
  });

  it('preserves an existing backup when there is no previous primary', async () => {
    const desktop = mirror();
    const data = new Map<IDBValidKey, unknown>([['profile:backup', { laps: 2 }]]);
    const { store, db } = await connected(data);
    const operation = observe(store.writeWithBackup('profile', { laps: 4 }));
    await flush();
    const tx = db.transactions[0];
    tx.requests[0].succeed(undefined);
    tx.requests[1].succeed(data.get(REVISION_KEY));
    tx.complete();
    await expect(operation.result).resolves.toEqual({ value: undefined });
    expect(data.get('profile:backup')).toEqual({ laps: 2 });
    expect(desktop.written).toHaveBeenCalledExactlyOnceWith([['profile', { laps: 4 }]], 7);
  });

  it('rejects a failed previous-value request without writing or mirroring', async () => {
    const desktop = mirror();
    const { store, db } = await connected();
    const operation = observe(store.writeWithBackup('profile', { laps: 4 }));
    await flush();
    const error = new DOMException('Cannot read previous value', 'UnknownError');
    const tx = db.transactions[0];
    tx.requests[0].fail(error);
    tx.fail(error);
    await expect(operation.result).resolves.toEqual({ error });
    expect(tx.store.put).not.toHaveBeenCalled();
    expect(desktop.stamp).not.toHaveBeenCalled();
    expect(desktop.written).not.toHaveBeenCalled();
  });
});
