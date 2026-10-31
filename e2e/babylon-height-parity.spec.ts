import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type {
  babylonControlledHeightParity,
  babylonOriginalHeightParity,
} from './fixtures/babylon-height-parity.ts';

type Probe = {
  babylonControlledHeightParity: typeof babylonControlledHeightParity;
  babylonOriginalHeightParity: typeof babylonOriginalHeightParity;
};
async function install(page: import('@playwright/test').Page) {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/babylon-height-parity.ts'),
        name: 'BabylonHeightProbe',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in result)) throw new Error('Missing height fixture');
  const chunk = result.output.find((output) => output.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing height fixture code');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/babylon-height-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Scalar height parity evidence</title>',
    }),
  );
  await page.goto('/babylon-height-fixture');
  await page.addScriptTag({ content: chunk.code });
  return errors;
}
async function attachReport(
  info: import('@playwright/test').TestInfo,
  name: string,
  report: unknown,
) {
  await info.attach(`${name}.json`, {
    body: JSON.stringify(report, (key, value) => (/image$/i.test(key) ? undefined : value), 2),
    contentType: 'application/json',
  });
}
async function attachImage(info: import('@playwright/test').TestInfo, name: string, data: string) {
  await info.attach(`${name}.png`, {
    body: Buffer.from(data.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
}

test('scalar height plugin matches pinned Three view-space bump normals and leaves a true-normal control unchanged', async ({
  page,
}, info) => {
  const errors = await install(page);
  const report = await page.evaluate(() =>
    (
      window as unknown as { BabylonHeightProbe: Probe }
    ).BabylonHeightProbe.babylonControlledHeightParity(),
  );
  await attachReport(info, 'controlled-height-normals', report);
  for (const row of report.rows) {
    await attachImage(info, `${row.name}-babylon`, row.babylonImage);
    await attachImage(info, `${row.name}-three-r180`, row.threeImage);
    await attachImage(info, `${row.name}-raw-tangent-interpretation`, row.rawImage);
  }
  expect(report.failure).toBeNull();
  expect(report.shaders?.effects.length).toBeGreaterThan(0);
  for (const effect of report.shaders?.effects ?? []) {
    expect(effect.error).toBe('');
    expect(effect.samplerCount).toBeLessThanOrEqual(report.shaders!.maxFragmentSamplers);
  }
  expect(errors).toEqual([]);
  expect(report.threeShaderErrors).toEqual([]);
  expect(report.threeRevision).toBe('180');
  expect(report.normalSpace).toBe('view');
  expect(report.rows.map((row) => row.name)).toEqual([
    'carbon-source-scale',
    'tyre-source-scale',
    'diagnostic-front',
    'diagnostic-uv-nonuniform',
    'diagnostic-backface',
    'true-normal-control',
  ]);
  for (const row of report.rows) {
    expect(row.glError, row.name).toBe(0);
    expect(row.completedFrames, row.name).toBeGreaterThanOrEqual(2);
    expect(row.comparedPixels, row.name).toBeGreaterThan(4000);
    // Two RGB8 steps allow independent raster/float quantization, not lighting
    // mismatch. No percentile exclusions: the worst interior sample is gated.
    expect(row.maxChannelError, row.name).toBeLessThanOrEqual(2);
    expect(row.meanChannelError, row.name).toBeLessThanOrEqual(0.5);
    if (row.name.startsWith('diagnostic-'))
      expect(row.diagnosticSignalChannels, row.name).toBeGreaterThan(100);
    if (row.name === 'true-normal-control') expect(row.changedFromRaw).toBe(0);
    else expect(row.changedFromRaw, row.name).toBeGreaterThan(1000);
  }
});

test('original full-detail Babylon scalar-height A/B preserves source resources, pose and true-normal controls', async ({
  page,
}, info) => {
  const errors = await install(page);
  const report = await page.evaluate(() =>
    (
      window as unknown as { BabylonHeightProbe: Probe }
    ).BabylonHeightProbe.babylonOriginalHeightParity(),
  );
  await attachReport(info, 'original-height-ab', report);
  for (const [i, row] of report.rows.entries())
    await attachImage(
      info,
      `${i}-${row.view}-${row.enabled ? 'scalar-height' : 'raw-normal'}`,
      row.image,
    );
  expect(report.failure).toBeNull();
  expect(report.shaders?.effects.length).toBeGreaterThan(0);
  for (const effect of report.shaders?.effects ?? []) {
    expect(effect.error).toBe('');
    expect(effect.samplerCount).toBeLessThanOrEqual(report.shaders!.maxFragmentSamplers);
  }
  expect(errors).toEqual([]);
  expect(report.productionActivated).toBe(false);
  expect(report.sourceSHA256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.compiled).toBe(172);
  expect(report.retained).toEqual({
    primitives: 172,
    meshes: 173,
    geometries: 172,
    materials: 101,
    textures: 82,
    bones: 59,
    triangles: 1455118,
  });
  expect(report.selected.map((row) => row.material)).toEqual([
    74, 81, 82, 83, 86, 91, 92, 93, 94, 99,
  ]);
  expect(report.selected.map((row) => row.image)).toEqual([49, 49, 49, 49, 49, 49, 49, 49, 51, 51]);
  expect(report.selected.map((row) => row.scale)).toEqual([
    0.00015, 0.00015, 0.00015, 0.00015, 0.00015, 0.00015, 0.00015, 0.00015, 0.0004, 0.0004,
  ]);
  expect(report.selected.every((row) => row.linearSampling)).toBe(true);
  expect(report.rows).toHaveLength(9);
  for (const row of report.rows) {
    expect(row.glError).toBe(0);
    expect(row.completedFrames).toBeGreaterThanOrEqual(2);
    expect(row.matchingResources).toBe(true);
    expect(row.unchangedPose).toBe(true);
    expect(row.trueNormalControls).toBe(true);
    expect(row.visiblePixels).toBeGreaterThan(1000);
    expect(row.activeIndices).toBeGreaterThan(0);
    if (row.enabled) expect(row.differentChannels).toBeGreaterThan(100);
    else expect(row.differentChannels).toBe(0);
  }
  expect(report.graphics).toMatchObject({ lost: false, losses: 0 });
});
