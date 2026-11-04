import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The desktop shell's side of the Steam demo: the store link, the packaging scripts and config. */
const load = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const store = load('../desktop/src/store-link.cjs') as {
  STORE_PLACEHOLDER_URL: string;
  parseAppId(v: unknown): string | null;
  cleanSource(v: unknown): string;
  buildStoreUrl(appId: unknown, source?: unknown): string | null;
  isAllowedStoreUrl(url: string): boolean;
  configuredAppId(env?: Record<string, string>, config?: { appId?: unknown } | null): string | null;
  openStore(o: {
    env?: Record<string, string>;
    config?: { appId?: unknown } | null;
    source?: unknown;
    openExternal: (url: string) => unknown;
    log?: (m: string) => void;
  }): Promise<{ opened: boolean; reason: string | null }>;
};

describe('store link (the demo WISHLIST button, desktop side)', () => {
  it('accepts only plain Steam app ids', () => {
    expect(store.parseAppId('2873190')).toBe('2873190');
    expect(store.parseAppId(480)).toBe('480');
    expect(store.parseAppId(' 480 ')).toBe('480');
    for (const bad of [
      '',
      '0',
      '-5',
      '12ab',
      '1e3',
      '480/../x',
      '12345678901',
      null,
      undefined,
      {},
      [],
    ])
      expect(store.parseAppId(bad), String(bad)).toBeNull();
  });
  it('builds the store address from the id, with a clean campaign label', () => {
    expect(store.buildStoreUrl('480', 'paddock')).toBe(
      'https://store.steampowered.com/app/480/?utm_source=motobound-demo&utm_medium=in-game&utm_campaign=paddock',
    );
    expect(store.cleanSource('festival-end')).toBe('festival-end');
    for (const bad of ['Paddock', 'a b', 'x/y', '', 'x'.repeat(40), 7, null])
      expect(store.cleanSource(bad), String(bad)).toBe('demo');
    expect(store.buildStoreUrl('480', '../x')).toMatch(/utm_campaign=demo$/);
    expect(store.buildStoreUrl(undefined, 'paddock')).toBeNull();
    expect(store.buildStoreUrl('not-an-id', 'paddock')).toBeNull();
  });
  it('allows only https store.steampowered.com/app/<id>/ with utm parameters', () => {
    const ok = store.buildStoreUrl('480', 'paddock')!;
    expect(store.isAllowedStoreUrl(ok)).toBe(true);
    for (const bad of [
      'http://store.steampowered.com/app/480/',
      'https://store.steampowered.com.evil.example/app/480/',
      'https://evil.example/app/480/',
      'https://store.steampowered.com@evil.example/app/480/',
      'https://user:pw@store.steampowered.com/app/480/',
      'https://store.steampowered.com:8443/app/480/',
      'https://store.steampowered.com/app/480/#x',
      'https://store.steampowered.com/app/480/?redirect=http://evil.example',
      'https://store.steampowered.com/app/480',
      'https://store.steampowered.com/app/0/',
      'https://store.steampowered.com/app/480/extra/',
      'https://store.steampowered.com/search/?term=motobound',
      'steam://store/480',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'not a url',
    ])
      expect(store.isAllowedStoreUrl(bad), bad).toBe(false);
  });
  it('prefers the environment over the staged file, and has a documented placeholder', () => {
    expect(store.configuredAppId({ MOTOBOUND_STORE_APPID: '111' }, { appId: 222 })).toBe('111');
    expect(store.configuredAppId({}, { appId: 222 })).toBe('222');
    expect(store.configuredAppId({}, { appId: null })).toBeNull();
    expect(store.configuredAppId(undefined, null)).toBeNull();
    expect(store.STORE_PLACEHOLDER_URL).toContain('<FULL_GAME_APP_ID>');
  });
  it('opens exactly the built address, and never throws', async () => {
    const opened: string[] = [];
    const logs: string[] = [];
    const ok = await store.openStore({
      env: {},
      config: { appId: 480 },
      source: 'paddock',
      openExternal: (url) => void opened.push(url),
      log: (m) => logs.push(m),
    });
    expect(ok).toEqual({ opened: true, reason: null });
    expect(opened).toEqual([
      'https://store.steampowered.com/app/480/?utm_source=motobound-demo&utm_medium=in-game&utm_campaign=paddock',
    ]);
    // The page cannot choose the destination: a hostile source label is reduced to `demo`.
    opened.length = 0;
    await store.openStore({
      env: {},
      config: { appId: 480 },
      source: 'https://evil.example',
      openExternal: (url) => void opened.push(url),
    });
    expect(opened[0]).toMatch(
      /^https:\/\/store\.steampowered\.com\/app\/480\/\?.*utm_campaign=demo$/,
    );
    // No id staged: nothing is opened, the reason says why and the log names the placeholder.
    opened.length = 0;
    const none = await store.openStore({
      env: {},
      config: null,
      source: 'paddock',
      openExternal: (url) => void opened.push(url),
      log: (m) => logs.push(m),
    });
    expect(none).toEqual({ opened: false, reason: 'not-configured' });
    expect(opened).toEqual([]);
    expect(logs.join('\n')).toContain('<FULL_GAME_APP_ID>');
    // A failing opener is contained.
    const failing = await store.openStore({
      env: {},
      config: { appId: 480 },
      source: 'paddock',
      openExternal: () => {
        throw new Error('no browser');
      },
    });
    expect(failing).toEqual({ opened: false, reason: 'failed' });
  });
});

