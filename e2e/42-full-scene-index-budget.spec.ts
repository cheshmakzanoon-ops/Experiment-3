import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { fullSceneIndexBudget } from './fixtures/full-scene-index-budget.ts';
import { OWNER_BUILD, fixtureDefine } from './fixtures/owner-build.ts';

/** The authored player car measures 228,936 triangles in 94 draws over 143 index buffers of
 * 1,752,816 bytes in total (A61 census, tests/a61-rival.test.ts; the same figures from
 * FormulaCar(0) in node). The budgets keep ~14 % headroom on the bytes and the draws, and the
 * suite's existing 250,000-triangle near ceiling on the triangles. */
const INDEX_BYTES_BUDGET = 2_000_000;
const DRAW_BUDGET = 110;

/**
 * G15: the player's car is the original authored APX-01 in a product build, so this spec
 * measures THAT car in the real eight-car main pass: held frames repeat exactly, the player's
 * triangles stay inside the A61 near budget (tests/a61-rival.test.ts: below 250,000) and its
 * index buffers are bounded and valid. The owner-supplied model's index compaction (before /
 * after pixel identity, fewer triangles, buffers reused) is the extra owner-only half and
 * runs only when the build under test is an owner build (MOTOBOUND_SUPPLIED_PLAYER=1).
 * The point-light work check covers the whole scene and runs in both.
 */
test('production grid index compaction preserves every held HDR channel and bounded buffers', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    define: fixtureDefine(),
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
  expect(report.lightingMaterials).toBeGreaterThan(100);
  expect(report.lightingRows).toHaveLength(3);
  for (const row of report.lightingRows) {
    expect(row.differentChannels, row.lighting).toBe(0);
    expect(row.after.calls, row.lighting).toBe(row.before.calls);
    expect(row.after.triangles, row.lighting).toBe(row.before.triangles);
    expect(row.intensities).toHaveLength(4);
    if (row.lighting === 'day') expect(row.intensities.every((value) => value === 0)).toBe(true);
    if (row.lighting === 'night') expect(row.intensities.some((value) => value > 0)).toBe(true);
  }
  expect(report.playerKind).toBe(OWNER_BUILD ? 'supplied' : 'authored');
  expect(report.playerRows).toHaveLength(3);
  for (const row of report.playerRows) {
    // The held frame is deterministic: the same submissions and the same HDR channels.
    expect(row.sameCallsAndTriangles, row.camera).toBe(true);
    expect(row.heldDifferentChannels, row.camera).toBe(0);
    // The player's car is drawn, inside the scene's own totals, with valid index buffers.
    expect(row.player.draws, row.camera).toBeGreaterThan(0);
    expect(row.player.triangles, row.camera).toBeGreaterThan(0);
    expect(row.player.triangles, row.camera).toBeLessThanOrEqual(row.scene.triangles);
    expect(row.player.outOfRange, row.camera).toBe(0);
    if (report.playerKind === 'authored') {
      expect(row.player.triangles, row.camera).toBeLessThan(250000);
      expect(row.player.draws, row.camera).toBeLessThanOrEqual(DRAW_BUDGET);
      expect(row.player.indexBuffers, row.camera).toBeGreaterThan(0);
      expect(row.player.indexBytes, row.camera).toBeLessThan(INDEX_BYTES_BUDGET);
    }
  }
  if (!OWNER_BUILD) expect(report.rows).toEqual([]);
  else {
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
  }
});
