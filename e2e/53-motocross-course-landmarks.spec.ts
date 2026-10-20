import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { captureMxCourseIdentities } from './fixtures/motocross-course-landmarks.ts';

async function loadCourseReview(page: Page) {
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
}

test('Production MX course components render with surveyed jump-profile signs', async ({
  page,
}, info) => {
  test.setTimeout(360000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await loadCourseReview(page);
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

test('MX and SX braking lines render their shared physical relief and compiled wear cues', async ({
  page,
}, info) => {
  test.setTimeout(360000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await loadCourseReview(page);
  for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
    const captures = await page.evaluate(
      (circuit) =>
        (
          window as unknown as {
            MxCourseReview: { captureMxCourseIdentities: typeof captureMxCourseIdentities };
          }
        ).MxCourseReview.captureMxCourseIdentities(circuit, 'braking-lines'),
      circuit,
    );
    expect(captures.map((capture) => capture.label)).toEqual(
      circuit === 'valley-ridge-mx' ? ['quarry-entry', 'sky-berm-entry'] : ['stage-turn-entry'],
    );
    for (const capture of captures) {
      const name = `${circuit}-${capture.label}`,
        image = Buffer.from(capture.image.split(',')[1], 'base64'),
        imagePath = info.outputPath(`${name}.png`),
        metricsPath = info.outputPath(`${name}.json`);
      // Preserve actual frames and diagnostics before any GPU-dependent
      // assertion, so a failed compile or blank render is inspectable.
      await writeFile(imagePath, image);
      await writeFile(
        metricsPath,
        JSON.stringify(capture, (key, value) => (key === 'image' ? undefined : value), 2),
      );
      await info.attach(`${name}.png`, { path: imagePath, contentType: 'image/png' });
      await info.attach(`${name}.json`, { path: metricsPath, contentType: 'application/json' });
      expect(capture.glError).toBe(0);
      expect(capture.brakingShaderCompiled).toBe(true);
      expect(capture.terrainUnchanged).toBe(true);
      expect(capture.soilScans.failed).toEqual([]);
      expect(capture.brakingField).not.toBeNull();
      const field = capture.brakingField!;
      expect(field.finite).toBe(true);
      expect(field.workedVertices).toBeGreaterThan(150);
      expect(field.vertices).toBeGreaterThan(field.workedVertices * 10);
      expect(field.maxVertexHeightErrorM).toBeLessThan(0.0001);
      expect(field.maxFootprintError).toBeLessThan(0.0001);
      expect(field.maxRaisedSoilError).toBeLessThan(0.0001);
      expect(field.maxMeshInterpolationErrorM).toBeLessThan(0.02);
      expect(capture.image).toMatch(/^data:image\/png;base64,/);
      expect(image.byteLength).toBeGreaterThan(10000);
      expect(capture.pixels).not.toBeNull();
      expect(capture.pixels!.distinctColors).toBeGreaterThan(20);
      expect(capture.pixels!.luminanceRange).toBeGreaterThan(20);
      expect(capture.calls).toBeGreaterThan(0);
      expect(capture.triangles).toBeGreaterThan(0);
    }
  }
  expect(errors).toEqual([]);
});
