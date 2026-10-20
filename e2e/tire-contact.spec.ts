import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureTireContact } from './fixtures/tire-contact.ts';

test('recorded tyre strain: GPU plane, bead, normals, authored transform, catalogue shadows and rewind', async ({
  page,
}, info) => {
  const bundled = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/tire-contact.ts'),
        name: 'TireContactProbe',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundled) ? bundled[0] : bundled;
  if (!('output' in output)) throw new Error('Missing tire fixture output');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing tire fixture chunk');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/tire-contact-probe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Recorded tire contact verification</title>',
    }),
  );
  await page.goto('/tire-contact-probe');
  await page.addScriptTag({ content: chunk.code });
  const result = await page.evaluate(() =>
    (
      window as unknown as { TireContactProbe: { captureTireContact: typeof captureTireContact } }
    ).TireContactProbe.captureTireContact(),
  );
  await info.attach('recorded-tire-contact.png', {
    body: Buffer.from(result.image.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
  await info.attach('recorded-tire-contact.json', {
    body: JSON.stringify({ ...result, image: undefined }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(result.glError).toBe(0);
  expect(result.compilation.lit).toBeGreaterThan(0);
  expect(result.compilation.depth).toBeGreaterThan(0);
  expect(result.shadow).toBe(true);
  expect(result.changed).toBeGreaterThan(100);
  expect(result.largest).toBeGreaterThan(10);
  expect(result.replayDelta).toBe(0);
  for (const rows of [result.flat, result.spinningAuthored]) {
    for (const [index, row] of rows.entries()) {
      expect(row.rawNormalLength).toBeCloseTo(1, 4);
      if (index < 2) {
        expect(row.position[0] - row.original[0]).toBeCloseTo(
          -0.008 + Math.sign(row.original[0]) * 0.02 * 0.35,
          5,
        );
        expect(row.position[1]).toBeCloseTo(-0.315, 5);
        expect(row.position[2]).toBeCloseTo(0.006, 5);
        expect(row.normal[0]).toBeCloseTo(0, 3);
        expect(row.normal[1]).toBeCloseTo(-1, 3);
        expect(row.normal[2]).toBeCloseTo(0, 3);
      } else
        row.position.forEach((value, axis) => expect(value).toBeCloseTo(row.original[axis], 5));
    }
  }
  for (const row of result.inclined)
    expect(
      row.position.reduce((sum, value, axis) => sum + value * result.normal[axis], 0),
    ).toBeGreaterThanOrEqual(-0.315001);
  for (const rows of [result.unloaded, result.fallback])
    for (const row of rows)
      row.position.forEach((value, axis) => expect(value).toBeCloseTo(row.original[axis], 5));
});
