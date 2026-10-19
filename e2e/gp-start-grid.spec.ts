import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureGpStartGrid } from './fixtures/gp-start-grid.ts';

test('GP start paint and single-contact launch paths retain dry/wet replay and bounded resources', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/gp-start-grid.ts'), name: 'GpGrid', formats: ['iife'] },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in output)) throw new Error('Missing GP grid fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing GP grid fixture chunk');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>Production GP start-grid inspection</title>');
  await page.addScriptTag({ content: chunk.code });
  const result = await page.evaluate(() =>
    (
      window as unknown as {
        GpGrid: { captureGpStartGrid: typeof captureGpStartGrid };
      }
    ).GpGrid.captureGpStartGrid(),
  );
  for (const capture of result.captures)
    await info.attach(`${capture.name}.png`, {
      body: Buffer.from(capture.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('gp-grid-metrics.json', {
    body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
    contentType: 'application/json',
  });
  const capture = (name: string) => result.captures.find((entry) => entry.name === name)!;
  expect(errors).toEqual([]);
  expect(result.glError).toBe(0);
  expect(result.grid.cachedLayers).toBe(2);
  expect(capture('gp-grid').hash).not.toBe(capture('original-grid').hash);
  expect(capture('gp-grid').hash).not.toBe(capture('gp-paint-old-launch-control').hash);
  expect(capture('gp-grid').hash).toBe(capture('gp-grid-held').hash);
  expect(capture('gp-grid').hash).toBe(capture('gp-grid-restored').hash);
  expect(capture('gp-grid-wet').hash).not.toBe(capture('gp-grid').hash);
  expect(capture('gp-grid-wet').hash).toBe(capture('gp-grid-wet-held').hash);
  expect(capture('original-grid').hash).toBe(capture('original-grid-restored').hash);
  for (const entry of result.captures) {
    expect(entry.calls).toBeLessThanOrEqual(6);
    expect(entry.triangles).toBeLessThan(3000);
    expect(entry.resources).toEqual(capture('gp-grid').resources);
  }
  expect(capture('gp-grid').triangles).toBeLessThan(capture('original-grid').triangles);
});
