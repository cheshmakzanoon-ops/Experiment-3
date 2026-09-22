import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/phase27g-completion.ts';
async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/phase27g-completion.ts'),
        name: 'ClosureProbe',
        formats: ['iife'],
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap((r) =>
      'output' in r ? r.output : [],
    ),
    chunk = chunks.find((c) => c.type === 'chunk' && c.isEntry);
  if (!chunk || chunk.type !== 'chunk') throw new Error('No closure fixture');
  await page.setContent(
    '<!doctype html><title>Phase 27G component validation (not a human acceptance run)</title>',
  );
  await page.addScriptTag({ content: chunk.code });
  return errors;
}
test('27G closure: real HDR meter respects pixel ratio, pause, async ownership and zero-cost disable', async ({
  page,
}, info) => {
  const errors = await load(page);
  const r = await page.evaluate(() =>
    (window as unknown as { ClosureProbe: typeof Fixture }).ClosureProbe.exposureGPU(),
  );
  expect(errors).toEqual([]);
  expect(r.restored).toBe(true);
  expect(r.glErrorAfterSynchronousRead).toBe(0);
  expect(r.sampled.samples).toBe(1);
  expect(r.stats.failedReads).toBe(0);
  expect(r.exposure).toBeGreaterThan(1.5);
  expect(r.exposure).toBeLessThanOrEqual(2 ** 0.85);
  expect(r.heldExact).toBe(true);
  expect(r.disabledCalls).toBe(0);
  expect(r.resetEV).toBe(0);
  await info.attach('measured-exposure.json', {
    body: JSON.stringify(r, null, 2),
    contentType: 'application/json',
  });
});
test('27G closure: real instanced local fog and synchronously-owned PNG survive subsequent canvas resize', async ({
  page,
}, info) => {
  const errors = await load(page);
  const r = await page.evaluate(() =>
    (window as unknown as { ClosureProbe: typeof Fixture }).ClosureProbe.atmosphereAndCaptureGPU(),
  );
  expect(errors).toEqual([]);
  expect(r.glError).toBe(0);
  expect(r.changed).toBeGreaterThan(100);
  expect(r.exact).toBe(true);
  expect(r.capturedExact).toBe(true);
  expect(r.dimensions).toEqual([640, 360]);
  expect(r.blobBytes).toBeGreaterThan(1000);
  await info.attach('actual-local-fog.png', {
    body: Buffer.from(r.png.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
});
test('27G closure: whole-tab evidence has explicit gestures and readable controls; no automatic capture', async ({
  page,
}, info) => {
  const errors = await load(page);
  await page.addStyleTag({ path: resolve('src/ui/style.css') });
  await page.evaluate(() =>
    (window as unknown as { ClosureProbe: typeof Fixture }).ClosureProbe.mountTabPanel(),
  );
  for (const width of [320, 390, 720, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('[data-tab-start]')).toBeDisabled();
    await expect(page.locator('[data-tab-stop]')).toBeDisabled();
    expect(
      await page.locator('[data-tab-evidence]').evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
  }
  await info.attach('tab-evidence-controls.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(errors).toEqual([]);
});

test('publication: native photographs retain driving optics and suspension remains articulated at every LOD', async ({
  page,
}, info) => {
  const errors = await load(page);
  const r = await page.evaluate(() =>
    (window as unknown as { ClosureProbe: typeof Fixture }).ClosureProbe.nativePhotoAndLodGPU(),
  );
  expect(errors).toEqual([]);
  expect(r.glError).toBe(0);
  expect(r.sourceUnchanged).toBe(true);
  for (const mode of r.results) {
    expect(mode.eyeError).toBeLessThan(1e-6);
    expect(mode.fovError).toBeLessThan(1e-6);
    if (mode.mode === 'cockpit') expect(mode.helmetVisible).toBe(false);
  }
  expect(r.visible).toEqual([1, 1, 1]);
  expect(r.posesEqual).toBe(true);
  expect(r.rotorOwnership).toBe(true);
  expect(r.reducedCount).toBe(2);
  await info.attach('native-camera-and-lod.json', {
    body: JSON.stringify(r, null, 2),
    contentType: 'application/json',
  });
});
