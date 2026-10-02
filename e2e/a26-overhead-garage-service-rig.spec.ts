import { finishRaceEntry } from './race-entry.ts';
import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import manifest from '../src/rendering/overhead-garage-service-rig.manifest.json' with { type: 'json' };
import type { captureA26 } from './fixtures/a26-overhead-services.ts';

test('A26 production startup and practice entry retain the overhead rig with A22 and A33', async ({
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
  const before = await read();
  expect(before.renderer?.environmentAssets.garage?.overheadServices).toMatchObject({
    assetId: 'A26',
    sha256: manifest.sha256,
    loaded: true,
    attached: true,
    finalArtApproved: false,
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
  const after = await read();
  expect(after.renderer?.environmentAssets.garage?.overheadServices?.loaded).toBe(true);
  await info.attach('a26-startup.json', {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

for (const [lighting, wet] of [
  ['day', false],
  ['sunset', false],
  ['day', true],
  ['night', true],
] as const) {
  test(`A26 real-circuit moving survey ${lighting} ${wet ? 'wet' : 'dry'}`, async ({
    page,
  }, info) => {
    const rig = readFileSync('public/' + manifest.url);
    expect(createHash('sha256').update(rig).digest('hex')).toBe(manifest.sha256);
    const bundle = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/a26-overhead-services.ts'),
          name: 'A26Survey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(bundle) ? bundle[0] : bundle;
    if (!('output' in output)) throw new Error('Missing A26 survey bundle');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing A26 code');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    // The production hash gate requires a genuine secure localhost origin.
    // Serve an isolated document there without booting a second application.
    await page.route('**/a26-inspection', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>A26 circuit survey</title>',
      }),
    );
    await page.goto('/a26-inspection');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      async (args) =>
        (
          window as unknown as { A26Survey: { captureA26: typeof captureA26 } }
        ).A26Survey.captureA26(args.garage, args.rig, args.lighting, args.wet),
      {
        garage: readFileSync('public/models/aurel-hero-garage-bay.glb').toString('base64'),
        rig: rig.toString('base64'),
        lighting,
        wet,
      },
    );
    const prefix = `${wet ? 'wet-' : ''}${lighting}`;
    mkdirSync('test-results/a26-evidence', { recursive: true });
    for (const shot of report.images) {
      const png = Buffer.from(shot.image.split(',')[1], 'base64');
      expect(png.length).toBeGreaterThan(30000);
      await info.attach(`${prefix}-${shot.view}.png`, { body: png, contentType: 'image/png' });
      writeFileSync(`test-results/a26-evidence/${prefix}-${shot.view}.png`, png);
      if (!shot.view.startsWith('move-')) {
        expect(shot.addedCalls).toBeGreaterThan(0);
        expect(shot.addedCalls).toBeLessThanOrEqual(16); // material batches plus shadow submissions
      }
    }
    const summary = { ...report, images: report.images.map(({ image: _image, ...shot }) => shot) };
    writeFileSync(`test-results/a26-evidence/${prefix}.json`, JSON.stringify(summary, null, 2));
    await info.attach(`${prefix}.json`, {
      body: JSON.stringify(summary, null, 2),
      contentType: 'application/json',
    });
    expect(report.errors.every((n) => n === 0)).toBe(true);
    expect(errors).toEqual([]);
    expect(report.after).toEqual(report.before);
    expect(report.sourceUnchanged).toBe(true);
    expect(report.waterUnchanged).toBe(true);
    expect(report.garage.overheadServices).toMatchObject({
      assetId: 'A26',
      loaded: true,
      attached: true,
      lod: 0,
    });
  });
}
