import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { captureMotocrossShoulderPlants } from './fixtures/motocross-shoulder-plants.ts';

test('production MX shoulder plants compile and reproduce held and rewound wind pixels', async ({
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
        entry: resolve('e2e/fixtures/motocross-shoulder-plants.ts'),
        name: 'MotocrossShoulderPlants',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing shoulder-plants fixture output');
  const script = output.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing shoulder-plants fixture script');
  await page.route('**/motocross-shoulder-plants.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Production motocross shoulder plants — component review</title>',
    }),
  );
  await page.goto('/motocross-shoulder-plants.html');
  await page.addScriptTag({ content: script.code });
  const result = await page.evaluate(() =>
    (
      window as unknown as {
        MotocrossShoulderPlants: {
          captureMotocrossShoulderPlants: typeof captureMotocrossShoulderPlants;
        };
      }
    ).MotocrossShoulderPlants.captureMotocrossShoulderPlants(),
  );
  // Preserve the two original review frames and all measurements before any
  // assertion, so a shader or replay failure stays visually diagnosable.
  for (const sample of result.samples.slice(0, 2))
    await info.attach(`shoulder-${sample.label}.png`, {
      body: Buffer.from(sample.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('shoulder-plants.json', {
    body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(result.sourceUnchanged).toBe(true);
  expect(result.sharedPlantMaterial).toBe(true);
  expect(result.plantTextures).toBe(false);
  expect(result.windHooks).toContain('mx-shoulder-wind-v1');
  expect(result.soilHooks).toContain('mx-groomed-soil-v3');
  expect(result.scans.failed).toEqual([]);
  expect(result.scans.resident).toContain('dryEarth');
  expect(result.foliage).toHaveLength(3);
  for (const plant of result.foliage) {
    expect(plant.instances).toBeGreaterThan(0);
    expect(plant.rootsInView, plant.name).toBeGreaterThan(0);
  }
  expect(result.foliage.reduce((sum, p) => sum + p.triangles, 0)).toBeLessThan(90000);
  expect(result.foliage.reduce((sum, p) => sum + p.attributeBytes, 0)).toBeLessThan(32000);
  expect(result.foliage.reduce((sum, p) => sum + p.instanceBytes, 0)).toBeLessThan(160000);
  const samples = result.samples;
  for (const sample of samples) {
    expect(sample.glError, sample.label).toBe(0);
    expect(sample.hash).not.toBe(0);
    expect(sample.calls).toBeLessThan(300);
    expect(sample.resources.geometries).toBeLessThan(300);
    expect(sample.resources.textures).toBeLessThan(100);
    expect(sample.resources.programs).toBeLessThan(50);
    expect(sample.calls).toBe(samples[0].calls);
    expect(sample.triangles).toBe(samples[0].triangles);
    expect(sample.resources).toEqual(samples[0].resources);
  }
  expect(samples[0].hash).not.toBe(samples[1].hash);
  expect(samples[1].hash).toBe(samples[2].hash);
  expect(samples[0].hash).toBe(samples[3].hash);
});
