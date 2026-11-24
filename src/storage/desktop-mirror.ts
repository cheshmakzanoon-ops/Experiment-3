import {
  desktopBridge,
  type DesktopSaveSnapshot,
  type MotoboundDesktop,
} from '../desktop/bridge.ts';

/**
 * Desktop save mirror (renderer half). In the Electron shell every completed
 * SaveStore write is also sent to the main process, which keeps an atomic,
 * checksummed JSON copy under userData (Steam Cloud syncs that folder). On
 * start-up the two copies are reconciled by a complete revision that is
 * stored inside IndexedDB in the same transaction as the data it describes:
 *
 *   file revision  >  IndexedDB revision (or IndexedDB empty)  ->  restore from file
 *   IndexedDB revision  >  file revision (or file empty)        ->  re-seed the file
 *
 * In a browser there is no bridge, `DesktopMirror.detect()` is null and
 * SaveStore behaves exactly as before.
 */

export const REVISION_KEY = '__desktop_revision';

/** The slice of a key/value store the reconciliation needs (IndexedDB adapter below). */
export interface MirrorKv {
  keys(): Promise<string[]>;
  get(key: string): Promise<unknown>;
  entries(): Promise<Record<string, unknown>>;
  putMany(entries: Record<string, unknown>): Promise<void>;
}

export type MirrorAction = 'none' | 'in-sync' | 'restored' | 'seeded' | 'failed';
export interface MirrorReport {
  action: MirrorAction;
  keys: number;
  revision: number;
  detail?: string;
}

const revisionOf = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

/** Older shells cannot certify complete transactions, so revision equality
 * also needs a value comparison. Match the desktop codec, including its
 * non-JSON values; JSON.stringify would silently conflate several of these. */
function sameValue(a: unknown, b: unknown, path = new Set<unknown>()): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Object.prototype.toString.call(a) !== Object.prototype.toString.call(b)) return false;
  if (path.has(a) || path.has(b)) return false; // cyclic data is not supported by the file codec
  path.add(a);
  path.add(b);
  try {
    if (a instanceof Date && b instanceof Date) return Object.is(a.getTime(), b.getTime());
    if (a instanceof ArrayBuffer && b instanceof ArrayBuffer)
      return sameValue(new Uint8Array(a), new Uint8Array(b), path);
    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
      if (a.byteLength !== b.byteLength) return false;
      const left = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      const right = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      return left.every((value, index) => value === right[index]);
    }
    if (a instanceof Map && b instanceof Map)
      return a.size === b.size && sameValue([...a], [...b], path);
    if (a instanceof Set && b instanceof Set)
      return a.size === b.size && sameValue([...a], [...b], path);
    if (Array.isArray(a) && Array.isArray(b))
      return (
        a.length === b.length &&
        Array.from(a).every((value, index) => sameValue(value, b[index], path))
      );
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) &&
          sameValue(left[key], right[key], path),
      )
    );
  } finally {
    path.delete(a);
    path.delete(b);
  }
}

const dataEntries = (entries: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(entries).filter(([key]) => key !== REVISION_KEY));

