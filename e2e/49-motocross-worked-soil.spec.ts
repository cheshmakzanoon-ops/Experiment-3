import { expect, test as base } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { captureMotocrossWorkedSoil } from './fixtures/motocross-worked-soil.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

type SoilCapture = typeof captureMotocrossWorkedSoil;
let bundle: Promise<string> | undefined;

async function compileSoilReview() {
  const built = await build({
    configFile: false,
    define: fixtureDefine(),
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
  return script.code;
}

const test = base.extend<{ capture: SoilCapture }>({
  capture: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    bundle ??= compileSoilReview();
    await page.route('**/motocross-worked-soil.html', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Production motocross worked soil</title>',
      }),
    );
    await page.goto('/motocross-worked-soil.html');
    await page.addScriptTag({ content: await bundle });
    const capture: SoilCapture = (circuit, options) =>
      page.evaluate(
        ({ circuit, options }) =>
          (window as unknown as {
            MotocrossWorkedSoil: { captureMotocrossWorkedSoil: SoilCapture };
          }).MotocrossWorkedSoil.captureMotocrossWorkedSoil(circuit, options),
        { circuit, options },
      );
    await use(capture);
    expect(errors).toEqual([]);
  },
});

test('MX and SX prepared traffic remains visible and reversible with resident production soil', async ({
  capture,
}, info) => {
  for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
    const result = await capture(circuit, { compact: process.env.APEX_MX_SOIL_COMPACT === '1' });
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
});

test('skipping zero soil contributions matches the exhaustive shader on both courses', async ({
  capture,
}, info) => {
  for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
    const result = await capture(circuit, { compact: true, compareEvaluation: true });
    expect(result.sourceUnchanged).toBe(true);
    expect(result.scans.failed).toEqual([]);
    expect(result.comparisons.map((shot) => shot.angle)).toEqual(['approach', 'berm', 'jump']);
    for (const shot of result.comparisons) {
      expect([shot.width, shot.height]).toEqual([640, 400]);
      expect(shot.variedPixels).toBeGreaterThan(1000);
      expect(shot.optimized.error).toBe(0);
      expect(shot.exhaustive).toEqual(shot.optimized);
      expect(shot.optimized.triangles).toBeGreaterThan(0);
      expect(shot.changedPixels, circuit + ' ' + shot.angle).toBe(0);
    }
    console.info('MX_SOIL_EVALUATION', circuit, JSON.stringify(result.comparisons));
    await info.attach(circuit + '-soil-evaluation.json', {
      body: JSON.stringify(result.comparisons, null, 2),
      contentType: 'application/json',
    });
  }
});
