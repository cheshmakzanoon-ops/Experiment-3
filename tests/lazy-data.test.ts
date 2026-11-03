import { describe, expect, it } from 'vitest';
import { build } from 'vite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  LazyDataNotLoadedError,
  lazyDataStatus,
  lazyDataset,
  loadLazyData,
} from '../src/core/lazy-data.ts';
import { splitDataset, lazyData } from '../scripts/vite-lazy-data.ts';

describe('lazy dataset runtime', () => {
  it('keeps small keys inline and refuses large keys until loaded', async () => {
    let fetches = 0;
    const data = lazyDataset<{ version: number }, { table: number[] }>(
      'test/runtime',
      'alpha',
      { version: 3 },
      ['table'],
      async () => {
        fetches++;
        return { default: { table: [1, 2, 3] } };
      },
    );
    expect(data.version).toBe(3);
    expect(() => data.table).toThrow(LazyDataNotLoadedError);
    expect(() => data.table).toThrow(/test\/runtime.*\.table.*loadLazyData/);
    expect(lazyDataStatus()).toContainEqual({ id: 'test/runtime', group: 'alpha', loaded: false });
    await Promise.all([loadLazyData('alpha'), loadLazyData('alpha')]);
    expect(fetches).toBe(1);
    expect(data.table).toEqual([1, 2, 3]);
    expect(Object.keys(data)).toEqual(['version', 'table']);
    expect(lazyDataStatus()).toContainEqual({ id: 'test/runtime', group: 'alpha', loaded: true });
    await loadLazyData();
    expect(fetches).toBe(1);
  });

  it('loads only the requested group, can retry after a failed fetch, and is a no-op with no match', async () => {
    let attempts = 0;
    let others = 0;
    const data = lazyDataset<object, { rows: string[] }>(
      'test/retry',
      'beta',
      {},
      ['rows'],
      async () => {
        if (++attempts === 1) throw new Error('chunk unavailable');
        return { default: { rows: ['ok'] } };
      },
    );
    lazyDataset<object, { other: number[] }>('test/other', 'gamma', {}, ['other'], async () => {
      others++;
      return { default: { other: [1] } };
    });
    await expect(loadLazyData('beta')).rejects.toThrow('chunk unavailable');
    expect(() => data.rows).toThrow(LazyDataNotLoadedError);
    await loadLazyData('beta');
    expect(data.rows).toEqual(['ok']);
    expect(others).toBe(0);
    await expect(loadLazyData('no-such-group')).resolves.toBeUndefined();
  });
});

describe('lazy dataset splitting', () => {
  it('moves only top-level keys at or above the threshold', () => {
    const { inline, lazy } = splitDataset(
      { version: 1, units: 'metres', rest: [[0, 1, 0]], meshes: { a: 'x'.repeat(200) } },
      100,
    );
    expect(Object.keys(inline)).toEqual(['version', 'units', 'rest']);
    expect(Object.keys(lazy)).toEqual(['meshes']);
    expect(() => splitDataset([1, 2, 3])).toThrow(/JSON object/);
  });
});

describe('lazy dataset build plugin', () => {
  const sentinel = 'LAZY-PAYLOAD-SENTINEL';
  const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'lazy-data-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'src/table.json'),
      JSON.stringify({
        version: 7,
        rest: [1, 2],
        table: Array.from({ length: 40 }, () => sentinel),
      }),
    );
    writeFileSync(
      join(root, 'src/entry.ts'),
      [
        "import data from './table.json' with { type: 'json' };",
        "import { loadLazyData } from '" +
          resolve('src/core/lazy-data.ts').replaceAll('\\', '/') +
          "';",
        'export const probe = {',
        '  version: data.version,',
        '  rest: data.rest.length,',
        '  early: () => data.table.length,',
        '  load: loadLazyData,',
        '  late: () => data.table.length,',
        '};',
      ].join('\n'),
    );
    return root;
  };
  const options = (root: string) => ({
    root,
    files: { 'src/table.json': 'alpha' },
    minBytes: 200,
    runtime: resolve('src/core/lazy-data.ts'),
  });

  it('puts large keys in a separate chunk the entry does not contain', async () => {
    const root = fixture();
    try {
      const built = await build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [lazyData(options(root))],
        build: {
          write: false,
          lib: { entry: join(root, 'src/entry.ts'), formats: ['es'], fileName: 'entry' },
        },
      });
      const output = (Array.isArray(built) ? built[0] : built) as {
        output: { type: string; fileName: string; code?: string; isEntry?: boolean }[];
      };
      const chunks = output.output.filter((item) => item.type === 'chunk');
      const entry = chunks.find((chunk) => chunk.isEntry)!;
      const payload = chunks.filter((chunk) => !chunk.isEntry && chunk.code?.includes(sentinel));
      expect(entry.code).not.toContain(sentinel);
      expect(payload).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('serves small keys at once and large keys only after loadLazyData()', async () => {
    const root = fixture();
    try {
      const built = await build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [lazyData(options(root))],
        build: {
          write: false,
          lib: { entry: join(root, 'src/entry.ts'), formats: ['iife'], name: 'Probe' },
          rollupOptions: { output: { inlineDynamicImports: true } },
        },
      });
      const output = (Array.isArray(built) ? built[0] : built) as {
        output: { type: string; code?: string }[];
      };
      const code = output.output.find((item) => item.type === 'chunk')!.code!;
      const { probe } = new Function(`${code}; return Probe;`)() as {
        probe: {
          version: number;
          rest: number;
          early(): number;
          late(): number;
          load(): Promise<void>;
        };
      };
      expect(probe.version).toBe(7);
      expect(probe.rest).toBe(2);
      expect(() => probe.early()).toThrow(/before loadLazyData/);
      await probe.load();
      expect(probe.late()).toBe(40);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
