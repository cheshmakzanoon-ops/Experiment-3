import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/wet-lighting-closure.ts';

test('lit spray follows scene lights, projected wake, pause, clear and near-plane contracts', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const built = await build({ configFile: false, logLevel: 'error', build: { write: false,
    lib: { entry: resolve('e2e/fixtures/wet-lighting-closure.ts'), name: 'WetClosure', formats: ['iife'] } } });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing wet closure fixture');
  const chunk = output.output.find((part) => part.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing wet closure script');
  await page.setContent('<!doctype html><title>Lit wheel-water spray contract</title>');
  await page.addScriptTag({ content: chunk.code });
  const result = await page.evaluate(() =>
    (window as unknown as { WetClosure: typeof Fixture }).WetClosure.captureWetLightingClosure());
  for (const shot of result.captures)
    await info.attach(`${shot.view}.png`, { body: Buffer.from(shot.image.split(',')[1], 'base64'), contentType: 'image/png' });
  await info.attach('lit-spray-metrics.json', { body: JSON.stringify({ ...result, errors,
    captures: result.captures.map(({ image: _image, ...metrics }) => metrics) }, null, 2), contentType: 'application/json' });
  const shot = (name: string) => result.captures.find((s) => s.view === name)!;
  expect(errors).toEqual([]); expect(result.glError).toBe(0);
  expect(shot('day-horizontal-wake').width).toBeGreaterThan(shot('day-horizontal-wake').height * 1.3);
  expect(shot('day-vertical-wake').height).toBeGreaterThan(shot('day-vertical-wake').width * 1.3);
  expect(shot('day-horizontal-wake').pixels).toBeGreaterThan(100);
  expect(shot('under-floodlight').energy).toBeGreaterThan(1000);
  for (const name of ['unlit', 'non-spray-excluded', 'near-plane', 'cleared', 'fogged', 'occluded'])
    expect(shot(name).pixels, name).toBe(0);
  expect(result.pauseExact).toBe(true); expect(result.restoreExact).toBe(true);
  expect(result.after).toEqual(result.before);
  expect(result.captures.every((s) => s.draws === (s.view === 'occluded' ? 2 : 1))).toBe(true);
  expect(await page.locator('canvas').count()).toBe(0);
});
