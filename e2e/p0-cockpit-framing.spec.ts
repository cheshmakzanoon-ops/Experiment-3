import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { cockpitFramingSurvey } from './fixtures/cockpit-framing.ts';

test('P0 actual supplied cockpit, full circuit and camera framing evidence', async ({
  page,
}, info) => {
  const bundled = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/cockpit-framing.ts'),
        name: 'CockpitSurvey',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(bundled) ? bundled[0] : bundled;
  if (!('output' in result)) throw new Error('Missing cockpit survey');
  const chunk = result.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing cockpit survey script');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/cockpit-survey', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Production cockpit framing survey</title>',
    }),
  );
  await page.goto('/cockpit-survey');
  await page.addScriptTag({ content: chunk.code });
  const report = await page.evaluate(() =>
    (
      window as unknown as { CockpitSurvey: { cockpitFramingSurvey: typeof cockpitFramingSurvey } }
    ).CockpitSurvey.cockpitFramingSurvey(),
  );
  for (const row of report.rows) {
    await info.attach(`p0-${row.name}.png`, {
      body: Buffer.from(row.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
    expect(row.visual.suppliedPlayer).not.toBeNull();
    expect(row.camera.position.every(Number.isFinite)).toBe(true);
    expect(row.image.length).toBeGreaterThan(10000);
  }
  await info.attach('p0-cockpit.json', {
    body: JSON.stringify(report, (key, value) => (key === 'image' ? undefined : value), 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
