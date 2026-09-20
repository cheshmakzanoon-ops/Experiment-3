import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { verifyMotionGPU } from './fixtures/motion.ts';

test('real GPU motion vectors follow object movement and preserve a co-moving cockpit', async ({ page }, info) => {
  test.setTimeout(60000);
  // A separate test bundle avoids exposing private mutation/test APIs in the app.
  const result = await build({ configFile: false, logLevel: 'error', build: {
    write: false, minify: false, lib: { entry: resolve('e2e/fixtures/motion.ts'), name: 'APEXMotionTest', formats: ['iife'] },
  } });
  const output = (Array.isArray(result) ? result[0] : result);
  if (!('output' in output)) throw new Error('Missing in-memory shader fixture bundle');
  const chunk = output.output.find((value) => value.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing shader fixture entry');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setContent('<!doctype html><title>Isolated GPU oracle</title>');
  await page.addScriptTag({ content: chunk.code });
  const measured = await page.evaluate(() =>
    (window as unknown as { APEXMotionTest: { verifyMotionGPU: typeof verifyMotionGPU } }).APEXMotionTest.verifyMotionGPU());
  expect(measured.first[0]).toBeCloseTo(0, 4);
  expect(measured.moving[0]).toBeCloseTo(0.5 * Math.sqrt(3) * 0.3 / 5, 3);
  expect(measured.moving[2]).toBeCloseTo(5, 2);
  expect(measured.moving[3]).toBe(1);
  expect(measured.changedPixels).toBeGreaterThan(100);
  for (const vector of [measured.stopped, measured.coMoving, measured.cut]) {
    expect(vector[0]).toBeCloseTo(0, 4); expect(vector[1]).toBeCloseTo(0, 4);
  }
  expect(measured.diagnostics.velocityFrames).toBe(5);
  expect(errors).toEqual([]);
  await info.attach('measured-gpu-motion.json', { body: JSON.stringify(measured), contentType: 'application/json' });
});
