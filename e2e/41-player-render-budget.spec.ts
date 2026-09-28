import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { playerRenderBudget } from './fixtures/player-render-budget.ts';

test('supplied player: actual surface-pass pixels and bounded restorable imported texture budgets', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/player-render-budget.ts'),
        name: 'PlayerBudgetProbe',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in result)) throw new Error('Missing player budget fixture');
  const chunk = result.output.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing player budget code');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route('**/player-budget-fixture', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Supplied player render budget</title>',
    }),
  );
  await page.goto('/player-budget-fixture');
  await page.addScriptTag({ content: chunk.code });
  const report = await page.evaluate(() =>
    (
      window as unknown as { PlayerBudgetProbe: { playerRenderBudget: typeof playerRenderBudget } }
    ).PlayerBudgetProbe.playerRenderBudget(),
  );
  for (const row of report.rows) {
    for (const key of ['original', 'singlePass', 'sorted', 'coverage', 'shaderWork', 'low', 'restored'] as const)
      await info.attach(`${row.view}-${key}.png`, {
        body: Buffer.from(row[key].image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
  }
  await info.attach('player-render-budget.json', {
    body: JSON.stringify(report, (k, v) => (k === 'image' ? undefined : v), 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(report.glError).toBe(0);
  expect(report.sourceUnchanged).toBe(true);
  expect(report.maps).toBeGreaterThan(40);
  expect(report.shaderWorkMaterials).toBeGreaterThan(20);
  expect(report.decalMaterials).toBeGreaterThan(20);
  expect(report.coverageMaterials).toBe(report.decalMaterials);
  expect(report.mapsRestored).toBe(true);
  expect(report.sourcesRestored).toBe(true);
  expect(report.displayUnchanged).toBe(true);
  expect(report.reused).toEqual(report.warmed);
  expect(report.rows).toHaveLength(3);
  for (const row of report.rows) {
    expect(row.decalDelta.mean, row.view).toBeLessThan(0.5);
    expect(row.opaqueDelta.mean, row.view).toBeLessThan(0.05);
    expect(row.coverageDelta.mean, row.view).toBeLessThan(0.05);
    expect(row.coverage.calls, row.view).toBe(row.sorted.calls);
    expect(row.coverage.triangles, row.view).toBe(row.sorted.triangles);
    expect(row.restoredDelta.max, row.view).toBe(0);
    expect(row.shaderWorkDelta.max, row.view).toBe(0);
    expect(row.shaderWork.calls, row.view).toBe(row.coverage.calls);
    expect(row.shaderWork.triangles, row.view).toBe(row.coverage.triangles);
    expect(row.original.calls).toBeGreaterThanOrEqual(row.singlePass.calls);
    expect(row.original.triangles).toBeGreaterThanOrEqual(row.singlePass.triangles);
    if (row.view !== 'cockpit') {
      expect(row.original.calls).toBeGreaterThan(row.singlePass.calls);
      expect(row.original.triangles).toBeGreaterThan(row.singlePass.triangles);
    }
    expect(row.sorted.calls).toBe(row.singlePass.calls);
    expect(row.sorted.triangles).toBe(row.singlePass.triangles);
    expect(row.lowMaps.every((m) => Math.max(m.width, m.height) <= 256 && m.anisotropy === 2)).toBe(
      true,
    );
    expect(row.original.image.length).toBeGreaterThan(10000);
  }
});
