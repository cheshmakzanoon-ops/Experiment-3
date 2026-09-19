import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureCircuitSurvey } from './fixtures/circuit-survey.ts';

for (const weather of ['clear', 'rain'] as const) {
  test(`circuit survey: ${weather} architecture, catch fence and kerb`, async ({ page }, info) => {
    test.setTimeout(300000);
    const built = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/circuit-survey.ts'),
          name: 'CircuitSurvey',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(built) ? built[0] : built;
    if (!('output' in output)) throw new Error('Missing survey bundle');
    const code = output.output.find((x) => x.type === 'chunk');
    if (!code || code.type !== 'chunk') throw new Error('Missing survey script');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setContent('<!doctype html><title>Original circuit material survey</title>');
    await page.addScriptTag({ content: code.code });
    const result = await page.evaluate(
      (weather) =>
        (
          window as unknown as {
            CircuitSurvey: { captureCircuitSurvey: typeof captureCircuitSurvey };
          }
        ).CircuitSurvey.captureCircuitSurvey(weather),
      weather,
    );
    for (const image of result.images)
      await info.attach(`${weather}-${image.view}.png`, {
        body: Buffer.from(image.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    await info.attach('circuit-survey.json', {
      body: JSON.stringify(
        {
          ...result,
          images: result.images.map(({ image: _image, ...metadata }) => metadata),
          errors,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
    expect(result.glError).toBe(0);
    expect(result.sourceUnchanged).toBe(true);
    expect(result.waterUnchanged).toBe(true);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.before).toEqual(result.after);
    expect(result.images).toHaveLength(3);
    for (const image of result.images) {
      expect(image.calls, image.view).toBeGreaterThan(10);
      expect(image.triangles, image.view).toBeGreaterThan(10000);
      expect(image.image.length, image.view).toBeGreaterThan(50000);
    }
  });
}
