import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { verifyWeatherGPU } from './fixtures/weather.ts';

test('actual wet simulation drives rendered spray, rain, wind and particle cleanup', async ({ page }, info) => {
  test.setTimeout(60000);
  const result = await build({ configFile: false, logLevel: 'error', build: {
    write: false, minify: false,
    lib: { entry: resolve('e2e/fixtures/weather.ts'), name: 'APEXWeatherTest', formats: ['iife'] },
  } });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Missing weather fixture bundle');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing weather fixture entry');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setContent('<!doctype html><title>Weather GPU oracle</title>');
  await page.addScriptTag({ content: chunk.code });
  const measured = await page.evaluate(() =>
    (window as unknown as { APEXWeatherTest: { verifyWeatherGPU: typeof verifyWeatherGPU } }).APEXWeatherTest.verifyWeatherGPU());
  expect(measured.speedMps).toBeGreaterThan(5);
  expect(measured.changedPixels).toBeGreaterThan(100);
  expect(measured.clearDifferences).toBe(0);
  expect(measured.diagnostics.spawned[0]).toBeGreaterThan(0);
  expect(measured.diagnostics.spawned[measured.rainKind]).toBe(480);
  expect(measured.diagnostics.velocityX[measured.rainKind]).toBeCloseTo(measured.simulationWind[0], 5);
  expect(measured.diagnostics.velocityZ[measured.rainKind]).toBeCloseTo(measured.simulationWind[1], 5);
  expect(errors).toEqual([]);
  await info.attach('measured-weather-pixels.json', { body: JSON.stringify(measured), contentType: 'application/json' });
});