export function idbKv(db: IDBDatabase, storeName = 'saved'): MirrorKv {
  // Request success does not imply transaction success: even a completed cursor
  // can be followed by an abort. Publish results only once the transaction commits.
  const transact = <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore, abort: (error: unknown) => void) => () => T,
  ) =>
    new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      let result: () => T;
      const abort = (error: unknown) => {
        reject(error);
        try {
          tx.abort();
        } catch {
          /* the transaction has already finished */
        }
      };
      tx.oncomplete = () => {
        try {
          resolve(result());
        } catch (error) {
          reject(error);
        }
      };
      tx.onerror = () => reject(tx.error ?? new Error('Mirror transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Mirror transaction aborted'));
      try {
        result = run(tx.objectStore(storeName), abort);
      } catch (error) {
        // A synchronous put/clone failure must also roll back earlier queued puts.
        abort(error);
      }
    });
  const resultOf = <T>(request: IDBRequest<T>, abort: (error: unknown) => void) => {
    request.onerror = () => abort(request.error ?? new Error('Mirror request failed'));
    return () => request.result;
  };
  return {
    keys: () =>
      transact('readonly', (store, abort) => {
        const result = resultOf(store.getAllKeys(), abort);
        return () => result().map(String);
      }),
    get: (key) => transact('readonly', (store, abort) => resultOf(store.get(key), abort)),
    entries: () =>
      transact('readonly', (store, abort) => {
        const out: Record<string, unknown> = {};
        const request = store.openCursor();
        resultOf(request, abort);
        request.onsuccess = () => {
          try {
            const cursor = request.result;
            if (!cursor) return;
            out[String(cursor.key)] = cursor.value;
            cursor.continue();
          } catch (error) {
            abort(error);
          }
        };
        return () => out;
      }),
    putMany: (entries) =>
      transact('readwrite', (store, abort) => {
        for (const [key, value] of Object.entries(entries)) resultOf(store.put(value, key), abort);
        return () => undefined;
      }),
  };
}

export class DesktopMirror {
  private revision = 0;
  private acceptedRevision = 0;
  private pending = new Map<string, { value: unknown; revision: number }>();
  private inFlight: Promise<void> | null = null;
  private blocked = false;
  private reconciling = false;
  private constructor(private readonly bridge: MotoboundDesktop) {}

  /** The mirror when running inside the desktop shell, else null. */
  static detect(): DesktopMirror | null {
    const bridge = desktopBridge();
    return bridge ? new DesktopMirror(bridge) : null;
  }

  /** For tests: a mirror over a supplied bridge. */
  static forBridge(bridge: MotoboundDesktop) {
    return new DesktopMirror(bridge);
  }

  get currentRevision() {
    return this.revision;
  }

