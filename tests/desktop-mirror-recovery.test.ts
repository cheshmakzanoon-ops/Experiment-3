import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DesktopSaveInfo,
  DesktopSaveSnapshot,
  MotoboundDesktop,
} from '../src/desktop/bridge.ts';
import { DesktopMirror, REVISION_KEY, type MirrorKv } from '../src/storage/desktop-mirror.ts';

type Entries = readonly (readonly [string, unknown])[];
interface NativeMirror {
  revision: number;
  writes: number;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  load(): DesktopSaveSnapshot;
  flush(): boolean;
}
interface NativeSaves {
  info(): DesktopSaveInfo;
  load(): DesktopSaveSnapshot;
  put(key: string, value: unknown, revision: number): number;
  commit(entries: Entries, revision: number, previousRevision: number): number;
  seed(entries: Record<string, unknown>, revision: number): boolean;
  flush(): boolean;
}
const { SaveMirror, saveMirrorService } = createRequire(import.meta.url)(
  '../desktop/src/save-mirror.cjs',
) as {
  SaveMirror: new (options: { dir: string; name: string; debounceMs: number }) => NativeMirror;
  saveMirrorService(
    mirrors: { main: NativeMirror; ghosts: NativeMirror },
    path: string,
  ): NativeSaves;
};

