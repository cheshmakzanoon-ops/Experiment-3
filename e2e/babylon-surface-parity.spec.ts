import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type {
  babylonControlledPaintParity,
  babylonFullFormulaScenes,
  babylonFormulaSurfaceVisibility,
} from './fixtures/babylon-surface-parity.ts';
import type { babylonControlledGroundingParity } from './fixtures/babylon-grounding-parity.ts';
import type { babylonControlledAsphaltParity } from './fixtures/babylon-asphalt-parity.ts';

type Probe = {
  babylonControlledGroundingParity: typeof babylonControlledGroundingParity;
  babylonFullFormulaScenes: typeof babylonFullFormulaScenes;
  babylonControlledPaintParity: typeof babylonControlledPaintParity;
  babylonFormulaSurfaceVisibility: typeof babylonFormulaSurfaceVisibility;
  babylonControlledAsphaltParity: typeof babylonControlledAsphaltParity;
};
async function install(
  page: import('@playwright/test').Page,
  asphalt: boolean | 'grounding' = false,
) {
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve(
          asphalt === 'grounding'
            ? 'e2e/fixtures/babylon-grounding-parity.ts'
            : asphalt
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

for (const forceStandalone of [false, true]) {
  const transportMode = forceStandalone ? 'forced-standalone' : 'native-default';
  test(`full actual Formula scenes prepare and complete both canonical venue workloads [${transportMode}]`, async ({
    page,
  }, info) => {
    const errors = await install(page);
    const result = await page.evaluate(
      (forceStandalone) =>
        (
          window as unknown as { BabylonSurfaceProbe: Probe }
        ).BabylonSurfaceProbe.babylonFullFormulaScenes(forceStandalone),
      forceStandalone,
    );
    await report(info, `full-live-formula-scenes-${transportMode}`, result);
    expect(result.forceStandalone).toBe(forceStandalone);
    for (const row of result.rows) {
      await image(
        info,
        `full-${transportMode}-${row.transport}-${row.circuit}-live-scene`,
        row.image,
      );
      await image(
        info,
        `full-${transportMode}-${row.transport}-${row.circuit}-moved-grounding`,
        row.grounding.movedImage,
      );
    }
    expect(result.failure).toBeNull();
    expect(errors).toEqual([]);
    expect(result.rows.map((row) => row.circuit)).toEqual(['aurel', 'vellamar']);
    for (const row of result.rows) {
      expect(['ubo', 'standalone']).toContain(row.transport);
      if (forceStandalone) expect(row.transport).toBe('standalone');
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
        formulaGroundingRoadChunks: road,
        formulaGroundingPaintChunks: road * 2,
        formulaGroundingMaterials: 2,
        formulaGroundingCars: 1,
      });
      expect(row.surfaces.vertices).toBe(row.circuit === 'aurel' ? 31882 : 42700);
      expect(row.preparationVariants).toBe(road * 3 + 1);
      expect(row.asphaltShaderChunks).toBe(road);
      expect(row.paintAsphaltShaderChunks).toBe(0);
      expect(row.grounding.appliedRoadChunks).toBe(road);
      expect(row.grounding.appliedPaintChunks).toBe(road * 2);
      expect(row.grounding.effectsStable).toBe(true);
      expect(row.grounding.glErrorAfterMove).toBe(0);
      expect(row.grounding.resourcesStable).toBe(true);
      expect(row.grounding.geometryStable).toBe(true);
      expect(row.grounding.initial.completedFrames).toBeGreaterThanOrEqual(2);
      expect(
        row.grounding.moved.completedFrames - row.grounding.initial.completedFrames,
      ).toBeGreaterThanOrEqual(2);
      expect(row.grounding.moved.completedSequence).toBeGreaterThan(
        row.grounding.initial.completedSequence,
      );
      expect(row.grounding.moved.expected).not.toEqual(row.grounding.initial.expected);
      expect(row.grounding.moved.expected[0]).not.toBe(row.grounding.initial.expected[0]);
      expect(row.grounding.moved.expected[1]).not.toBe(row.grounding.initial.expected[1]);
      expect(row.grounding.moved.expected[2]).not.toBe(row.grounding.initial.expected[2]);
      for (const receipt of [row.grounding.initial, row.grounding.moved]) {
        expect(receipt.receivers.map((r) => r.surface).sort()).toEqual(['edge-paint', 'road']);
        for (const receiver of receipt.receivers) {
          expect(receiver.notifications).toBeGreaterThan(0);
          expect(receiver.count).toBe(1);
          expect(receiver.poses).toEqual([...receipt.expected, ...new Array(44).fill(0)]);
          expect(receiver.transport).toBe(row.transport);
          if (row.transport === 'ubo') {
            expect(receiver.poseStride).toBe(16);
            for (const value of [
              receiver.block,
              receiver.binding,
              receiver.countOffset,
              receiver.poseOffset,
            ]) {
              expect(value).not.toBeNull();
              expect(value).toBeGreaterThanOrEqual(0);
            }
            expect(receiver.byteLength).toBeGreaterThanOrEqual(12 * 16 + 4);
          } else {
            for (const value of [
              receiver.block,
              receiver.binding,
              receiver.byteLength,
              receiver.countOffset,
              receiver.poseOffset,
              receiver.poseStride,
            ])
              expect(value).toBeNull();
          }
          expect(receiver.poseSize).toBe(12);
          expect(receiver.countType).toBe(5124); // GL_INT, not a float reinterpretation.
          expect(receiver.poseType).toBe(35666); // GL_FLOAT_VEC4.
        }
      }
      for (const moved of row.grounding.moved.receivers)
        expect(moved.notifications).toBeGreaterThan(
          row.grounding.initial.receivers.find((r) => r.surface === moved.surface)!.notifications,
        );
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

  test(`isolated Formula grounding applies qualified original sky/sun attenuation to native road and paint terms [${transportMode}]`, async ({
    page,
  }, info) => {
    const errors = await install(page, 'grounding');
    const result = await page.evaluate(
      (forceStandalone) =>
        (
          window as unknown as { BabylonSurfaceProbe: Probe }
        ).BabylonSurfaceProbe.babylonControlledGroundingParity(forceStandalone),
      forceStandalone,
    );
    await report(
      info,
      `controlled-original-formula-grounding-${transportMode}-${result.transport}`,
      result,
    );
    expect(result.forceStandalone).toBe(forceStandalone);
    expect(['ubo', 'standalone']).toContain(result.transport);
    if (forceStandalone) expect(result.transport).toBe('standalone');
    for (const [i, row] of result.captures.entries())
      await image(
        info,
        `grounding-${transportMode}-${result.transport}-${i}-${row.renderer}-${row.layout}-${row.light}-${row.output}-${row.control}-${row.zero ? 'zero' : 'posed'}${row.repeat ? '-repeat' : ''}`,
        row.image,
      );
    expect(result.failure).toBeNull();
    expect(errors).toEqual([]);
    expect(result.threeShaderErrors).toEqual([]);
    expect(result.threeRevision).toBe('180');
    expect(result.productionActivated).toBe(false);
    expect(result.referenceQualified).toBe(true);
    expect(result.candidateConstructed).toBe(true);
    expect(result.phases).toEqual([
      'original-reference',
      'original-negative-controls',
      'reference-qualified',
      'candidate',
      'disposed',
    ]);
    expect(result.poseOracleSha256).toBe(
      '6156be159c6826b87dda551ee6dd0b564ff571a4fbd5695cb87a7d5b91fde7fe',
    );
    expect(result.limits).toEqual({
      referenceMax: 0,
      referenceMean: 0,
      candidateMax: 1,
      candidateMean: 0.1,
      nativeRange: 16,
      referenceClosureMaxUnits: 2,
      closureQuantizationAllowance: 2,
      negativeMinChangedPixels: 100,
      negativeMinMaxError: 3,
      minInteriorPixelsPerReceiver: 1000,
    });
    expect(result.captures).toHaveLength(145);
    expect(result.repeats).toHaveLength(45);
    expect(result.controls.map((c) => c.name)).toEqual([
      'omitted',
      'wrong-yaw',
      'wrong-height',
      'swapped-factors',
    ]);
    expect(result.comparisons).toHaveLength(6);
    expect(result.presence).toHaveLength(18);
    expect(result.nativeStats).toHaveLength(36);
    expect(result.closures).toHaveLength(12);
    expect(result.factors).toHaveLength(8);
    expect(result.coverage).toHaveLength(3);
    for (const row of result.captures) {
      const name = `${row.renderer}/${row.layout}/${row.light}/${row.output}`;
      expect(row.completedFrames, name).toBeGreaterThanOrEqual(2);
      expect(row.glError, name).toBe(0);
      if (row.output.startsWith('native-'))
        expect(Buffer.from(row.rgbaBase64!, 'base64').byteLength, name).toBe(256 * 256 * 4);
    }
    expect(result.zeroApplication).toHaveLength(2);
    for (const capture of [...result.repeats, ...result.factors, ...result.zeroApplication])
      for (const row of Object.values(capture.metrics)) {
        expect(row.comparedPixels).toBeGreaterThanOrEqual(1000);
        expect(row.maxChannelError).toBe(0);
        expect(row.meanChannelError).toBe(0);
        expect(row.missingPixels).toBe(0);
      }
    for (const control of result.controls)
      for (const row of Object.values(control.metrics)) {
        expect(row.comparedPixels, control.name).toBeGreaterThanOrEqual(1000);
        expect(row.changedPixels, control.name).toBeGreaterThanOrEqual(100);
        expect(row.maxChannelError, control.name).toBeGreaterThanOrEqual(3);
        expect(row.missingPixels).toBe(0);
      }
    for (const comparison of result.comparisons)
      for (const row of Object.values(comparison.metrics)) {
        expect(row.comparedPixels).toBeGreaterThanOrEqual(1000);
        expect(row.maxChannelError).toBeLessThanOrEqual(1);
        expect(row.meanChannelError).toBeLessThanOrEqual(0.1);
        expect(row.missingPixels).toBe(0);
      }
    for (const receipt of result.presence)
      for (const row of Object.values(receipt.metrics)) {
        expect(row.missingRequired).toBe(0);
        expect(row.unexpectedlyActive).toBe(0);
        expect(row.invalidNative).toBe(0);
        expect(row.pixels).toBeGreaterThanOrEqual(1000);
        for (let channel = 0; channel < 4; channel++)
          expect(row.absentBoth[channel]).toBe(
            receipt.requiredBits & (1 << channel) ? 0 : row.pixels,
          );
      }
    for (const receipt of result.nativeStats)
      for (const row of Object.values(receipt.metrics)) {
        const absent =
          receipt.renderer === 'three' &&
          receipt.light === 'sky' &&
          receipt.output === 'native-specular';
        if (absent) {
          expect(row.maxBeforeUnits).toBe(0);
          expect(row.maxAfterUnits).toBe(0);
        } else {
          expect(row.maxBeforeUnits).toBeGreaterThan(0);
          expect(row.maxAfterUnits).toBeGreaterThan(0);
        }
      }
    const originalMaximum = Math.max(
      ...result.closures
        .filter((c) => c.renderer === 'three')
        .flatMap((c) =>
          Object.values(c.metrics).flatMap((row) => [row.maxBeforeUnits, row.maxAfterUnits]),
        ),
    );
    expect(originalMaximum).toBeLessThanOrEqual(2);
    expect(result.closureBound).toBe(originalMaximum + 2);
    for (const closure of result.closures.filter((c) => c.renderer === 'babylon'))
      for (const row of Object.values(closure.metrics)) {
        expect(row.maxBeforeUnits).toBeLessThanOrEqual(result.closureBound!);
        expect(row.maxAfterUnits).toBeLessThanOrEqual(result.closureBound!);
      }
    for (const row of result.coverage)
      expect(row.metrics).toEqual({ missingInterior: 0, wrongReceiver: 0, excessCoverage: 0 });
    expect(result.displayUnchanged).toBe(true);
    expect(result.countCacheStable).toBe(true);
    expect(result.poseState).toEqual({ count: 0, poses: new Array(48).fill(0), valid: false });
    expect(result.baseline).toEqual({ meshes: 0, geometries: 0, materials: 0, textures: 1 });
    expect(result.retained).toEqual({ meshes: 2, geometries: 2, materials: 2, textures: 4 });
    expect(result.restored).toEqual(result.baseline);
    expect(result.repeatDisposeUnchanged).toBe(true);
    expect(result.pluginResourceDelta).toEqual({
      before: { meshes: 0, geometries: 0, materials: 2, textures: 4 },
      after: { meshes: 0, geometries: 0, materials: 2, textures: 4 },
    });
    // Disabling/re-enabling lights changes Babylon's active-light ordering.
    // The final mixed pass is sun/sky, unlike the initial sky/sun pass. Both
    // programs must be present for both receivers; count changes remain uniform-only.
    expect(result.nativeShaders).toHaveLength(8);
    const lightDefines = (defines: string) =>
      defines
        .split('\n')
        .filter((line) =>
          /^#define (?:LIGHT\d+|HEMILIGHT\d+|DIRLIGHT\d+|LIGHTCOUNT \d+)$/.test(line),
        )
        .join(';');
    const nonLightDefines = (defines: string) =>
      defines
        .split('\n')
        .filter(
          (line) => !/^#define (?:LIGHT\d+|HEMILIGHT\d+|DIRLIGHT\d+|LIGHTCOUNT \d+)$/.test(line),
        )
        .join('\n');
    for (const material of [
      'Original dry asphalt substrate — road-state/wet/scan layers unported',
      'original offwhite paint',
    ]) {
      const variants = result.nativeShaders.filter((shader) => shader.material === material);
      expect(new Set(variants.map((shader) => nonLightDefines(shader.defines))).size).toBe(1);
      expect(variants.map((shader) => lightDefines(shader.defines)).sort()).toEqual(
        [
          '#define LIGHT0;#define HEMILIGHT0;#define LIGHT1;#define DIRLIGHT1;#define LIGHTCOUNT 2',
          '#define LIGHT0;#define HEMILIGHT0;#define LIGHTCOUNT 1',
          '#define LIGHT0;#define DIRLIGHT0;#define LIGHTCOUNT 1',
          '#define LIGHT0;#define DIRLIGHT0;#define LIGHT1;#define HEMILIGHT1;#define LIGHTCOUNT 2',
        ].sort(),
      );
    }
    for (const shader of result.nativeShaders) {
      expect(shader.error).toBe('');
      expect(shader.samplers.length).toBeLessThanOrEqual(result.shaders!.maxFragmentSamplers);
      expect(shader.defines).toContain('#define ORIGINAL_FORMULA_GROUNDING_V1');
      for (const applied of [
        'highp int formulaGroundingCount;',
        'vec4 formulaGroundingPose[12];',
        'float formulaGround= formulaGrounding(vPositionW);',
        'finalDiffuse=finalDiffuse*formulaDirect+formulaSkyDiffuse*(formulaIndirect-formulaDirect);',
        'finalSpecularScaled=finalSpecularScaled*formulaDirect+formulaSkySpecular*(formulaIndirect-formulaDirect);',
        'finalAmbient*=formulaIndirect;',
      ])
        expect(shader.fragmentSource).toContain(applied);
      expect(shader.fragmentSource).toContain('groundingNativeBefore=vec4(');
      expect(shader.fragmentSource).toContain('groundingNativeAfter=vec4(');
    }
    for (const diagnostic of Object.values(result.diagnostics)) {
      expect(diagnostic.losses).toBe(0);
      expect(diagnostic.abandoned).toBe(0);
      expect(diagnostic.settled).toBe(true);
      expect(diagnostic.queue.pending).toBe(false);
      expect(diagnostic.queue.failure).toBeNull();
      expect(diagnostic.preparation.failure).toBeNull();
    }
  });
}
