import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedReplayStore, type ReplayPage } from '../src/storage/replay-pages.ts';

type PageKey = [string, number];
type KeyRange = { lower: PageKey; upper: PageKey };

class ControlledRequest {
  result: unknown;
  onsuccess: (() => void) | null = null;
  private done = false;

  constructor(private value: () => unknown) {}

  succeed() {
    if (this.done) return;
    this.done = true;
    this.result = this.value();
    this.onsuccess?.();
  }
}

/** An event-controlled database double: no browser or user storage is accessed.
 * Writes commit only on complete(), and aborts discard all staged effects. */
class ControlledTransaction {
  oncomplete: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: DOMException | null = null;
  requests: ControlledRequest[] = [];
  aborted = false;
  private effects: (() => void)[] = [];

  constructor(
    readonly mode: IDBTransactionMode,
    private pages: Map<string, ReplayPage>,
    private enqueueError: Error | null,
  ) {}

  private request(value: () => unknown) {
    if (this.enqueueError) throw this.enqueueError;
    const request = new ControlledRequest(value);
    this.requests.push(request);
    return request;
  }

  readonly store = {
    put: vi.fn((page: ReplayPage, key: PageKey) => {
      const request = this.request(() => key);
      this.effects.push(() => this.pages.set(JSON.stringify(key), structuredClone(page)));
      return request;
    }),
    get: vi.fn((key: PageKey) => this.request(() => this.pages.get(JSON.stringify(key)))),
    delete: vi.fn((range: KeyRange) => {
      const request = this.request(() => undefined);
      this.effects.push(() => {
        for (const key of this.pages.keys()) {
          const [session, id] = JSON.parse(key) as PageKey;
          if (
            session === range.lower[0] &&
            session === range.upper[0] &&
            id >= range.lower[1] &&
            id <= range.upper[1]
          )
            this.pages.delete(key);
        }
      });
      return request;
    }),
  };

  objectStore = vi.fn((name: string) => {
    expect(name).toBe('pages');
    return this.store;
  });

  abort = vi.fn(() => {
    this.aborted = true;
  });

  complete() {
    if (this.aborted) throw new Error('Cannot complete an aborted transaction');
    for (const request of this.requests) request.succeed();
    for (const effect of this.effects) effect();
    this.oncomplete?.();
  }

  fail(error: DOMException | null, emitError = false) {
    this.error = error;
    if (emitError) this.onerror?.();
    this.aborted = true;
    this.onabort?.();
  }
}

class ControlledConnection {
  onversionchange: (() => void) | null = null;
  onclose: (() => void) | null = null;
  transactions: ControlledTransaction[] = [];
  enqueueError: Error | null = null;
  closed = false;

  constructor(private pages: Map<string, ReplayPage>) {}

  close = vi.fn(() => {
    this.closed = true;
  });

  createObjectStore = vi.fn();

  transaction = vi.fn((name: string, mode: IDBTransactionMode) => {
    if (this.closed) throw new DOMException('Connection is closed', 'InvalidStateError');
    expect(name).toBe('pages');
    const tx = new ControlledTransaction(mode, this.pages, this.enqueueError);
    this.transactions.push(tx);
    return tx;
  });
}

class ControlledOpen {
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onsuccess: (() => void) | null = null;
  error: DOMException | null = null;

  constructor(readonly result: ControlledConnection) {}

  succeed() {
    this.onsuccess?.();
  }
}

class ControlledFactory {
  pages = new Map<string, ReplayPage>();
  requests: ControlledOpen[] = [];
  open = vi.fn(() => {
    const request = new ControlledOpen(new ControlledConnection(this.pages));
    this.requests.push(request);
    return request;
  });
}

