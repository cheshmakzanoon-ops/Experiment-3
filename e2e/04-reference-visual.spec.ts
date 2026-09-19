import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureReferenceViews } from './fixtures/reference-visual.ts';

for (const weather of ['clear', 'rain'] as const) {
  test(`reference review: production high-quality ${weather} car and cockpit`, async ({ page }, info) => {
    test.setTimeout(300000); // Explicit software-rendered high preset; not an FPS acceptance gate.
    const bundled = await build({
      configFile: false, logLevel: 'error',
      build: {
        write: false,
        lib: { entry: resolve('e2e/fixtures/reference-visual.ts'), name: 'ReferenceProbe', formats: ['iife'] },
      },
    });
    const output = Array.isArray(bundled) ? bundled[0] : bundled;
    if (!('output' in output)) throw new Error('Missing reference fixture output');
    const chunk = output.output.find((entry) => entry.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing reference fixture script');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setContent('<!doctype html><title>Original renderer reference review</title>');
    await page.addScriptTag({ content: chunk.code });
    const result = await page.evaluate((weather) =>
      (window as unknown as { ReferenceProbe: { captureReferenceViews: typeof captureReferenceViews } })
        .ReferenceProbe.captureReferenceViews(weather), weather);
    for (const capture of result.captures) {
      await info.attach(`${weather}-${capture.view}.png`, {
        body: Buffer.from(capture.image.split(',')[1], 'base64'), contentType: 'image/png',
      });
    }
    await info.attach('reference-review-metrics.json', {
      body: JSON.stringify({ ...result, captures: result.captures.map(({ image: _image, ...stats }) => stats) }, null, 2),
      contentType: 'application/json',
    });
    expect(result.sourceUnchanged).toBe(true);
    expect(result.finite).toBe(true);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.captures).toHaveLength(2);
    for (const capture of result.captures) {
      expect(capture.draws).toBeGreaterThan(10);
      expect(capture.triangles).toBeGreaterThan(10000);
      expect(capture.image.length).toBeGreaterThan(50000);
    }
    expect(errors).toEqual([]);
  });
}
