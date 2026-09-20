import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureAeroSurfaces } from './fixtures/aero-surface.ts';

test('original aero surfaces: production car studio review', async ({ page }, info) => {
  const bundled = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/aero-surface.ts'), name: 'AeroProbe', formats: ['iife'] },
    },
  });
  const output = Array.isArray(bundled) ? bundled[0] : bundled;
  if (!('output' in output)) throw new Error('Missing aero fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing aero fixture script');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent('<!doctype html><title>Original aero surface review</title>');
  await page.addScriptTag({ content: chunk.code });
  const result = await page.evaluate(() =>
    (
      window as unknown as { AeroProbe: { captureAeroSurfaces: typeof captureAeroSurfaces } }
    ).AeroProbe.captureAeroSurfaces(),
  );
  for (const capture of result.captures) {
    await info.attach(`${capture.view}.png`, {
      body: Buffer.from(capture.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  }
  await info.attach('aero-surface-metrics.json', {
    body: JSON.stringify(
      { ...result, errors, captures: result.captures.map(({ image: _image, ...stats }) => stats) },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(result.sourceUnchanged).toBe(true);
  expect(result.glError).toBe(0);
  expect(result.captures.map((capture) => capture.view)).toEqual([
    'front-three-quarter',
    'front-wing',
    'rear-three-quarter',
    'rear-wing',
  ]);
  for (const capture of result.captures) {
    expect(capture.draws, capture.view).toBeGreaterThan(20);
    expect(capture.triangles, capture.view).toBeGreaterThan(10000);
    expect(capture.image.length, capture.view).toBeGreaterThan(50000);
  }
  // Attachments support visual review; this does not certify aesthetic parity.
  expect(await page.locator('canvas').count()).toBe(0);
});
