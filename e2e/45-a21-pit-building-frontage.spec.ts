import { finishRaceEntry } from './race-entry.ts';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import manifest from '../src/rendering/pit-building-frontage.manifest.json' with { type: 'json' };
import type { capturePitBuilding } from './fixtures/pit-building-frontage.ts';

test('A21 normal startup retains four frontage chunks and A22/A24 through practice entry', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  const read = () => page.evaluate(() => window.apexDiagnostics());
  const loaded = await read();
  expect(loaded.renderer?.environmentAssets.frontage).toMatchObject({
    assetId: 'A21',
    loaded: true,
    placed: true,
    sha256: manifest.sha256,
    bayCount: 12,
    sockets: 43,
    finalArtApproved: false,
  });
  expect(loaded.renderer?.environmentAssets.frontage?.chunks).toHaveLength(4);
  expect(loaded.renderer?.environmentAssets.garage).toMatchObject({ loaded: true, bay: 5 });
  expect(loaded.renderer?.environmentAssets.pitWall).toMatchObject({
    loaded: true,
    assetId: 'A24',
  });
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '0');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await finishRaceEntry(page);
  await expect.poll(async () => (await read()).state, { timeout: 90000 }).toBe('driving');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await read()).workerPause)
    .toMatchObject({ pending: false, paused: true });
  const paused = await read();
  expect(paused.renderer?.environmentAssets.frontage).toMatchObject({
    loaded: true,
    sha256: manifest.sha256,
  });
  await info.attach('a21-startup.json', {
    body: JSON.stringify({ loaded, paused }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

for (const scenario of [
  { lighting: 'day', wet: false },
  { lighting: 'sunset', wet: false },
  { lighting: 'night', wet: false },
  { lighting: 'night', wet: true },
] as const) {
  const label = scenario.wet ? 'rainy-night' : scenario.lighting;
  test(`A21 actual circuit frontage, retained garages and pit station in ${label}`, async ({
    page,
  }, info) => {
    const bytes = readFileSync('public/' + manifest.url);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
    const bundle = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/pit-building-frontage.ts'),
          name: 'FrontageSurvey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(bundle) ? bundle[0] : bundle;
    if (!('output' in output)) throw new Error('Missing A21 fixture');
    const chunk = output.output.find((c) => c.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing A21 script');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setContent('<!doctype html><title>A21 retained circuit survey</title>');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      async ({ encoded, g, s, lighting, wet }) =>
        (
          window as unknown as { FrontageSurvey: { capturePitBuilding: typeof capturePitBuilding } }
        ).FrontageSurvey.capturePitBuilding(encoded, g, s, lighting, wet),
      {
        encoded: bytes.toString('base64'),
        g: readFileSync('public/models/aurel-hero-garage-bay.glb').toString('base64'),
        s: readFileSync('public/models/aurel-pit-wall-command-station.glb').toString('base64'),
        ...scenario,
      },
    );
    for (const shot of report.images) {
      const png = Buffer.from(shot.image.split(',')[1], 'base64');
      expect(png.readUInt32BE(16)).toBe(1280);
      expect(png.readUInt32BE(20)).toBe(720);
      await info.attach(`a21-${label}-${shot.view}.png`, { body: png, contentType: 'image/png' });
      expect(shot.addedCalls).toBeGreaterThan(0);
      expect(shot.addedCalls).toBeLessThanOrEqual(80);
    }
    await info.attach(`a21-${label}.json`, {
      body: JSON.stringify(
        { ...report, images: report.images.map(({ image: _image, ...row }) => row) },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(report.images).toHaveLength(7);
    expect(report.frontage).toMatchObject({
      loaded: true,
      placed: true,
      bayCount: 12,
      sockets: 43,
      finalArtApproved: false,
    });
    expect(report.frontage.minimumPitClearance).toBeGreaterThan(0.25);
    expect(report.garage).toMatchObject({ loaded: true, bay: 5 });
    expect(report.station).toMatchObject({ loaded: true, assetId: 'A24' });
    expect(report.sourceUnchanged).toBe(true);
    expect(report.waterUnchanged).toBe(true);
    expect(report.after).toEqual(report.before);
    expect(report.glError).toBe(0);
    expect(errors).toEqual([]);
  });
}
