import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type {
  babylonControlledPaintParity,
  babylonFullFormulaScenes,
  babylonFormulaSurfaceVisibility,
} from './fixtures/babylon-surface-parity.ts';
import type { babylonControlledAsphaltParity } from './fixtures/babylon-asphalt-parity.ts';

type Probe = {
  babylonFullFormulaScenes: typeof babylonFullFormulaScenes;
  babylonControlledPaintParity: typeof babylonControlledPaintParity;
  babylonFormulaSurfaceVisibility: typeof babylonFormulaSurfaceVisibility;
  babylonControlledAsphaltParity: typeof babylonControlledAsphaltParity;
};
async function install(page: import('@playwright/test').Page, asphalt = false) {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve(
          asphalt
            ? 'e2e/fixtures/babylon-asphalt-parity.ts'
            : 'e2e/fixtures/babylon-surface-parity.ts',
        ),
        name: 'BabylonSurfaceProbe',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in result)) throw new Error('Missing surface fixture');
  const chunk = result.output.find((output) => output.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing surface fixture code');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/babylon-surface-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Isolated Formula surface evidence — not live gameplay</title>',
    }),
  );
  await page.goto('/babylon-surface-fixture');
  await page.addScriptTag({ content: chunk.code });
  return errors;
}
async function report(info: import('@playwright/test').TestInfo, name: string, value: unknown) {
  await info.attach(`${name}.json`, {
    body: JSON.stringify(value, (key, value) => (/image$/i.test(key) ? undefined : value), 2),
    contentType: 'application/json',
  });
}
async function image(info: import('@playwright/test').TestInfo, name: string, data: string) {
  await info.attach(`${name}.png`, {
    body: Buffer.from(data.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
}

test('isolated asphalt substrate matches qualified actual original factors and normals', async ({
  page,
}, info) => {
  const errors = await install(page, true);
  const result = await page.evaluate(() =>
    (
      window as unknown as { BabylonSurfaceProbe: Probe }
    ).BabylonSurfaceProbe.babylonControlledAsphaltParity(),
  );
  await report(info, 'controlled-original-asphalt-substrate', result);
  for (const row of result.referenceRows)
    await image(info, `${row.name}-${row.output}-original-three`, row.image);
  for (const row of result.controls)
    await image(info, `${row.name}-${row.output}-negative-control`, row.image);
  for (const row of result.rows)
    await image(info, `${row.name}-${row.output}-isolated-babylon`, row.image);
  expect(result.failure).toBeNull();
  expect(errors).toEqual([]);
  expect(result.threeShaderErrors).toEqual([]);
  expect(result.threeRevision).toBe('180');
  expect(result.productionActivated).toBe(false);
  expect(result.sourceBoundary).toBe("surfaceMaterial('asphalt', undefined, false)");
  expect(result.referenceQualified).toBe(true);
  expect(result.candidateConstructed).toBe(true);
  expect(result.phases).toEqual([
    'original-reference',
    'original-negative-controls',
    'reference-qualified',
    'candidate',
    'disposed',
  ]);
  expect(result.referenceRows).toHaveLength(15);
  expect(result.rows.map((row) => `${row.name}/${row.output}`)).toEqual(
    result.referenceRows.map((row) => `${row.name}/${row.output}`),
  );
  expect(result.controls.map((row) => row.name)).toEqual([
    'wrong-gamma',
    'wrong-packed-channel',
    'flipped-normal',
    'omitted-meso-tone',
  ]);
  expect(result.limits).toEqual({
    referenceMax: 0,
    referenceMean: 0,
    candidateMax: 1,
    candidateMean: 0.1,
    negativeMinChangedPixels: 100,
    negativeMinMaxError: 3,
    minInteriorPixels: 1000,
  });
  for (const row of result.referenceRows) {
    const name = `${row.name}/${row.output}`;
    expect(row.glError, name).toBe(0);
    expect(row.completedFrames, name).toBeGreaterThanOrEqual(2);
    expect(row.repeatCompletedFrames, name).toBeGreaterThanOrEqual(2);
    expect(row.metrics.comparedPixels, name).toBeGreaterThanOrEqual(
      result.limits.minInteriorPixels,
    );
    expect(row.metrics.maxChannelError, name).toBe(result.limits.referenceMax);
    expect(row.metrics.meanChannelError, name).toBe(result.limits.referenceMean);
    expect(row.metrics.alphaMismatchPixels, name).toBe(0);
  }
  for (const row of result.controls) {
    expect(row.glError, row.name).toBe(0);
    expect(row.completedFrames, row.name).toBeGreaterThanOrEqual(2);
    expect(row.metrics.comparedPixels, row.name).toBeGreaterThanOrEqual(
      result.limits.minInteriorPixels,
    );
    expect(row.metrics.changedPixels, row.name).toBeGreaterThanOrEqual(
      result.limits.negativeMinChangedPixels,
    );
    expect(row.metrics.maxChannelError, row.name).toBeGreaterThanOrEqual(
      result.limits.negativeMinMaxError,
    );
    expect(row.metrics.missingInteriorPixels, row.name).toBe(0);
    expect(row.metrics.excessCoveragePixels, row.name).toBe(0);
  }
  for (const row of result.rows) {
    const name = `${row.name}/${row.output}`;
    expect(row.glError, name).toBe(0);
    expect(row.completedFrames, name).toBeGreaterThanOrEqual(2);
    expect(row.metrics.comparedPixels, name).toBeGreaterThanOrEqual(
      result.limits.minInteriorPixels,
    );
    expect(row.metrics.maxChannelError, name).toBeLessThanOrEqual(result.limits.candidateMax);
    expect(row.metrics.meanChannelError, name).toBeLessThanOrEqual(result.limits.candidateMean);
    expect(row.metrics.missingInteriorPixels, name).toBe(0);
    expect(row.metrics.excessCoveragePixels, name).toBe(0);
    expect(row.sharedMaterial, name).toBe(true);
    expect(row.retained.materials - result.baseline.materials, name).toBe(1);
    expect(row.retained.textures - result.baseline.textures, name).toBe(3);
    expect(row.retained.meshes - result.baseline.meshes, name).toBe(
      row.name === 'grazing-seam' ? 2 : 1,
    );
    expect(row.retained.geometries - result.baseline.geometries, name).toBe(
      row.name === 'grazing-seam' ? 2 : 1,
    );
    expect(row.samplers, name).toEqual(
      expect.arrayContaining(['albedoSampler', 'bumpSampler', 'asphaltSubstrateData']),
    );
  }
  // Actual WebGL allocation calls, not just the renderer's gamma metadata.
  expect(result.allocations).toEqual([
    { internalFormat: 35907, width: 512, height: 512, format: 6408, type: 5121, bytes: 1048576 },
    { internalFormat: 32856, width: 512, height: 512, format: 6408, type: 5121, bytes: 1048576 },
    { internalFormat: 32856, width: 512, height: 512, format: 6408, type: 5121, bytes: 1048576 },
  ]);
  expect(result.sampling).toEqual(
    ['albedo', 'data', 'normal'].map((name) => ({
      name,
      srgb: name === 'albedo',
      gammaSpace: false,
      repeat: [7.8125, 7.8125],
      anisotropy: 8,
      flipY: true,
      mipmaps: true,
      samplingMode: 3,
    })),
  );
  expect(result.shaders?.effects.length).toBeGreaterThan(0);
  for (const effect of result.shaders?.effects ?? []) {
    expect(effect.error).toBe('');
    expect(effect.samplerCount).toBeLessThanOrEqual(result.shaders!.maxFragmentSamplers);
  }
  expect(result.restored).toEqual(result.baseline);
  expect(result.repeatDisposeUnchanged).toBe(true);
  for (const gpu of Object.values(result.diagnostics)) {
    expect(gpu.losses).toBe(0);
    expect(gpu.submitted).toBe(gpu.completed);
    expect(gpu.preparation.failure).toBeNull();
  }
  expect(result.unported).toContain('PBR/environment parity');
  expect(result.unported).toContain('wet road/water film');
});

test('isolated paint finish matches original Three grit and wear before lighting', async ({
  page,
}, info) => {
  const errors = await install(page);
  const result = await page.evaluate(() =>
    (
      window as unknown as { BabylonSurfaceProbe: Probe }
    ).BabylonSurfaceProbe.babylonControlledPaintParity(),
  );
  await report(info, 'controlled-paint-factor', result);
  for (const row of result.rows) {
    await image(info, `${row.name}-babylon`, row.babylonImage);
    await image(info, `${row.name}-three-r180`, row.threeImage);
  }
  expect(result.failure).toBeNull();
  expect(errors).toEqual([]);
  expect(result.threeShaderErrors).toEqual([]);
  expect(result.threeRevision).toBe('180');
  expect(result.productionActivated).toBe(false);
  expect(result.rows.map((row) => row.name)).toEqual([
    'resolved',
    'banked-translated',
    'minified',
    'plain-control',
  ]);
  expect(result.shaders?.effects.length).toBeGreaterThan(0);
  for (const effect of result.shaders?.effects ?? []) {
    expect(effect.error).toBe('');
    expect(effect.samplerCount).toBeLessThanOrEqual(result.shaders!.maxFragmentSamplers);
  }
  for (const row of result.rows) {
    expect(row.babylonGlError, row.name).toBe(0);
    expect(row.threeGlError, row.name).toBe(0);
    expect(row.completedFrames, row.name).toBeGreaterThanOrEqual(2);
    expect(row.babylonCompletedFrames, row.name).toBeGreaterThanOrEqual(2);
    expect(row.comparedPixels, row.name).toBeGreaterThan(20000);
    // Worst interior channel is bounded, with no percentile/noise outlier exclusions.
    expect(row.maxChannelError, row.name).toBeLessThanOrEqual(2);
    expect(row.meanChannelError, row.name).toBeLessThanOrEqual(0.5);
    expect(row.paintShaderCode, row.name).toBe(row.name !== 'plain-control');
    if (row.name === 'plain-control') {
      expect(row.referenceMin).toBe(128);
      expect(row.referenceMax).toBe(128);
    } else if (row.name === 'minified') {
      expect(row.referenceMin).toBe(118);
      expect(row.referenceMax).toBe(118);
    } else expect(row.referenceMax - row.referenceMin, row.name).toBeGreaterThan(5);
  }
  expect(result.restored).toEqual(result.baseline);
  for (const gpu of Object.values(result.diagnostics)) {
    expect(gpu.losses).toBe(0);
    expect(gpu.submitted).toBe(gpu.completed);
    expect(gpu.preparation.failure).toBeNull();
  }
});

test('isolated Formula ribbons expose both authored paint sides at bank and seam views and dispose cleanly', async ({
  page,
}, info) => {
  const errors = await install(page);
  const result = await page.evaluate(() =>
    (
      window as unknown as { BabylonSurfaceProbe: Probe }
    ).BabylonSurfaceProbe.babylonFormulaSurfaceVisibility(),
  );
  await report(info, 'formula-surface-visibility', result);
  for (const row of result.rows) {
    await image(info, `${row.name}-lit`, row.image);
    await image(info, `${row.name}-material-id`, row.idImage);
  }
  expect(result.failure).toBeNull();
  expect(errors).toEqual([]);
  expect(result.productionActivated).toBe(false);
  expect(result.unported).toContain('scanned asphalt');
  expect(result.unported).toContain('road macro/detail and rubber wear');
  expect(result.unported).toContain('wet road/water film');
  expect(result.unported).toContain('PBR/environment parity');
  expect(result.unported).toContain('car grounding');
  expect(result.unported).toContain('light pools');
  expect(result.rows.map((row) => row.name)).toEqual([
    'aurel-straight-chunk-seam',
    'aurel-banked',
    'vellamar-width-changing',
    'aurel-grazing-lap-seam',
  ]);
  expect(result.shaders?.effects.length).toBeGreaterThan(0);
  for (const effect of result.shaders?.effects ?? []) {
    expect(effect.error).toBe('');
    expect(effect.samplerCount).toBeLessThanOrEqual(result.shaders!.maxFragmentSamplers);
  }
  for (const row of result.rows) {
    expect(row.roadChunks, row.name).toBe(Math.ceil((row.range.end - row.range.start) / 80));
    expect(row.paintChunks).toBe(row.roadChunks * 2);
    expect(row.roadPixels, row.name).toBeGreaterThan(10000);
    expect(row.paintPixels, row.name).toBeGreaterThan(100);
    // Authored side IDs, not screen halves. Counts do not prove seam continuity.
    expect(row.authoredLeftPaintPixels, row.name).toBeGreaterThan(20);
    expect(row.authoredRightPaintPixels, row.name).toBeGreaterThan(20);
    expect(row.litCompletedFrames, row.name).toBeGreaterThanOrEqual(2);
    expect(row.idCompletedFrames, row.name).toBeGreaterThanOrEqual(2);
    expect(row.postDisposeCompletedFrames, row.name).toBeGreaterThanOrEqual(2);
    expect(row.glError, row.name).toBe(0);
    expect(row.idGlError, row.name).toBe(0);
    expect(row.postDisposeGlError, row.name).toBe(0);
    expect(row.geometryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(row.geometryUnchanged).toBe(true);
    expect(row.shaderPaint).toBe(true);
    expect(row.shaderRoadPaint).toBe(false);
    expect(row.shaderRoadAsphalt).toBe(true);
    expect(row.shaderPaintAsphalt).toBe(false);
    expect(row.retained.meshes - row.baseline.meshes).toBe(row.roadChunks + row.paintChunks);
    expect(row.retained.geometries - row.baseline.geometries).toBe(
      row.roadChunks + row.paintChunks,
    );
    expect(row.retained.materials - row.baseline.materials).toBe(2);
    expect(row.retained.textures - row.baseline.textures).toBe(3);
    expect(row.restored, row.name).toEqual(row.baseline);
    expect(row.repeatDisposeUnchanged).toBe(true);
    expect(row.allMeshesDisposed).toBe(true);
  }
  expect(result.diagnostics.losses).toBe(0);
  expect(result.diagnostics.submitted).toBe(result.diagnostics.completed);
  expect(result.diagnostics.preparation.failure).toBeNull();
});

test('full actual Formula scenes prepare and complete both canonical venue workloads', async ({
  page,
}, info) => {
  const errors = await install(page);
  const result = await page.evaluate(() =>
    (
      window as unknown as { BabylonSurfaceProbe: Probe }
    ).BabylonSurfaceProbe.babylonFullFormulaScenes(),
  );
  await report(info, 'full-live-formula-scenes', result);
  for (const row of result.rows) await image(info, `full-${row.circuit}-live-scene`, row.image);
  expect(result.failure).toBeNull();
  expect(errors).toEqual([]);
  expect(result.rows.map((row) => row.circuit)).toEqual(['aurel', 'vellamar']);
  for (const row of result.rows) {
    const road = row.circuit === 'aurel' ? 38 : 50;
    expect(row.surfaces).toMatchObject({
      kind: 'formula-ribbon',
      roadChunks: road,
      paintChunks: road * 2,
      leftPaintChunks: road,
      rightPaintChunks: road,
      coarseMeshes: 0,
      paintFinishMaterials: 1,
      asphaltSubstrateRoadChunks: road,
      asphaltSubstrateMaterials: 1,
      asphaltSubstrateTextures: 3,
      asphaltSubstrateSrgbTextures: 1,
    });
    expect(row.surfaces.vertices).toBe(row.circuit === 'aurel' ? 31882 : 42700);
    expect(row.preparationVariants).toBe(road * 3 + 1);
    expect(row.asphaltShaderChunks).toBe(road);
    expect(row.paintAsphaltShaderChunks).toBe(0);
    expect(row.resources).toEqual({
      meshes: road * 3 + 1,
      geometries: road * 3 + 1,
      materials: 3,
      textures: 4,
    });
    expect(row.completedFrames).toBeGreaterThanOrEqual(2);
    expect(row.glError).toBe(0);
    expect(row.disposeGlError).toBe(0);
    expect(row.restored).toEqual({ meshes: 0, geometries: 0, materials: 0, textures: 0 });
    expect(row.diagnostics.losses).toBe(0);
    expect(row.diagnostics.submitted).toBe(row.diagnostics.completed);
    expect(row.diagnostics.preparation.failure).toBeNull();
    for (const effect of row.shaders.effects) {
      expect(effect.error).toBe('');
      expect(effect.samplerCount).toBeLessThanOrEqual(row.shaders.maxFragmentSamplers);
    }
  }
});
