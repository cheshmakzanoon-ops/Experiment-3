import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type * as Fixture from './fixtures/terrain-morph-contract.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

test('Festival native geomorph agrees across material, normal, depth and far-shadow passes', async ({
  page,
}, info) => {
  const built = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/terrain-morph-contract.ts'),
        name: 'TerrainMorphContract',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing terrain contract fixture output');
  const script = result.output.find((file) => file.type === 'chunk');
  if (!script || script.type !== 'chunk')
    throw new Error('Missing terrain contract fixture script');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<!doctype html><title>Festival terrain geomorph GPU contract</title>');
  await page.addScriptTag({ content: script.code });
  const report = await page.evaluate(() =>
    (window as unknown as { TerrainMorphContract: typeof Fixture }).TerrainMorphContract.capture(),
  );
  const { images, ...diagnostics } = report;
  await info.attach('terrain-morph-contract.json', {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: 'application/json',
  });
  for (const [name, image] of Object.entries(images))
    await info.attach(`terrain-${name}.png`, {
      body: Buffer.from(image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  expect(errors).toEqual([]);
  expect(report.glErrors).toEqual([]);
  expect(report.contextAlive).toBe(true);
  expect(report.finite).toBe(true);
  expect(report.stages.map((stage) => stage.name)).toEqual([
    'parent',
    'quarter',
    'midpoint',
    'reverse',
    'fine',
    'coarsened',
  ]);
  expect(report.stages.map((stage) => stage.drawn)).toEqual([1, 4, 4, 4, 4, 1]);
  expect(report.stages[1].influence).toBeCloseTo(0.75, 8);
  expect(report.midpointInfluence).toBeCloseTo(0.5, 8);
  expect(report.stages[3].influence).toBeCloseTo(0.75, 8);
  expect(report.stages[4].influence).toBeCloseTo(0, 8);
  for (const stage of report.stages) {
    expect(stage.resident, stage.name).toBeLessThanOrEqual(5);
    expect(stage.materialError.mean, stage.name).toBeLessThan(0.001);
    expect(stage.materialError.maximum, stage.name).toBeLessThan(0.025);
    expect(stage.normalError.maximum, stage.name).toBeLessThan(0.001);
    expect(stage.depthError.maximum, stage.name).toBeLessThan(0.000002);
    expect(stage.depthError.covered, stage.name).toBe(report.width * report.height);
    expect(stage.depthError.coverageMismatch, stage.name).toBe(0);
    expect(stage.silhouetteError.mean, stage.name).toBeLessThan(0.000002);
    expect(stage.silhouetteError.coverageMismatch, stage.name).toBeLessThanOrEqual(2);
    expect(stage.shadowError.mean, stage.name).toBeLessThan(0.000002);
    expect(stage.shadowError.coverageMismatch, stage.name).toBeLessThanOrEqual(2);
    expect(stage.shadowError.covered, stage.name).toBeGreaterThan(2000);
    expect(stage.coverage.holes, stage.name).toBe(0);
    expect(stage.coverage.overlaps, stage.name).toBe(0);
    expect(stage.coverage.maximumError, stage.name).toBeLessThan(0.00001);
  }
  // Negative controls must fail materially. A blank image, unused masks,
  // unchanging height, or disabled morph normals cannot satisfy this contract.
  expect(report.negativeControls.height.mean).toBeGreaterThan(0.001);
  expect(report.negativeControls.normal.mean).toBeGreaterThan(0.005);
  expect(report.negativeControls.mask.mean).toBeGreaterThan(0.005);
  expect(report.negativeControls.missingChild.holes).toBeGreaterThan(3000);
  expect(report.negativeControls.duplicateParent.overlaps).toBe(report.width * report.height);
  expect(report.held.error.maximum).toBe(0);
  expect(report.held.influence).toBeCloseTo(0.5, 8);
  expect(report.held.revisionUnchanged).toBe(true);
  expect(report.contact.readyHeld).toBe(false);
  expect(report.contact.readyAfterTick).toBe(true);
  expect(report.contact.contactVertices).toBeGreaterThan(0);
  expect(report.contact.contactHeightError).toBe(0);
  expect(report.contact.treeHeightError).toBe(0);
  expect(report.contact.depthError.maximum).toBeLessThan(0.000002);
  expect(report.contact.depthError.covered).toBe(report.width * report.height);
  expect(report.contact.coverage.holes).toBe(0);
  expect(report.contact.coverage.overlaps).toBe(0);
  expect(report.contact.resident).toBeLessThanOrEqual(29);
  expect(report.contact.morphBytes).toBeGreaterThan(0);
  for (const cleanup of report.cleanups) {
    expect(cleanup.geometriesDisposed).toBe(cleanup.geometries);
    expect(cleanup.materialDisposals).toBe(1);
    expect(cleanup.listenersRemoved).toBe(1);
    expect(cleanup.children).toBe(0);
    expect(cleanup.resident).toBe(0);
    expect(cleanup.totalRequests).toBeGreaterThan(0);
    expect(cleanup.retainedTotalRequests).toBe(cleanup.totalRequests);
    expect(cleanup.pendingRequests).toBe(0);
    expect(cleanup.morphBytes).toBe(0);
  }
});