const page = (id = 0, value = 1): ReplayPage => ({
  version: 1,
  id,
  count: 1,
  stride: 1,
  frames: new Float32Array([value]),
  surfaces: [{ time: 0, data: new Uint16Array([1, 2, 3, 4]) }],
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('IndexedReplayStore connection and transaction ownership', () => {
  let factory: ControlledFactory;

  beforeEach(() => {
    factory = new ControlledFactory();
    let session = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `session-${++session}` });
    vi.stubGlobal('indexedDB', factory);
    vi.stubGlobal('IDBKeyRange', {
      bound: vi.fn((lower: PageKey, upper: PageKey): KeyRange => ({ lower, upper })),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  function opened() {
    const store = new IndexedReplayStore();
    const request = factory.requests.at(-1)!;
    request.succeed();
    return { store, db: request.result };
  }

  it('resolves writes and reads only when their transaction completes', async () => {
    const { store, db } = opened();
    const written = page();
    const write = store.put(written);
    const writeSettled = vi.fn();
    void write.then(writeSettled, writeSettled);
    await flush();
    const writeTx = db.transactions[0];
    writeTx.requests[0].succeed();
    await flush();
    expect(writeSettled).not.toHaveBeenCalled();
    expect(factory.pages.size).toBe(0);
    writeTx.complete();
    await write;

    const read = store.get(written.id);
    const readSettled = vi.fn();
    void read.then(readSettled, readSettled);
    await flush();
    const readTx = db.transactions[1];
    readTx.requests[0].succeed();
    await flush();
    expect(readSettled).not.toHaveBeenCalled();
    readTx.complete();
    await expect(read).resolves.toEqual(written);
  });

  it('closes a late success after blocked open and retains the original open failure', async () => {
    const store = new IndexedReplayStore();
    const request = factory.requests[0];
    request.onblocked?.();
    await expect(store.put(page())).rejects.toThrow('Another tab blocked the replay cache');
    const disposal = store.dispose();
    await expect(disposal).rejects.toThrow('Another tab blocked the replay cache');
    request.succeed();
    expect(request.result.close).toHaveBeenCalledTimes(1);
    expect(request.result.transaction).not.toHaveBeenCalled();
    expect(store.dispose()).toBe(disposal);
    await expect(store.dispose()).rejects.toThrow('Another tab blocked the replay cache');
  });

  it('closes a rejected open that later succeeds even without disposal', async () => {
    const store = new IndexedReplayStore();
    const request = factory.requests[0];
    const failure = new DOMException('Open denied', 'SecurityError');
    request.error = failure;
    request.onerror?.();
    request.succeed();
    await expect(store.get(0)).rejects.toBe(failure);
    await expect(store.put(page())).rejects.toBe(failure);
    expect(request.result.close).toHaveBeenCalledTimes(1);
  });

  it('keeps unavailable and synchronously failed opens observable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const unavailable = new IndexedReplayStore();
    await expect(unavailable.get(0)).rejects.toThrow('IndexedDB replay cache unavailable');
    await expect(unavailable.dispose()).rejects.toThrow('IndexedDB replay cache unavailable');

    const failure = new DOMException('Open denied', 'SecurityError');
    vi.stubGlobal('indexedDB', { open: () => { throw failure; } });
    const denied = new IndexedReplayStore();
    await expect(denied.put(page())).rejects.toBe(failure);
    await expect(denied.dispose()).rejects.toBe(failure);
  });

  it('disposes before open and rejects waiting operations without creating transactions', async () => {
    const store = new IndexedReplayStore();
    const writeRejected = expect(store.put(page())).rejects.toThrow(/closed/i);
    const readRejected = expect(store.get(0)).rejects.toThrow(/closed/i);
    const disposal = store.dispose();
    expect(store.dispose()).toBe(disposal);
    const request = factory.requests[0];
    request.succeed();
    await Promise.all([writeRejected, readRejected, disposal]);
    expect(request.result.close).toHaveBeenCalledTimes(1);
    expect(request.result.transaction).not.toHaveBeenCalled();
    await expect(store.put(page())).rejects.toThrow(/closed/i);
    await expect(store.get(0)).rejects.toThrow(/closed/i);
  });

  it('blocks operations waiting to resume after an already successful open', async () => {
    const { store, db } = opened();
    const writeRejected = expect(store.put(page())).rejects.toThrow(/closed/i);
    const readRejected = expect(store.get(0)).rejects.toThrow(/closed/i);
    const disposal = store.dispose();
    await flush();
    expect(db.transactions).toHaveLength(1);
    expect(db.transactions[0].store.delete).toHaveBeenCalledTimes(1);
    db.transactions[0].complete();
    await Promise.all([writeRejected, readRejected, disposal]);
  });

  it('shares one disposal before and after completion and rejects further operations', async () => {
    const { store, db } = opened();
    const first = store.dispose();
    const second = store.dispose();
    expect(second).toBe(first);
    await flush();
    expect(db.transactions).toHaveLength(1);
    expect(db.close).not.toHaveBeenCalled();
    db.transactions[0].complete();
    await first;
    expect(store.dispose()).toBe(first);
    await store.dispose();
    expect(db.close).toHaveBeenCalledTimes(1);
    await expect(store.put(page())).rejects.toThrow(/closed/i);
    await expect(store.get(0)).rejects.toThrow(/closed/i);
    expect(db.transactions).toHaveLength(1);
  });

  it('queues cleanup after an in-flight write while refusing new work', async () => {
    const { store, db } = opened();
    const write = store.put(page());
    await flush();
    const disposal = store.dispose();
    await flush();
    expect(db.transactions).toHaveLength(2);
    await expect(store.put(page(1))).rejects.toThrow(/closed/i);
    db.transactions[0].complete();
    await write;
    expect(factory.pages.size).toBe(1);
    expect(db.close).not.toHaveBeenCalled();
    db.transactions[1].complete();
    await disposal;
    expect(factory.pages.size).toBe(0);
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it.each(['write', 'read'] as const)('rejects an aborted %s despite request success', async (kind) => {
    const { store, db } = opened();
    factory.pages.set(JSON.stringify(['session-1', 0]), page());
    const operation = kind === 'write' ? store.put(page(1)) : store.get(0);
    const failure = new DOMException('Transaction aborted', 'AbortError');
    const rejected = expect(operation).rejects.toBe(failure);
    await flush();
    const tx = db.transactions[0];
    tx.requests[0].succeed();
    tx.fail(failure);
    await rejected;
    expect(factory.pages.size).toBe(1);
  });

  it('reports a missing read only after transaction completion', async () => {
    const { store, db } = opened();
    const read = store.get(4);
    const rejected = expect(read).rejects.toThrow('Replay page 4 is missing');
    await flush();
    db.transactions[0].complete();
    await rejected;
  });

  it.each(['write', 'read', 'cleanup'] as const)(
    'aborts a transaction when its %s request cannot be enqueued',
    async (kind) => {
      const { store, db } = opened();
      const failure = new DOMException('Cannot enqueue request', 'DataCloneError');
      db.enqueueError = failure;
      const operation = kind === 'write' ? store.put(page()) : kind === 'read' ? store.get(0) : store.dispose();
      await expect(operation).rejects.toBe(failure);
      expect(db.transactions[0].abort).toHaveBeenCalledTimes(1);
      expect(factory.pages.size).toBe(0);
      if (kind === 'cleanup') expect(db.close).toHaveBeenCalledTimes(1);
    },
  );

  it('closes once after aborted cleanup and retains that failure on repeated disposal', async () => {
    const { store, db } = opened();
    factory.pages.set(JSON.stringify(['session-1', 0]), page());
    const disposal = store.dispose();
    const failure = new DOMException('Cleanup failed', 'AbortError');
    const rejected = expect(disposal).rejects.toBe(failure);
    await flush();
    db.transactions[0].fail(failure, true);
    await rejected;
    expect(db.close).toHaveBeenCalledTimes(1);
    expect(factory.pages.size).toBe(1);
    expect(store.dispose()).toBe(disposal);
    await expect(store.dispose()).rejects.toBe(failure);
    await expect(store.get(0)).rejects.toThrow(/closed/i);
    expect(db.transactions).toHaveLength(1);
  });

  it('closes on version change and never starts work on the closed connection', async () => {
    const { store, db } = opened();
    db.onversionchange?.();
    expect(db.close).toHaveBeenCalledTimes(1);
    await expect(store.get(0)).rejects.toThrow(/closed/i);
    await expect(store.put(page())).rejects.toThrow(/closed/i);
    await store.dispose();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('stops using an unexpectedly closed connection', async () => {
    const { store, db } = opened();
    db.closed = true;
    db.onclose?.();
    await expect(store.get(0)).rejects.toThrow(/closed/i);
    await expect(store.put(page())).rejects.toThrow(/closed/i);
    await store.dispose();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.close).not.toHaveBeenCalled();
  });

  it('deletes only its session, including both page-id bounds, and leaves a sibling usable', async () => {
    const first = opened();
    const sibling = opened();
    for (const [store, db, value] of [
      [first.store, first.db, 10],
      [sibling.store, sibling.db, 20],
    ] as const) {
      for (const id of [0, Number.MAX_SAFE_INTEGER]) {
        const write = store.put(page(id, value));
        await flush();
        db.transactions.at(-1)!.complete();
        await write;
      }
    }
    expect(factory.pages.size).toBe(4);
    const disposal = first.store.dispose();
    await flush();
    first.db.transactions.at(-1)!.complete();
    await disposal;
    expect([...factory.pages.keys()]).toEqual([
      JSON.stringify(['session-2', 0]),
      JSON.stringify(['session-2', Number.MAX_SAFE_INTEGER]),
    ]);
    expect(sibling.db.close).not.toHaveBeenCalled();
    const read = sibling.store.get(0);
    await flush();
    sibling.db.transactions.at(-1)!.complete();
    await expect(read).resolves.toEqual(page(0, 20));
  });
});
