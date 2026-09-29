import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import manifest from '../src/rendering/pit-wall-station.manifest.json' with { type: 'json' };
import type { capturePitWall } from './fixtures/pit-wall-station.ts';

test('A24 normal startup loads the authored station and retains it through practice', async ({
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
  expect((await read()).renderer?.environmentAssets.pitWall).toMatchObject({
    loaded: true,
    assetId: 'A24',
    sha256: manifest.sha256,
    screenCar: 0,
  });
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '0');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await expect.poll(async () => (await read()).state, { timeout: 90000 }).toBe('driving');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await read()).workerPause)
    .toMatchObject({ pending: false, paused: true });
  const result = await read();
  expect(result.renderer?.environmentAssets.pitWall?.loaded).toBe(true);
  await info.attach('a24-normal-startup.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`A24 real-circuit ${lighting} station, screen orientation and replay ownership`, async ({
    page,
  }, info) => {
    const bytes = readFileSync('public/models/aurel-pit-wall-command-station.glb');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
    const result = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/pit-wall-station.ts'),
          name: 'StationSurvey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(result) ? result[0] : result;
    if (!('output' in output)) throw new Error('Missing station bundle');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing station code');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setContent('<!doctype html><title>A24 circuit inspection</title>');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      async ({ encoded, garage, lighting }) =>
        (
          window as unknown as { StationSurvey: { capturePitWall: typeof capturePitWall } }
        ).StationSurvey.capturePitWall(encoded, garage, lighting),
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
      await info.attach(`a24-${lighting}-${shot.view}.png`, {
        body: png,
        contentType: 'image/png',
      });
      expect(shot.addedCalls).toBeGreaterThan(0);
      expect(shot.addedCalls).toBeLessThanOrEqual(40);
    }
    await info.attach(`a24-${lighting}-atlas.png`, {
      body: Buffer.from(report.atlas.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
    await info.attach(`a24-${lighting}.json`, {
      body: JSON.stringify(
        {
          ...report,
          atlas: undefined,
          images: report.images.map(({ image: _image, ...row }) => row),
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(report.station).toMatchObject({
      assetId: 'A24',
      loaded: true,
      lod: 0,
      screenMode: 'HELD',
      screenTime: report.restoredTime,
      finalArtApproved: false,
    });
    expect(report.pausedUploads).toBe(report.uploads);
    expect(report.rewoundTime).toBe(report.expectedRewind);
    expect(report.before).toEqual(report.after);
    expect(report.frameUnchanged).toBe(true);
    expect(report.waterUnchanged).toBe(true);
    expect(report.placement.pitClearance).toBeGreaterThan(1);
    expect(report.placement.trackClearance).toBeGreaterThan(2);
    expect(report.glError).toBe(0);
    expect(errors).toEqual([]);
  });
}
