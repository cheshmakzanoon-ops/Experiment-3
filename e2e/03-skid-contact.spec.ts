import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { verifySkidContact } from './fixtures/skid-contact.ts';

test('real floor-contact work renders sparks at recorded points and survives replay and pause', async ({
  page,
}, info) => {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve('e2e/fixtures/skid-contact.ts'),
        name: 'SkidOracle',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing contact fixture bundle');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing contact fixture entry');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent(
    '<!doctype html><title>Production floor contact and recorded spark rendering</title>',
  );
  await page.addScriptTag({ content: chunk.code });
  const { image, ...measured } = await page.evaluate(() =>
    (
      window as unknown as { SkidOracle: { verifySkidContact: typeof verifySkidContact } }
    ).SkidOracle.verifySkidContact(),
  );
  await info.attach('skid-contact.png', {
    body: Buffer.from(image.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
  await info.attach('skid-contact.json', {
    body: JSON.stringify(measured, null, 2),
    contentType: 'application/json',
  });
  expect(measured.frameCount).toBe(4);
  expect(measured.workJ).toBeGreaterThan(0);
  expect(measured.births).toBeGreaterThan(0);
  expect(measured.replayBirths).toBe(measured.births);
  expect(measured.changedPixels).toBeGreaterThan(5);
  expect(measured.pauseDifferences).toBe(0);
  expect(measured.replayDifferences).toBe(0);
  expect(measured.sourcesUnchanged).toBe(true);
  expect(measured.finitePixels).toBe(true);
  expect(errors).toEqual([]);
});
