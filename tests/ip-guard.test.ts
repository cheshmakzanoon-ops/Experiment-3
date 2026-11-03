import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Release gate G15: the IP guard (scripts/ip-guard.mjs) certifies a PRODUCT build's output and
 * can never certify an owner or review build. It runs inside `vite build` for product builds
 * (vite.config.ts), in the CI `validate` job and in the release script; this pins its behaviour
 * on synthetic outputs so a regression in the guard itself cannot go unnoticed.
 */
const guard = new URL('../scripts/ip-guard.mjs', import.meta.url).pathname;
const roots: string[] = [];

function glb(names: string[]) {
  const json = Buffer.from(JSON.stringify({ nodes: names.map((name) => ({ name })) }));
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.write('glTF', 0, 'latin1');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.write('JSON', 16, 'latin1');
  return Buffer.concat([header, padded]);
}
function makeDist(
  files: Record<string, string | Buffer> = {},
  identity: Record<string, unknown> | null = { version: 1, variant: 'product' },
) {
  const dist = mkdtempSync(join(tmpdir(), 'ip-guard-'));
  roots.push(dist);
  const all: Record<string, string | Buffer> = {
    'index.html': '<!doctype html><title>MOTOBOUND</title><script src="assets/app.js"></script>',
    'assets/app.js': 'const a={nose:1,"apx01-shell":2,sidepod:3};export{a};',
    ...files,
  };
  if (identity) all['BUILD_IDENTITY.json'] = JSON.stringify(identity);
  for (const [name, content] of Object.entries(all)) {
    const path = join(dist, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  return dist;
}
function run(dist: string, extra: string[] = [], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [guard, '--dist', dist, ...extra], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('ip-guard certifies product builds', () => {
  it('passes a clean product output', () => {
    const result = run(makeDist());
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('IP guard: clean');
  });
  it('passes an output whose identity file predates the variant field', () => {
    expect(run(makeDist({}, { version: 1 })).status).toBe(0);
  });
  it.each([
    ['snake_case key in JS', { 'assets/app.js': 'export const d={redbull_wordmark:1}' }],
    ['compound in a JSON table', { 'assets/t.json': '{"tag_heuer":1}' }],
    ['bare honda', { 'assets/app.js': 'x("Honda")' }],
    ['bare oracle', { 'assets/app.js': 'const oracle=1' }],
    ['asset id in HTML', { 'index.html': '<p>RB19_BODY</p>' }],
    ['node name in a GLB', { 'models/car.glb': glb(['body', 'tyre_pirelli']) }],
    ['node name in a gzipped GLB', { 'models/car.glb.gz': gzipSync(glb(['front_bull'])) }],
    ['text inside a gzip asset', { 'assets/t.txt.gz': gzipSync(Buffer.from('arctic_wolf')) }],
  ])('fails on %s', (_name, files) => {
    const result = run(makeDist(files));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('problem(s)');
  });
  it('reports the brand and where it was found', () => {
    const result = run(makeDist({ 'assets/app.js': 'x={hard_rock:1}' }), ['--json']);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.certified).toBe(false);
    expect(report.problems[0]).toMatch(/assets\/app\.js: .*"hard rock"/);
  });
});

describe('ip-guard can never certify an owner or review build', () => {
  const refusals: [string, Record<string, string | Buffer>, Record<string, unknown> | null][] = [
    ['the owner model binary', { 'models/supplied-player.glb.gz': 'x' }, null],
    ['the owner LOD index', { 'models/supplied-player-lods.bin.gz': 'x' }, null],
    ['the lazy owner chunk', { 'assets/supplied-player-AbC123.js': 'export{}' }, null],
    ['an owner identity', {}, { version: 1, variant: 'owner' }],
    ['a review identity', {}, { version: 1, variant: 'review' }],
  ];
  it.each(refusals)('refuses %s with a clear message', (_name, files, identity) => {
    const result = run(makeDist(files, identity));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('REFUSED');
    expect(result.stderr).toContain('can never be certified');
  });
  it('has no way to switch the refusal off', () => {
    const owner = makeDist(
      { 'models/supplied-player.glb.gz': 'x' },
      { version: 1, variant: 'owner' },
    );
    // The old certifying flag was removed: it is now an error, not a pass.
    const flagged = run(owner, ['--owner-build']);
    expect(flagged.status).toBe(2);
    expect(flagged.stderr).toContain('--owner-build was removed');
    // Neither the owner variable nor the QA variable changes the verdict.
    for (const env of [
      { MOTOBOUND_SUPPLIED_PLAYER: '1' },
      { MOTOBOUND_QA_BUILD: '1', MOTOBOUND_SUPPLIED_PLAYER: '1', MOTOBOUND_REVIEW_TOOLS: '1' },
    ] as Record<string, string>[])
      expect(run(owner, [], env).status).toBe(1);
  });
  it('machine-readable output says not certified', () => {
    const result = run(makeDist({}, { version: 1, variant: 'owner' }), ['--json']);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ certified: false, variant: 'owner' });
  });
  it('exits 2 when there is no build to check', () => {
    const empty = mkdtempSync(join(tmpdir(), 'ip-guard-empty-'));
    roots.push(empty);
    expect(run(empty).status).toBe(2);
  });
});

