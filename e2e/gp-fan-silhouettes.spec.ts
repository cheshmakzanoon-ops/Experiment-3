import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { fixtureDefine } from './fixtures/owner-build.ts';
import type {
  captureGpFanSilhouettes,
  captureGpViewingBank,
} from './fixtures/gp-fan-silhouettes.ts';

test('GP distance fans retain the standing and seated sculpt silhouettes in two triangles', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/gp-fan-silhouettes.ts'),
        name: 'GpFans',
        formats: ['iife'],
      },
    },
  });
  const out = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in out)) throw new Error('Missing GP spectator bundle');
  const code = out.output.find((chunk) => chunk.type === 'chunk');
  if (!code || code.type !== 'chunk') throw new Error('Missing GP spectator test entry');
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  // Load the shipped meadow atlas from the same preview origin as the game.
  await page.route('**/gp-fan-review-host', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>GP spectator sculpts</title>' }),
  );
  await page.goto('/gp-fan-review-host');
  await page.addScriptTag({ content: code.code });
  const { captures, ...stats } = await page.evaluate(() =>
    (
      window as unknown as { GpFans: { captureGpFanSilhouettes: typeof captureGpFanSilhouettes } }
    ).GpFans.captureGpFanSilhouettes(),
  );
  for (const f of captures)
    await info.attach(f.name, {
      body: Buffer.from(f.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('fan-silhouettes.json', {
    body: JSON.stringify(stats),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(stats.glError).toBe(0);
  expect(stats.shape).toBeGreaterThan(0.65);
  expect(stats.shape).toBeGreaterThan(stats.oldShape + 0.1);
  expect(stats.reverseShape).toBeGreaterThan(0.64);
  expect(stats.restored).toBe(0);
  expect(stats.casterAgreement).toBeGreaterThan(0.78);
  const angular = captures.find((f) => f.name === 'standing-angular')!;
  expect(angular.draws).toBe(1);
  expect(angular.triangles).toBe(8);
  const { captures: bank, ...wind } = await page.evaluate(() =>
    (
      window as unknown as { GpFans: { captureGpViewingBank: typeof captureGpViewingBank } }
    ).GpFans.captureGpViewingBank(),
  );
  for (const frame of bank)
    await info.attach(frame.name, {
      body: Buffer.from(frame.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  expect(errors).toEqual([]);
  expect(wind.glError).toBe(0);
  expect(wind.windRestore).toBe(0);
  expect(wind.meadowClumps).toBeGreaterThan(80);
  expect(wind.meadowPixels).toBeGreaterThan(40);
  expect(wind.umbrellas).toBeGreaterThan(1);
  expect(wind.canopyPixels).toBeGreaterThan(120);
  expect(wind.canopyHeld).toBe(0);
  expect(wind.showerWindPixels).toBeGreaterThan(40);
  expect(wind.canopyRestore).toBe(0);
  expect(wind.windPixels).toBeGreaterThan(200);
  expect(wind.lullPixels).toBeGreaterThan(200);
});
