import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureGpGrandstands } from './fixtures/gp-grandstand-review.ts';

test('four GP grandstands render production crowds and stable wet/held/reset materials', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/gp-grandstand-review.ts'),
        name: 'GpStandReview',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in output)) throw new Error('Missing GP stand fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing GP stand fixture chunk');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>Production GP grandstand inspection</title>');
  await page.addScriptTag({ content: chunk.code });
  const result = await page.evaluate(() =>
    (
      window as unknown as {
        GpStandReview: { captureGpGrandstands: typeof captureGpGrandstands };
      }
    ).GpStandReview.captureGpGrandstands(),
  );
  for (const capture of result.captures)
    await info.attach(`${capture.venue}-grandstand.png`, {
      contentType: 'image/png',
      body: Buffer.from(capture.image.split(',')[1], 'base64'),
    });
  await info.attach('gp-grandstand-webgl.json', {
    contentType: 'application/json',
    body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
  });
  expect(errors).toEqual([]);
  expect(result.glError).toBe(0);
  expect(result.captures).toHaveLength(4);
  for (const capture of result.captures) {
    expect(capture.architectureBatches).toBe(5);
    expect(capture.seats).toBeGreaterThan(500);
    expect(capture.crowdClusters).toBeGreaterThan(0);
    expect(capture.label).not.toMatch(/AUREL/);
    expect(capture.architecture.triangles).toBeLessThan(capture.site.length * 300 + 2000);
    expect(capture.retained).toEqual(capture.baseline.retained);
    expect(capture.baseline.render.glError).toBe(0);
    const structuralIncrease = capture.structure.triangles - capture.baseline.structure.triangles;
    expect(capture.architecture.addedTriangles).toBe(structuralIncrease);
    expect(structuralIncrease).toBeLessThan(capture.site.length * 200 + 1000);
    const [dry, held, wet, wetHeld, restored] = capture.states;
    // The measured render delta must come entirely from the new structure.
    // Existing seat and crowd geometry is held to the actual fallback builder.
    expect(dry.triangles - capture.baseline.render.triangles).toBe(structuralIncrease);
    expect(dry.hash).toBe(held.hash);
    expect(wet.hash).toBe(wetHeld.hash);
    expect(wet.hash).not.toBe(dry.hash);
    expect(restored.hash).toBe(dry.hash);
    for (const state of capture.states) {
      expect(state.glError).toBe(0);
      expect(state.coloured).toBeGreaterThan(600000);
      expect(state.calls).toBeLessThan(90);
      expect(state.triangles).toBe(dry.triangles);
      expect(state.resources).toEqual(dry.resources);
    }
    expect(capture.afterDispose.geometries).toBe(0);
    expect(capture.afterDispose.textures).toBe(0);
    expect(capture.weather.materialRoles.metal).toBe(2);
  }
});