  /** Reconcile IndexedDB with the mirror files. Never throws; restores use an atomic local batch. */
  async reconcile(kv: MirrorKv): Promise<MirrorReport> {
    this.reconciling = true;
    try {
      // A late IPC completion must not overwrite a newly seeded snapshot.
      await this.inFlight;
      const info = await this.bridge.saves.info();
      const file = revisionOf(info.revision);
      this.revision = Math.max(this.revision, file);
      const keys = (await kv.keys()).filter((key) => key !== REVISION_KEY);
      const local = revisionOf(await kv.get(REVISION_KEY));
      this.revision = Math.max(this.revision, local);

      if (keys.length > 0 && info.complete === false) return await this.seed(kv);
      if (info.keys.length > 0 && (file > local || keys.length === 0)) {
        const snapshot = await this.bridge.saves.load();
        this.revision = Math.max(this.revision, revisionOf(snapshot.revision));
        if (keys.length > 0 && snapshot.complete === false) return await this.seed(kv);
        // Metadata and load are separate IPC calls; the loaded data may be newer.
        return await this.restore(kv, snapshot);
      }
      if (keys.length > 0 && (local > file || info.keys.length === 0)) return await this.seed(kv);
      if (keys.length > 0 && info.complete !== true) {
        const snapshot = await this.bridge.saves.load();
        const entries = await kv.entries();
        const stored = revisionOf(entries[REVISION_KEY]);
        const loaded = revisionOf(snapshot.revision);
        this.revision = Math.max(this.revision, stored, loaded);
        if (loaded > stored && snapshot.complete !== false) return await this.restore(kv, snapshot);
        if (loaded !== stored || !sameValue(dataEntries(entries), dataEntries(snapshot.entries)))
          return await this.seed(kv);
        // Upgrade a readable legacy envelope only after verifying its contents.
        if (this.bridge.saves.commit) return await this.seed(kv);
      }
      this.acceptedRevision = file;
      this.blocked = false;
      return {
        action: keys.length || info.keys.length ? 'in-sync' : 'none',
        keys: keys.length,
        revision: this.revision,
      };
    } catch (error) {
      return {
        action: 'failed',
        keys: 0,
        revision: this.revision,
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.reconciling = false;
      this.drain();
    }
  }

  private async seed(kv: MirrorKv): Promise<MirrorReport> {
    const snapshot = await kv.entries();
    const entries = dataEntries(snapshot);
    // Bind the new revision to the same local snapshot, not an earlier get().
    const revision = (this.revision =
      Math.max(this.revision, revisionOf(snapshot[REVISION_KEY])) + 1);
    // Reserve it locally before IPC: a partial legacy seed or lost reply must
    // never make its file appear newer than the complete source on restart.
    await kv.putMany({ [REVISION_KEY]: revision });
    if (!(await this.bridge.saves.seed(entries, revision))) throw new Error('Mirror seed rejected');
    this.acceptedRevision = revision;
    this.blocked = false;
    return { action: 'seeded', keys: Object.keys(entries).length, revision };
  }

  private async restore(kv: MirrorKv, snapshot: DesktopSaveSnapshot): Promise<MirrorReport> {
    const revision = this.revision;
    const entries = dataEntries(snapshot.entries);
    await kv.putMany({ ...entries, [REVISION_KEY]: revision });
    // A newer legacy file is still a valid restore source. After restoring it
    // (or all readable files when local storage was lost), upgrade the envelope
    // using the complete local snapshot, including local-only recovery keys.
    const certify = this.bridge.saves.commit && snapshot.complete !== true;
    if (certify && !(await this.bridge.saves.seed(dataEntries(await kv.entries()), revision)))
      throw new Error('Mirror seed rejected');
    this.acceptedRevision = certify ? revision : revisionOf(snapshot.revision);
    this.blocked = false;
    return { action: 'restored', keys: Object.keys(entries).length, revision };
  }

  /** Called inside a readwrite transaction: stamps the data being written. */
  stamp(store: IDBObjectStore): number {
    const revision = ++this.revision;
    store.put(revision, REVISION_KEY);
    return revision;
  }

  /** Called after commit. At most one batch is in flight; later writes coalesce
   * by key. On failure, the persisted local revision stays ahead of the complete
   * native prefix. Recovery re-seeds it before incremental writes can resume. */
  written(entries: readonly (readonly [string, unknown])[], revision: number) {
    if (this.blocked) return;
    for (const [key, value] of entries) {
      const previous = this.pending.get(key);
      if (!previous || revision > previous.revision) this.pending.set(key, { value, revision });
      if (this.pending.size > 256) {
        // Do not retain an unbounded backlog behind a stalled IPC call.
        this.blocked = true;
        this.pending.clear();
        return;
      }
    }
    this.drain();
  }

  private drain() {
    if (this.inFlight || this.blocked || this.reconciling) return;
    const entries: [string, unknown][] = [];
    let revision = this.acceptedRevision;
    for (const [key, entry] of this.pending) {
      if (entry.revision <= this.acceptedRevision) continue;
      entries.push([key, entry.value]);
      revision = Math.max(revision, entry.revision);
    }
    this.pending.clear();
    if (!entries.length) return;
    const failed = () => {
      this.blocked = true;
      this.pending.clear();
    };
    try {
      const saves = this.bridge.saves;
      // Legacy IPC sends all keys immediately but serializes whole transactions.
      // It cannot prove completion; equal revisions are verified on next start.
      const sending = saves.commit
        ? saves.commit(entries, revision, this.acceptedRevision).then((accepted) => {
            if (accepted !== revision) throw new Error('Mirror commit rejected');
          })
        : Promise.allSettled(
            entries.map(([key, value]) => {
              try {
                return saves.put(key, value, revision);
              } catch (error) {
                return Promise.reject(error);
              }
            }),
          ).then((results) => {
            const rejection = results.find((result) => result.status === 'rejected');
            if (rejection?.status === 'rejected') throw rejection.reason;
          });
      this.inFlight = sending
        .then(() => {
          this.acceptedRevision = revision;
        }, failed)
        .finally(() => {
          this.inFlight = null;
          this.drain();
        });
    } catch {
      failed();
    }
  }
}
