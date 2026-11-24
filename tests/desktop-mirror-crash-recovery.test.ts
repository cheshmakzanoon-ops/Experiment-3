import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DesktopSaveInfo,
  DesktopSaveSnapshot,
  MotoboundDesktop,
} from '../src/desktop/bridge.ts';
import { DesktopMirror, REVISION_KEY, type MirrorKv } from '../src/storage/desktop-mirror.ts';

const fixture = fileURLToPath(new URL('./fixtures/desktop-mirror-process.cjs', import.meta.url));
const { encode, decode } = createRequire(import.meta.url)('../desktop/src/codec.cjs') as {
  encode(value: unknown): unknown;
  decode(value: unknown): unknown;
};
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const original = {
  career: { points: 10, event: 'old' },
  settings: { assist: true },
  'ghost:lap': new Float32Array([1, -0, 3]),
};
const latest = {
  career: { points: 20, event: 'latest' },
  settings: { assist: false },
  'ghost:lap': new Float32Array([4, -0, 6]),
};

type File = 'saves' | 'ghosts';
type Stage = 'opened' | 'partial-write' | 'written' | 'synced' | 'backup' | 'renamed';
interface Inspect {
  snapshot: DesktopSaveSnapshot;
  predecessorAccepted: boolean;
  sources: { main: string; ghosts: string };
}
const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function subprocess(dir: string, operation: string, extra: Record<string, unknown> = {}) {
  return spawnSync(process.execPath, ['--max-old-space-size=128', fixture], {
    input: JSON.stringify({ dir, operation, ...extra }),
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
}

function call<T>(dir: string, operation: string, extra: Record<string, unknown> = {}): T {
  const child = subprocess(dir, operation, extra);
  if (child.error) throw child.error;
  expect(child.signal, child.stderr).toBeNull();
  expect(child.status, child.stderr).toBe(0);
  return decode(JSON.parse(child.stdout)) as T;
}

function seed(entries: Record<string, unknown> = original, revision = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'motobound-mirror-process-'));
  dirs.push(dir);
  expect(call<boolean>(dir, 'seed', { entries: encode(entries), revision })).toBe(true);
  return dir;
}

function killWriter(dir: string, order: File[], target: File, stage: Stage | 'accepted') {
  const child = subprocess(dir, 'crash', { order, target, stage, entries: encode(latest) });
  if (child.error) throw child.error;
  expect(child.status, child.stderr).toBeNull();
  expect(child.signal, child.stderr).toBe('SIGKILL');
  const trace = readFileSync(join(dir, 'process-trace.jsonl'), 'utf8').trim().split('\n');
  expect(trace).toHaveLength(1);
  expect(JSON.parse(trace[0])).toMatchObject({
    stage,
    file: stage === 'accepted' ? 'memory' : `${target}.json`,
  });
}

function localKv(entries: Record<string, unknown>, revision: number) {
  const data = new Map<string, unknown>(
    Object.entries(structuredClone({ ...entries, [REVISION_KEY]: revision })),
  );
  const kv: MirrorKv = {
    keys: async () => [...data.keys()],
    get: async (key) => structuredClone(data.get(key)),
    entries: async () => structuredClone(Object.fromEntries(data)),
    putMany: async (entries) => {
      const next = new Map(data);
      for (const [key, value] of Object.entries(structuredClone(entries))) next.set(key, value);
      data.clear();
      for (const [key, value] of next) data.set(key, value);
    },
  };
  return { data, kv };
}

function bridge(dir: string): MotoboundDesktop {
  const saves: MotoboundDesktop['saves'] = {
    info: async () => call<DesktopSaveInfo>(dir, 'info'),
    load: async () => call<DesktopSaveSnapshot>(dir, 'load'),
    put: async () => {
      throw new Error('Modern reconciliation must not issue legacy single-key writes');
    },
    commit: async (entries, revision, previous) =>
      call<number>(dir, 'commit', {
        entries: encode(Object.fromEntries(entries)),
        revision,
        previous,
      }),
    seed: async (entries, revision) =>
      call<boolean>(dir, 'seed', { entries: encode(entries), revision }),
    flush: async () => true,
  };
  return { version: 1, saves } as MotoboundDesktop;
}

