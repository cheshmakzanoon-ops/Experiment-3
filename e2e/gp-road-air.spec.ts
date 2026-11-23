import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { fixtureDefine } from './fixtures/owner-build.ts';
import type { captureGpRoadAir, captureGpFloodlightGlare } from './fixtures/gp-road-air.ts';

test('GP optics resolve road heat, depth occlusion and the angular extent of floodlit highlights', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/gp-road-air.ts'), name: 'GpAir', formats: ['iife'] },
    },
  });
  const out = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in out)) throw new Error('Missing GP air bundle');
  const code = out.output.find((chunk) => chunk.type === 'chunk');
  if (!code || code.type !== 'chunk') throw new Error('Missing GP air test entry');
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent('<title>GP road optics</title>');
  await page.addScriptTag({ content: code.code });
  const { captures, ...stats } = await page.evaluate(() =>
    (
      window as unknown as { GpAir: { captureGpRoadAir: typeof captureGpRoadAir } }
    ).GpAir.captureGpRoadAir(),
  );
  for (const f of captures)
    await info.attach(f.name, {
      body: Buffer.from(f.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('road-air.json', {
    body: JSON.stringify(stats),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(stats.glError).toBe(0);
  expect(stats.count).toBeGreaterThan(0);
  expect(stats.changed).toBeGreaterThan(50);
  expect(stats.moving).toBeGreaterThan(30);
  expect(stats.foregroundPixels).toBeGreaterThan(100);
  expect(stats.foreground).toBe(0);
  expect(stats.sky).toBe(0);
  expect(stats.rewound).toBe(0);
  expect(stats.wetDifference).toBe(0);
  const glare = await page.evaluate(() =>
    (
      window as unknown as {
        GpAir: { captureGpFloodlightGlare: typeof captureGpFloodlightGlare };
      }
    ).GpAir.captureGpFloodlightGlare(),
  );
  await info.attach('floodlight-glare.json', {
    body: JSON.stringify(glare),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(glare.glError).toBe(0);
  expect(glare.original.glintHalo).toBeGreaterThan(1);
  expect(glare.gp.glintHalo).toBeLessThan(glare.original.glintHalo * 0.2);
  expect(glare.gp.lampHalo / glare.original.lampHalo).toBeGreaterThan(0.8);
  expect(glare.gp.lampHalo / glare.original.lampHalo).toBeLessThan(1.05);
  expect(glare.restored).toEqual(glare.original);
});