describe('the shell exposes the store link and nothing else for the demo', () => {
  it('has one IPC handler that goes through the allow-listed opener', () => {
    const main = read('desktop/main.cjs');
    expect(main).toContain("handle('shell:openStore'");
    expect(main).toContain("require('./src/store-link.cjs')");
    // shell.openExternal appears once, inside the store-link call, never with a page-supplied URL.
    expect([...main.matchAll(/openExternal/g)]).toHaveLength(2);
    expect(main).toMatch(/openExternal: \(url\) => shell\.openExternal\(url\)/);
    const preload = read('desktop/preload.cjs');
    expect(preload).toContain("openStore: (source) => call('shell:openStore', source)");
  });
});

describe('demo packaging', () => {
  it('has its own app identity, executable, output folder and artifact names', () => {
    const demo = read('desktop/electron-builder.demo.yml');
    expect(demo).toMatch(/^extends: \.\/electron-builder\.yml$/m);
    expect(demo).toMatch(/^appId: io\.motobound\.game\.demo$/m);
    expect(demo).toMatch(/^productName: MOTOBOUND Demo$/m);
    // userData (saves, logs, Steam Cloud) follows the package.json inside the app, not the builder's
    // productName: extraMetadata is what separates the demo's folder from the game's.
    expect(demo).toMatch(/extraMetadata:\n {2}name: motobound-demo\n {2}productName: MOTOBOUND Demo\n/);
    expect(demo).toMatch(/executableName: motobound-demo/);
    expect(demo).toMatch(/output: release-demo/);
    expect(demo).toMatch(/target: \[nsis, portable, zip\]/);
    expect(demo).toMatch(/^artifactName: MOTOBOUND-Demo-/m);
    const full = read('desktop/electron-builder.yml');
    expect(full).toMatch(/^appId: io\.motobound\.game$/m);
    expect(full).toMatch(/^productName: MOTOBOUND$/m);
  });
  it('stages the demo build only for the demo scripts, and the full build for the others', () => {
    const scripts = (
      JSON.parse(read('desktop/package.json')) as { scripts: Record<string, string> }
    ).scripts;
    for (const name of ['pack:demo:linux', 'dist:demo:linux', 'dist:demo:win', 'dist:demo:mac']) {
      expect(scripts[name], name).toContain('stage-web.cjs --demo');
      expect(scripts[name], name).toContain('--config electron-builder.demo.yml');
      expect(scripts[name], name).toContain('--publish never');
    }
    for (const name of ['pack:linux', 'dist:linux', 'dist:win', 'dist:win:zip', 'dist:mac']) {
      expect(scripts[name], name).not.toContain('--demo');
      expect(scripts[name], name).not.toContain('electron-builder.demo.yml');
    }
    expect(scripts['dist:win']).toContain('nsis portable zip');
    const root = JSON.parse(read('package.json')).scripts as Record<string, string>;
    for (const name of [
      'desktop:pack:demo',
      'desktop:dist:demo:linux',
      'desktop:dist:demo:win',
      'desktop:dist:demo:mac',
    ])
      expect(root[name], name).toMatch(/^npm --prefix desktop run (pack|dist):demo:/);
  });
  const stage = (args: string[], identity: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), 'motobound-stage-'));
    try {
      mkdirSync(join(dir, 'assets'));
      writeFileSync(join(dir, 'index.html'), '<!doctype html>');
      if (identity !== undefined)
        writeFileSync(join(dir, 'BUILD_IDENTITY.json'), JSON.stringify(identity));
      return spawnSync(
        process.execPath,
        [join(root, 'desktop/scripts/stage-web.cjs'), ...args, '--source', dir],
        { encoding: 'utf8' },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  it('refuses to package a build of the other edition (before copying anything)', () => {
    const full = stage([], { variant: 'product', edition: 'demo' });
    expect(full.status).toBe(1);
    expect(full.stderr).toMatch(/"demo" edition build but this stage is for "full"/);
    const demo = stage(['--demo'], { variant: 'product', edition: 'full' });
    expect(demo.status).toBe(1);
    expect(demo.stderr).toMatch(/"full" edition build but this stage is for "demo"/);
    // A build from before editions existed is the full game.
    const old = stage(['--demo'], { variant: 'product' });
    expect(old.status).toBe(1);
    expect(old.stderr).toMatch(/"full" edition build but this stage is for "demo"/);
  });
  it('still refuses an incomplete build', () => {
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'desktop/scripts/stage-web.cjs'),
        '--demo',
        '--source',
        join(tmpdir(), 'motobound-no-such-build'),
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/index\.html not found/);
  });
});
