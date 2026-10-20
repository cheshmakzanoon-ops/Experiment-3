import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureGpPaddocks } from './fixtures/gp-paddock-review.ts';

test('four GP pit complexes render with the existing garages, stable weather restoration and resource release', async ({
  page,
}, info) => {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/gp-paddock-review.ts'),
        name: 'GpPaddockReview',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing GP paddock fixture');
  const script = output.output.find((entry) => entry.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing GP paddock script');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>GP pit architecture review</title>');
  await page.addScriptTag({ content: script.code });
  const result = await page.evaluate(() =>
    (
      window as unknown as { GpPaddockReview: { captureGpPaddocks: typeof captureGpPaddocks } }
    ).GpPaddockReview.captureGpPaddocks(),
  );
  for (const [index, capture] of result.captures.entries()) {
    await info.attach(
      `${index}-${capture.venue}-${capture.view}-${capture.wet ? 'wet' : 'dry'}.png`,
      {
        body: Buffer.from(capture.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      },
    );
    expect(capture.error).toBe(0);
    expect(capture.calls).toBeLessThan(65);
    expect(capture.triangles).toBeLessThan(100000);
  }
  const haarveld = result.captures.filter(
    (capture) => capture.venue === 'haarveld' && capture.view === 'pit',
  );
  expect(haarveld).toHaveLength(4);
  expect(haarveld[0].hash).toBe(haarveld[1].hash);
  expect(haarveld[0].hash).toBe(haarveld[3].hash);
  expect(haarveld[0].hash).not.toBe(haarveld[2].hash);
  expect(new Set(result.releases.map((entry) => entry.geometries)).size).toBe(1);
  expect(new Set(result.releases.map((entry) => entry.textures)).size).toBe(1);
  for (const entry of result.releases) expect(entry.geometries).toBe(0);
  expect(errors).toEqual([]);
  await info.attach('gp-paddock-render-receipt.json', {
    body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
    contentType: 'application/json',
  });
});
