import { finishRaceEntry } from './race-entry.ts';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import manifest from '../src/rendering/tyre-blankets.manifest.json' with { type: 'json' };
import type { captureBlankets } from './fixtures/tyre-blankets.ts';

test('A34 normal startup, practice and pause retain the real blanket kit', async ({
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
  expect((await read()).renderer?.environmentAssets.tyreBlankets).toMatchObject({
    loaded: true,
    assetId: 'A34',
    sha256: manifest.sha256,
    heatingSimulation: false,
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
  const result = await read();
  expect(result.renderer?.environmentAssets.tyreBlankets?.loaded).toBe(true);
  expect(result.renderer?.environmentAssets.garage?.loaded).toBe(true);
  await info.attach('a34-normal-startup.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
for (const lighting of ['day', 'sunset', 'night'] as const)
  test(`A34 ${lighting} real-garage materials, moving inspection and allocation stability`, async ({
    page,
  }, info) => {
    const bytes = readFileSync('public/models/aurel-tyre-blankets-and-controllers.glb');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
    const built = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/tyre-blankets.ts'),
          name: 'BlanketSurvey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Missing A34 bundle');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing A34 code');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setContent('<!doctype html><title>A34 real-circuit inspection</title>');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      async ({ encoded, garage, lighting }) =>
        (
          window as unknown as { BlanketSurvey: { captureBlankets: typeof captureBlankets } }
        ).BlanketSurvey.captureBlankets(encoded, garage, lighting),
      {
        encoded: bytes.toString('base64'),
        garage: readFileSync('public/models/aurel-hero-garage-bay.glb').toString('base64'),
        lighting,
      },
    );
    for (const shot of report.images) {
      const png = Buffer.from(shot.image.split(',')[1], 'base64');
      expect(png.readUInt32BE(16)).toBe(1280);
      expect(png.readUInt32BE(20)).toBe(720);
      await info.attach(`a34-${lighting}-${shot.view}.png`, {
        body: png,
        contentType: 'image/png',
      });
      writeFileSync(info.outputPath(`a34-${lighting}-${shot.view}.png`), png);
      if (shot.view !== 'moving-inspection-end') {
        expect(shot.addedCalls).toBeGreaterThan(0);
        expect(shot.addedCalls).toBeLessThanOrEqual(40);
      }
    }
    expect(report.before).toEqual(report.after);
    expect(report.frameUnchanged).toBe(true);
    expect(report.waterUnchanged).toBe(true);
    expect(report.glError).toBe(0);
    expect(errors).toEqual([]);
    expect(report.kit).toMatchObject({
      assetId: 'A34',
      loaded: true,
      lod: 0,
      display: 'STANDBY',
      finalArtApproved: false,
    });
    expect(report.far.lod).toBe(2);
    expect(report.far.triangles).toBeLessThan(4500);
    const receipt = { ...report, images: report.images.map(({ image: _image, ...row }) => row) };
    await info.attach(`a34-${lighting}.json`, {
      body: JSON.stringify(receipt, null, 2),
      contentType: 'application/json',
    });
    writeFileSync(info.outputPath(`a34-${lighting}.json`), JSON.stringify(receipt, null, 2));
  });
