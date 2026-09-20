import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { verifyWheelFidelity } from './fixtures/wheel-fidelity.ts';

test('actual wheel geometry follows recorded alignment without deforming rigid parts at any LOD', async ({
  page,
}, info) => {
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve('e2e/fixtures/wheel-fidelity.ts'),
        name: 'WheelOracle',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Missing wheel fixture');
  const chunk = output.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing wheel fixture entry');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setContent('<!doctype html><title>Wheel geometry validation</title>');
  await page.addScriptTag({ content: chunk.code });
  const resultData = await page.evaluate(() =>
    (
      window as unknown as { WheelOracle: { verifyWheelFidelity: typeof verifyWheelFidelity } }
    ).WheelOracle.verifyWheelFidelity(),
  );
  const { loadedImage, puncturedImage, carImage, ...measured } = resultData;
  for (const [name, image] of [
    ['loaded-tire.png', loadedImage],
    ['punctured-tire.png', puncturedImage],
    ['recorded-wheel-alignment.png', carImage],
  ])
    await info.attach(name, {
      body: Buffer.from(image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('wheel-fidelity.json', {
    body: JSON.stringify(measured, null, 2),
    contentType: 'application/json',
  });
  expect(measured.rigidUnchanged).toBe(true);
  expect(measured.sourcesUnchanged).toBe(true);
  expect(measured.high).toHaveLength(4);
  for (const wheel of measured.high) {
    expect(wheel.steer).toBeCloseTo(wheel.expectedSteer, 7);
    expect(wheel.camber).toBeCloseTo(wheel.expectedCamber, 7);
    expect(wheel.scale).toEqual([1, 1, 1]);
  }
  for (const [index, lod] of measured.lods.entries()) {
    expect(lod.level).toBe(index + 1);
    expect(lod.wheels).toHaveLength(4);
    for (const [i, wheel] of lod.wheels.entries()) {
      expect(wheel.steer).toBeCloseTo(measured.high[i].expectedSteer, 7);
      expect(wheel.camber).toBeCloseTo(measured.high[i].expectedCamber, 7);
      expect(wheel.scale).toEqual([1, 1, 1]);
    }
  }
  expect(measured.loadChangedPixels).toBeGreaterThan(100);
  expect(measured.punctureChangedPixels).toBeGreaterThan(1000);
  expect(measured.memoryAfter).toBe(measured.memoryBefore);
  expect(Number.isFinite(measured.updateMsP95)).toBe(true);
  expect(errors).toEqual([]);
});
