import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

/** The Electron shell's pure modules (desktop/src/*.cjs) run under plain Node. */
const load = createRequire(import.meta.url);
interface Mirror {
  entries: Record<string, unknown>;
  revision: number;
  source: string;
  recovered: string | null;
  writes: number;
  load(): { revision: number; source: string; entries: Record<string, unknown> };
  put(key: string, value: unknown, revision?: number): void;
  replaceAll(entries: Record<string, unknown>, revision?: number): void;
  flush(): boolean;
  keys(): string[];
  snapshot(): { entries: Record<string, unknown>; revision: number };
}
const { SaveMirror } = load('../desktop/src/save-mirror.cjs') as {
  SaveMirror: new (o: {
    dir: string;
    name?: string;
    debounceMs?: number;
    now?: () => number;
  }) => Mirror;
};
const { encode, decode } = load('../desktop/src/codec.cjs') as {
  encode(v: unknown): unknown;
  decode(v: unknown): unknown;
};
const protocol = load('../desktop/src/protocol.cjs') as {
  resolveRequest(root: string, url: string): string | null;
  mimeFor(file: string): string;
  contentSecurityPolicy(o?: { dev?: boolean }): string;
  isAllowedRequestUrl(url: string): boolean;
  isTrustedSenderUrl(url: string): boolean;
};
const flags = load('../desktop/src/flags.cjs') as {
  parseArgs(argv: string[], env?: Record<string, string>): Record<string, unknown>;
  planSwitches(o: {
    platform: string;
    env?: Record<string, string>;
    uid?: number | null;
  }): string[][];
};
const windowState = load('../desktop/src/window-state.cjs') as {
  sanitizeState(
    raw: unknown,
    displays: { workArea: { x: number; y: number; width: number; height: number } }[],
  ): Record<string, unknown>;
};
const steam = load('../desktop/src/steam.cjs') as {
  loadSteam(o?: {
    env?: Record<string, string>;
    enabled?: boolean;
    requireFn?: (id: string) => unknown;
  }): {
    available: boolean;
    reason: string | null;
    activate(id: string): boolean;
    isActivated(id: string): boolean;
    setPresence(v: Record<string, unknown>): void;
    clearPresence(): void;
    name: string | null;
  };
};

const dirs: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'motobound-shell-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('value codec', () => {
  it('round-trips the structured-clone values the game stores', () => {
    const ghost = {
      version: 3,
      circuit: 'aurel',
      samples: new Float32Array([0, 1.5, -2.25, 1e-7]),
      nested: {
        when: new Date('2026-01-02T03:04:05.000Z'),
        none: undefined,
        nan: NaN,
        inf: -Infinity,
        big: 12n,
      },
      list: [1, 'two', null, true],
      set: new Set([1, 2]),
      map: new Map([['a', { b: 1 }]]),
      $t: 'collides with the tag key',
    };
    const wire = JSON.parse(JSON.stringify(encode(ghost)));
    const back = decode(wire) as typeof ghost;
    expect(back.samples).toBeInstanceOf(Float32Array);
    expect([...back.samples]).toEqual([...ghost.samples]);
    expect(back.nested.when.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect('none' in back.nested && back.nested.none === undefined).toBe(true);
    expect(Number.isNaN(back.nested.nan)).toBe(true);
    expect(back.nested.inf).toBe(-Infinity);
    expect(back.nested.big).toBe(12n);
    expect(back.set).toEqual(ghost.set);
    expect(back.map).toEqual(ghost.map);
    expect(back.$t).toBe('collides with the tag key');
    expect(back.list).toEqual(ghost.list);
  });

  it('keeps a typed-array view exact (offset and length) and rejects cycles', () => {
    const buffer = new Float32Array([1, 2, 3, 4]);
    const view = buffer.subarray(1, 3);
    const back = decode(JSON.parse(JSON.stringify(encode(view)))) as Float32Array;
    expect([...back]).toEqual([2, 3]);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => encode(cyclic)).toThrow(/cyclic/);
  });
});

