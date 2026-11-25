import { SaveStore } from '../../src/storage/data.ts';

const databaseName = 'apex-formula';
const documentId = crypto.randomUUID();
const store = new SaveStore();

interface TransactionWitness {
  mode: IDBTransactionMode;
  writes: string[];
  events: string[];
}

/** Observe native calls/events without replacing their requests, transactions,
 * clone implementation, or scheduling. Every test uses an isolated context. */
const nativeTransaction = IDBDatabase.prototype.transaction;
const nativePut = IDBObjectStore.prototype.put;
const connections = new Set<IDBDatabase>();
const transactions: TransactionWitness[] = [];
const witnesses = new WeakMap<IDBTransaction, TransactionWitness>();
IDBDatabase.prototype.transaction = function (...args) {
  const transaction = Reflect.apply(nativeTransaction, this, args) as IDBTransaction;
  if (this.name === databaseName && transaction.objectStoreNames.contains('saved')) {
    connections.add(this);
    const witness: TransactionWitness = { mode: transaction.mode, writes: [], events: [] };
    witnesses.set(transaction, witness);
    transactions.push(witness);
    for (const event of ['complete', 'abort'])
      transaction.addEventListener(event, () => witness.events.push(event), {
        once: true,
        capture: true,
      });
  }
  return transaction;
};
IDBObjectStore.prototype.put = function (...args) {
  const witness = witnesses.get(this.transaction);
  if (witness) {
    witness.writes.push(String(args[1]));
    witness.events.push('put');
  }
  const request = nativePut.apply(this, args);
  if (witness)
    request.addEventListener('success', () => witness.events.push('put-success'), { once: true });
  return request;
};

const writeTransactions = (start: number) =>
  transactions.slice(start).filter((transaction) => transaction.mode === 'readwrite');

function errorDescription(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: typeof error, message: String(error) };
}

async function failure(operation: Promise<unknown>) {
  try {
    await operation;
    return null;
  } catch (error) {
    return errorDescription(error);
  }
}

function entries(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string'))
    throw new Error('Expected the seeded native atomic board');
  return value;
}

export async function initialize() {
  // Opening is complete before the test queues competing updates. Each page
  // owns a production SaveStore and its own native database connection.
  await store.read('native-atomic:probe');
  return {
    documentId,
    origin: location.origin,
    connections: connections.size,
    schema: [...connections].map((db) => ({
      name: db.name,
      version: db.version,
      stores: [...db.objectStoreNames],
    })),
  };
}

export const seed = (key: string, value: string[]) => store.write(key, value);
export const read = (key: string) => store.read(key);

let barrier: { release: () => void; done: Promise<void> } | null = null;

export async function holdWrites() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  // This extra connection holds the real object-store lock. Repeated native
  // requests keep it active until BOTH pages have queued their transactions.
  // Bypass only our observation wrapper so the blocker is not counted as an update.
  const transaction = nativeTransaction.call(db, 'saved', 'readwrite');
  let released = false;
  let ready!: () => void;
  let failed!: (error: unknown) => void;
  const started = new Promise<void>((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  const timeout = setTimeout(() => transaction.abort(), 15000);
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => {
      clearTimeout(timeout);
      db.close();
      resolve();
    };
    transaction.onabort = () => {
      clearTimeout(timeout);
      db.close();
      const error = transaction.error ?? new Error('Native write barrier expired or aborted');
      failed(error);
      reject(error);
    };
  });
  // A timeout remains a failure when released/cleaned up, without an unhandled rejection.
  void done.catch(() => undefined);
  barrier = { release: () => (released = true), done };
  const pump = () => {
    const request = transaction.objectStore('saved').get('native-atomic:barrier');
    request.onsuccess = () => {
      ready();
      if (!released) pump();
    };
  };
  pump();
  await started;
}

export async function releaseWrites() {
  if (!barrier) return;
  const current = barrier;
  barrier = null;
  current.release();
  await current.done;
}

type UpdateOutcome =
  | { token: string; status: 'fulfilled'; length: number }
  | { token: string; status: 'rejected'; error: ReturnType<typeof errorDescription> };

let batch: {
  start: number;
  callbacks: { token: string; previousLength: number }[];
  settled: number;
  done: Promise<UpdateOutcome[]>;
} | null = null;

