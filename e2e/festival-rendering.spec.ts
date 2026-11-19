import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type * as Fixture from './fixtures/festival-rendering.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

test('Festival renders streamed cascade maps, exposure and motion through quality and photo transitions', async ({
  page,
}, info) => {
  const built = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/festival-rendering.ts'),
        name: 'FestivalRendering',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing Festival fixture output');
  const script = result.output.find((file) => file.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing Festival fixture script');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>Festival rendering pipeline</title><body></body>');
  await page.addScriptTag({ content: script.code });
  const report = await page.evaluate(() =>
    (window as unknown as { FestivalRendering: typeof Fixture }).FestivalRendering.capture(),
  );
  const { screenshot, ...diagnostics } = report;
  await info.attach('festival-rendering.json', {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: 'application/json',
  });
  await info.attach('festival-rendering.png', {
    body: Buffer.from(screenshot.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
  expect(errors).toEqual([]);
  expect(report.glErrors).toEqual([]);
  expect(report.medium.ultra.shadowCascades.count).toBe(2);
  expect(report.medium.shadows.bakes).toBe(2);
  expect(report.medium.automaticExposure.samples).toBeGreaterThan(0);
  expect(report.medium.automaticExposure.failedReads).toBe(0);
  if (report.medium.motionBlur.supported) {
    expect(report.medium.motionBlur.velocityFrames).toBeGreaterThan(0);
    expect(report.motionChangedPixels).toBeGreaterThan(10);
  }
  expect(report.reduced.motionBlur.active).toBe(false);
  expect(report.reduced.automaticExposure.active).toBe(true);
  expect(report.photo.motionBlur.active).toBe(false);
  expect(report.photo.automaticExposure.active).toBe(false);
  expect(report.high.ultra.shadowCascades.count).toBe(3);
  expect(report.high.scenePass.temporalAA.frames).toBeGreaterThan(0);
  expect(report.off.ultra.shadowCascades.count).toBe(0);
  expect(report.off.motionBlur.active).toBe(false);
  expect(report.off.automaticExposure.active).toBe(false);
  expect(report.restored.ultra.shadowCascades.count).toBe(2);
  expect(report.restored.automaticExposure.active).toBe(true);
  expect(report.sharedContextAlive).toBe(true);
});
