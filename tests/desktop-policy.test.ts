import { describe, it, expect } from 'vitest';
import { resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  GAME_CSP,
  GAME_URL,
  gameAssetPath,
  isGameURL,
  isGameNavigation,
} from '../desktop/policy.ts';
const root = resolve('desktop-stage/dist');
describe('offline desktop renderer boundary', () => {
  it('serves only the bundled game origin and preserves ordinary asset URLs', () => {
    expect(GAME_URL).toBe('motobound://game/babylon.html');
    expect(gameAssetPath(root, GAME_URL)).toBe(join(root, 'babylon.html'));
    expect(gameAssetPath(root, 'motobound://game/')).toBe(join(root, 'index.html'));
    expect(gameAssetPath(root, 'motobound://game/models/supplied-player.glb.gz?v=123')).toBe(
      join(root, 'models/supplied-player.glb.gz'),
    );
  });
  it('rejects foreign origins, credentials, traversal, malformed encoding and sourcemaps', () => {
    for (const u of [
      'https://example.com/index.html',
      'file:///etc/passwd',
      'motobound://other/index.html',
      'motobound://user:secret@game/index.html',
      'motobound://game:80/index.html',
      'motobound://game/%2e%2e%2fsecret',
      'motobound://game/%5csecret',
      'motobound://game/a%00b',
      'motobound://game/%ZZ',
      'motobound://game/assets/app.js.map',
    ])
      expect(gameAssetPath(root, u), u).toBeNull();
    expect(isGameURL('not a url')).toBe(false);
  });
  it('limits top-level navigation and disallows remote scripts, frames and Node access', () => {
    expect(isGameNavigation(GAME_URL)).toBe(true);
    expect(isGameNavigation('motobound://game/index.html')).toBe(true);
    expect(isGameNavigation('motobound://game/assets/game.js')).toBe(false);
    expect(GAME_CSP).toContain("default-src 'self'");
    expect(GAME_CSP).toContain("object-src 'none'");
    expect(GAME_CSP).not.toContain("'unsafe-eval'");
    const main = readFileSync('desktop/main.ts', 'utf8');
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/sandbox:\s*true/);
    expect(main).toMatch(/webSecurity:\s*true/);
    expect(main).toContain('app.enableSandbox()');
    expect(main).not.toContain('disableHardwareAcceleration');
    expect(main).not.toContain('no-sandbox');
    expect(main).not.toContain('shell.openExternal');
  });
});
