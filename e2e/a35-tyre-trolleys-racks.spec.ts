import { finishRaceEntry } from './race-entry.ts';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import manifest from '../src/rendering/tyre-trolleys-racks.manifest.json' with { type: 'json' };
import type { captureTyreEquipment } from './fixtures/tyre-trolleys-racks.ts';

test('A35 normal menu/practice startup retains the authored logistics kit', async ({
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
  expect(loaded.renderer?.environmentAssets.tyreEquipment).toMatchObject({
    assetId: 'A35',
    loaded: true,
    sha256: manifest.sha256,
    visualOnly: true,
    finalArtApproved: false,
  });
  expect(loaded.renderer?.environmentAssets.tyreEquipment?.instances.map((i) => i.wheels)).toEqual([
    4, 0, 8,
  ]);
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
  expect(paused.renderer?.environmentAssets.tyreEquipment).toMatchObject({
    assetId: 'A35',
    loaded: true,
    sha256: manifest.sha256,
  });
  await info.attach('a35-startup.json', {
    body: JSON.stringify({ loaded, paused }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`A35 actual garage views and moving-camera resources in ${lighting}`, async ({
    page,
  }, info) => {
    const bytes = readFileSync('public/models/aurel-tyre-trolleys-racks.glb');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
    const bundle = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/tyre-trolleys-racks.ts'),
          name: 'A35Survey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(bundle) ? bundle[0] : bundle;
    if (!('output' in output)) throw new Error('Missing A35 fixture output');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing A35 fixture code');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setContent('<!doctype html><title>A35 retained circuit inspection</title>');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      async ({ encoded, garage, lighting, blankets }) =>
        (
          window as unknown as { A35Survey: { captureTyreEquipment: typeof captureTyreEquipment } }
        ).A35Survey.captureTyreEquipment(encoded, garage, lighting, blankets),
      {
        encoded: bytes.toString('base64'),
        garage: readFileSync('public/models/aurel-hero-garage-bay.glb').toString('base64'),
        blankets: readFileSync('public/models/aurel-tyre-blankets-and-controllers.glb').toString(
          'base64',
        ),
        lighting,
      },
    );
    for (const shot of report.images) {
      const png = Buffer.from(shot.image.split(',')[1], 'base64');
      expect(png.readUInt32BE(16)).toBe(1280);
      expect(png.readUInt32BE(20)).toBe(720);
      await info.attach(`a35-${lighting}-${shot.name}.png`, {
        body: png,
        contentType: 'image/png',
      });
      expect(shot.addedCalls).toBeGreaterThan(0);
      // Includes existing shadow submissions, not just the visible main pass.
      expect(shot.addedCalls).toBeLessThanOrEqual(102);
    }
    await info.attach(`a35-${lighting}.json`, {
      body: JSON.stringify(
        { ...report, images: report.images.map(({ image: _image, ...row }) => row) },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(report.images).toHaveLength(3);
    expect(report.kit.instances.map((i) => i.wheels)).toEqual([4, 0, 8]);
    expect(report.before).toEqual(report.after);
    expect(report.sourceUnchanged).toBe(true);
    expect(report.waterUnchanged).toBe(true);
    expect(report.movingSurveyFrames).toBe(8);
    expect(report.includesA34).toBe(true);
    expect(report.glError).toBe(0);
    expect(errors).toEqual([]);
  });
}
