import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type * as Fixture from './fixtures/temporal-depth-rejection.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

test('temporal AA rejects revealed surfaces while retaining valid static and rigid history', async ({
  page,
}, info) => {
  const built = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/temporal-depth-rejection.ts'),
        name: 'TemporalDepthRejection',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing temporal depth fixture output');
  const script = result.output.find((file) => file.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing temporal depth fixture script');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>Temporal depth rejection GPU evidence</title>');
  await page.addScriptTag({ content: script.code });
  const report = await page.evaluate(() =>
    (
      window as unknown as { TemporalDepthRejection: typeof Fixture }
    ).TemporalDepthRejection.capture(),
  );
  const { images, ...diagnostics } = report;
  await info.attach('temporal-depth-rejection.json', {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: 'application/json',
  });
  for (const [name, image] of Object.entries(images))
    await info.attach(`temporal-depth-${name}.png`, {
      body: Buffer.from(image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  expect(errors).toEqual([]);
  expect(report.glErrors).toEqual([]);
  expect(report.contextAlive).toBe(true);
  expect(report.finite).toBe(true);
  expect(report.opaqueOutput).toBe(true);
  expect(report.firstCapture.maximum).toBeLessThan(0.002);
  expect(report.firstDepth).toBeCloseTo(4, 1);
  expect(report.disocclusion.maximum).toBeLessThan(0.002);
  // Same RGB, different depth: demonstrate that the depth test caused rejection.
  expect(report.depthControl.mean).toBeGreaterThan(0.04);
  expect(report.accumulation.mean).toBeGreaterThan(0.04);
  expect(report.rigidAccumulation.mean).toBeGreaterThan(0.03);
  expect(report.skyError.maximum).toBeLessThan(0.002);
  expect(report.skyDepth).toBe(0);
  expect(report.heldDifference.maximum).toBe(0);
  expect(report.resumedError.maximum).toBeLessThan(0.002);
  expect(report.farDepth).toBeGreaterThan(23000);
  expect(report.farDepth).toBeLessThan(25000);
  expect(report.diagnostics.historyBytes).toBe(report.width * report.height * 16);
  expect(report.diagnostics.extraDraws).toBe(1);
  expect(report.diagnostics.historyFetches).toBe(12);
});
