import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type * as Probe from './fixtures/race-surface-finish.ts';

test('production tyre states survive every LOD and metric venues render without shader errors', async ({ page }, info) => {
  const built = await build({ configFile: false, logLevel: 'error', build: { write: false,
    lib: { entry: resolve('e2e/fixtures/race-surface-finish.ts'), name: 'RaceSurfaceProbe', formats: ['iife'] } } });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing fixture output');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing fixture chunk');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  // Asset integrity uses the browser's real WebCrypto API. An opaque blank
  // document does not expose it; an ordinary loopback origin does. Intercept
  // this test-only document so the full game and its workers never start here.
  await page.route('**/__e2e_race_surface.html', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>Controlled race surface inspection</title><link rel="icon" href="data:,">',
  }));
  await page.goto('/__e2e_race_surface.html');
  const integrityContext = await page.evaluate(() => ({
    origin: location.origin,
    secure: window.isSecureContext,
    digestAvailable: typeof crypto.subtle?.digest === 'function',
  }));
  await info.attach('asset-integrity-origin.json', {
    body: JSON.stringify(integrityContext, null, 2), contentType: 'application/json',
  });
  expect(integrityContext.secure).toBe(true);
  expect(integrityContext.digestAvailable).toBe(true);
  await page.addScriptTag({ content: chunk.code });
  const result = await page.evaluate((bytes) =>
    (window as unknown as { RaceSurfaceProbe: typeof Probe }).RaceSurfaceProbe.raceSurfaceGPU(bytes),
    Array.from(readFileSync(resolve('src/rendering/apx01-shell.glb.gz'))));
  for (const capture of result.captures) await info.attach(`${capture.name}.png`, {
    body: Buffer.from(capture.image.split(',')[1], 'base64'), contentType: 'image/png',
  });
  await info.attach('race-surface-gpu.json', { contentType: 'application/json',
    body: JSON.stringify(result, (key, value) => key === 'image' ? undefined : value, 2) });
  expect(errors).toEqual([]); expect(result.glError).toBe(0); expect(result.after).toEqual(result.before);
  const find = (name: string) => {
    const value = result.captures.find((capture) => capture.name === name);
    if (!value) throw new Error(`Missing capture ${name}`); return value;
  };
  for (const lod of [0, 1, 2]) {
    const slick = find(`tire-${lod}-slick`), inter = find(`tire-${lod}-inter`), wet = find(`tire-${lod}-wet`);
    expect(slick.nonzero).toBeGreaterThan(100);
    expect(inter.hash).not.toBe(slick.hash); expect(wet.hash).not.toBe(inter.hash);
    expect(wet.hash).toBe(find(`tire-${lod}-held`).hash);
    expect(wet.hash).not.toBe(find(`tire-${lod}-dirty`).hash);
    expect(slick.hash).toBe(find(`tire-${lod}-rewound`).hash);
    expect(slick.calls).toBe(wet.calls); expect(slick.triangles).toBe(wet.triangles);
  }
  for (const finish of ['stone', 'timber', 'metal', 'paving']) {
    expect(find(`venue-${finish}`).nonzero).toBeGreaterThan(1000);
    expect(find(`venue-${finish}`).hash).toBe(find(`venue-${finish}-held`).hash);
  }
});
