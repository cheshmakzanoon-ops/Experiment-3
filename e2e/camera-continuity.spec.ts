import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { cameraContinuity } from './fixtures/camera-continuity.ts';

test('cockpit remains framed after slow turns and camera diagnostics commit with the listener', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 480, height: 300 });
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve('e2e/fixtures/camera-continuity.ts'),
        name: 'CameraOracle',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Missing camera fixture');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing camera fixture entry');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setContent('<!doctype html><title>Slow rendered camera acceptance</title>');
  await page.addScriptTag({ content: chunk.code });
  const measured = await page.evaluate(() =>
    (
      window as unknown as { CameraOracle: { cameraContinuity: typeof cameraContinuity } }
    ).CameraOracle.cameraContinuity(),
  );
  const { image, ...metrics } = measured;
  await info.attach('camera-cockpit.png', {
    body: Buffer.from(image.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
  await info.attach('camera-continuity.json', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
  expect(measured.laps).toBeGreaterThanOrEqual(1);
  expect(measured.observations.length).toBeGreaterThan(30);
  for (const observation of measured.observations) {
    expect(observation.screen).toBe(true);
    expect(Math.abs(observation.projection[0])).toBeLessThan(1);
    expect(Math.abs(observation.projection[1])).toBeLessThan(1);
    expect(Math.abs(observation.localEye[0])).toBeLessThan(0.06);
    expect(observation.localEye[1]).toBeGreaterThan(0.35);
    expect(observation.localEye[1]).toBeLessThan(0.48);
  }
  expect(measured.afterPause.position).toEqual(measured.beforePause.position);
  expect(measured.afterPause.rotation).toEqual(measured.beforePause.rotation);
  expect(measured.afterPause.time).toBe(measured.beforePause.time);
  expect(measured.settledAgain).toEqual(measured.settled);
  expect(measured.pending).toEqual({ camera: 'cockpit', requested: 'trackside', interior: true });
  expect(measured.committed).toEqual({
    camera: 'trackside',
    requested: 'trackside',
    interior: false,
    velocity: [0, 0, 0],
  });
  expect(errors).toEqual([]);
});
