import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type * as Fixture from './fixtures/graphics-engine-advancement.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

test('traffic native morphs cast bounded local shadows and release their maps', async ({
  page,
}, info) => {
  const built = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/graphics-engine-advancement.ts'),
        name: 'GraphicsAdvancement',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing graphics advancement fixture output');
  const script = result.output.find((file) => file.type === 'chunk');
  if (!script || script.type !== 'chunk')
    throw new Error('Missing graphics advancement fixture script');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent(
    '<!doctype html><title>Graphics advancement GPU evidence</title><body></body>',
  );
  await page.addScriptTag({ content: script.code });
  const report = await page.evaluate(() =>
    (window as unknown as { GraphicsAdvancement: typeof Fixture }).GraphicsAdvancement.capture(),
  );
  const { images, ...diagnostics } = report;
  await info.attach('graphics-advancement.json', {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: 'application/json',
  });
  for (const [name, image] of Object.entries(images))
    await info.attach(`graphics-advancement-${name}.png`, {
      body: Buffer.from(image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  expect(errors).toEqual([]);
  expect(report.glErrors).toEqual([]);
  expect(report.contextAlive).toBe(true);
  expect(report.traffic.batches).toBe(5);
  expect(report.traffic.profiles).toBe(10);
  expect(report.ultra.readyShadows).toBe(2);
  expect(report.ultra.allocatedTexels).toBe(2 * 1024 * 1024);
  expect(report.held.updates).toBe(report.ultra.updates);
  expect(report.held.requestedUpdates).toBe(0);
  expect(report.off.allocatedMaps).toBe(0);
  expect(report.high.readyShadows).toBe(1);
  expect(report.high.allocatedTexels).toBe(512 * 512);
  expect(report.darkenedPixels).toBeGreaterThan(80);
  expect(report.darkenedPixels).toBeGreaterThan(report.brighterPixels * 4);
});
