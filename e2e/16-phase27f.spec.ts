import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/phase27f.ts';
async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/phase27f.ts'), name: 'Phase27F', formats: ['iife'] },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('No Phase 27F bundle');
  const chunk = output.output.find((part) => part.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('No Phase 27F script');
  await page.setContent(
    '<!doctype html><title>Phase 27F component evidence, not a human drive</title>',
  );
  await page.addScriptTag({ content: chunk.code });
  return errors;
}
test('night sky and environment restore exactly across day, cloud and night transitions', async ({
  page,
}, info) => {
  const errors = await load(page);
  const r = await page.evaluate(() =>
    (window as unknown as { Phase27F: typeof Fixture }).Phase27F.nightSkyGPU(),
  );
  for (const c of r.captures)
    await info.attach(`${c.name}.png`, {
      body: Buffer.from(c.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('night-environment.json', {
    body: JSON.stringify({ ...r, captures: undefined, errors }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(r.glError).toBe(0);
  expect(r.heldExact).toBe(true);
  expect(r.restoredExact).toBe(true);
  expect(r.dayRestoredExact).toBe(true);
  expect(r.environmentCaptures).toBe(5);
  expect(r.night.every((v) => v > 0)).toBe(true);
  expect(r.night.reduce((a, b) => a + b)).toBeLessThan(r.day.reduce((a, b) => a + b));
  expect(r.night).not.toEqual(r.clear);
  expect(r.hardware.gpuVRAMBytes).toBeNull();
});
test('explicit game-audio capture records the real post-compressor bus and releases its tracks', async ({
  page,
}, info) => {
  const errors = await load(page);
  await page.evaluate(() =>
    (window as unknown as { Phase27F: typeof Fixture }).Phase27F.mountAudioStart(),
  );
  await page.locator('#startGameAudio').click();
  await expect(page.locator('#startGameAudio')).toHaveAttribute('data-started', 'true');
  const r = await page.evaluate(() =>
    (window as unknown as { Phase27F: typeof Fixture }).Phase27F.gameAudioVideoProbe(),
  );
  // WebM MIME parameters contain a codec-list comma before the data delimiter.
  // Decode after ';base64,' rather than silently attaching 'opus;base64'.
  const delimiter = r.video.indexOf(';base64,');
  expect(delimiter).toBeGreaterThan(0);
  const bytes = Buffer.from(r.video.slice(delimiter + 8), 'base64');
  expect(bytes.length).toBe(r.diagnostics.bytes);
  expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  await info.attach('game-bus-diagnostic.webm', { body: bytes, contentType: 'video/webm' });
  await info.attach('game-bus-lifecycle.json', {
    body: JSON.stringify({ ...r, video: undefined, errors }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(r.diagnostics.state).toBe('ready');
  expect(r.diagnostics.capturesAudio).toBe(true);
  expect(r.diagnostics.audioSource).toBe('game-post-compressor-bus');
  expect(r.diagnostics.microphone).toBe(false);
  expect(r.diagnostics.encodedFrameCount).toBeNull();
  expect(r.diagnostics.requestedFrames).toBe(40);
  expect(r.diagnostics.bytes).toBeGreaterThan(2000);
  expect(r.audio.state).toBe('running');
  expect(r.tracksEnded).toBe(true);
  expect(await page.locator('canvas').count()).toBe(0);
});
test('production evidence dialogs retain readable controls and full hashes at narrow viewports', async ({
  page,
}, info) => {
  const errors = await load(page);
  await page.addStyleTag({ path: resolve('src/ui/style.css') });
  for (const mode of ['references', 'session', 'lap'] as const) {
    await page.evaluate(
      (mode) => (window as unknown as { Phase27F: typeof Fixture }).Phase27F.mountEvidenceUi(mode),
      mode,
    );
    for (const width of [320, 390, 720, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.locator('#modal')).toBeVisible();
      if (mode === 'references') {
        await page.locator('#referenceSearch').fill('092');
        await page
          .locator('[data-reference="92"]')
          .evaluate((e) => ((e as HTMLDetailsElement).open = true));
      }
      expect(await page.locator('#modal').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
        true,
      );
    }
    if (mode === 'lap') {
      await expect(page.locator('#reviewAudio')).not.toBeChecked();
      await expect(page.locator('#reviewVideo')).not.toBeChecked();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await info.attach(`${mode}-390px.png`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  }
  expect(errors).toEqual([]);
});
