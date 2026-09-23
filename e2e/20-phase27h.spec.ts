import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';
import manifest from '../src/rendering/apx01-shell.manifest.json' with { type: 'json' };
import { F, H, carBase } from '../src/simulation/protocol.ts';

test('27H: actual application loads the authored GLB and retains frozen native views and live paint', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  const initial = await page.evaluate(() => window.apexDiagnostics());
  expect(initial.frame![carBase(0) + F.S]).toBeCloseTo(initial.frame![H.LENGTH] - 32, 3);
  expect(initial.renderer?.authoredBodywork).toMatchObject({
    loaded: true,
    revision: 'APX-01 / 27H.1',
    partCount: 41,
    compressedBytes: manifest.compressedBytes,
    finalArtApproved: false,
  });
  expect(initial.renderer!.authoredBodywork!.sha256).toBe(manifest.sha256);
  await page.getByRole('button', { name: 'PHOTO / LIVERY', exact: true }).click();
  await expect(page.locator('#photoStudio')).toBeVisible();
  await page.locator('#photoBackdrop').selectOption('studio');
  await page.locator('#liveryPrimary').evaluate((e) => {
    (e as HTMLInputElement).value = '#285c89';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.apexDiagnostics())).renderer?.playerPaint?.primary,
    )
    .toBe('#285c89');
  await info.attach('27h-authored-car-application.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'DOWNLOAD PNG', exact: true }).click();
  const png = await readFile((await (await download).path())!);
  expect(png.length).toBeGreaterThan(5000);
  await info.attach('27h-authored-car-canvas.png', { body: png, contentType: 'image/png' });
  await page.locator('#photoBackdrop').selectOption('circuit');
  for (const view of ['cockpit', 'pod', 'chase']) {
    await page.locator('#photo-view').selectOption(view);
    await expect
      .poll(async () => (await page.evaluate(() => window.apexDiagnostics())).renderer?.camera)
      .toBe(view);
    await info.attach(`27h-native-${view}.png`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  }
  expect(errors).toEqual([]);
});

test('27H: a missing authored asset fails explicitly rather than claiming a procedural fallback is authored', async ({
  page,
}) => {
  await page.route('**/apx01-shell*.gz', (route) =>
    route.fulfill({ status: 404, body: 'Asset unavailable' }),
  );
  await page.goto('/');
  await expect(page.locator('#errorMessage')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('#errorMessage')).toContainText(/bodywork/i);
});

test('27H: isolated renderer imports do not resolve an asset URL or fetch bodywork', async ({
  page,
}) => {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('src/rendering/hero-shells.ts'),
        name: 'APEXHeroImportProbe',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in output)) throw new Error('Missing authored bodywork bundle');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing authored bodywork entry');
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  // The geometry probes intentionally have an opaque document URL, not the
  // application origin. Importing geometry must not start asset acquisition.
  await page.setContent('<!doctype html><title>Bodywork import isolation</title>');
  await page.addScriptTag({ content: chunk.code });
  const state = await page.evaluate(() => {
    const api = (
      window as unknown as {
        APEXHeroImportProbe?: {
          HeroShells?: unknown;
          bakeHeroGeometry?: unknown;
          loadHeroShells?: unknown;
        };
      }
    ).APEXHeroImportProbe;
    return {
      href: location.href,
      exports: [typeof api?.HeroShells, typeof api?.bakeHeroGeometry, typeof api?.loadHeroShells],
    };
  });
  expect(state).toEqual({ href: 'about:blank', exports: ['function', 'function', 'function'] });
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});