export async function queueUpdates(key: string, tokens: string[]) {
  if (batch) throw new Error('An atomic batch is already queued');
  const current = {
    start: transactions.length,
    callbacks: [] as { token: string; previousLength: number }[],
    settled: 0,
    done: Promise.resolve([] as UpdateOutcome[]),
  };
  batch = current;
  current.done = Promise.all(
    tokens.map((token) =>
      store
        .update(key, (stored) => {
          const previous = entries(stored);
          current.callbacks.push({ token, previousLength: previous.length });
          return [...previous, token];
        })
        .then(
          (value): UpdateOutcome => {
            current.settled++;
            return { token, status: 'fulfilled', length: entries(value).length };
          },
          (error: unknown): UpdateOutcome => {
            current.settled++;
            return { token, status: 'rejected', error: errorDescription(error) };
          },
        ),
    ),
  );
  void current.done.catch(() => undefined);
  // SaveStore awaits its already-open connection before creating a transaction.
  // Yield that microtask; the native blocker still prevents every read callback.
  await Promise.resolve();
  return {
    transactions: transactions.slice(current.start).map((transaction) => transaction.mode),
    updaterCalls: current.callbacks.length,
    settled: current.settled,
  };
}

export async function finishUpdates() {
  if (!batch) throw new Error('No atomic batch was queued');
  const current = batch;
  const outcomes = await current.done;
  return {
    outcomes,
    callbacks: current.callbacks,
    settled: current.settled,
    transactions: transactions.slice(current.start),
  };
}

export async function rollbackAndRecovery() {
  const key = 'native-atomic:rollback';
  await store.write(key, ['seed']);
  await store.write(`${key}:backup`, ['recovery-copy']);
  await store.write(`${key}:untouched`, 'retained');
  const other = new SaveStore();
  await other.read(key);

  const failedStart = transactions.length;
  const thrown = failure(
    store.update(key, (stored) => {
      entries(stored).push('discarded-mutation');
      throw new Error('Native updater failed');
    }),
  );
  // A second connection is already waiting when the throwing updater aborts.
  const follower = other.update(key, (stored) => [...entries(stored), 'survivor']);
  const [updaterFailure, followerValue] = await Promise.all([thrown, follower]);
  const afterThrow = await store.read(key);
  const failedTransactions = writeTransactions(failedStart);

  const cloneStart = transactions.length;
  const cloneFailure = await failure(
    store.update(key, (stored) => ({ entries: stored, uncloneable: () => undefined })),
  );
  const afterClone = await other.read(key);
  const cloneTransactions = writeTransactions(cloneStart);

  const recoveryStart = transactions.length;
  const recovered = await store
    .update(key, (stored) => [...entries(stored), 'recovered'])
    .then((value) => {
      writeTransactions(recoveryStart)[0].events.push('promise-resolved');
      return value;
    });
  const recoveryTransactions = writeTransactions(recoveryStart);
  const visible = await other.read(key);
  return {
    connections: connections.size,
    updaterFailure,
    followerValue,
    afterThrow,
    failedTransactions,
    cloneFailure,
    afterClone,
    cloneTransactions,
    recovered,
    visible,
    recoveryTransactions,
    backup: await other.read(`${key}:backup`),
    untouched: await other.read(`${key}:untouched`),
  };
}

export async function identityNoops() {
  const key = 'native-atomic:noop:existing';
  const missingKey = 'native-atomic:noop:missing';
  await store.write(key, ['retained']);
  const other = new SaveStore();
  await other.read(key);
  let updaterValue: unknown;
  const existingStart = transactions.length;
  const returned = await store
    .update(key, (stored) => {
      updaterValue = stored;
      // Identity return is a no-op, even if a caller mutates its private read clone.
      entries(stored).push('unsaved-mutation');
      return stored;
    })
    .then((value) => {
      writeTransactions(existingStart)[0].events.push('promise-resolved');
      return value;
    });
  const existingTransactions = writeTransactions(existingStart);
  const visible = await other.read(key);

  const missingStart = transactions.length;
  const missing = await store
    .update(missingKey, (stored) => stored)
    .then((value) => {
      writeTransactions(missingStart)[0].events.push('promise-resolved');
      return value;
    });
  const missingTransactions = writeTransactions(missingStart);
  return {
    connections: connections.size,
    sameReference: returned === updaterValue,
    returned,
    visible,
    existingTransactions,
    missingIsUndefined: missing === undefined,
    missingTransactions,
    keys: await other.keys('native-atomic:noop:'),
  };
}

export async function cleanup() {
  try {
    await releaseWrites();
    await batch?.done;
  } finally {
    IDBDatabase.prototype.transaction = nativeTransaction;
    IDBObjectStore.prototype.put = nativePut;
    // Production versionchange handlers must close every SaveStore connection.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Native atomic database cleanup blocked'));
    });
  }
}
