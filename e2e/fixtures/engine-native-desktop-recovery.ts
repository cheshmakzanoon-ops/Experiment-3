import { SaveStore } from '../../src/storage/data.ts';
import { REVISION_KEY } from '../../src/storage/desktop-mirror.ts';
import type {
  DesktopSaveInfo,
  DesktopSaveSnapshot,
  MotoboundDesktop,
} from '../../src/desktop/bridge.ts';

export type BridgeMethod = 'info' | 'load' | 'put' | 'commit' | 'seed' | 'flush';
export interface BridgeRequest {
  method: BridgeMethod;
  args: unknown[];
}
export interface Change {
  method: 'write' | 'writeWithBackup' | 'update';
  key: string;
  value: unknown;
}
export interface TransactionWitness {
  mode: IDBTransactionMode;
  reads: string[];
  writes: string[];
  readRevisions: unknown[];
  writtenRevisions: unknown[];
  events: string[];
}

type BindingWindow = Window & {
  __engineNativeDesktopCall(request: BridgeRequest): Promise<unknown>;
};
const databaseName = 'apex-formula';
const documentId = crypto.randomUUID();
const originalDesktop = Object.getOwnPropertyDescriptor(window, 'motobound');
const nativeTransaction = IDBDatabase.prototype.transaction;
const nativeGet = IDBObjectStore.prototype.get;
const nativePut = IDBObjectStore.prototype.put;
const transactions: TransactionWitness[] = [];
const witnesses = new WeakMap<IDBTransaction, TransactionWitness>();
const connections = new Set<IDBDatabase>();
const pending = new Set<Promise<unknown>>();
const unhandled: string[] = [];
let store: SaveStore | null = null;
let cleaned = false;
const rejection = (event: PromiseRejectionEvent) => unhandled.push(String(event.reason));
window.addEventListener('unhandledrejection', rejection);

// Observe the native transaction, requests and completion events. Every
// operation and argument is forwarded unchanged; no request is synthesized.
IDBDatabase.prototype.transaction = function (...args) {
  const transaction = Reflect.apply(nativeTransaction, this, args) as IDBTransaction;
  if (this.name === databaseName && transaction.objectStoreNames.contains('saved')) {
    connections.add(this);
    const witness: TransactionWitness = {
      mode: transaction.mode,
      reads: [],
      writes: [],
      readRevisions: [],
      writtenRevisions: [],
      events: [],
    };
    transactions.push(witness);
    witnesses.set(transaction, witness);
    for (const event of ['complete', 'abort'])
      transaction.addEventListener(event, () => witness.events.push(event), {
        once: true,
        capture: true,
      });
  }
  return transaction;
};
IDBObjectStore.prototype.get = function (...args) {
  const request = Reflect.apply(nativeGet, this, args) as IDBRequest;
  const witness = witnesses.get(this.transaction);
  if (witness) {
    const key = String(args[0]);
    witness.reads.push(key);
    request.addEventListener(
      'success',
      () => {
        if (key === REVISION_KEY) witness.readRevisions.push(request.result ?? 0);
      },
      { once: true },
    );
  }
  return request;
};
IDBObjectStore.prototype.put = function (...args) {
  const request = Reflect.apply(nativePut, this, args) as IDBRequest<IDBValidKey>;
  const witness = witnesses.get(this.transaction);
  if (witness) {
    const key = String(args[1]);
    witness.writes.push(key);
    witness.events.push('put');
    if (key === REVISION_KEY) witness.writtenRevisions.push(structuredClone(args[0]));
    request.addEventListener('success', () => witness.events.push('put-success'), { once: true });
  }
  return request;
};

function invoke<T>(method: BridgeMethod, args: unknown[] = []): Promise<T> {
  const operation = (window as BindingWindow).__engineNativeDesktopCall({
    method,
    args,
  }) as Promise<T>;
  pending.add(operation);
  void operation.then(
    () => { pending.delete(operation); },
    () => { pending.delete(operation); },
  );
  return operation;
}

/** A message turn lets the production mirror's derived promise chain finish.
 * This does not advance an IndexedDB request or substitute a wall-clock sleep. */
function taskTurn() {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
async function settleBridge() {
  for (;;) {
    if (pending.size) await Promise.allSettled([...pending]);
    await taskTurn();
    if (pending.size === 0) return;
  }
}
function installBridge() {
  // Only the saves surface is exercised. The binding is an explicit test
  // transport to the actual Node mirror service, not Electron preload/IPC.
  const saves: MotoboundDesktop['saves'] = {
    info: () => invoke<DesktopSaveInfo>('info'),
    load: () => invoke<DesktopSaveSnapshot>('load'),
    put: (key, value, revision) => invoke<number>('put', [key, value, revision]),
    commit: (entries, revision, previous) =>
      invoke<number>('commit', [entries, revision, previous]),
    seed: (entries, revision) => invoke<boolean>('seed', [entries, revision]),
    flush: () => invoke<boolean>('flush'),
  };
  Object.defineProperty(window, 'motobound', {
    configurable: true,
    writable: true,
    value: { desktop: { version: 1, saves } as unknown as MotoboundDesktop },
  });
}
function owner() {
  if (!store || cleaned) throw new Error('Native desktop owner is unavailable');
  return store;
}
export async function snapshot() {
  const current = owner();
  const keys = (await current.keys()).filter((key) => key !== REVISION_KEY);
  const values = await Promise.all(keys.map((key) => current.read(key)));
  const revision = (await current.read(REVISION_KEY)) ?? 0;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
    throw new Error('Invalid persisted desktop revision');
  return { revision, entries: Object.fromEntries(keys.map((key, i) => [key, values[i]])) };
}
export async function initialize(desktop = true) {
  if (store) throw new Error('Native desktop owner already initialized');
  if (desktop) installBridge();
  store = new SaveStore();
  await store.read('native-desktop:opening');
  await settleBridge();
  return {
    documentId,
    origin: location.origin,
    desktop: window.motobound?.desktop?.version === 1,
    connections: connections.size,
    schema: [...connections].map((db) => ({
      name: db.name,
      version: db.version,
      stores: [...db.objectStoreNames],
    })),
    state: await snapshot(),
  };
}
export async function change(change: Change) {
  const start = transactions.length;
  const current = owner();
  if (change.method === 'update')
    await current.update(change.key, () => change.value);
  else await current[change.method](change.key, change.value);
  const writes = transactions.slice(start).filter((transaction) => transaction.mode === 'readwrite');
  if (writes.length !== 1) throw new Error('Expected one native write transaction');
  writes[0].events.push('promise-resolved');
  await settleBridge();
  const observed = structuredClone(writes);
  return { transactions: observed, state: await snapshot(), pending: pending.size };
}
export async function cleanup() {
  if (!cleaned) {
    await settleBridge();
    cleaned = true;
    for (const db of connections) db.close();
    IDBDatabase.prototype.transaction = nativeTransaction;
    IDBObjectStore.prototype.get = nativeGet;
    IDBObjectStore.prototype.put = nativePut;
    if (originalDesktop) Object.defineProperty(window, 'motobound', originalDesktop);
    else Reflect.deleteProperty(window, 'motobound');
    window.removeEventListener('unhandledrejection', rejection);
  }
  return {
    pending: pending.size,
    closedConnections: connections.size,
    restored:
      IDBDatabase.prototype.transaction === nativeTransaction &&
      IDBObjectStore.prototype.get === nativeGet &&
      IDBObjectStore.prototype.put === nativePut,
    unhandled: [...unhandled],
  };
}