describe('atomic save mirror', () => {
  const settings = { version: 6, quality: 'low', volume: 0.45 };

  it('writes checksummed JSON atomically and reads it back', () => {
    const dir = tmp();
    const a = new SaveMirror({ dir, debounceMs: 5 });
    expect(a.load().source).toBe('empty');
    a.put('settings', settings, 1);
    a.put('ghost-like', new Float32Array([1, 2, 3]), 2);
    expect(a.flush()).toBe(true);
    const names = readdirSync(dir).sort();
    expect(names).toContain('saves.json');
    expect(names).not.toContain('saves.json.tmp'); // the swap leaves no temp file behind
    const onDisk = JSON.parse(readFileSync(join(dir, 'saves.json'), 'utf8'));
    expect(onDisk).toMatchObject({ format: 'motobound-saves', version: 1, revision: 2 });
    expect(onDisk.checksum).toMatch(/^[0-9a-f]{64}$/);

    const b = new SaveMirror({ dir });
    const snapshot = b.load();
    expect(snapshot).toMatchObject({ source: 'primary', revision: 2 });
    expect(snapshot.entries.settings).toEqual(settings);
    expect(snapshot.entries['ghost-like']).toBeInstanceOf(Float32Array);
  });

  it('keeps the previous good state as a .bak on every swap', () => {
    const dir = tmp();
    const m = new SaveMirror({ dir });
    m.load();
    m.put('k', 'one', 1);
    m.flush();
    expect(existsSync(join(dir, 'saves.json.bak'))).toBe(false); // nothing to back up yet
    m.put('k', 'two', 2);
    m.flush();
    expect(JSON.parse(readFileSync(join(dir, 'saves.json.bak'), 'utf8')).entries.k).toBe('one');
    expect(JSON.parse(readFileSync(join(dir, 'saves.json'), 'utf8')).entries.k).toBe('two');
  });

  it('recovers from a truncated primary via the backup, quarantines the damage and heals', () => {
    const dir = tmp();
    const m = new SaveMirror({ dir, now: () => 1700000000000 });
    m.load();
    m.put('k', 'one', 1);
    m.flush();
    m.put('k', 'two', 2);
    m.flush();
    // A torn write: the primary is cut off mid-file.
    const primary = join(dir, 'saves.json');
    writeFileSync(primary, readFileSync(primary, 'utf8').slice(0, 40));

    const r = new SaveMirror({ dir, now: () => 1700000000001 });
    const snapshot = r.load();
    expect(snapshot.source).toBe('backup');
    expect(snapshot.entries.k).toBe('one');
    expect(r.recovered).toBe('backup');
    expect(readdirSync(dir).some((n) => n.startsWith('saves.corrupt-'))).toBe(true);
    // Healed: a fresh instance reads the primary again.
    expect(new SaveMirror({ dir }).load().source).toBe('primary');
  });

  it('rejects a checksum mismatch (silent corruption) and never trusts it', () => {
    const dir = tmp();
    const m = new SaveMirror({ dir });
    m.load();
    m.put('coins', 100, 1);
    m.flush();
    m.put('coins', 200, 2);
    m.flush();
    const primary = join(dir, 'saves.json');
    writeFileSync(primary, readFileSync(primary, 'utf8').replace('200', '999'));
    const r = new SaveMirror({ dir });
    expect(r.load().entries.coins).toBe(100);
  });

  it('starts empty when nothing is readable and never throws', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'saves.json'), 'not json');
    writeFileSync(join(dir, 'saves.json.bak'), '{"format":"other"}');
    const r = new SaveMirror({ dir });
    expect(r.load()).toMatchObject({ source: 'empty', revision: 0, entries: {} });
  });

  it('coalesces bursts into one debounced write and keeps the highest revision', async () => {
    const dir = tmp();
    const m = new SaveMirror({ dir, debounceMs: 20 });
    m.load();
    for (let i = 1; i <= 25; i++) m.put('counter', i, i);
    m.put('stale', 1, 3); // a late, lower revision must not move the counter backwards
    expect(m.writes).toBe(0);
    await new Promise((r) => setTimeout(r, 80));
    expect(m.writes).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, 'saves.json'), 'utf8')).revision).toBe(25);
  });

  it('replaceAll re-seeds the file from IndexedDB contents', () => {
    const dir = tmp();
    const m = new SaveMirror({ dir });
    m.load();
    m.put('old', 1, 1);
    m.replaceAll({ settings }, 8);
    m.flush();
    const r = new SaveMirror({ dir });
    expect(r.load()).toMatchObject({ revision: 8, entries: { settings } });
    expect(r.keys()).toEqual(['settings']);
  });

  it('keeps separate files per mirror name (ghosts vs profile)', () => {
    const dir = tmp();
    const main = new SaveMirror({ dir, name: 'saves' });
    const ghosts = new SaveMirror({ dir, name: 'ghosts' });
    main.load();
    ghosts.load();
    main.put('settings', settings, 1);
    ghosts.put('ghost:v1:aurel', new Float32Array(4), 2);
    main.flush();
    ghosts.flush();
    expect(readdirSync(dir).sort()).toEqual(['ghosts.json', 'saves.json']);
  });
});

