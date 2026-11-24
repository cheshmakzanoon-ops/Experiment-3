import { desktopBridge, type MotoboundDesktop } from '../desktop/bridge.ts';

/**
 * Desktop save mirror (renderer half). In the Electron shell every completed
 * SaveStore write is also sent to the main process, which keeps an atomic,
 * checksummed JSON copy under userData (Steam Cloud syncs that folder). On
 * start-up the two copies are reconciled by a monotonic revision that is
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

  /** Reconcile IndexedDB with the mirror files. Never throws: a failure leaves IndexedDB as it is. */
  async reconcile(kv: MirrorKv): Promise<MirrorReport> {
    try {
      const info = await this.bridge.saves.info();
      const file = revisionOf(info.revision);
      this.revision = Math.max(this.revision, file);
      const keys = (await kv.keys()).filter((key) => key !== REVISION_KEY);
      const local = revisionOf(await kv.get(REVISION_KEY));
      this.revision = Math.max(this.revision, local);

      if (info.keys.length > 0 && (file > local || keys.length === 0)) {
        const snapshot = await this.bridge.saves.load();
        // Metadata and load are separate IPC calls; the loaded data may be newer.
        const revision = (this.revision = Math.max(this.revision, revisionOf(snapshot.revision)));
        await kv.putMany({ ...snapshot.entries, [REVISION_KEY]: revision });
        return {
          action: 'restored',
          keys: Object.keys(snapshot.entries).filter((key) => key !== REVISION_KEY).length,
          revision,
        };
      }
      if (keys.length > 0 && (local > file || info.keys.length === 0)) {
        const { [REVISION_KEY]: stored, ...entries } = await kv.entries();
        // The entries transaction can also observe a later local write than get().
        const revision = (this.revision = Math.max(this.revision, revisionOf(stored)) + 1);
        await this.bridge.saves.seed(entries, revision);
        await kv.putMany({ [REVISION_KEY]: revision });
        return { action: 'seeded', keys: Object.keys(entries).length, revision };
      }
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
    }
  }

  /** Called inside a readwrite transaction: stamps the data being written. */
  stamp(store: IDBObjectStore): number {
    const revision = ++this.revision;
    store.put(revision, REVISION_KEY);
    return revision;
  }

  /** Called after the transaction completed: forward the write. Best effort. */
  written(entries: readonly (readonly [string, unknown])[], revision: number) {
    for (const [key, value] of entries) {
      try {
        void this.bridge.saves.put(key, value, revision).catch(() => undefined);
      } catch {
        /* the next start-up reconciles by revision */
      }
    }
  }
}
