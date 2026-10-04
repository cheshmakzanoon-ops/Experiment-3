import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedSource, runWithStableSource, snapshotSource } from '../scripts/source-stability.ts';

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'source-stability-'));
  directories.push(root);
  for (const path of ['src', 'public/models', 'docs', 'node_modules', 'dist'])
    mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, 'src/example.ts'), 'export const version = 1;\n');
  writeFileSync(join(root, 'package.json'), '{}\n');
  return root;
}

it('accepts legitimate edits made before a normal invocation without historical hashes', () => {
  const root = fixture();
  writeFileSync(join(root, 'src/example.ts'), 'export const version = 2;\n');
  expect(runWithStableSource(root, process.execPath, ['-e', 'process.exit(0)'])).toBe(0);
});

it.each(['src/example.ts', 'src/new.ts', 'docs/guide.md', 'package.json'])(
  'rejects a build-time modification or addition to %s',
  (path) => {
    const root = fixture();
    expect(
      runWithStableSource(root, process.execPath, [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(path)}, 'changed')`,
      ]),
    ).toBe(1);
  },
);

it('rejects deleted input even when the child command fails', () => {
  const root = fixture();
  const before = snapshotSource(root);
  expect(
    runWithStableSource(root, process.execPath, [
      '-e',
      "require('node:fs').unlinkSync('src/example.ts');process.exit(23)",
    ]),
  ).toBe(1);
  expect(changedSource(before, snapshotSource(root))).toEqual(['src/example.ts']);
});

it('permits only the named disposable player LOD derivative and output directories', () => {
  const root = fixture();
  const before = snapshotSource(root);
  for (const path of [
    'public/models/supplied-player-lods.bin.gz',
    'dist/build.js',
    'node_modules/a.js',
  ])
    writeFileSync(join(root, path), 'generated');
  expect(changedSource(before, snapshotSource(root))).toEqual([]);
  writeFileSync(join(root, 'public/models/aurel-track-boards.glb'), 'unexpected authoring');
  expect(changedSource(before, snapshotSource(root))).toEqual([
    'public/models/aurel-track-boards.glb',
  ]);
});

it('propagates a failing command and fails closed for a missing executable', () => {
  const root = fixture();
  expect(runWithStableSource(root, process.execPath, ['-e', 'process.exit(23)'])).toBe(23);
  expect(runWithStableSource(root, join(root, 'nonexistent-executable'), [])).toBe(1);
});

it('keeps source materialization and Blender out of ordinary npm lifecycles', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of [
    'preinstall',
    'postinstall',
    'prepare',
    'precheck',
    'prebuild',
    'predev',
    'pretest',
  ])
    expect(pkg.scripts[name] ?? '').not.toMatch(/materialize|git\s+apply|blender|author-/i);
  expect(pkg.scripts['check:stable']).toContain('source-stability.ts');
  expect(pkg.scripts['generate:player-lods']).not.toContain('--update-manifest');
});