describe('privileged protocol helpers', () => {
  const root = join(tmpdir(), 'web-root');
  it('maps urls inside the root and refuses everything else', () => {
    expect(protocol.resolveRequest(root, 'motobound://app/index.html')).toBe(
      join(root, 'index.html'),
    );
    expect(protocol.resolveRequest(root, 'motobound://app/')).toBe(join(root, 'index.html'));
    expect(protocol.resolveRequest(root, 'motobound://app/assets/a%20b.js?x=1#h')).toBe(
      join(root, 'assets', 'a b.js'),
    );
    for (const bad of [
      'motobound://app/..%2f..%2fetc/passwd',
      'motobound://app/%2e%2e%2f%2e%2e%2fetc/passwd',
      'motobound://app/a\\..\\b',
      'motobound://other/index.html',
      'https://app/index.html',
      'file:///etc/passwd',
      'not a url',
      'motobound://app/%00',
    ])
      expect(protocol.resolveRequest(root, bad), bad).toBeNull();
    // The URL parser itself collapses dot segments, so these stay inside the root.
    for (const dotted of [
      'motobound://app/../secret',
      'motobound://app/%2e%2e/secret',
      'motobound://app/a/../../b.js',
    ]) {
      const resolved = protocol.resolveRequest(root, dotted);
      expect(resolved === null || resolved.startsWith(root + sep), dotted).toBe(true);
    }
  });

  it('serves the right content types for the game assets', () => {
    expect(protocol.mimeFor('x.wasm')).toBe('application/wasm');
    expect(protocol.mimeFor('x.js')).toContain('javascript');
    expect(protocol.mimeFor('a.glb')).toBe('model/gltf-binary');
    expect(protocol.mimeFor('a.ktx2')).toBe('image/ktx2');
    expect(protocol.mimeFor('A.WOFF2')).toBe('font/woff2');
    expect(protocol.mimeFor('unknown.xyz')).toBe('application/octet-stream');
  });

  it('keeps the page offline: strict CSP and a request allow-list', () => {
    const csp = protocol.contentSecurityPolicy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/https?:/);
    // Deliberate: three's KTX2 Basis transcoder (embind) uses the Function constructor in its
    // blob workers; without it each worker throws an EvalError and KTX2 textures never load.
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).not.toMatch(/script-src[^;]*https?:/);
    expect(protocol.isAllowedRequestUrl('motobound://app/assets/x.js')).toBe(true);
    expect(protocol.isAllowedRequestUrl('blob:motobound://app/uuid')).toBe(true);
    expect(protocol.isAllowedRequestUrl('data:image/png;base64,AAAA')).toBe(true);
    for (const url of [
      'https://example.com/x',
      'http://127.0.0.1:4173/',
      'ws://x/',
      'file:///etc/passwd',
      'ftp://x',
    ])
      expect(protocol.isAllowedRequestUrl(url), url).toBe(false);
  });
});

