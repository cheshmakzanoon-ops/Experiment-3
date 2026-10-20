import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { captureMotocrossWorkedSoil } from './fixtures/motocross-worked-soil.ts';

test('MX and SX prepared traffic remains visible and reversible with resident production soil', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motocross-worked-soil.ts'),
        name: 'MotocrossWorkedSoil',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing worked-soil fixture output');
  const script = output.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing worked-soil fixture script');
  await page.route('**/motocross-worked-soil.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Production motocross worked soil</title>',
    }),
  );
  await page.goto('/motocross-worked-soil.html');
  await page.addScriptTag({ content: script.code });
  for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
    const result = await page.evaluate(
      ({ circuit, compact }) =>
        (
          window as unknown as {
            MotocrossWorkedSoil: {
              captureMotocrossWorkedSoil: typeof captureMotocrossWorkedSoil;
            };
          }
        ).MotocrossWorkedSoil.captureMotocrossWorkedSoil(circuit, { compact }),
      { circuit, compact: process.env.APEX_MX_SOIL_COMPACT === '1' },
    );
    expect(result.sourceUnchanged).toBe(true);
    expect(result.geometry.courseWidthBytes).toBe(result.geometry.vertices * 4);
    expect(result.geometry.courseWearBytes).toBe(result.geometry.vertices * 16);
    expect(result.hooks).toContain('mx-groomed-soil-v4');
    expect(result.hooks).toContain('mx-soil-morphology-v2');
    expect(result.scans.failed).toEqual([]);
    for (const { samples } of result.results) {
      for (const sample of samples) {
        expect(sample.glError).toBe(0);
        expect(sample.hash).not.toBe(0);
        expect(sample.calls).toBe(samples[0].calls);
        expect(sample.triangles).toBe(samples[0].triangles);
        expect(sample.resources).toEqual(samples[0].resources);
      }
      expect(samples[0].hash).not.toBe(samples[1].hash);
      expect(samples[1].hash).toBe(samples[2].hash);
      expect(samples[0].hash).toBe(samples[3].hash);
      expect(samples[0].hash).not.toBe(samples[4].hash);
      expect(samples[0].hash).toBe(samples[5].hash);
      for (const sample of [samples[0], samples[1], samples[4]])
        await info.attach(`${circuit}-${sample.label}.png`, {
          body: Buffer.from(sample.image.split(',')[1], 'base64'),
          contentType: 'image/png',
        });
    }
    await info.attach(`${circuit}-worked-soil.json`, {
      body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
      contentType: 'application/json',
    });
  }
  expect(errors).toEqual([]);
});