const dirs: string[] = [];
const mirrors: NativeMirror[] = [];
function stop(mirror: NativeMirror) {
  if (mirror.timer) clearTimeout(mirror.timer);
  mirror.timer = null;
}
afterEach(() => {
  mirrors.splice(0).forEach(stop);
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function disk(existingDir?: string) {
  const dir = existingDir ?? mkdtempSync(join(tmpdir(), 'motobound-mirror-recovery-'));
  if (!existingDir) dirs.push(dir);
  const main = new SaveMirror({ dir, name: 'saves', debounceMs: 60_000 });
  const ghosts = new SaveMirror({ dir, name: 'ghosts', debounceMs: 60_000 });
  mirrors.push(main, ghosts);
  main.load();
  ghosts.load();
  return { dir, main, ghosts, saves: saveMirrorService({ main, ghosts }, dir) };
}

function kvOf(entries: Record<string, unknown>, revision = 1) {
  const data = new Map<string, unknown>(
    Object.entries(structuredClone({ ...entries, [REVISION_KEY]: revision })),
  );
  const kv: MirrorKv = {
    keys: async () => [...data.keys()],
    get: async (key) => data.get(key),
    entries: async () => Object.fromEntries(data),
    putMany: async (values) => {
      for (const [key, value] of Object.entries(structuredClone(values))) data.set(key, value);
    },
  };
  return { data, kv };
}

function bridgeOf(native: NativeSaves, modern = true) {
  const saves = {
    info: vi.fn(async () => {
      const info = native.info();
      if (!modern) delete info.complete;
      return info;
    }),
    load: vi.fn(async () => {
      const snapshot = native.load();
      if (!modern) delete snapshot.complete;
      return snapshot;
    }),
    put: vi.fn(
      (key: string, value: unknown, revision: number): Promise<number> =>
        Promise.resolve(native.put(key, structuredClone(value), revision)),
    ),
    commit: modern
      ? vi.fn(
          (entries: Entries, revision: number, previous: number): Promise<number> =>
            Promise.resolve(native.commit(structuredClone(entries), revision, previous)),
        )
      : undefined,
    seed: vi.fn(async (entries: Record<string, unknown>, revision: number) =>
      native.seed(structuredClone(entries), revision),
    ),
    flush: vi.fn(async () => native.flush()),
  };
  return { saves, bridge: { version: 1, saves } as unknown as MotoboundDesktop };
}

function fixture(modern = true) {
  const initial = { career: 'old', settings: 'old' };
  const files = disk();
  files.saves.seed(initial, 1);
  files.saves.flush();
  const local = kvOf(initial);
  const ipc = bridgeOf(files.saves, modern);
  return {
    ...files,
    ...ipc,
    local,
    mirror: DesktopMirror.forBridge(ipc.bridge),
    native: files.saves,
  };
}

function commit(mirror: DesktopMirror, local: ReturnType<typeof kvOf>, entries: Entries) {
  const captured = structuredClone(entries);
  for (const [key, value] of captured) local.data.set(key, structuredClone(value));
  const revision = mirror.stamp({
    put: (value: unknown, key: string) => local.data.set(key, value),
  } as unknown as IDBObjectStore);
  mirror.written(captured, revision);
  return revision;
}

async function settle() {
  // Drain promise callbacks only; no real player files, Electron, or timed IO.
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('complete desktop write prefixes', () => {
  it.each(['sync', 'async'] as const)(
    'repairs a %s-rejected career batch and never lets settings conceal it',
    async (failure) => {
      const f = fixture();
      await f.mirror.reconcile(f.local.kv);
      f.saves.commit!.mockImplementationOnce(() => {
        if (failure === 'sync') throw new Error('IPC unavailable');
        return Promise.reject(new Error('IPC unavailable'));
      });
      commit(f.mirror, f.local, [['career', 'new']]);
      await settle();
      commit(f.mirror, f.local, [['settings', 'new']]);
      await settle();
      expect(f.saves.commit).toHaveBeenCalledTimes(1);
      expect(f.native.info()).toMatchObject({ revision: 1, complete: true });
      f.native.flush();

      const restart = disk(f.dir);
      const ipc = bridgeOf(restart.saves);
      expect(await DesktopMirror.forBridge(ipc.bridge).reconcile(f.local.kv)).toMatchObject({
        action: 'seeded',
        revision: 4,
      });
      expect(restart.saves.load()).toMatchObject({
        complete: true,
        entries: { career: 'new', settings: 'new' },
      });
      restart.saves.flush();
      expect(disk(f.dir).saves.load().entries).toEqual({ career: 'new', settings: 'new' });
    },
  );

  it.each(['sync', 'async'] as const)(
    'repairs a legacy successful backup followed by a %s primary failure at the same revision',
    async (failure) => {
      const f = fixture(false);
      await f.mirror.reconcile(f.local.kv);
      f.saves.put.mockImplementation((key, value, revision) => {
        if (key === 'career') {
          if (failure === 'sync') throw new Error('primary IPC failed');
          return Promise.reject(new Error('primary IPC failed'));
        }
        return Promise.resolve(f.native.put(key, value, revision));
      });
      commit(f.mirror, f.local, [
        ['career:backup', 'old'],
        ['career', 'new'],
      ]);
      await settle();
      f.native.flush();
      expect(f.native.load()).toMatchObject({
        revision: 2,
        entries: { career: 'old', 'career:backup': 'old' },
      });

      const restart = disk(f.dir);
      const ipc = bridgeOf(restart.saves, false);
      expect(await DesktopMirror.forBridge(ipc.bridge).reconcile(f.local.kv)).toMatchObject({
        action: 'seeded',
        revision: 3,
      });
      expect(restart.saves.load().entries).toEqual({
        career: 'new',
        'career:backup': 'old',
        settings: 'old',
      });
    },
  );

  it.each([true, false])(
    'repairs previously masked equal revisions (modern bridge: %s)',
    async (modern) => {
      const f = fixture(modern);
      f.native.put('settings', 'new', 3); // An old application skipped the failed career write.
      f.native.flush();
      f.local.data.set('career', 'new');
      f.local.data.set('settings', 'new');
      f.local.data.set(REVISION_KEY, 3);
      const restart = disk(f.dir);
      const ipc = bridgeOf(restart.saves, modern);
      expect(await DesktopMirror.forBridge(ipc.bridge).reconcile(f.local.kv)).toMatchObject({
        action: 'seeded',
      });
      expect(restart.saves.load().entries).toEqual({ career: 'new', settings: 'new' });
    },
  );

  it('accepts primary and backup as one batch and tolerates an aborted revision gap', async () => {
    const f = fixture();
    await f.mirror.reconcile(f.local.kv);
    f.mirror.stamp({ put: () => undefined } as unknown as IDBObjectStore); // aborted: no written()
    commit(f.mirror, f.local, [
      ['career:backup', 'old'],
      ['career', 'new'],
    ]);
    await settle();
    expect(f.saves.commit).toHaveBeenCalledWith(
      [
        ['career:backup', 'old'],
        ['career', 'new'],
      ],
      3,
      1,
    );
    expect(f.native.load()).toMatchObject({
      revision: 3,
      complete: true,
      entries: { career: 'new', 'career:backup': 'old' },
    });
    expect(f.saves.put).not.toHaveBeenCalled();
  });

  it('rejects out-of-order and stale batches without overwriting a newer value', () => {
    const f = fixture();
    expect(() => f.native.commit([['career', 'third']], 3, 2)).toThrow(/predecessor/);
    expect(f.native.load().revision).toBe(1);
    f.native.commit([['career', 'second']], 2, 1);
    f.native.commit([['career', 'third']], 3, 2);
    expect(() => f.native.commit([['career', 'second']], 2, 1)).toThrow(/predecessor/);
    expect(() => f.native.seed({ career: 'stale' }, 2)).toThrow(/stale/);
    expect(f.native.load()).toMatchObject({
      revision: 3,
      complete: true,
      entries: { career: 'third' },
    });
  });

  it('stays recoverable when a complete native batch loses its IPC acknowledgement', async () => {
    const f = fixture();
    await f.mirror.reconcile(f.local.kv);
    f.saves.commit!.mockImplementationOnce((entries, revision, previous) => {
      f.native.commit(entries, revision, previous);
      return Promise.reject(new Error('acknowledgement lost'));
    });
    commit(f.mirror, f.local, [
      ['career:backup', 'old'],
      ['career', 'new'],
    ]);
    await settle();
    f.native.flush();
    const restart = disk(f.dir);
    const ipc = bridgeOf(restart.saves);
    expect(await DesktopMirror.forBridge(ipc.bridge).reconcile(f.local.kv)).toMatchObject({
      action: 'in-sync',
      revision: 2,
    });
    expect(restart.saves.load().entries.career).toBe('new');
  });
});

describe('split-file completion certificates', () => {
  it('restores a newer version-1 legacy file before certifying it, retaining local-only keys', async () => {
    const f = disk();
    f.saves.seed({ career: 'cloud latest', 'ghost:lap': new Float32Array([5]) }, 7);
    f.saves.flush();
    for (const name of ['saves', 'ghosts']) {
      const path = join(f.dir, `${name}.json`);
      const payload = JSON.parse(readFileSync(path, 'utf8'));
      delete payload.completion;
      delete payload.completionChecksum;
      writeFileSync(path, JSON.stringify(payload));
    }
    const restart = disk(f.dir);
    expect(restart.saves.info().complete).toBeUndefined();
    const local = kvOf({ career: 'local old', 'career:backup': 'local recovery' }, 3);
    const ipc = bridgeOf(restart.saves);
    expect(await DesktopMirror.forBridge(ipc.bridge).reconcile(local.kv)).toMatchObject({
      action: 'restored',
      revision: 7,
    });
    expect(local.data.get('career')).toBe('cloud latest');
    expect(restart.saves.load()).toMatchObject({
      complete: true,
      entries: { career: 'cloud latest', 'career:backup': 'local recovery' },
    });
  });

  it('recovers readable split-file contents when IndexedDB is absent and certifies the result', async () => {
    const f = disk();
    f.saves.seed({ career: 'old', 'ghost:lap': new Float32Array([1]) }, 1);
    f.saves.flush();
    f.saves.commit(
      [
        ['career', 'new'],
        ['ghost:lap', new Float32Array([2])],
      ],
      2,
      1,
    );
    f.main.flush();
    stop(f.ghosts);
    const restart = disk(f.dir);
    const ipc = bridgeOf(restart.saves);
    const local = kvOf({}, 0);
    expect(await DesktopMirror.forBridge(ipc.bridge).reconcile(local.kv)).toMatchObject({
      action: 'restored',
      revision: 2,
    });
    expect(restart.saves.load()).toMatchObject({
      complete: true,
      entries: { career: 'new', 'ghost:lap': new Float32Array([1]) },
    });
    expect(local.data.get('career')).toBe('new');
  });

  it.each(['main', 'ghosts'] as const)(
    'repairs a crash after only the %s file was flushed',
    async (first) => {
      const f = disk();
      const initial = { career: 'old', 'ghost:lap': new Float32Array([1, 2]) };
      const latest = { career: 'new', 'ghost:lap': new Float32Array([3, 4]) };
      f.saves.seed(initial, 1);
      f.saves.flush();
      f.saves.commit(Object.entries(latest), 2, 1);
      f[first].flush();
      stop(f.main);
      stop(f.ghosts); // process crash: discard the other dirty in-memory file
      const restart = disk(f.dir);
      expect(restart.saves.info()).toMatchObject({ revision: 2, complete: false });
      const local = kvOf(latest, 2);
      const ipc = bridgeOf(restart.saves);
      expect(await DesktopMirror.forBridge(ipc.bridge).reconcile(local.kv)).toMatchObject({
        action: 'seeded',
        revision: 3,
      });
      restart.saves.flush();
      expect(disk(f.dir).saves.load()).toMatchObject({
        revision: 3,
        complete: true,
        entries: latest,
      });
    },
  );

  it('detects a ghost backup recovery even when the profile revision is current', async () => {
    const f = disk();
    f.saves.seed({ career: 'old', 'ghost:lap': new Float32Array([1]) }, 1);
    f.saves.flush();
    const latest = { career: 'new', 'ghost:lap': new Float32Array([2]) };
    f.saves.commit(Object.entries(latest), 2, 1);
    f.saves.flush();
    writeFileSync(join(f.dir, 'ghosts.json'), '{broken');
    const restart = disk(f.dir);
    expect(restart.saves.info()).toMatchObject({ revision: 2, complete: false });
    const ipc = bridgeOf(restart.saves);
    expect(await DesktopMirror.forBridge(ipc.bridge).reconcile(kvOf(latest, 2).kv)).toMatchObject({
      action: 'seeded',
    });
    expect(restart.saves.load().entries).toEqual(latest);
  });

  it('certifies profile-only saves without rewriting the large ghost file', () => {
    const f = disk();
    f.saves.seed({ career: 'old', 'ghost:lap': new Float32Array([1]) }, 1);
    f.saves.flush();
    const ghostFile = readFileSync(join(f.dir, 'ghosts.json'), 'utf8');
    const ghostWrites = f.ghosts.writes;
    f.saves.commit([['career', 'new']], 2, 1);
    f.saves.flush();
    expect(f.ghosts.writes).toBe(ghostWrites);
    expect(readFileSync(join(f.dir, 'ghosts.json'), 'utf8')).toBe(ghostFile);
    expect(disk(f.dir).saves.info()).toMatchObject({ revision: 2, complete: true });
  });

  it('validates both files before installing any part of a batch or full seed', () => {
    const f = fixture();
    const before = f.native.load();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() =>
      f.native.commit(
        [
          ['career', 'new'],
          ['ghost:bad', cyclic],
        ],
        2,
        1,
      ),
    ).toThrow(/cyclic/);
    expect(f.native.load()).toEqual(before);
    expect(() => f.native.seed({ career: 'new', 'ghost:bad': cyclic }, 2)).toThrow(/cyclic/);
    expect(f.native.load()).toEqual(before);
    expect(f.main.dirty || f.ghosts.dirty).toBe(false);
  });

  it('checksums completion metadata and preserves the existing backup fallback', () => {
    const f = fixture();
    f.native.commit([['career', 'new']], 2, 1);
    f.native.flush();
    const path = join(f.dir, 'saves.json');
    const payload = JSON.parse(readFileSync(path, 'utf8'));
    payload.completion.ghostRevision = 999;
    writeFileSync(path, JSON.stringify(payload));
    const restart = disk(f.dir);
    expect(restart.saves.load()).toMatchObject({
      revision: 1,
      complete: true,
      entries: { career: 'old' },
    });
  });
});

describe('bounded and serialized forwarding', () => {
  it('coalesces a burst behind one acknowledgement without advancing the queued revision', async () => {
    const f = fixture();
    await f.mirror.reconcile(f.local.kv);
    let release!: () => void;
    f.saves.commit!.mockImplementationOnce((entries, revision, previous) => {
      const accepted = f.native.commit(entries, revision, previous);
      return new Promise((resolve) => {
        release = () => resolve(accepted);
      });
    });
    commit(f.mirror, f.local, [['career', 0]]);
    for (let i = 1; i <= 1000; i++)
      commit(f.mirror, f.local, [
        ['career', i],
        ['settings', i],
      ]);
    expect(f.saves.commit).toHaveBeenCalledTimes(1);
    expect(f.native.info().revision).toBe(2);
    expect(f.local.data.get(REVISION_KEY)).toBe(1002);
    release();
    await settle();
    expect(f.saves.commit).toHaveBeenCalledTimes(2);
    expect(f.saves.commit!.mock.calls[1]).toEqual([
      [
        ['career', 1000],
        ['settings', 1000],
      ],
      1002,
      2,
    ]);
    expect(f.native.load()).toMatchObject({
      revision: 1002,
      complete: true,
      entries: { career: 1000, settings: 1000 },
    });
  });

  it('falls back to restart recovery instead of growing a backlog of distinct keys', async () => {
    const f = fixture();
    await f.mirror.reconcile(f.local.kv);
    let release!: () => void;
    f.saves.commit!.mockImplementationOnce((entries, revision, previous) => {
      const accepted = f.native.commit(entries, revision, previous);
      return new Promise((resolve) => {
        release = () => resolve(accepted);
      });
    });
    commit(f.mirror, f.local, [['career', 'new']]);
    for (let i = 0; i < 300; i++) commit(f.mirror, f.local, [[`record:${i}`, i]]);
    release();
    await settle();
    expect(f.saves.commit).toHaveBeenCalledTimes(1);
    f.native.flush();
    const restart = disk(f.dir);
    const ipc = bridgeOf(restart.saves);
    expect(await DesktopMirror.forBridge(ipc.bridge).reconcile(f.local.kv)).toMatchObject({
      action: 'seeded',
      keys: 302,
    });
    expect(restart.saves.load().entries['record:299']).toBe(299);
  });

  it('waits for every legacy key before a recovery seed can replace the snapshot', async () => {
    const f = fixture(false);
    await f.mirror.reconcile(f.local.kv);
    let release!: () => void;
    f.saves.put.mockImplementation((key, value, revision) => {
      if (key === 'career') throw new Error('synchronous primary rejection');
      return new Promise((resolve) => {
        release = () => resolve(f.native.put(key, value, revision));
      });
    });
    commit(f.mirror, f.local, [
      ['career:backup', 'old'],
      ['career', 'new'],
    ]);
    const reconciliation = f.mirror.reconcile(f.local.kv);
    await settle();
    expect(f.saves.seed).not.toHaveBeenCalled();
    release();
    expect(await reconciliation).toMatchObject({ action: 'seeded' });
    expect(f.native.load().entries).toEqual({
      career: 'new',
      'career:backup': 'old',
      settings: 'old',
    });
  });
});

describe('legacy recovery value comparison', () => {
  it('recognizes equal codec-supported values without JSON coercion or a needless seed', async () => {
    const source = new Float32Array([9, 1.5, -2.25, 8]);
    const value = {
      bytes: new Uint8Array([1, 2]).buffer,
      view: new DataView(new Uint8Array([3, 4]).buffer),
      samples: source.subarray(1, 3),
      special: [undefined, NaN, -0, Infinity, -Infinity, 42n],
      dates: [new Date('2026-01-02T03:04:05Z'), new Date(NaN)],
      map: new Map([[{ lap: 1 }, new Set(['wet', 'manual'])]]),
      $t: 'ordinary user property',
    };
    const f = disk();
    f.saves.seed({ profile: value }, 1);
    f.saves.flush();
    const ipc = bridgeOf(disk(f.dir).saves, false);
    expect(
      await DesktopMirror.forBridge(ipc.bridge).reconcile(kvOf({ profile: value }).kv),
    ).toMatchObject({ action: 'in-sync' });
    expect(ipc.saves.seed).not.toHaveBeenCalled();
  });

  it.each([
    [NaN, null],
    [undefined, null],
    [-0, 0],
    [new Uint8Array([1, 2]), new Uint8Array([1, 3])],
    [new Map([['lap', 1]]), new Map([['lap', 2]])],
    [new Set(['wet']), new Set(['dry'])],
    [Object.assign(new Array<number>(2), { 1: 2 }), [1, 2]],
  ])(
    'repairs unequal values even when revision counters match (%j)',
    async (localValue, fileValue) => {
      const f = disk();
      f.saves.seed({ profile: fileValue }, 1);
      const ipc = bridgeOf(f.saves, false);
      expect(
        await DesktopMirror.forBridge(ipc.bridge).reconcile(kvOf({ profile: localValue }).kv),
      ).toMatchObject({ action: 'seeded' });
      expect(f.saves.load().entries.profile).toEqual(localValue);
    },
  );

  it('keeps the full local snapshot authoritative when a full seed is rejected', async () => {
    const f = fixture();
    f.local.data.set(REVISION_KEY, 2);
    f.saves.seed.mockResolvedValueOnce(false);
    expect(await f.mirror.reconcile(f.local.kv)).toMatchObject({
      action: 'failed',
      detail: 'Mirror seed rejected',
    });
    expect(f.local.data.get(REVISION_KEY)).toBe(3);
    expect(f.native.info().revision).toBe(1);
  });

  it('repairs a partially accepted legacy seed without restoring its stale ghost value', async () => {
    const f = disk();
    f.saves.seed({ career: 'old', 'ghost:lap': new Float32Array([1]) }, 1);
    f.saves.flush();
    const latest = { career: 'new', 'ghost:lap': new Float32Array([2]) };
    const local = kvOf(latest, 2);
    const ipc = bridgeOf(f.saves, false);
    ipc.saves.seed.mockImplementationOnce(async (entries, revision) => {
      f.saves.put('career', entries.career, revision);
      throw new Error('legacy ghost seed rejected');
    });
    expect(await DesktopMirror.forBridge(ipc.bridge).reconcile(local.kv)).toMatchObject({
      action: 'failed',
      revision: 3,
    });
    expect(local.data.get(REVISION_KEY)).toBe(3);
    f.saves.flush();
    const restart = disk(f.dir);
    const retry = bridgeOf(restart.saves, false);
    expect(await DesktopMirror.forBridge(retry.bridge).reconcile(local.kv)).toMatchObject({
      action: 'seeded',
      revision: 4,
    });
    expect(restart.saves.load().entries).toEqual(latest);
  });
});
