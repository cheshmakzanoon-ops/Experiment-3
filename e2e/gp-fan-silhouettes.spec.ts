import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { fixtureDefine } from './fixtures/owner-build.ts';
import type { captureGpFanSilhouettes } from './fixtures/gp-fan-silhouettes.ts';

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
  await page.setContent('<title>GP spectator sculpts</title>');
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
  const angular = captures.find((f) => f.name === 'standing-angular')!;
  expect(angular.draws).toBe(1);
  expect(angular.triangles).toBe(8);
});
