import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureBike } from './fixtures/motogp-reference-review.ts';

let fixtureScript: string;
test.beforeAll(async () => {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motogp-reference-review.ts'),
        name: 'MotoGPReview',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in output)) throw new Error('Missing GP crown fixture bundle');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing GP crown fixture script');
  fixtureScript = chunk.code;
});

// Additional focused visual receipts. The original 41-motogp-reference sequence
// remains an independent gate. Reuse its production camera, materials, three
// preparation draws, resource checks and budgets; retain one image per GP bike.
// Crown-face occlusion is covered separately by gp-fork-crown.test.ts.
for (const id of ['gpr1', 'gpr2']) {
  test(`${id} fork crowns render from the production onboard eye with a clear instrument display`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setContent('<!doctype html><title>GP production onboard fork-crown review</title>');
    await page.addScriptTag({ content: fixtureScript });
    const result = await page.evaluate(
      (id) =>
        (
          window as unknown as {
            MotoGPReview: { captureBike: typeof captureBike };
          }
        ).MotoGPReview.captureBike('onboard', 'high', id, false),
      id,
    );
    // Attach before assertions so a failed contract still retains its pixels.
    await info.attach(`${id}-fork-crown-production-onboard.png`, {
      body: Buffer.from(result.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
    await info.attach(`${id}-fork-crown-onboard-receipt.json`, {
      body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
      contentType: 'application/json',
    });
    expect(result.preparation).toHaveLength(3);
    for (const sample of result.preparation) {
      expect(sample.wet).toBe(false);
      expect(sample.time).toBe(2);
      expect(sample.sourceFrameUnchanged).toBe(true);
    }
    expect(result.preparation[2].resources).toEqual(result.preparation[1].resources);
    expect(result.preparation[2].addedPrograms).toEqual([]);
    expect(result.resources).toEqual(result.preparation[2].resources);
    expect(result.sourceFrameUnchanged).toBe(true);
    expect(result.glError).toBe(0);
    expect(result.hash).not.toBe(0);
    expect(result.calls).toBeLessThan(220);
    expect(result.triangles).toBeLessThan(110000);
    expect(result.weather.dampness).toBe(0);
    expect(result.windscreen.mode).toBe('production');
    expect(result.cockpit?.facing).toBeGreaterThan(0.7);
    expect(result.cockpit?.visibleSamples).toBe(9);
    for (const [x, y, z] of result.cockpit!.corners) {
      expect(Math.abs(x)).toBeLessThan(0.95);
      expect(Math.abs(y)).toBeLessThan(0.95);
      expect(z).toBeGreaterThan(-1);
      expect(z).toBeLessThan(1);
    }
    expect(errors).toEqual([]);
  });
}
