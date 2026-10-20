import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureGpCourse } from './fixtures/gp-course-review.ts';

test('GP course markers and protective covers render through dry, wet, held and restored views', async ({
  page,
}, info) => {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/gp-course-review.ts'),
        name: 'GpCourseReview',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in result)) throw new Error('Missing GP course fixture bundle');
  const script = result.output.find((entry) => entry.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing GP course fixture script');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>GP course construction review</title>');
  await page.addScriptTag({ content: script.code });
  const report = await page.evaluate(() =>
    (
      window as unknown as { GpCourseReview: { captureGpCourse: typeof captureGpCourse } }
    ).GpCourseReview.captureGpCourse(),
  );
  for (const [index, capture] of report.captures.entries())
    await info.attach(`${index}-${capture.view}-${capture.wet ? 'wet' : 'dry'}.png`, {
      body: Buffer.from(capture.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('gp-course-render-receipt.json', {
    body: JSON.stringify(report, (key, value) => (key === 'image' ? undefined : value), 2),
    contentType: 'application/json',
  });
  expect(report.covers).toBeGreaterThan(20);
  expect(report.markerGroups).toBeGreaterThanOrEqual(12);
  const [approach, held, padding, wet, rewind] = report.captures;
  for (const capture of report.captures) {
    expect(capture.error).toBe(0);
    expect(capture.calls).toBeGreaterThan(5);
    expect(capture.calls).toBeLessThan(180);
    expect(capture.triangles).toBeLessThan(160000);
    expect(capture.resources).toEqual(approach.resources);
  }
  expect(held.hash).toBe(approach.hash);
  expect(rewind.hash).toBe(approach.hash);
  expect(padding.hash).not.toBe(approach.hash);
  expect(wet.hash).not.toBe(padding.hash);
  expect(errors).toEqual([]);
});
