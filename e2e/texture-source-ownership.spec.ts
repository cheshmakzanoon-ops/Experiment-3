import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type * as Fixture from './fixtures/texture-source-ownership.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

test('retained bitmap pixels survive three scene closures and independent GPU uploads', async ({
  page,
}, info) => {
  const built = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/texture-source-ownership.ts'),
        name: 'TextureSourceOwnership',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing texture ownership fixture output');
  const script = result.output.find((file) => file.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing texture ownership script');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>Shared texture source GPU evidence</title>');
  await page.addScriptTag({ content: script.code });
  const report = await page.evaluate(() =>
    (
      window as unknown as { TextureSourceOwnership: typeof Fixture }
    ).TextureSourceOwnership.capture(),
  );
  const { images, ...diagnostics } = report;
  await info.attach('texture-source-ownership.json', {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: 'application/json',
  });
  for (const [name, image] of Object.entries(images))
    await info.attach(`texture-source-${name}.png`, {
      body: Buffer.from(image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  expect(errors).toEqual([]);
  expect(report.glErrors).toEqual([]);
  expect(report.cycles).toHaveLength(3);
  for (const cycle of report.cycles) {
    expect(cycle.maximumDifference).toBe(0);
    expect(cycle.nonBlackPixels).toBe(report.width * report.height);
    expect(cycle.uniqueColors).toBeGreaterThanOrEqual(8);
    expect(cycle.cloneSourcesShared).toBe(true);
    expect(cycle.contextAlive).toBe(true);
    expect(cycle.sourceSizeAfterDispose).toEqual([
      [4, 4],
      [4, 4],
      [4, 4],
    ]);
  }
  expect(report.exclusiveSize).toEqual([0, 0]);
  expect(report.closedControlRejected).toBe(true);
  expect(report.registrationsAfter).toBe(report.registrations);
});
