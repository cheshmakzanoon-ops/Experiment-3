import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { verifyMarbleGPU } from './fixtures/marbles.ts';

test('physical marble pickup drives road texture, individual tire materials and solid particles', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('e2e/fixtures/marbles.ts'), name: 'MarbleOracle', formats: ['iife'] },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing marble fixture bundle');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing marble fixture entry');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>Actual surface and tread GPU oracle</title>');
  await page.addScriptTag({ content: chunk.code });
  const measured = await page.evaluate(() =>
    (
      window as unknown as { MarbleOracle: { verifyMarbleGPU: typeof verifyMarbleGPU } }
    ).MarbleOracle.verifyMarbleGPU(),
  );
  const { tireImage, ...metrics } = measured;
  await info.attach('marble-gpu.json', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
  await info.attach('physical-tire-pickup.png', {
    body: Buffer.from(tireImage.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
  expect(measured.pickup.every((value) => value > 0)).toBe(true);
  expect(measured.contamination.every((value) => value > 0)).toBe(true);
  for (let i = 0; i < 4; i++)
    expect(measured.uniformCoverage[i]).toBeCloseTo(measured.contamination[i], 5);
  expect(measured.encodedDensity).toBe(measured.expectedDensity);
  expect(measured.roadChangedPixels).toBeGreaterThan(100);
  expect(measured.tireChangedPixels).toBeGreaterThan(30);
  expect(measured.chipChangedPixels).toBeGreaterThan(5);
  expect(measured.diagnostics.spawned[measured.marbleKind]).toBeGreaterThan(0);
  expect(measured.clearDifferences).toBe(0);
  expect(errors).toEqual([]);
});
