import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { captureMotocrossTerrainContinuity } from './fixtures/motocross-terrain-continuity.ts';

test('MX and SX display continuous lit receiver normals across worn chunk edges', async ({
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
        entry: resolve('e2e/fixtures/motocross-terrain-continuity.ts'),
        name: 'MotocrossTerrainContinuity',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing terrain continuity fixture');
  const script = output.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing terrain continuity script');
  await page.route('**/motocross-terrain-continuity.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Motocross terrain continuity</title>',
    }),
  );
  await page.goto('/motocross-terrain-continuity.html');
  await page.addScriptTag({ content: script.code });
  for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
    const result = await page.evaluate(
      (circuit) =>
        (
          window as unknown as {
            MotocrossTerrainContinuity: {
              captureMotocrossTerrainContinuity: typeof captureMotocrossTerrainContinuity;
            };
          }
        ).MotocrossTerrainContinuity.captureMotocrossTerrainContinuity(circuit),
      circuit,
    );
    // Preserve the compared frames and GPU/resource diagnostics even if a
    // renderer-specific failure trips one of the assertions below.
    const [continuous, independent, restored] = result.samples;
    await info.attach(`${circuit}-terrain-continuity.json`, {
      body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
      contentType: 'application/json',
    });
    for (const sample of [continuous, independent])
      await info.attach(`${circuit}-${sample.label}.png`, {
        body: Buffer.from(sample.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    expect(result.sourceUnchanged).toBe(true);
    expect(result.continuousError).toBe(0);
    expect(result.independentError).toBeGreaterThan(0.001);
    expect(result.scans.failed).toEqual([]);
    expect(continuous.hash).not.toBe(independent.hash);
    expect(continuous.hash).toBe(restored.hash);
    for (const sample of result.samples) {
      expect(sample.glError).toBe(0);
      expect(sample.calls).toBe(continuous.calls);
      expect(sample.triangles).toBe(continuous.triangles);
      expect(sample.resources).toEqual(continuous.resources);
    }
  }
  expect(errors).toEqual([]);
});
