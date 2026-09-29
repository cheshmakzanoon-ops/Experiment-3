import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { fullSceneIndexBudget } from './fixtures/full-scene-index-budget.ts';

test('production grid index compaction preserves every held HDR channel and bounded buffers', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/full-scene-index-budget.ts'),
        name: 'IndexBudgetProbe',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in result)) throw new Error('Missing full-scene index fixture');
  const chunk = result.output.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing full-scene index code');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route('**/index-budget-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Production grid index budget</title>',
    }),
  );
  await page.goto('/index-budget-fixture');
  await page.addScriptTag({ content: chunk.code });
  const report = await page.evaluate(() =>
    (
      window as unknown as {
        IndexBudgetProbe: { fullSceneIndexBudget: typeof fullSceneIndexBudget };
      }
    ).IndexBudgetProbe.fullSceneIndexBudget(),
  );
  await info.attach('full-scene-index-budget.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(report.glError).toBe(0);
  expect(report.sourceUnchanged).toBe(true);
  expect(report.rows).toHaveLength(3);
  for (const row of report.rows) {
    expect(row.differentChannels, row.camera).toBe(0);
    expect(row.repeatDifferentChannels, row.camera).toBe(0);
    expect(row.after.calls, row.camera).toBe(row.before.calls);
    expect(row.after.triangles, row.camera).toBeLessThanOrEqual(row.before.triangles);
    expect(row.reused, row.camera).toEqual(row.buffers);
    if (row.camera !== 'trackside')
      expect(row.after.triangles, row.camera).toBeLessThan(row.before.triangles);
  }
});