describe('the certifying build path', () => {
  const vite = new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname;
  const root = new URL('../', import.meta.url).pathname;
  const env = (extra: Record<string, string>) => {
    const clean = { ...process.env };
    delete clean.MOTOBOUND_QA_BUILD;
    delete clean.MOTOBOUND_SUPPLIED_PLAYER;
    delete clean.MOTOBOUND_REVIEW_TOOLS;
    return { ...clean, ...extra };
  };
  it.each([['MOTOBOUND_SUPPLIED_PLAYER'], ['MOTOBOUND_REVIEW_TOOLS']])(
    '`vite build` (npm run build) refuses %s=1 and points at build:qa',
    (name) => {
      const out = mkdtempSync(join(tmpdir(), 'ip-guard-out-'));
      roots.push(out);
      const result = spawnSync(process.execPath, [vite, 'build', '--outDir', out], {
        cwd: root,
        encoding: 'utf8',
        env: env({ [name]: '1' }),
        timeout: 60000,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toContain('npm run build:qa');
      expect(result.stderr + result.stdout).toContain('can never be certified or published');
    },
    70000,
  );
  it('package.json: build certifies (no QA switches), build:qa is the only QA path', () => {
    const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
    expect(scripts.build).toBe('tsc --noEmit && vite build');
    expect(scripts['build:qa']).toBe('node scripts/build-qa.mjs');
    expect(scripts['check:ip']).toBe('node scripts/ip-guard.mjs --dist dist');
    expect(scripts['check:bundle']).toContain('scripts/ip-guard.mjs');
    // The QA path never calls the certifying path: no typecheck step, no guard (comments aside).
    const qa = readFileSync(join(root, 'scripts/build-qa.mjs'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(qa).toContain("MOTOBOUND_QA_BUILD: '1'");
    expect(qa).not.toMatch(/ip-guard|tsc|check:ip/);
  });
  it('the desktop packager and the release script certify what they package or publish', () => {
    const stage = readFileSync(join(root, 'desktop/scripts/stage-web.cjs'), 'utf8');
    expect(stage).toContain('scripts');
    expect(stage).toContain('ip-guard.mjs');
    expect(stage).toMatch(/guard\.status !== 0/);
    const release = readFileSync(join(root, 'scripts/publish-validated-release.sh'), 'utf8');
    expect(release).toContain('ip-guard.mjs');
    expect(release).toContain("identity.variant !== 'product'");
  });
  it('vite.config.ts runs the guard on product builds and labels every other build', () => {
    const config = readFileSync(join(root, 'vite.config.ts'), 'utf8');
    expect(config).toContain("name: 'ip-guard'");
    expect(config).toContain("join(root, 'scripts/ip-guard.mjs')");
    expect(config).toContain(
      "const variant = suppliedPlayer ? 'owner' : reviewTools ? 'review' : 'product';",
    );
    expect(config).toContain('fingerprint, variant }');
    expect(config).toContain('NOT_FOR_RELEASE.txt');
  });
});