describe('ipc sender trust', () => {
  it('accepts only pages served by the app scheme', () => {
    // URL.origin is the opaque string "null" for custom schemes, so a naive origin comparison
    // rejects every legitimate call: the bridge then silently does nothing.
    expect(new URL('motobound://app/index.html').origin).toBe('null');
    expect(protocol.isTrustedSenderUrl('motobound://app/index.html')).toBe(true);
    expect(protocol.isTrustedSenderUrl('motobound://app/')).toBe(true);
    for (const url of [
      '',
      'about:blank',
      'https://app/index.html',
      'motobound://evil/index.html',
      'motobound://user:pw@app/index.html',
      'file:///index.html',
      'devtools://devtools/bundled/inspector.html',
    ])
      expect(protocol.isTrustedSenderUrl(url), url).toBe(false);
  });
});

describe('launch policy', () => {
  it('parses Steam launch options', () => {
    expect(flags.parseArgs(['app', '--borderless'])).toMatchObject({
      display: 'borderless',
      steam: true,
    });
    expect(flags.parseArgs(['app', '--windowed', '--steam=0'])).toMatchObject({
      display: 'windowed',
      steam: false,
    });
    expect(flags.parseArgs(['app'], { MOTOBOUND_STEAM: '0' }).steam).toBe(false);
    expect(flags.parseArgs(['app', '--user-data=/tmp/x']).userData).toBe('/tmp/x');
    expect(flags.parseArgs(['app']).display).toBeNull();
  });

  it('picks GPU switches per platform and enables software GL / no-sandbox only on request', () => {
    const names = (plan: string[][]) => plan.map((p) => p[0]);
    const win = flags.planSwitches({ platform: 'win32', env: {}, uid: null });
    expect(names(win)).toContain('ignore-gpu-blocklist');
    expect(win.find(([name]) => name === 'disable-features')?.[1]).toContain(
      'CalculateNativeWinOcclusion',
    );
    // An offline game must not let Chromium phone home.
    for (const flag of [
      'disable-background-networking',
      'disable-component-update',
      'disable-domain-reliability',
      'no-pings',
    ])
      expect(names(win)).toContain(flag);
    expect(names(win)).not.toContain('no-sandbox');
    expect(names(win)).not.toContain('use-angle');

    const linux = flags.planSwitches({ platform: 'linux', env: {}, uid: 1000 });
    expect(linux).toContainEqual(['ozone-platform-hint', 'auto']);
    expect(names(linux)).not.toContain('no-sandbox');
    expect(names(flags.planSwitches({ platform: 'linux', env: {}, uid: 0 }))).toContain(
      'no-sandbox',
    );
    expect(
      names(
        flags.planSwitches({ platform: 'linux', env: { MOTOBOUND_NO_SANDBOX: '1' }, uid: 1000 }),
      ),
    ).toContain('no-sandbox');
    expect(
      names(flags.planSwitches({ platform: 'linux', env: { SteamGameId: '1' }, uid: 1000 })),
    ).toContain('no-sandbox');
    expect(
      names(
        flags.planSwitches({
          platform: 'linux',
          env: { SteamGameId: '1', MOTOBOUND_SANDBOX: '1' },
          uid: 1000,
        }),
      ),
    ).not.toContain('no-sandbox');
    // Never on Windows/macOS, where Chromium's sandbox always works.
    expect(
      names(flags.planSwitches({ platform: 'win32', env: { SteamGameId: '1' }, uid: 0 })),
    ).not.toContain('no-sandbox');

    const soft = flags.planSwitches({
      platform: 'linux',
      env: { MOTOBOUND_SOFTWARE_GL: '1' },
      uid: 1000,
    });
    expect(soft).toContainEqual(['use-angle', 'swiftshader']);
    expect(soft).toContainEqual(['gpu-watchdog-timeout-seconds', '120']);
    // Real GPUs keep Chromium's watchdog unless the player raises it.
    expect(names(linux)).not.toContain('gpu-watchdog-timeout-seconds');
    expect(
      flags.planSwitches({ platform: 'win32', env: { MOTOBOUND_GPU_WATCHDOG_SECONDS: '60' } }),
    ).toContainEqual(['gpu-watchdog-timeout-seconds', '60']);
    expect(
      flags.planSwitches({ platform: 'win32', env: { MOTOBOUND_ANGLE: 'd3d11' } }),
    ).toContainEqual(['use-angle', 'd3d11']);
  });

  it('never restores a window off-screen or unusably small', () => {
    const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
    expect(windowState.sanitizeState(null, displays)).toMatchObject({
      mode: 'fullscreen',
      width: 1600,
      height: 900,
    });
    expect(
      windowState.sanitizeState(
        { x: 100, y: 80, width: 1280, height: 720, mode: 'windowed' },
        displays,
      ),
    ).toEqual({
      mode: 'windowed',
      x: 100,
      y: 80,
      width: 1280,
      height: 720,
      maximized: false,
    });
    // The second monitor was unplugged: position dropped, size kept.
    const gone = windowState.sanitizeState(
      { x: 3000, y: 100, width: 1280, height: 720, mode: 'windowed' },
      displays,
    );
    expect('x' in gone).toBe(false);
    expect(gone).toMatchObject({ width: 1280, height: 720 });
    expect(windowState.sanitizeState({ width: 10, height: 10 }, displays)).toMatchObject({
      width: 960,
      height: 540,
    });
    expect(windowState.sanitizeState({ mode: 'exclusive', width: NaN }, displays).mode).toBe(
      'fullscreen',
    );
    expect(windowState.sanitizeState('garbage', [])).toMatchObject({ mode: 'fullscreen' });
  });
});

