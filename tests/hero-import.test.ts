import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { build } from 'vite';

it('imports the real browser bodywork bundle without resolving URLs or starting acquisition', async () => {
  const bundled = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('src/rendering/hero-shells.ts'),
        name: 'HeroImportProbe',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundled) ? bundled[0] : bundled;
  if (!('output' in output)) throw new Error('Missing bodywork library output');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing bodywork entry');
  const fetcher = vi.fn(),
    setTimer = vi.fn(() => 1),
    clearTimer = vi.fn();
  const context = {
    document: { baseURI: 'about:blank', currentScript: null },
    URL,
    DOMException,
    AbortController,
    fetch: fetcher,
    setTimeout: setTimer,
    setInterval: setTimer,
    clearTimeout: clearTimer,
    clearInterval: clearTimer,
    HeroImportProbe: undefined as
      | undefined
      | {
          HeroShells: unknown;
          bakeHeroGeometry: unknown;
          loadHeroShells: (cancelled: () => boolean) => Promise<unknown>;
        },
  };
  runInNewContext(chunk.code, context, { timeout: 5000 });
  const api = context.HeroImportProbe;
  expect(typeof api?.HeroShells).toBe('function');
  expect(typeof api?.bakeHeroGeometry).toBe('function');
  expect(typeof api?.loadHeroShells).toBe('function');
  expect(fetcher).not.toHaveBeenCalled();
  expect(setTimer).not.toHaveBeenCalled();
  // A cancelled load must not try to resolve a URL against about:blank either.
  await expect(api!.loadHeroShells(() => true)).rejects.toThrow('Bodywork loading cancelled');
  expect(fetcher).not.toHaveBeenCalled();
  expect(clearTimer).toHaveBeenCalledTimes(2);
});

/** Regression for the real library/IIFE route used by the existing GPU probes.
 * This executes Vite's output, not a source-string assertion or mocked renderer.
 * It establishes import safety only; GPU/visual gates still execute separately. */
describe('authored bodywork import lifecycle', () => {
  it.each([false, true])(
    'imports an inline bundle before an asset origin exists (minify=%s)',
    async (minify) => {
      const result = await build({
        configFile: false,
        logLevel: 'error',
        build: {
          write: false,
          minify,
          lib: {
            entry: resolve('src/rendering/hero-shells.ts'),
            name: 'HeroImportProbe',
            formats: ['iife'],
          },
        },
      });
      const output = Array.isArray(result) ? result[0] : result;
      if (!('output' in output)) throw new Error('Missing actual Vite output');
      const entry = output.output.find((chunk) => chunk.type === 'chunk' && chunk.isEntry);
      if (!entry || entry.type !== 'chunk') throw new Error('Missing actual library entry');
      let urlConstructions = 0;
      class ObservedURL extends URL {
        constructor(input: string | URL, base?: string | URL) {
          urlConstructions++;
          super(input, base);
        }
      }
      const scope = {
        URL: ObservedURL,
        AbortController,
        document: { baseURI: 'about:blank', currentScript: null },
        location: { href: 'about:blank' },
        console,
        HeroImportProbe: undefined as undefined | Record<string, unknown>,
      };
      expect(() => runInNewContext(entry.code, scope, { timeout: 10000 })).not.toThrow();
      expect(urlConstructions).toBe(0);
      expect(typeof scope.HeroImportProbe?.HeroShells).toBe('function');
      expect(typeof scope.HeroImportProbe?.bakeHeroGeometry).toBe('function');
      expect(typeof scope.HeroImportProbe?.loadHeroShells).toBe('function');
    },
    30000,
  );
});