const stages: Stage[] = ['opened', 'partial-write', 'written', 'synced', 'backup', 'renamed'];
const orders: File[][] = [
  ['saves', 'ghosts'],
  ['ghosts', 'saves'],
];
const crashCases = orders.flatMap((order) =>
  order.flatMap((target) => stages.map((stage) => ({ order, target, stage }))),
);

describe('native mirror process crashes over real files', () => {
  it.each(crashCases)(
    'repairs $order / $target / $stage after SIGKILL without false completion',
    async ({ order, target, stage }) => {
      const dir = seed();
      killWriter(dir, order, target, stage);
      const installed = new Set(order.slice(0, order.indexOf(target)));
      if (stage === 'renamed') installed.add(target);
      const expected = {
        ...(installed.has('saves') ? latest : original),
        'ghost:lap': installed.has('ghosts') ? latest['ghost:lap'] : original['ghost:lap'],
      };
      const complete = installed.size !== 1;
      const before = call<Inspect>(dir, 'inspect');
      expect(before.snapshot).toEqual({
        revision: installed.size ? 2 : 1,
        complete,
        entries: expected,
      });
      expect(before.predecessorAccepted).toBe(complete);
      const local = localKv(latest, 2);
      const report = await DesktopMirror.forBridge(bridge(dir)).reconcile(local.kv);
      const unchangedCompletePair = installed.size === 2;
      expect(report).toMatchObject({
        action: unchangedCompletePair ? 'in-sync' : 'seeded',
        revision: unchangedCompletePair ? 2 : 3,
      });
      expect(call<Inspect>(dir, 'inspect').snapshot).toEqual({
        revision: unchangedCompletePair ? 2 : 3,
        complete: true,
        entries: latest,
      });
      expect(local.data.get('ghost:lap')).toEqual(latest['ghost:lap']);
      expect(Object.is((local.data.get('ghost:lap') as Float32Array)[1], -0)).toBe(true);
    },
  );

  it('recovers locally committed data after native acceptance dies before any disk write', async () => {
    const dir = seed();
    killWriter(dir, ['saves', 'ghosts'], 'saves', 'accepted');
    expect(call<Inspect>(dir, 'inspect').snapshot).toEqual({
      revision: 1,
      complete: true,
      entries: original,
    });
    expect(
      await DesktopMirror.forBridge(bridge(dir)).reconcile(localKv(latest, 2).kv),
    ).toMatchObject({
      action: 'seeded',
      revision: 3,
    });
    expect(call<Inspect>(dir, 'inspect').snapshot.entries).toEqual(latest);
  });

  it.each(['saves', 'ghosts'] as const)(
    'salvages readable mixed generations when only %s survived and IndexedDB is absent',
    async (first) => {
      const dir = seed();
      killWriter(
        dir,
        first === 'saves' ? ['saves', 'ghosts'] : ['ghosts', 'saves'],
        first,
        'renamed',
      );
      const expected = {
        ...(first === 'saves' ? latest : original),
        'ghost:lap': first === 'ghosts' ? latest['ghost:lap'] : original['ghost:lap'],
      };
      expect(call<Inspect>(dir, 'inspect').snapshot.complete).toBe(false);
      const local = localKv({}, 0);
      expect(await DesktopMirror.forBridge(bridge(dir)).reconcile(local.kv)).toMatchObject({
        action: 'restored',
        revision: 2,
      });
      expect(call<Inspect>(dir, 'inspect').snapshot).toEqual({
        revision: 2,
        complete: true,
        entries: expected,
      });
      expect(local.data.get('career')).toEqual(expected.career);
      expect(local.data.get('ghost:lap')).toEqual(expected['ghost:lap']);
    },
  );
});

