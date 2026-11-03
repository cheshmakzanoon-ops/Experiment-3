import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Release gate G15 (docs/studio/reports/ip-audit.md): the player's car is the ORIGINAL authored
 * APX-01 in a product build, and the owner-supplied model only in an owner build. The e2e specs
 * that bundle `RacingRenderer` or `FormulaCar` themselves (`build({ configFile: false, ... })`)
 * do not read `vite.config.ts`, so each must define `__SUPPLIED_PLAYER__` from the environment
 * (`fixtureDefine()` in e2e/fixtures/owner-build.ts): otherwise a spec run against an owner
 * build measures the original car while the page shows the supplied one, and a fixture that
 * dereferences `suppliedPlayer` crashes on the product build. This pins both rules statically
 * (the specs themselves are run in the browser jobs).
 */
const E2E = new URL('../e2e/', import.meta.url).pathname;
const read = (directory: string) =>
  readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => ({
      name: entry.name,
      text: readFileSync(join(directory, entry.name), 'utf8'),
    }));
const specs = read(E2E);
const fixtures = read(join(E2E, 'fixtures'));

describe('ad-hoc fixture bundles are the same kind of build as the page under test', () => {
  const adHoc = specs.filter((file) => file.text.includes('configFile: false'));
  it('finds the bundling specs', () => {
    expect(adHoc.length).toBeGreaterThan(80);
  });
  it.each(adHoc.map((file) => [file.name, file.text]))(
    '%s defines __SUPPLIED_PLAYER__ in every ad-hoc bundle',
    (_name, text) => {
      const builds = text.match(/configFile: false/g)!.length;
      const defined = text.match(/configFile: false,\s*define: fixtureDefine\(\)/g)?.length ?? 0;
      expect(defined).toBe(builds);
      expect(text).toMatch(
        /import \{[^}]*\bfixtureDefine\b[^}]*\} from '\.\/fixtures\/owner-build\.ts';/,
      );
    },
  );
  it('derives the flag from the owner-build environment variable only', () => {
    const source = readFileSync(join(E2E, 'fixtures/owner-build.ts'), 'utf8');
    expect(source).toContain(
      "export const OWNER_BUILD = process.env.MOTOBOUND_SUPPLIED_PLAYER === '1';",
    );
    expect(source).toMatch(
      /fixtureDefine\(\)[^{]*\{\s*return \{ __SUPPLIED_PLAYER__: JSON\.stringify\(OWNER_BUILD\) \};/,
    );
  });
});

describe('no fixture assumes the player car is the supplied model', () => {
  it('never asserts suppliedPlayer is non-null', () => {
    const offenders = [...specs, ...fixtures].filter(({ text }) =>
      /suppliedPlayer!|suppliedPlayer\)!/.test(text),
    );
    expect(offenders.map((file) => file.name)).toEqual([]);
  });
  it('owner-only specs skip with the stated reason, and only the owner-only specs', () => {
    const skipping = specs
      .filter(({ text }) => text.includes('test.skip(!OWNER_BUILD, OWNER_ONLY_REASON)'))
      .map((file) => file.name)
      .sort();
    expect(skipping).toEqual([
      '24-coupled-driver.spec.ts',
      '39-supplied-player.spec.ts',
      '41-player-render-budget.spec.ts',
    ]);
  });
  it('the measured specs (42 index budget, A31 wheel gun, P0 cockpit framing) run in both builds', () => {
    for (const name of [
      '42-full-scene-index-budget.spec.ts',
      'a31-wheel-gun.spec.ts',
      'p0-cockpit-framing.spec.ts',
    ]) {
      const text = specs.find((file) => file.name === name)!.text;
      expect(text, name).not.toContain('test.skip');
      expect(text, name).toContain('OWNER_BUILD');
    }
  });
});
