import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A minimal dist shaped like Vite's output: an entry that statically imports
 * `vendor`, dynamically imports `lazy`, and a `lazy` that imports `deep`. */
function fixture(vendorBytes: number) {
  const dist = mkdtempSync(join(tmpdir(), 'bundle-budget-'));
  mkdirSync(join(dist, 'assets'));
  const noise = (bytes: number) =>
    `"${Array.from({ length: bytes }, () => Math.random().toString(36)[2]).join('')}"`;
  writeFileSync(
    join(dist, 'index.html'),
    '<script type="module" crossorigin src="./assets/index-A.js"></script>' +
      '<link rel="modulepreload" crossorigin href="./assets/vendor-B.js">',
  );
  writeFileSync(
    join(dist, 'assets/index-A.js'),
    `import{x as y}from"./vendor-B.js";const l=()=>import("./lazy-C.js");export{y,l};`,
  );
  writeFileSync(join(dist, 'assets/vendor-B.js'), `export const x=${noise(vendorBytes)};`);
  writeFileSync(
    join(dist, 'assets/lazy-C.js'),
    `import"./deep-D.js";export const z=${noise(5000)};`,
  );
  writeFileSync(join(dist, 'assets/deep-D.js'), `export const d=${noise(5000)};`);
  return dist;
}
const run = (dist: string, ...extra: string[]) =>
  spawnSync(process.execPath, ['scripts/bundle-budget.mjs', '--dist', dist, ...extra], {
    encoding: 'utf8',
  });

describe('bundle budget gate (G7)', () => {
  it('counts the entry and its static imports as initial and everything else as lazy', () => {
    const dist = fixture(2000);
    try {
      const result = run(dist, '--json');
      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout) as {
        initial: { rel: string }[];
        lazy: { rel: string }[];
      };
      expect(report.initial.map((chunk) => chunk.rel).sort()).toEqual([
        'assets/index-A.js',
        'assets/vendor-B.js',
      ]);
      expect(report.lazy.map((chunk) => chunk.rel).sort()).toEqual([
        'assets/deep-D.js',
        'assets/lazy-C.js',
      ]);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('fails when the initial gzip size exceeds the budget', () => {
    const dist = fixture(200_000);
    try {
      expect(run(dist, '--max-gzip-mb', '0.05').status).toBe(1);
      expect(run(dist, '--max-gzip-mb', '4').status).toBe(0);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('refuses a missing build', () => {
    expect(run(join(tmpdir(), 'no-such-dist-for-bundle-budget')).status).toBe(2);
  });
});
