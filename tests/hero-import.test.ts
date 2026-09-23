import { describe, expect, it } from 'vitest';
import { build } from 'vite';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

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
