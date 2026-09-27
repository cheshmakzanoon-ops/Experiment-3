import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { fogQuadratureGPU } from './fixtures/race-surface-atmosphere.ts';

test('vector fog quadrature preserves the scalar density model on low, high and long rays', async ({
  page,
}, info) => {
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/race-surface-atmosphere.ts'),
        name: 'FogProbe',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Missing fog probe');
  const chunk = output.output.find((c) => c.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing fog probe code');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route('**/quadrature-fixture', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fog comparison</title>' }),
  );
  await page.goto('/quadrature-fixture');
  await page.addScriptTag({ content: chunk.code });
  const report = await page.evaluate(() =>
    (
      window as unknown as { FogProbe: { fogQuadratureGPU: typeof fogQuadratureGPU } }
    ).FogProbe.fogQuadratureGPU(),
  );
  await info.attach('quadrature.json', {
    body: JSON.stringify(report, (key, value) => (key === 'image' ? undefined : value), 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(report.glError).toBe(0);
  expect(report.rows).toHaveLength(3);
  for (const row of report.rows) {
    await info.attach(`${row.mode}.png`, {
      body: Buffer.from(row.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
    expect(row.calls).toBeGreaterThan(0);
    expect(row.comparison.maxChannelDelta).toBeLessThanOrEqual(1);
    expect(row.comparison.meanChannelDelta).toBeLessThan(0.01);
    expect(row.held.maxChannelDelta).toBe(0);
    // The long-lens plane occupies a small part of the image; prove the
    // control changes real pixels rather than averaging mostly empty background.
    expect(row.negative.maxChannelDelta).toBeGreaterThan(5);
    expect(row.negative.changedChannels).toBeGreaterThan(100);
    expect(row.comparison.meanChannelDelta).toBeLessThan(row.negative.meanChannelDelta * 0.05);
  }
});
