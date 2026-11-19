import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type * as Fixture from './fixtures/road-bike-presentation.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

test('active road-bike snapshots render supported, airborne and landed poses with measured grounding', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const built = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/road-bike-presentation.ts'),
        name: 'RoadBikePresentation',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing road-bike fixture output');
  const script = result.output.find((file) => file.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing road-bike fixture script');
  await page.setContent('<!doctype html><title>Active road-bike WebGL pose contract</title>');
  await page.addScriptTag({ content: script.code });
  const report = await page.evaluate(() =>
    (window as unknown as { RoadBikePresentation: typeof Fixture }).RoadBikePresentation.capture(),
  );
  const { images, ...diagnostics } = report;
  await info.attach('road-bike-presentation.json', {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: 'application/json',
  });
  for (const [name, image] of Object.entries(images))
    await info.attach(`road-bike-${name}.png`, {
      body: Buffer.from(image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  expect(report.webgl2).toBe(true);
  expect(report.contextAlive).toBe(true);
  expect(report.shaderErrors).toEqual([]);
  expect(report.glErrors).toEqual([]);
  expect(errors).toEqual([]);
  expect(report.protocol).toBe(17);
  expect(report.observations.map((stage) => stage.name)).toEqual([
    'supported',
    'airborne',
    'landed',
  ]);
  for (const stage of report.observations) {
    expect(stage.marked).toBe(true);
    expect(stage.finite).toBe(true);
    expect(stage.meshes).toBeGreaterThan(100);
    expect(stage.calls).toBeGreaterThan(100);
    expect(stage.triangles).toBeGreaterThan(10000);
    expect(stage.sprungPositionError).toBeLessThan(1e-6);
    expect(stage.sprungRotationError).toBeLessThan(1e-6);
    expect(stage.tyres.map((tyre) => tyre.wheel)).toEqual([0, 2]);
    for (const tyre of stage.tyres) {
      expect(tyre.vertices).toBeGreaterThan(100);
      expect(tyre.clearance).toBeGreaterThanOrEqual(tyre.expected - 0.0001);
      expect(tyre.clearance).toBeLessThan(tyre.expected + 0.004);
    }
  }
  const [supported, airborne, landed] = report.observations;
  expect(supported.contactWeights).toEqual([1, 1]);
  expect(airborne.contactWeights).toEqual([0, 0]);
  expect(landed.contactWeights.some((weight) => weight === 1)).toBe(true);
  for (const tyre of airborne.tyres) expect(tyre.expected).toBeGreaterThan(0.1);
  for (const darkness of supported.tyreDarkness) expect(darkness).toBeGreaterThan(5);
  expect(airborne.tyreDarkness).toEqual([0, 0]);
  for (const key of ['flight', 'landing', 'legacy'] as const) {
    expect(report.differences[key].changedPixels).toBeGreaterThan(100);
    expect(report.differences[key].maxChannelDelta).toBeGreaterThan(10);
  }
  for (const key of ['held', 'rewind', 'restored'] as const)
    expect(report.differences[key]).toEqual({
      maxChannelDelta: 0,
      changedPixels: 0,
      coverageDifferences: 0,
    });
  expect(report.legacyControl.marked).toBe(false);
  expect(report.legacyControl.sprungPositionError).toBeGreaterThan(0.001);
});
