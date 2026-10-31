import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { suppliedIndexPreupload } from './fixtures/supplied-index-preupload.ts';

test('preparing exact supplied index streams preserves real draw pixels, order and allocation counts', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/supplied-index-preupload.ts'),
        name: 'IndexPreuploadProbe',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in result)) throw new Error('Missing index preupload fixture');
  const chunk = result.output.find((output) => output.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing index preupload code');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/index-preupload-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Exact supplied index preupload</title>',
    }),
  );
  await page.goto('/index-preupload-fixture');
  await page.addScriptTag({ content: chunk.code });
  const report = await page.evaluate(() =>
    (
      window as unknown as {
        IndexPreuploadProbe: { suppliedIndexPreupload: typeof suppliedIndexPreupload };
      }
    ).IndexPreuploadProbe.suppliedIndexPreupload(),
  );
  for (const row of report.rows) {
    for (const [label, image] of [
      ['baseline', row.baseline.image],
      ['prepared', row.image],
    ])
      await info.attach(`index-preupload-${row.name}-${label}.png`, {
        body: Buffer.from(image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
  }
  await info.attach('supplied-index-preupload.json', {
    body: JSON.stringify(report, (key, value) => (key === 'image' ? undefined : value), 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(report.glError).toBe(0);
  expect(report.rows.map((row) => row.name)).toEqual(['near', 'far', 'rear']);
  expect(report.preparedRetained).toEqual(report.baselineRetained);
  expect(report.preparedRetained.buffers).toBe(3);
  expect(report.preparedRetained.uploads).toBe(3);
  expect(report.baselineDisposedBuffers).toBe(0);
  expect(report.preparedDisposedBuffers).toBe(0);
  for (const row of report.rows) {
    expect(row.prepared, row.name).toBe(true);
    expect(row.prepassUnchanged, row.name).toBe(true);
    expect(row.afterDrawUnchanged, row.name).toBe(true);
    expect(row.baseline.afterDrawUnchanged, row.name).toBe(true);
    expect(row.error, row.name).toBe(0);
    expect(row.baseline.error, row.name).toBe(0);
    expect(row.selected, row.name).toEqual(row.expected);
    expect(row.selected, row.name).toEqual(row.baseline.selected);
    expect(row.differentChannels, row.name).toBe(0);
    expect(row.visibleChannels, row.name).toBeGreaterThan(100);
    expect(row.calls, row.name).toBe(row.baseline.calls);
    expect(row.triangles, row.name).toBe(row.baseline.triangles);
    expect(row.afterDraw, row.name).toEqual(row.afterPreparation);
    expect(row.afterDraw, row.name).toEqual(row.baseline.afterDraw);
    expect(row.afterPreparation.buffers - row.before.buffers, row.name).toBe(1);
    expect(row.afterPreparation.uploads - row.before.uploads, row.name).toBe(1);
  }
});
