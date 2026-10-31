import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { babylonPlayerLods } from './fixtures/babylon-player-lods.ts';

test('original Babylon index tiers preserve GPU indices/resources and restore exact full-detail pixels', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/babylon-player-lods.ts'),
        name: 'BabylonPlayerLodProbe',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in result)) throw new Error('Missing Babylon index-tier fixture');
  const chunk = result.output.find((output) => output.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing Babylon index-tier code');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/babylon-player-lods-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Original Babylon reversible index tiers</title>',
    }),
  );
  await page.goto('/babylon-player-lods-fixture');
  await page.addScriptTag({ content: chunk.code });
  const report = await page.evaluate(() =>
    (
      window as unknown as {
        BabylonPlayerLodProbe: { babylonPlayerLods: typeof babylonPlayerLods };
      }
    ).BabylonPlayerLodProbe.babylonPlayerLods(),
  );
  for (const [index, row] of report.rows.entries())
    await info.attach(`babylon-lod-${index}-tier-${row.tier}.png`, {
      body: Buffer.from(row.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('babylon-player-lods.json', {
    body: JSON.stringify(report, (key, value) => (key === 'image' ? undefined : value), 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(report.glError).toBe(0);
  expect(report.compiled).toBe(172);
  expect(report.retained).toMatchObject({
    meshes: 173,
    geometries: 172,
    materials: 101,
    textures: 82,
    bones: 59,
  });
  expect(report.rows.map((row) => row.tier)).toEqual([0, 1, 2, 3, 0]);
  expect(report.rows.map((row) => row.triangles)).toEqual([
    1455118, 855654, 814806, 797386, 1455118,
  ]);
  for (const row of report.rows) {
    expect(row.matchingIndices).toBe(true);
    expect(row.matchingResources).toBe(true);
    expect(row.releasedReplacements).toBe(true);
    expect(row.unchangedPose).toBe(true);
    expect(row.originalIndexIdentity).toBe(true);
    expect(row.completedFrames).toBeGreaterThanOrEqual(2);
    expect(row.activeIndices).toBeGreaterThan(0);
    expect(row.visiblePixels).toBeGreaterThan(1000);
    expect(row.resources).toEqual(report.retained);
    expect(row.glError).toBe(0);
  }
  expect(report.rows.at(-1)!.differentChannels).toBe(0);
  expect(report.disposedIndexBuffers).toBe(true);
  expect(report.adapter).toMatchObject({
    tier: 0,
    disposed: true,
    abandoned: false,
    failed: false,
  });
  expect(report.graphics).toMatchObject({ lost: false, losses: 0 });
});
