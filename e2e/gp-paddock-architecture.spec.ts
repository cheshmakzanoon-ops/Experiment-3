import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type {
  captureGpPaddocks,
  captureGpPennants,
  captureGpPavilion,
} from './fixtures/gp-paddock-review.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

let fixtureScript: string;
test.beforeAll(async () => {
  const built = await build({
    configFile: false,
    define: fixtureDefine(),
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
  fixtureScript = script.code;
});

async function loadReview(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>GP pit architecture review</title>');
  await page.addScriptTag({ content: fixtureScript });
  return errors;
}

test('four GP pit complexes render with the existing garages, stable weather restoration and resource release', async ({
  page,
}, info) => {
  const errors = await loadReview(page);
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
  const wind = await page.evaluate(() =>
    (
      window as unknown as {
        GpPaddockReview: { captureGpPennants: typeof captureGpPennants };
      }
    ).GpPaddockReview.captureGpPennants(),
  );
  for (const sample of wind) {
    expect(sample.error).toBe(0);
    expect(sample.count).toBeGreaterThan(75);
  }
  expect(wind[1].x - wind[4].x).toBeGreaterThan(70);
  expect(wind[1].y).toBeGreaterThan(wind[0].y + 15);
  expect(wind[1].hash).toBe(wind[2].hash);
  expect(wind[1].hash).toBe(wind[5].hash);
  expect(wind[1].hash).not.toBe(wind[3].hash);
  expect(errors).toEqual([]);
  await info.attach('gp-paddock-render-receipt.json', {
    body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
    contentType: 'application/json',
  });
});

test('Montejaral pavilion emits from its two spectator galleries and keeps its roof dark at night', async ({
  page,
}, info) => {
  const errors = await loadReview(page);
  const { image, ...metrics } = await page.evaluate(() =>
    (
      window as unknown as {
        GpPaddockReview: { captureGpPavilion: typeof captureGpPavilion };
      }
    ).GpPaddockReview.captureGpPavilion(),
  );
  expect(errors).toEqual([]);
  expect(metrics.glError).toBe(0);
  expect(metrics.draws).toBe(1);
  expect(metrics.litPixels).toBeGreaterThan(1800);
  expect(metrics.litPixels / metrics.shellPixels).toBeLessThan(0.28);
  expect(metrics.outsideGallery).toBe(0);
  expect(metrics.restoredPixels).toBe(0);
  await info.attach('gp-pavilion-lit-galleries.png', {
    body: Buffer.from(image.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
  await info.attach('gp-pavilion-light-meter.json', {
    body: JSON.stringify(metrics),
    contentType: 'application/json',
  });
});
