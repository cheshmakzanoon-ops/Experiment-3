import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { FORBIDDEN_RE, ALLOW } from '../scripts/ip-denylist.mjs';
import { buildNotices, NOTICES_PATH } from '../scripts/third-party-notices.mjs';
import { BRANDS } from '../src/rendering/studio/brand-atlas.ts';
import { DEFAULT_LIVERY, LIVERY_PRESETS } from '../src/storage/livery.ts';
import { LIVERY_SCHEMES } from '../src/rendering/car-livery.ts';
import { creditsHtml } from '../src/ui/credits.ts';

/**
 * Release gate G15 (docs/studio/reports/ip-audit.md): the shipped authored assets and the
 * player-visible brand tables carry no real team, sponsor, maker or commercial-game
 * identifier. The build-output half of the gate is `npm run check:ip` (scripts/ip-guard.mjs).
 * The owner-only supplied player model is deliberately excluded: it is not part of any
 * product build (vite.config.ts) and is tested by tests/supplied-*.test.ts.
 */
const ROOT = new URL('../', import.meta.url).pathname;
const OWNER_ONLY = /(^|\/)supplied-player[^/]*$/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}
function hits(text: string) {
  const found: string[] = [];
  for (const [label, re] of FORBIDDEN_RE) {
    const global = new RegExp(re.source, 'gi');
    for (const match of text.matchAll(global)) {
      const around = text.slice(Math.max(0, match.index - 12), match.index + match[0].length + 12);
      if (!ALLOW.some((a) => a.test(around))) found.push(`${label}: ${match[0]}`);
    }
  }
  return found;
}
function glbNames(path: string) {
  const file = readFileSync(path);
  const bytes: Buffer = path.endsWith('.gz') ? gunzipSync(file) : file;
  expect(bytes.readUInt32LE(0), path).toBe(0x46546c67);
  return bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8');
}

describe('G15 shipped authored assets', () => {
  const assets = [
    ...[...walk(join(ROOT, 'public/models'))].filter((p) => /\.glb(\.gz)?$/.test(p)),
    ...[...walk(join(ROOT, 'src/rendering'))].filter((p) => /\.glb\.gz$/.test(p)),
  ]
    .filter((p) => !OWNER_ONLY.test(p))
    .map((p) => relative(ROOT, p));

  it('finds the shipped GLBs (including the original APX-01 shell, driver and A61 levels)', () => {
    expect(assets.length).toBeGreaterThanOrEqual(45);
    for (const name of [
      'src/rendering/apx01-shell.glb.gz',
      'src/rendering/apx01-driver.glb.gz',
      'src/rendering/a61-rival-near.glb.gz',
    ])
      expect(assets).toContain(name);
    expect(assets.some((a) => OWNER_ONLY.test(a))).toBe(false);
  });
  it.each(assets)('%s names no real brand, team, sponsor or commercial game', (path) => {
    expect(hits(glbNames(join(ROOT, path))), path).toEqual([]);
  });
});

describe('G15 player-visible brand tables', () => {
  it('uses only the fictional brand list for the default livery, presets and team schemes', () => {
    for (const brand of BRANDS) expect(hits(brand), brand).toEqual([]);
    expect(BRANDS).toContain(DEFAULT_LIVERY.sponsor);
    for (const preset of Object.values(LIVERY_PRESETS)) expect(hits(preset.sponsor)).toEqual([]);
    for (const scheme of LIVERY_SCHEMES)
      for (const brand of [scheme.title, ...scheme.partners]) expect(BRANDS).toContain(brand);
  });
  it('no longer carries the legacy APEX product name on cars or in the default identity', () => {
    expect(BRANDS.some((b) => /APEX/.test(b))).toBe(false);
    expect(DEFAULT_LIVERY.sponsor).not.toMatch(/APEX/);
  });
  it('keeps the owner-only binaries and the review catalogue out of product output (config contract)', () => {
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    expect(config).toContain("'models/supplied-player.glb.gz'");
    expect(config).toContain("'models/supplied-player-lods.bin.gz'");
    expect(config).toMatch(/__SUPPLIED_PLAYER__: JSON\.stringify\(suppliedPlayer\)/);
    expect(config).toContain("process.env.MOTOBOUND_SUPPLIED_PLAYER === '1'");
    expect(config).toContain("process.env.MOTOBOUND_REVIEW_TOOLS === '1'");
    const renderer = readFileSync(join(ROOT, 'src/rendering/renderer.ts'), 'utf8');
    // the only way to reach the loader is the build flag
    expect(renderer).not.toMatch(/import\s*\{[^}]*loadSuppliedPlayer[^}]*\}\s*from/);
    expect(renderer).toMatch(/if \(OWNER_BUILD\) \{[\s\S]*import\('\.\/supplied-player\.ts'\)/);
  });
});

describe('G15 third-party notices', () => {
  it('ships a current THIRD_PARTY_NOTICES.txt with MIT, Apache-2.0 and OFL texts', () => {
    expect(existsSync(join(ROOT, NOTICES_PATH))).toBe(true);
    const shipped = readFileSync(join(ROOT, NOTICES_PATH), 'utf8');
    expect(shipped, 'run: node scripts/third-party-notices.mjs').toBe(buildNotices());
    expect(shipped).toContain('The MIT License');
    expect(shipped).toContain('Apache License');
    expect(shipped).toContain('Version 2.0, January 2004');
    expect(shipped).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(shipped).toContain('Saira Stencil One');
    expect(shipped).toContain('Binomial LLC');
    expect(shipped).toContain('Creative Commons Attribution 4.0');
  });
  it('is linked from the credits screen', () => {
    expect(creditsHtml([])).toContain('href="THIRD_PARTY_NOTICES.txt"');
  });
});
