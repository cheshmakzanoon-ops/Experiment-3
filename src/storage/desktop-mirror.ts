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

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export function idbKv(db: IDBDatabase, storeName = 'saved'): MirrorKv {
  const store = (mode: IDBTransactionMode) =>
    db.transaction(storeName, mode).objectStore(storeName);
  return {
    keys: async () => (await done(store('readonly').getAllKeys())).map(String),
    get: (key) => done(store('readonly').get(key)),
    async entries() {
      const out: Record<string, unknown> = {};
      const request = store('readonly').openCursor();
      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return resolve();
          out[String(cursor.key)] = cursor.value;
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
      return out;
    },
    putMany(entries) {
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const target = tx.objectStore(storeName);
        for (const [key, value] of Object.entries(entries)) target.put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('Restore aborted'));
      });
    },
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
      const keys = (await kv.keys()).filter((key) => key !== REVISION_KEY);
      const stored = await kv.get(REVISION_KEY);
      const local = typeof stored === 'number' && Number.isSafeInteger(stored) ? stored : 0;
      const file = Number.isSafeInteger(info.revision) ? info.revision : 0;
      this.revision = Math.max(local, file);

      if (info.keys.length > 0 && (file > local || keys.length === 0)) {
        const snapshot = await this.bridge.saves.load();
        await kv.putMany({ ...snapshot.entries, [REVISION_KEY]: this.revision });
        return { action: 'restored', keys: info.keys.length, revision: this.revision };
      }
      if (keys.length > 0 && (local > file || info.keys.length === 0)) {
        this.revision = Math.max(local, file) + 1;
        const { [REVISION_KEY]: _own, ...entries } = await kv.entries();
        await this.bridge.saves.seed(entries, this.revision);
        await kv.putMany({ [REVISION_KEY]: this.revision });
        return { action: 'seeded', keys: keys.length, revision: this.revision };
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