describe('optional Steamworks', () => {
  it('is a harmless no-op when steamworks.js is not installed', () => {
    const s = steam.loadSteam({
      env: {},
      requireFn: () => {
        throw new Error("Cannot find module 'steamworks.js'");
      },
    });
    expect(s.available).toBe(false);
    expect(s.reason).toContain('not available');
    expect(s.activate('x')).toBe(false);
    expect(() => {
      s.setPresence({ steam_display: '#Status_Menu' });
      s.clearPresence();
    }).not.toThrow();
  });

  it('is a no-op when disabled, without even loading the package', () => {
    const load = () => {
      throw new Error('must not be required');
    };
    expect(steam.loadSteam({ env: { MOTOBOUND_STEAM: '0' }, requireFn: load }).available).toBe(
      false,
    );
    expect(steam.loadSteam({ env: {}, enabled: false, requireFn: load }).available).toBe(false);
  });

  it('survives a missing Steam client (init throws)', () => {
    const s = steam.loadSteam({
      env: {},
      requireFn: () => ({
        init: () => {
          throw new Error('Failed to initialize Steam\nmore text');
        },
      }),
    });
    expect(s.available).toBe(false);
    expect(s.reason).toContain('Steam client not running');
    expect(s.reason).not.toContain('\n');
  });

  it('wires achievements and rich presence when Steam is present, and contains API failures', () => {
    const calls: string[] = [];
    const sw = {
      init: (id?: number) => {
        calls.push(`init:${id ?? 'auto'}`);
        return {
          localplayer: {
            getName: () => 'Racer',
            setRichPresence: (k: string, v: string | null) => calls.push(`rp:${k}=${v}`),
          },
          achievement: {
            activate: (id: string) => {
              if (id === 'explodes') throw new Error('boom');
              calls.push(`ach:${id}`);
              return true;
            },
            isActivated: (id: string) => id === 'done',
          },
        };
      },
      electronEnableSteamOverlay: () => calls.push('overlay'),
    };
    const s = steam.loadSteam({ env: { MOTOBOUND_STEAM_APPID: '480' }, requireFn: () => sw });
    expect(s).toMatchObject({ available: true, name: 'Racer' });
    expect(calls.slice(0, 2)).toEqual(['init:480', 'overlay']);
    expect(s.activate('circuit_win')).toBe(true);
    expect(s.activate('explodes')).toBe(false);
    expect(s.isActivated('done')).toBe(true);
    s.setPresence({ steam_display: '#Status_Racing', venue: null });
    expect(calls).toContain('rp:steam_display=#Status_Racing');
    expect(calls).toContain('rp:venue=null');
    // Without an app id, Steam supplies it (launcher env or steam_appid.txt).
    calls.length = 0;
    steam.loadSteam({ env: { MOTOBOUND_STEAM_OVERLAY: '0' }, requireFn: () => sw });
    expect(calls).toEqual(['init:auto']);
  });
});
