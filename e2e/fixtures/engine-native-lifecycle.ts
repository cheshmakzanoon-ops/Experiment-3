import { SaveStore } from '../../src/storage/data.ts';
import { idbKv } from '../../src/storage/desktop-mirror.ts';
import { IndexedReplayStore, type ReplayPage } from '../../src/storage/replay-pages.ts';
import { FrameBufferPool } from '../../src/workers/frame-buffer-pool.ts';

/** These fixtures run only in fresh Playwright browser contexts. The native
 * IndexedDB factory, requests, transactions and structured-clone machinery are
 * used throughout; no real user's profile or browser connection is reused. */
function openDatabase(name: string, storeName: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Test database open blocked: ${name}`));
  });
}

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Test database cleanup blocked: ${name}`));
  });
}

async function caught(operation: Promise<unknown>) {
  try {
    await operation;
    return null;
  } catch (error) {
    return error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: typeof error, message: String(error) };
  }
}

function page(id: number, value: number): ReplayPage {
  return {
    version: 1,
    id,
    count: 1,
    stride: 2,
    frames: new Float32Array([value, -0]),
    surfaces: [{ time: value, data: new Uint16Array([1, 2, 3, 65535]) }],
  };
}

async function replayCount() {
  const db = await openDatabase('apex-replay-cache', 'pages');
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction('pages', 'readonly');
      const request = tx.objectStore('pages').count();
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function replaySessions() {
  const first = new IndexedReplayStore();
  const second = new IndexedReplayStore();
  try {
    const written = page(0, 11);
    await Promise.all([first.put(written), second.put(page(0, 22))]);
    written.frames[0] = 99;
    written.surfaces[0].data[0] = 99;
    const loaded = await first.get(0);
    const firstRead = {
      value: loaded.frames[0],
      negativeZero: Object.is(loaded.frames[1], -0),
      surface: [...loaded.surfaces[0].data],
    };
    loaded.frames[0] = 88;
    const reread = (await first.get(0)).frames[0];
    const before = await replayCount();
    const disposal = first.dispose();
    const idempotent = first.dispose() === disposal;
    await disposal;
    const afterFirst = await replayCount();
    const otherSession = (await second.get(0)).frames[0];
    const terminal = await caught(first.put(page(1, 33)));
    await second.dispose();
    const afterBoth = await replayCount();
    return { firstRead, reread, before, afterFirst, afterBoth, otherSession, terminal, idempotent };
  } finally {
    await Promise.allSettled([first.dispose(), second.dispose()]);
    await deleteDatabase('apex-replay-cache');
  }
}

export async function replayPendingDisposal() {
  const store = new IndexedReplayStore();
  const pending = caught(store.put(page(0, 7)));
  const disposal = store.dispose();
  const idempotent = store.dispose() === disposal;
  try {
    const [writeError] = await Promise.all([pending, disposal]);
    const readError = await caught(store.get(0));
    const rows = await replayCount();
    return { writeError, readError, rows, idempotent };
  } finally {
    await store.dispose();
    // Deletion is also a native check that the late open left no live owner.
    await deleteDatabase('apex-replay-cache');
  }
}

export async function saveBackupRollback() {
  const store = new SaveStore();
  try {
    await store.writeWithBackup('profile', { revision: 1 });
    await store.writeWithBackup('profile', { revision: 2 });
    const failure = await caught(
      store.writeWithBackup('profile', { revision: 3, uncloneable: () => undefined }),
    );
    const afterFailure = {
      primary: await store.read('profile'),
      backup: await store.read('profile:backup'),
    };
    await store.writeWithBackup('profile', { revision: 4 });
    const afterRecovery = {
      primary: await store.read('profile'),
      backup: await store.read('profile:backup'),
    };
    return { failure, afterFailure, afterRecovery };
  } finally {
    // SaveStore's native versionchange listener must release its connection.
    await deleteDatabase('apex-formula');
  }
}

export async function saveVersionChange() {
  const store = new SaveStore();
  try {
    await store.write('profile', { revision: 1 });
    await deleteDatabase('apex-formula');
    const missing = (await store.read('profile')) === undefined;
    await store.write('profile', { revision: 2 });
    return { missing, restored: await store.read('profile'), keys: await store.keys() };
  } finally {
    await deleteDatabase('apex-formula');
  }
}

export async function mirrorTransactions() {
  const name = `engine-native-mirror-${crypto.randomUUID()}`;
  const db = await openDatabase(name, 'saved');
  const kv = idbKv(db);
  try {
    await kv.putMany({ primary: { revision: 1 }, untouched: 'retained' });
    const writeFailure = await caught(
      kv.putMany({ primary: { revision: 2 }, invalid: () => undefined }),
    );
    const afterFailure = await kv.entries();

    // Force a real transaction abort after its native read request succeeded.
    // Publishing at request success would incorrectly return a successful read.
    const order: string[] = [];
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (query) {
      const request = original.call(this, query);
      if (this.transaction.db === db) {
        this.transaction.addEventListener('abort', () => order.push('transaction-abort'), {
          once: true,
          capture: true,
        });
        request.addEventListener(
          'success',
          () => {
            order.push('request-success');
            this.transaction.abort();
          },
          { once: true },
        );
      }
      return request;
    };
    let readFailure;
    try {
      readFailure = await caught(kv.get('primary'));
      order.push(readFailure ? 'promise-rejected' : 'promise-resolved');
    } finally {
      IDBObjectStore.prototype.get = original;
    }
    const recovered = await kv.get('primary');
    return { writeFailure, afterFailure, readFailure, order, recovered };
  } finally {
    db.close();
    await deleteDatabase(name);
  }
}

export async function workerTransfers() {
  const source = `
    const queued = [];
    self.onmessage = ({ data }) => {
      if (data.kind === 'frame') {
        queued.push(data.buffer);
        return;
      }
      if (data.kind !== 'release') return;
      let detached = 0;
      for (const buffer of queued) {
        const values = new Uint32Array(buffer);
        values[1] = (~values[0]) >>> 0;
        self.postMessage({ kind: 'return', buffer }, [buffer]);
        if (buffer.byteLength === 0) detached++;
      }
      self.postMessage({ kind: 'done', count: queued.length, detached });
      queued.length = 0;
    };
  `;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url);
  const pool = new FrameBufferPool(64, 2, 3);
  let sent = 0;
  let returned = 0;
  let senderDetached = 0;
  let workerDetached = 0;
  let duplicateRejected = 0;
  let blockedRounds = 0;
  try {
    for (let round = 0; round < 101; round++) {
      const count = round === 0 ? 10 : 3;
      const drained = new Promise<void>((resolve, reject) => {
        worker.onerror = (event) => reject(new Error(event.message));
        worker.onmessage = ({ data }) => {
          try {
            if (data.kind === 'done') {
              if (data.count !== count) throw new Error('Worker queue length changed');
              workerDetached += data.detached;
              resolve();
              return;
            }
            const buffer = data.buffer as ArrayBuffer;
            const values = new Uint32Array(buffer);
            if (buffer.byteLength !== 64 || values[0] !== returned || values[1] !== ~returned >>> 0)
              throw new Error('Transferred frame contents changed');
            if (!pool.recycle(buffer)) throw new Error('Valid returned transfer was rejected');
            if (!pool.recycle(buffer)) duplicateRejected++;
            else throw new Error('Duplicate native return was accepted');
            returned++;
          } catch (error) {
            reject(error);
          }
        };
      });
      for (let i = 0; i < count; i++) {
        const accepted = pool.publish(
          (buffer) => {
            new Uint32Array(buffer)[0] = sent++;
            worker.postMessage({ kind: 'frame', buffer }, [buffer]);
            if (buffer.byteLength === 0) senderDetached++;
          },
          round === 0 && i >= 2,
        );
        if (!accepted) throw new Error('Expected native publication was dropped');
      }
      if (
        !pool.publish(() => {
          throw new Error('Ordinary delivery exceeded its reserve');
        })
      )
        blockedRounds++;
      worker.postMessage({ kind: 'release' });
      await drained;
      if (pool.available !== 3) throw new Error('Idle transfer reserve grew or lost capacity');
    }
    return {
      sent,
      returned,
      senderDetached,
      workerDetached,
      duplicateRejected,
      blockedRounds,
      available: pool.available,
    };
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}
