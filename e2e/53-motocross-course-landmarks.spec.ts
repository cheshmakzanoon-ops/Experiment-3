import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { captureMxCourseIdentities } from './fixtures/motocross-course-landmarks.ts';

test('Production MX course components render with surveyed jump-profile signs', async ({
  page,
}, info) => {
  test.setTimeout(360000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/motocross-course-landmarks.ts'),
        name: 'MxCourseReview',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing MX course review bundle');
  const script = output.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing MX course review code');
  await page.route('**/motocross-course-identities.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>MX course identity component review</title>',
    }),
  );
  await page.goto('/motocross-course-identities.html');
  await page.addScriptTag({ content: script.code });
  for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
    const captures = await page.evaluate(
      (circuit) =>
        (
          window as unknown as {
            MxCourseReview: { captureMxCourseIdentities: typeof captureMxCourseIdentities };
          }
        ).MxCourseReview.captureMxCourseIdentities(circuit),
      circuit,
    );
    expect(captures.length).toBe(circuit === 'valley-ridge-mx' ? 4 : 1);
    for (const capture of captures) {
      const name = `${circuit}-${capture.label}`,
        imagePath = info.outputPath(`${name}.png`),
        metricsPath = info.outputPath(`${name}.json`);
      await writeFile(imagePath, Buffer.from(capture.image.split(',')[1], 'base64'));
      await writeFile(
        metricsPath,
        JSON.stringify(capture, (key, value) => (key === 'image' ? undefined : value), 2),
      );
      await info.attach(`${name}.png`, { path: imagePath, contentType: 'image/png' });
      await info.attach(`${name}.json`, { path: metricsPath, contentType: 'application/json' });
      expect(capture.glError).toBe(0);
      expect(capture.budget.draws).toBeLessThanOrEqual(16);
      expect(capture.budget.triangles).toBeLessThanOrEqual(42000);
      expect(capture.soilScans.failed).toEqual([]);
      expect(capture.guides.length).toBeGreaterThanOrEqual(2);
    }
  }
  expect(errors).toEqual([]);
});