interface Envelope {
  revision: number;
  entries: Record<string, unknown>;
  checksum: string;
  completion?: unknown;
  completionChecksum?: string;
}

function rewrite(dir: string, name: File, change: (envelope: Envelope) => void) {
  const filename = join(dir, `${name}.json`);
  const envelope = JSON.parse(readFileSync(filename, 'utf8')) as Envelope;
  change(envelope);
  writeFileSync(filename, JSON.stringify(envelope));
}

describe('restart certificate and legacy boundaries', () => {
  it('rejects a valid ghost envelope with the same revision but different content', async () => {
    const dir = seed(latest, 2);
    rewrite(dir, 'ghosts', (envelope) => {
      envelope.entries['ghost:lap'] = encode(new Float32Array([91, 92, 93]));
      envelope.checksum = digest(envelope.entries);
      envelope.completionChecksum = digest([
        envelope.revision,
        envelope.checksum,
        envelope.completion,
      ]);
    });
    const before = call<Inspect>(dir, 'inspect');
    expect(before.snapshot).toMatchObject({ revision: 2, complete: false });
    expect(before.sources).toEqual({ main: 'primary', ghosts: 'primary' });
    expect(before.predecessorAccepted).toBe(false);
    expect(
      await DesktopMirror.forBridge(bridge(dir)).reconcile(localKv(latest, 2).kv),
    ).toMatchObject({
      action: 'seeded',
      revision: 3,
    });
    expect(call<Inspect>(dir, 'inspect').snapshot.entries).toEqual(latest);
  });

  it.each(['bad-checksum', 'negative-ghost-revision', 'array-certificate'])(
    'quarantines %s completion metadata and refuses its split backup as complete',
    async (damage) => {
      const dir = seed();
      call(dir, 'commit', { entries: encode(latest), revision: 2, previous: 1 });
      rewrite(dir, 'saves', (envelope) => {
        if (damage === 'array-certificate') envelope.completion = [];
        else
          (envelope.completion as { ghostRevision: number }).ghostRevision =
            damage === 'negative-ghost-revision' ? -1 : 999;
        if (damage !== 'bad-checksum')
          envelope.completionChecksum = digest([
            envelope.revision,
            envelope.checksum,
            envelope.completion,
          ]);
      });
      const before = call<Inspect>(dir, 'inspect');
      expect(before.snapshot).toMatchObject({ revision: 2, complete: false });
      expect(before.snapshot.entries.career).toEqual(original.career);
      expect(before.snapshot.entries['ghost:lap']).toEqual(latest['ghost:lap']);
      expect(before.sources.main).toBe('backup');
      expect(before.predecessorAccepted).toBe(false);
      expect(readdirSync(dir).filter((name) => name.startsWith('saves.corrupt-'))).toHaveLength(1);
      expect(
        await DesktopMirror.forBridge(bridge(dir)).reconcile(localKv(latest, 2).kv),
      ).toMatchObject({
        action: 'seeded',
        revision: 3,
      });
      expect(call<Inspect>(dir, 'inspect').snapshot.entries).toEqual(latest);
    },
  );

  it.each([false, true])(
    'verifies equal-revision legacy values before upgrade (matching data: %s)',
    async (matching) => {
      const dir = seed(matching ? latest : original, 2);
      for (const name of ['saves', 'ghosts'] as const)
        rewrite(dir, name, (envelope) => {
          delete envelope.completion;
          delete envelope.completionChecksum;
        });
      expect(call<Inspect>(dir, 'inspect').snapshot.complete).toBeUndefined();
      expect(
        await DesktopMirror.forBridge(bridge(dir)).reconcile(localKv(latest, 2).kv),
      ).toMatchObject({
        action: 'seeded',
        revision: 3,
      });
      expect(call<Inspect>(dir, 'inspect').snapshot).toEqual({
        revision: 3,
        complete: true,
        entries: latest,
      });
    },
  );
});
