import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type * as Fixture from './fixtures/webgl-renderer-reuse.ts';

declare global {
  interface Window {
    WebGLRendererReuseFixture: typeof Fixture;
  }
}

/** Exercise the actual production creation boundary, independently of circuit
 * assets. The legacy negative controls intentionally produce WebGL warnings. */
test('renderer context reuse clears fallback upload state and preserves 2D texture orientation', async ({
  page,
}, info) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning') warnings.push(message.text());
  });
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/webgl-renderer-reuse.ts'),
        name: 'WebGLRendererReuseFixture',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing renderer reuse fixture build');
  const chunk = output.output.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing renderer reuse fixture code');
  await page.setContent('<!doctype html><title>WebGL renderer context reuse</title>');
  await page.addScriptTag({ content: chunk.code });
  const report = await page.evaluate(() =>
    window.WebGLRendererReuseFixture.captureWebGLRendererReuse(),
  );
  await info.attach('renderer-context-reuse.json', {
    body: JSON.stringify({ report, warnings, errors }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(report).toHaveLength(4);
  for (const sample of report) {
    expect(sample.sameContext).toBe(true);
    expect(sample.recreatedAttributes).toEqual(sample.attributes);
    expect(sample.attributes?.alpha).toBe(false);
    expect(sample.initialError).toBe(0);
    const dirty = {
      flipY: sample.dirtyFlag === 'flipY',
      premultiplyAlpha: sample.dirtyFlag === 'premultiplyAlpha',
    };
    expect(sample.afterUpload).toEqual({ unpack: dirty, error: 0 });
    expect(sample.afterDisposal).toEqual(sample.afterUpload);
    expect(sample.fallbackUploads).toHaveLength(2);
    expect(sample.fallbackUploads.map((upload) => upload.target)).toEqual([
      'TEXTURE_2D_ARRAY',
      'TEXTURE_3D',
    ]);
    for (const upload of sample.fallbackUploads) {
      expect([upload.width, upload.height, upload.depth]).toEqual([1, 1, 1]);
      expect(upload.unpack).toEqual(
        sample.factory === 'legacy' ? dirty : { flipY: false, premultiplyAlpha: false },
      );
      expect(upload.error).toBe(sample.factory === 'legacy' ? 1282 : 0);
    }
    expect(sample.constructorErrorAfterPerCallDrain).toBe(0);
    if (sample.factory === 'production') {
      expect(sample.orientations).toEqual([
        {
          flipY: true,
          top: [255, 0, 0, 255],
          bottom: [0, 0, 255, 255],
          uploadedFlipY: true,
          glError: 0,
        },
        {
          flipY: false,
          top: [0, 0, 255, 255],
          bottom: [255, 0, 0, 255],
          uploadedFlipY: false,
          glError: 0,
        },
      ]);
    }
  }
});
