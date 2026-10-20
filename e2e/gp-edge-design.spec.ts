import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureGpEdges } from './fixtures/gp-edge-review.ts';

test('four GP venue edge schemes render through dry, wet and restored production materials', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/gp-edge-review.ts'), name: 'GpEdges', formats: ['iife'] },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in output)) throw new Error('Missing GP edge review output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing GP edge review script');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>Production GP track edge review</title>');
  await page.addScriptTag({ content: chunk.code });
  const reports = [];
  for (const id of ['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const) {
    const report = await page.evaluate(
      (id) =>
        (
          window as unknown as { GpEdges: { captureGpEdges: typeof captureGpEdges } }
        ).GpEdges.captureGpEdges(id),
      id,
    );
    reports.push(report);
    for (const capture of report.captures) {
      if (capture.image && !capture.wet)
        await info.attach(`${id}-${capture.wet ? 'wet' : 'dry'}.png`, {
          body: Buffer.from(capture.image.split(',')[1], 'base64'),
          contentType: 'image/png',
        });
      expect(capture.error).toBe(0);
      expect(capture.calls).toBeGreaterThan(4);
      expect(capture.calls).toBeLessThan(70);
      expect(capture.triangles).toBeLessThan(110000);
      expect(capture.resources).toEqual(report.captures[0].resources);
    }
    const [dry, held, wet, restored] = report.captures;
    expect(held.hash).toBe(dry.hash);
    expect(wet.hash).not.toBe(dry.hash);
    expect(restored.hash).toBe(dry.hash);
  }
  await info.attach('gp-edge-material-receipt.json', {
    body: JSON.stringify(reports, (key, value) => (key === 'image' ? undefined : value), 2),
    contentType: 'application/json',
  });
  expect(new Set(reports.map((r) => r.design)).size).toBe(4);
  expect(errors).toEqual([]);
});
