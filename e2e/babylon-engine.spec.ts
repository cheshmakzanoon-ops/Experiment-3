import gantryManifest from '../src/rendering/start-gantry.manifest.json' with { type: 'json' };
import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { exerciseBabylonContextRecovery } from './fixtures/babylon-context-recovery.ts';

// Use the exact PNG decoder shipped with the already pinned Playwright runtime.
// No network dependency, tolerance, mask, resampling or image alteration.
const require = createRequire(import.meta.url);
const { PNG } = require(
  join(dirname(require.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'),
) as {
  PNG: { sync: { read(png: Buffer): { width: number; height: number; data: Buffer } } };
};
function compareDisplayedPng(before: Buffer, after: Buffer) {
  const a = PNG.sync.read(before),
    b = PNG.sync.read(after);
  if (a.width !== b.width || a.height !== b.height)
    return {
      widthBefore: a.width,
      heightBefore: a.height,
      widthAfter: b.width,
      heightAfter: b.height,
      sameDimensions: false,
      changedPixels: null,
    };
  let changedPixels = 0,
    changedChannels = 0,
    maxChannelDelta = 0;
  let minX = a.width,
    minY = a.height,
    maxX = -1,
    maxY = -1;
  for (let offset = 0; offset < a.data.length; offset += 4) {
    let changed = false;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(a.data[offset + channel] - b.data[offset + channel]);
      if (delta !== 0) {
        changed = true;
        changedChannels++;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
      }
    }
    if (!changed) continue;
    changedPixels++;
    const pixel = offset / 4,
      x = pixel % a.width,
      y = Math.floor(pixel / a.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    widthBefore: a.width,
    heightBefore: a.height,
    widthAfter: b.width,
    heightAfter: b.height,
    sameDimensions: true,
    changedPixels,
    changedChannels,
    maxChannelDelta,
    changedBounds: changedPixels ? { minX, minY, maxX, maxY } : null,
    rgbaSha256Before: createHash('sha256').update(a.data).digest('hex'),
    rgbaSha256After: createHash('sha256').update(b.data).digest('hex'),
  };
}

const surfaceKeys = [
  'bannerState',
  'bannerParts',
  'bannerMaterials',
  'bannerTextures',
  'bannerTriangles',
  'bannerWidth',
  'bannerHeight',
  'bannerHardwareSrgb',
  'brakingTripletState',
  'brakingTripletParts',
  'brakingTripletTriangles',
  'brakingTripletScope',
  'gridState',
  'gridParts',
  'gridMaterials',
  'gridTextures',
  'gridSlots',
  'gridBoxes',
  'gridTriangles',
  'gridDryOnly',
  'gridGpSwitchingParity',
  'gridWeatherParity',
  'gridShadowParity',
  'stripeState',
  'stripeParts',
  'stripeMaterials',
  'stripeTextures',
  'stripeTriangles',
  'stripeWidth',
  'stripeHeight',
  'stripeHardwareSrgb',
  'lampState',
  'lampParts',
  'lampMaterials',
  'lampTriangles',
  'lampLights',
  'gantryState',
  'gantryParts',
  'gantryMaterials',
  'gantryTextures',
  'gantryTriangles',
  'gantrySha256',

  'surfaceKind',
  'surfaceRoadChunks',
  'surfacePaintChunks',
  'surfaceLeftPaintChunks',
  'surfaceRightPaintChunks',
  'surfaceCoarseMeshes',
  'surfaceVertices',
  'surfacePaintFinishMaterials',
  'surfaceAsphaltSubstrateRoadChunks',
  'surfaceAsphaltSubstrateMaterials',
  'surfaceAsphaltSubstrateTextures',
  'surfaceAsphaltSubstrateSrgbTextures',
  'surfaceFormulaGroundingRoadChunks',
  'surfaceFormulaGroundingPaintChunks',
  'surfaceFormulaGroundingMaterials',
  'surfaceFormulaGroundingCars',
] as const;
async function expectOriginalStartBanner(page: Page) {
  const status = page.locator('#status');
  await expect(status).toHaveAttribute('data-banner-state', 'ready');
  await expect(status).toHaveAttribute('data-banner-parts', '1');
  await expect(status).toHaveAttribute('data-banner-materials', '1');
  await expect(status).toHaveAttribute('data-banner-textures', '1');
  await expect(status).toHaveAttribute('data-banner-triangles', '2');
  await expect(status).toHaveAttribute('data-banner-width', '512');
  await expect(status).toHaveAttribute('data-banner-height', '128');
  await expect(status).toHaveAttribute('data-banner-hardware-srgb', '1');
}
async function expectOriginalStartStripe(page: Page) {
  const status = page.locator('#status');
  await expect(status).toHaveAttribute('data-stripe-state', 'ready');
  await expect(status).toHaveAttribute('data-stripe-parts', '1');
  await expect(status).toHaveAttribute('data-stripe-materials', '1');
  await expect(status).toHaveAttribute('data-stripe-textures', '1');
  await expect(status).toHaveAttribute('data-stripe-triangles', '2');
  await expect(status).toHaveAttribute('data-stripe-width', '128');
  await expect(status).toHaveAttribute('data-stripe-height', '32');
  await expect(status).toHaveAttribute('data-stripe-hardware-srgb', '1');
}
async function expectOriginalGridPaint(page: Page) {
  const status = page.locator('#status');
  await expect(status).toHaveAttribute('data-braking-triplet-state', 'ready');
  await expect(status).toHaveAttribute('data-braking-triplet-parts', '6');
  await expect(status).toHaveAttribute('data-braking-triplet-triangles', '4950');
  await expect(status).toHaveAttribute(
    'data-braking-triplet-scope',
    'dry-formula-first-clean-triplet-fixed-lod0',
  );
  await expect(status).toHaveAttribute('data-grid-state', 'ready');
  await expect(status).toHaveAttribute('data-grid-parts', '2');
  await expect(status).toHaveAttribute('data-grid-materials', '1');
  await expect(status).toHaveAttribute('data-grid-textures', '0');
  await expect(status).toHaveAttribute('data-grid-slots', '12');
  await expect(status).toHaveAttribute('data-grid-boxes', '36');
  await expect(status).toHaveAttribute('data-grid-triangles', '432');
  await expect(status).toHaveAttribute('data-grid-dry-only', 'true');
  await expect(status).toHaveAttribute('data-grid-gp-switching-parity', 'false');
  await expect(status).toHaveAttribute('data-grid-weather-parity', 'false');
  await expect(status).toHaveAttribute('data-grid-shadow-parity', 'false');
}
async function expectOriginalStartLamps(page: Page) {
  const status = page.locator('#status');
  await expect(status).toHaveAttribute('data-lamp-state', 'ready');
  await expect(status).toHaveAttribute('data-lamp-parts', '5');
  await expect(status).toHaveAttribute('data-lamp-materials', '5');
  await expect(status).toHaveAttribute('data-lamp-triangles', '400');
  // The unchanged practice session has no start countdown. Observe actual
  // bound emission rather than injecting a synthetic race state into gameplay.
  await expect(status).toHaveAttribute('data-lamp-lights', '0');
}
async function expectOriginalAurelSurface(page: Page) {
  const status = page.locator('#status');
  await expect(status).toHaveAttribute('data-surface-kind', 'formula-ribbon');
  await expect(status).toHaveAttribute('data-surface-road-chunks', '38');
  await expect(status).toHaveAttribute('data-surface-paint-chunks', '76');
  await expect(status).toHaveAttribute('data-surface-left-paint-chunks', '38');
  await expect(status).toHaveAttribute('data-surface-right-paint-chunks', '38');
  await expect(status).toHaveAttribute('data-surface-coarse-meshes', '0');
  await expect(status).toHaveAttribute('data-surface-vertices', '31882');
  await expect(status).toHaveAttribute('data-surface-paint-finish-materials', '1');
  await expect(status).toHaveAttribute('data-surface-asphalt-substrate-road-chunks', '38');
  await expect(status).toHaveAttribute('data-surface-asphalt-substrate-materials', '1');
  await expect(status).toHaveAttribute('data-surface-asphalt-substrate-textures', '3');
  await expect(status).toHaveAttribute('data-surface-asphalt-substrate-srgb-textures', '1');
  await expect(status).toHaveAttribute('data-surface-formula-grounding-road-chunks', '38');
  await expect(status).toHaveAttribute('data-surface-formula-grounding-paint-chunks', '76');
  await expect(status).toHaveAttribute('data-surface-formula-grounding-materials', '2');
  await expect(status).toHaveAttribute('data-surface-formula-grounding-cars', '1');
  await expect(status).toHaveAttribute('data-gantry-state', 'ready');
  await expect(status).toHaveAttribute('data-gantry-parts', '4');
  await expect(status).toHaveAttribute('data-gantry-materials', '1');
  await expect(status).toHaveAttribute('data-gantry-textures', '3');
  await expect(status).toHaveAttribute('data-gantry-triangles', '9520');
  await expect(status).toHaveAttribute('data-gantry-sha256', gantryManifest.sha256);
  await expectOriginalStartLamps(page);
  await expectOriginalStartBanner(page);
  await expectOriginalStartStripe(page);
  await expectOriginalGridPaint(page);
  await expect(status).toHaveAttribute('data-scene-ready', 'true');
  expect(Number(await status.getAttribute('data-completed-frames'))).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#loadAsset')).toBeEnabled();
}
async function restartAndCheckSurfaceInvalidation(page: Page) {
  const immediate = await page.evaluate((keys) => {
    (document.querySelector('#restart') as HTMLButtonElement).click();
    const status = document.querySelector('#status') as HTMLElement;
    return {
      absent: keys.every((key) => status.dataset[key] === undefined),
      loadDisabled: (document.querySelector('#loadAsset') as HTMLButtonElement).disabled,
    };
  }, surfaceKeys);
  expect(immediate).toEqual({ absent: true, loadDisabled: true });
  await expectOriginalAurelSurface(page);
}

test('Babylon migration entry renders existing simulation and supports pause, resume and restart', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/babylon.html');
  const status = page.locator('#status');
  await expect(status).toContainText('DRIVING');
  const tick = async () => Number((await status.textContent())?.match(/tick (\d+)/)?.[1] ?? -1);
  await expect.poll(tick).toBeGreaterThan(5);
  await expect(status).toHaveAttribute('data-scene-ready', 'true');
  await expectOriginalAurelSurface(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(status).toContainText('PAUSED');
  await expect(status).toHaveAttribute('data-presentation-settled', 'true');
  const stopped = await tick();
  const draws = await status.getAttribute('data-rendered-frames');
  await page.waitForTimeout(400);
  expect(await tick()).toBe(stopped);
  expect(await status.getAttribute('data-rendered-frames')).toBe(draws);
  // A resize invalidates the static canvas once, even while physics is paused.
  await page.setViewportSize({ width: 1360, height: 820 });
  await expect
    .poll(async () => Number(await status.getAttribute('data-rendered-frames')))
    .toBeGreaterThan(Number(draws));
  expect(await tick()).toBe(stopped);
  await expect(status).toHaveAttribute('data-scene-ready', 'true');
  await expect(status).toHaveAttribute('data-presentation-settled', 'true');
  const resizedDraws = await status.getAttribute('data-rendered-frames');
  await page.waitForTimeout(400);
  expect(await status.getAttribute('data-rendered-frames')).toBe(resizedDraws);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(tick).toBeGreaterThan(stopped);
  await page.locator('#game').click();
  await page.keyboard.press('KeyG');
  await expect(status).toContainText('AI DEMO');
  await restartAndCheckSurfaceInvalidation(page);
  await expect(status).toContainText('DRIVING');
  await expect(page.getByRole('link', { name: 'Full Three.js game' })).toHaveAttribute(
    'href',
    './',
  );
  // Actual context loss invalidates readiness; restoration alone cannot publish
  // old scene counts or re-enable asset loading. No timeout/sleep extension.
  const recovery = await page.evaluate(exerciseBabylonContextRecovery, surfaceKeys);
  expect(recovery).toEqual({
    lost: { contextLost: true, absent: true, sceneReady: 'false', loadDisabled: true },
    restored: { contextLost: false, absent: true, sceneReady: 'false', loadDisabled: true },
  });
  // Babylon rebuilds its engine asynchronously after the native event. Observe
  // that completion too, rather than accepting the earlier loss message.
  await expect(page.locator('#assetStatus')).toContainText(
    'Graphics context restored. Restart is required',
  );
  await expect(page.locator('#loadAsset')).toBeDisabled();
  await expect(status).not.toHaveAttribute('data-surface-kind');
  for (const key of [
    'state',
    'parts',
    'materials',
    'textures',
    'triangles',
    'width',
    'height',
    'hardware-srgb',
  ])
    for (const prefix of ['banner', 'stripe'])
      await expect(status).not.toHaveAttribute(`data-${prefix}-${key}`);
  for (const key of [
    'state',
    'parts',
    'materials',
    'textures',
    'slots',
    'boxes',
    'triangles',
    'dry-only',
    'gp-switching-parity',
    'weather-parity',
    'shadow-parity',
  ])
    await expect(status).not.toHaveAttribute(`data-grid-${key}`);
  for (const key of ['state', 'parts', 'triangles', 'scope'])
    await expect(status).not.toHaveAttribute(`data-braking-triplet-${key}`);
  for (const key of ['state', 'parts', 'materials', 'triangles', 'lights'])
    await expect(status).not.toHaveAttribute(`data-lamp-${key}`);
  await expect(status).toHaveAttribute('data-scene-ready', 'false');
  await info.attach('babylon-context-recovery-state.json', {
    body: JSON.stringify(recovery, null, 2),
    contentType: 'application/json',
  });
  await restartAndCheckSurfaceInvalidation(page);
  await info.attach('babylon-live-formula-surface-state.json', {
    body: JSON.stringify(
      await status.evaluate(
        (element, keys) => ({
          surface: Object.fromEntries(
            keys.map((key) => [key, (element as HTMLElement).dataset[key]]),
          ),
          completedFrames: (element as HTMLElement).dataset.completedFrames,
          sceneReady: (element as HTMLElement).dataset.sceneReady,
        }),
        surfaceKeys,
      ),
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  await info.attach('babylon-engine-preview.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Babylon completes original environment startup while paused before gantry preparation', async ({
  page,
}, info) => {
  // One absolute test budget also bounds the held request and startup; do not
  // grant preparation a second budget after release or inject simulation state.
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const evidence: unknown[] = [];
  const observe = async (phase: string) => {
    const observed = await page.locator('#status').evaluate((status) => {
      const text = status.textContent ?? '';
      const keys = [
        'bannerState',
        'bannerParts',
        'bannerMaterials',
        'bannerTextures',
        'bannerTriangles',
        'bannerWidth',
        'bannerHeight',
        'bannerHardwareSrgb',
        'brakingTripletState',
        'brakingTripletParts',
        'brakingTripletTriangles',
        'brakingTripletScope',
        'gridState',
        'gridParts',
        'gridMaterials',
        'gridTextures',
        'gridSlots',
        'gridBoxes',
        'gridTriangles',
        'gridDryOnly',
        'gridGpSwitchingParity',
        'gridWeatherParity',
        'gridShadowParity',
        'stripeState',
        'stripeParts',
        'stripeMaterials',
        'stripeTextures',
        'stripeTriangles',
        'stripeWidth',
        'stripeHeight',
        'stripeHardwareSrgb',
        'sceneReady',
        'presentationSettled',
        'completedFrames',
        'gantryState',
        'gantryParts',
        'gantryMaterials',
        'gantryTextures',
        'gantryTriangles',
        'gantrySha256',
        'lampState',
        'lampParts',
        'lampMaterials',
        'lampTriangles',
        'lampLights',
      ];
      return {
        text,
        tick: Number(text.match(/tick (\d+)/)?.[1] ?? -1),
        loadDisabled: document.querySelector<HTMLButtonElement>('#loadAsset')?.disabled,
        pauseButton: document.querySelector('#pause')?.textContent,
        readiness: Object.fromEntries(
          keys.map((key) => [key, (status as HTMLElement).dataset[key] ?? null]),
        ),
      };
    });
    evidence.push({ phase, ...observed });
  };
  let held = false;
  await page.route('**/models/aurel-start-gantry.glb*', async (route) => {
    held = true;
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/babylon.html', { waitUntil: 'domcontentloaded' });
    const status = page.locator('#status');
    await expect.poll(() => held, { timeout: 120000 }).toBe(true);
    await expect(status).toHaveAttribute('data-scene-ready', 'false');
    await expect(page.locator('#loadAsset')).toBeDisabled();
    await expect(status).not.toHaveAttribute('data-gantry-state');
    await expect(status).not.toHaveAttribute('data-lamp-state');
    await expect(status).not.toHaveAttribute('data-banner-state');
    await expect(status).not.toHaveAttribute('data-stripe-state');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(status).toContainText('PAUSED');
    const tick = async () => Number((await status.textContent())?.match(/tick (\d+)/)?.[1] ?? -1);
    const pausedTick = await tick();
    expect(pausedTick).toBeGreaterThanOrEqual(0);
    await expect(status).toHaveAttribute('data-presentation-settled', 'false');
    await observe('gantry-fetch-held-paused');
    release();
    await expect(status).toHaveAttribute('data-presentation-settled', 'true', { timeout: 120000 });
    await observe('released-settled');
    await expectOriginalAurelSurface(page);
    await expect(status).toContainText('PAUSED');
    expect(await tick()).toBe(pausedTick);
    const frozenReceipt = () =>
      page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
        const bounds = canvas.getBoundingClientRect();
        const graphics = window.babylonGraphicsDiagnostics(true);
        const data = document.querySelector<HTMLElement>('#status')!.dataset;
        const count = (keys: string[]) => keys.reduce((sum, key) => sum + Number(data[key]), 0);
        return {
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          canvas: {
            width: canvas.width,
            height: canvas.height,
            x: bounds.x,
            y: bounds.y,
            cssWidth: bounds.width,
            cssHeight: bounds.height,
          },
          graphics,
          expectedBindings: {
            meshes: count([
              'surfaceRoadChunks',
              'surfacePaintChunks',
              'gantryParts',
              'lampParts',
              'bannerParts',
              'stripeParts',
              'gridParts',
              'brakingTripletParts',
            ]),
            materials:
              count([
                'surfacePaintFinishMaterials',
                'surfaceAsphaltSubstrateMaterials',
                'gantryMaterials',
                'lampMaterials',
                'bannerMaterials',
                'stripeMaterials',
                'gridMaterials',
              ]) + (data.brakingTripletState === 'ready' ? 4 : 0),
            textures:
              count([
                'surfaceAsphaltSubstrateTextures',
                'gantryTextures',
                'bannerTextures',
                'stripeTextures',
                'gridTextures',
              ]) + (data.brakingTripletState === 'ready' ? 6 : 0),
          },
          dom: {
            panelText: document.querySelector('#panel')?.textContent,
            activeElement: document.activeElement?.id,
            animations: document.getAnimations().map((animation) => ({
              playState: animation.playState,
              currentTime: String(animation.currentTime),
            })),
            status: document.querySelector('#status')?.textContent,
          },
        };
      });
    const beforeVisual = await frozenReceipt();
    evidence.push({ phase: 'paused-before-resize', visual: beforeVisual });
    expect(beforeVisual.graphics?.startupPublicationDecision).toBe('reused-completed-image');
    const assertCachedVisualState = (observed: typeof beforeVisual) => {
      const cached = observed.graphics?.startupVisualState;
      expect(cached?.source).toBe('last-owned-paused-draw');
      expect(typeof cached?.state).toBe('string');
      expect(cached!.state!.length).toBeGreaterThan(0);
      expect(cached!.state!.length).toBeLessThanOrEqual(262144);
      expect(Number.isSafeInteger(cached!.sequence)).toBe(true);
      expect(cached!.sequence!).toBeGreaterThan(0);
      expect(cached!.sequence!).toBeLessThanOrEqual(observed.graphics!.lastCompletedSequence);
      expect(cached!.tick).toBe(pausedTick);
      const state: unknown = JSON.parse(cached!.state!);
      expect(Array.isArray(state)).toBe(true);
      const tuple = state as unknown[];
      expect(tuple).toHaveLength(25);
      expect(Array.isArray(tuple[0])).toBe(true);
      const cameraTransform = tuple[0] as unknown[];
      expect(cameraTransform).toHaveLength(6);
      expect(cameraTransform[2]).toHaveLength(3);
      expect(cameraTransform[3]).toHaveLength(3);
      expect(cameraTransform[5]).toBe(true);
      for (const [index, count] of [
        [21, observed.expectedBindings.meshes],
        [22, observed.expectedBindings.materials],
        [23, observed.expectedBindings.textures],
      ]) {
        expect(Number.isSafeInteger(count)).toBe(true);
        expect(count).toBeGreaterThan(0);
        expect(Array.isArray(tuple[index])).toBe(true);
        expect((tuple[index] as unknown[]).length).toBeGreaterThanOrEqual(count);
      }
      return {
        camera: tuple.slice(0, 15),
        meshCount: (tuple[21] as unknown[]).length,
        materialCount: (tuple[22] as unknown[]).length,
        textureCount: (tuple[23] as unknown[]).length,
      };
    };
    const beforeState = assertCachedVisualState(beforeVisual);
    const screenshotOptions = { animations: 'allow' as const, caret: 'initial' as const };
    // Locator capture is the unmasked composited canvas rectangle, NOT a raw
    // framebuffer readback (the real engine uses preserveDrawingBuffer:false).
    const beforeCanvas = await page.locator('#game').screenshot(screenshotOptions);
    await info.attach('babylon-paused-before-resize-canvas.png', {
      body: beforeCanvas,
      contentType: 'image/png',
    });
    const beforePage = await page.screenshot({ ...screenshotOptions, fullPage: true });
    await info.attach('babylon-paused-before-resize-page.png', {
      body: beforePage,
      contentType: 'image/png',
    });
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const completeAfterResize = async (completedBefore: number) => {
      await expect
        .poll(() => page.evaluate(() => window.babylonGraphicsDiagnostics()?.completed ?? -1))
        .toBeGreaterThan(completedBefore);
      await expect(status).toHaveAttribute('data-presentation-settled', 'true');
      await expect(status).toContainText('PAUSED');
      expect(await tick()).toBe(pausedTick);
    };
    // Real browser resize events exercise the existing application invalidation
    // and GPU fence path. Round-trip to the exact original viewport before proof.
    await page.setViewportSize({ width: viewport!.width + 1, height: viewport!.height });
    await completeAfterResize(beforeVisual.graphics!.completed);
    const intermediateVisual = await frozenReceipt();
    evidence.push({ phase: 'paused-expanded-viewport', visual: intermediateVisual });
    await page.setViewportSize(viewport!);
    await completeAfterResize(intermediateVisual.graphics!.completed);
    await expectOriginalAurelSurface(page);
    const afterVisual = await frozenReceipt();
    evidence.push({ phase: 'paused-restored-viewport', visual: afterVisual });
    const afterState = assertCachedVisualState(afterVisual);
    const afterCanvas = await page.locator('#game').screenshot(screenshotOptions);
    await info.attach('babylon-paused-after-resize-canvas.png', {
      body: afterCanvas,
      contentType: 'image/png',
    });
    const afterPage = await page.screenshot({ ...screenshotOptions, fullPage: true });
    await info.attach('babylon-paused-after-resize-page.png', {
      body: afterPage,
      contentType: 'image/png',
    });
    const canvasPixels = compareDisplayedPng(beforeCanvas, afterCanvas);
    const pagePixels = compareDisplayedPng(beforePage, afterPage);
    evidence.push({
      phase: 'frozen-resize-pixel-proof',
      captureScope: 'unmasked composited canvas rectangle; overlapping DOM retained',
      beforeVisual,
      intermediateVisual,
      afterVisual,
      canvasPixels,
      pagePixels,
      beforeState,
      afterState,
    });
    expect(afterVisual.graphics?.startupPublicationDecision).toBe(
      beforeVisual.graphics?.startupPublicationDecision,
    );
    expect(afterVisual.graphics!.startupVisualState!.state).toBe(
      beforeVisual.graphics!.startupVisualState!.state,
    );
    expect(afterVisual.graphics!.startupVisualState!.sequence!).toBeGreaterThan(
      beforeVisual.graphics!.startupVisualState!.sequence!,
    );
    expect(afterState).toEqual(beforeState);
    expect(afterVisual.viewport).toEqual(beforeVisual.viewport);
    expect(afterVisual.canvas).toEqual(beforeVisual.canvas);
    expect(afterVisual.graphics!.completed).toBeGreaterThan(beforeVisual.graphics!.completed);
    expect(canvasPixels.sameDimensions).toBe(true);
    expect(
      canvasPixels.changedPixels,
      'Exact unmasked canvas rectangle changed; inspect page/DOM and visual receipts, do not mask differences',
    ).toBe(0);
    await observe('paused-same-viewport-redraw');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(status).toContainText('DRIVING');
    await expect.poll(tick).toBeGreaterThan(pausedTick);
    await observe('resumed-advancing');
    expect(errors).toEqual([]);
  } finally {
    release();
    try {
      await page.unrouteAll({ behavior: 'wait' });
    } finally {
      await info.attach('babylon-early-paused-startup.json', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      });
    }
  }
});

test('Babylon imports the existing authored Formula asset and restart cancels obsolete loading', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/babylon.html');
  await expect(page.locator('#status')).toContainText('DRIVING');
  await expectOriginalAurelSurface(page);
  const assetStatus = page.locator('#assetStatus');
  await expect(assetStatus).not.toHaveAttribute('data-scalar-height-materials');
  const load = page.getByRole('button', {
    name: 'Inspect existing Formula asset (35 MB)',
    exact: true,
  });
  await load.click();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(load).toBeEnabled();
  await expectOriginalAurelSurface(page);
  await expect(page.locator('#assetStatus')).toContainText('optional');
  await expect(assetStatus).not.toHaveAttribute('data-scalar-height-materials');
  await load.click();
  await expect(page.locator('#assetStatus')).toContainText(
    'Original Formula asset loaded in Babylon',
    { timeout: 120000 },
  );
  // Read back actual enabled plugin state on the production load route, not
  // the isolated parity fixture or a constant readiness label.
  await expect(assetStatus).toHaveAttribute('data-scalar-height-materials', '10');
  // Live surface readiness and full-lap counts survive the original model load.
  await expect(page.locator('#status')).toHaveAttribute('data-surface-kind', 'formula-ribbon');
  await expect(page.locator('#status')).toHaveAttribute('data-surface-paint-chunks', '76');
  await expectOriginalStartLamps(page);
  await expectOriginalStartBanner(page);
  await expectOriginalStartStripe(page);
  await expectOriginalGridPaint(page);
  const driverSteering = async () =>
    Number(await page.locator('#assetStatus').getAttribute('data-steering'));
  await page.keyboard.down('a');
  try {
    await expect.poll(driverSteering).toBeGreaterThan(0.7);
  } finally {
    await page.keyboard.up('a');
  }
  await page.keyboard.down('d');
  try {
    await expect.poll(driverSteering).toBeLessThan(0.3);
  } finally {
    await page.keyboard.up('d');
  }
  await expect.poll(async () => Math.abs((await driverSteering()) - 0.5)).toBeLessThan(0.05);
  const wheelPhase = async () =>
    Number(await page.locator('#assetStatus').getAttribute('data-wheel-phase'));
  const initialWheel = await wheelPhase();
  await page.keyboard.down('w');
  try {
    await expect
      .poll(
        async () => {
          const delta = (await wheelPhase()) - initialWheel;
          return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
        },
        { timeout: 15000 },
      )
      .toBeGreaterThan(0.1);
  } finally {
    await page.keyboard.up('w');
  }
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toContainText('PAUSED');
  await expect(page.locator('#status')).toHaveAttribute('data-presentation-settled', 'true');
  await expectOriginalStartLamps(page);
  await expectOriginalStartBanner(page);
  await expectOriginalStartStripe(page);
  await expectOriginalGridPaint(page);
  const frozenWheel = await wheelPhase();
  const frozenDriver = await driverSteering();
  await page.waitForTimeout(300);
  expect(await driverSteering()).toBe(frozenDriver);
  expect(await wheelPhase()).toBe(frozenWheel);
  await expect(assetStatus).toHaveAttribute('data-scalar-height-materials', '10');
  await info.attach('babylon-original-height-state.json', {
    body: JSON.stringify(
      {
        enabledMaterials: Number(await assetStatus.getAttribute('data-scalar-height-materials')),
        completedFrames: Number(
          await page.locator('#status').getAttribute('data-completed-frames'),
        ),
        presentationSettled: await page
          .locator('#status')
          .getAttribute('data-presentation-settled'),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  // The reported phase is read back from the applied Babylon spin node.
  await info.attach('babylon-original-formula-model.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(load).toBeEnabled();
  await expectOriginalAurelSurface(page);
  await expect(page.locator('#assetStatus')).toContainText('optional');
  await expect(assetStatus).not.toHaveAttribute('data-scalar-height-materials');
  await expect(page.locator('#assetStatus')).not.toHaveAttribute('data-wheel-phase');
  expect(errors).toEqual([]);
});

test('Babylon uses the production driving inputs, including keyboard throttle and touch steering', async ({
  page,
}) => {
  await page.goto('/babylon.html');
  await expect(page.locator('#status')).toContainText('DRIVING');
  const speed = async () =>
    Number((await page.locator('#status').textContent())?.match(/(\d+) km\/h/)?.[1] ?? -1);
  await page.locator('#game').click();
  await page.keyboard.down('w');
  await expect.poll(speed, { timeout: 15000 }).toBeGreaterThan(8);
  await page.keyboard.up('w');
  await expect(page.getByRole('navigation', { name: 'Touch driving controls' })).toBeVisible();
  const right = await page.getByRole('button', { name: 'Steer right', exact: true }).boundingBox();
  expect(right).not.toBeNull();
  await page.mouse.move(right!.x + right!.width / 2, right!.y + right!.height / 2);
  await page.mouse.down();
  await expect
    .poll(async () => Number(await page.locator('#status').getAttribute('data-steer')))
    .toBeLessThan(-0.02);
  await page.mouse.up();
  await expect
    .poll(async () => Math.abs(Number(await page.locator('#status').getAttribute('data-steer'))))
    .toBeLessThan(0.01);

  await page.keyboard.press('Escape');
  await expect(page.locator('#status')).toContainText('PAUSED');
  await expect(page.locator('#status')).toHaveAttribute('data-presentation-settled', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#status')).toContainText('DRIVING');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect.poll(speed).toBeLessThan(3);
});

test('Babylon diagnostic panel leaves the native driving view clear at minimum window size', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1008, height: 689 });
  await page.goto('/babylon.html');
  await expect(page.locator('#status')).toContainText('DRIVING');
  const panel = await page.locator('#panel').boundingBox();
  const controls = await page.locator('#touchDrive').boundingBox();
  expect(panel).not.toBeNull();
  expect(controls).not.toBeNull();
  expect(panel!.x + panel!.width).toBeLessThan(1008 * 0.45);
  expect(panel!.y + panel!.height).toBeLessThan(controls!.y);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toContainText('PAUSED');
  await expect(page.locator('#status')).toHaveAttribute('data-presentation-settled', 'true');
});

test('Babylon reuses the completed original startup scene on Restart with a fresh reset image', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let release!: () => void;
  const heldFetch = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const evidence: unknown[] = [];
  await page.route('**/models/aurel-start-gantry.glb*', async (route) => {
    if (!held) {
      held = true;
      await heldFetch;
    }
    await route.continue();
  });
  const observe = () =>
    page.evaluate(() => {
      const status = document.querySelector<HTMLElement>('#status')!;
      const graphics = window.babylonGraphicsDiagnostics(true);
      if (
        !graphics ||
        typeof graphics.componentEpoch !== 'number' ||
        typeof graphics.sceneEpoch !== 'number' ||
        !Number.isSafeInteger(graphics.componentEpoch) ||
        !Number.isSafeInteger(graphics.sceneEpoch)
      )
        throw new Error('Missing actual restart epoch evidence');
      return {
        text: status.textContent,
        statusText: status.textContent,
        assetStatus: document.querySelector('#assetStatus')?.textContent ?? null,
        activeElement: document.activeElement?.id ?? null,
        activeElementTag: document.activeElement?.tagName ?? null,
        focusVisible: document.activeElement?.matches(':focus-visible') ?? null,
        tick: Number(status.textContent?.match(/tick (\d+)/)?.[1] ?? -1),
        sceneReady: status.dataset.sceneReady,
        presentationSettled: status.dataset.presentationSettled,
        graphics: {
          ...graphics,
          componentEpoch: graphics.componentEpoch,
          sceneEpoch: graphics.sceneEpoch,
        },
        submissions: window.babylonGraphicsDiagnostics({ submissionObservation: true })
          ?.submissionObservation,
      };
    });
  const restartThenPause = () =>
    page.evaluate(() => {
      // Programmatic UI dispatch (not a physical pointer click): invoke both
      // existing button handlers in one task. Restart creates the fresh
      // authoritative component, then Pause freezes it before the next RAF. This
      // sets no simulation/renderer state and changes no application timer.
      document.querySelector<HTMLButtonElement>('#restart')!.click();
      document.querySelector<HTMLButtonElement>('#pause')!.click();
      return document.querySelector('#pause')!.textContent;
    });
  const settledReset = async () => {
    await expect(page.locator('#status')).toContainText('PAUSED');
    await expectOriginalAurelSurface(page);
    await expect(page.locator('#status')).toHaveAttribute('data-presentation-settled', 'true');
    await expect.poll(async () => (await observe()).tick).toBe(0);
    // Use the same real pointer modality before both unmasked captures. Clicking
    // the existing noninteractive heading clears the button's keyboard focus ring
    // without invoking an application handler or altering the paused simulation.
    await page.getByRole('heading', { name: 'MOTOBOUND / BABYLON', exact: true }).click();
    const observed = await observe();
    expect(observed.activeElementTag).toBe('BODY');
    expect(observed.activeElement).toBe('');
    expect(observed.focusVisible).toBe(false);
    expect(observed.tick).toBe(0);
    expect(observed.sceneReady).toBe('true');
    expect(observed.presentationSettled).toBe('true');
    const graphics = observed.graphics!;
    const cached = graphics.startupVisualState!;
    expect(cached?.source).toBe('last-owned-paused-draw');
    expect(cached?.rejectionCode).toBeNull();
    expect(cached?.tick).toBe(0);
    expect(typeof cached?.state).toBe('string');
    expect(cached.state!.length).toBeGreaterThan(0);
    expect(cached.state!.length).toBeLessThanOrEqual(262144);
    expect(cached.sequence).toBeGreaterThan(0);
    expect(cached.sequence!).toBeLessThanOrEqual(graphics.lastCompletedSequence);
    expect(graphics.settled).toBe(true);
    expect(graphics.phase).toBe('idle');
    expect(graphics.lost).toBe(false);
    expect(graphics.disposed).toBe(false);
    return observed;
  };
  try {
    await page.goto('/babylon.html', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => held).toBe(true);
    await expect(page.locator('#loadAsset')).toBeDisabled();
    await expect(page.locator('#status')).toHaveAttribute('data-scene-ready', 'false');
    // This pauses only the obsolete pre-reference component; settledReset later
    // establishes identical real pointer modality before both image captures.
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.locator('#status')).toContainText('PAUSED');
    const incomplete = await observe();
    evidence.push({ phase: 'held-incomplete-before-reference-rebuild', ...incomplete });
    expect(await restartThenPause()).toBe('Resume');
    release();
    const reference = await settledReset();
    evidence.push({ phase: 'fresh-rebuilt-tick-zero-reference', ...reference });
    expect(reference.graphics!.restartSceneDecision).toBe('rebuilt-scene');
    expect(reference.graphics!.sceneEpoch).toBeGreaterThan(incomplete.graphics!.sceneEpoch);
    expect(reference.graphics!.componentEpoch).toBe(incomplete.graphics!.componentEpoch + 1);
    const canvas = page.locator('#game');
    const screenshotOptions = { animations: 'allow' as const, caret: 'initial' as const };
    const referenceImage = await canvas.screenshot(screenshotOptions);
    await info.attach('restart-fresh-scene-tick-zero-reference.png', {
      body: referenceImage,
      contentType: 'image/png',
    });

    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.keyboard.down('w');
    try {
      await expect
        .poll(async () => {
          const text = await page.locator('#status').textContent();
          return Number(text?.match(/(\d+) km\/h/)?.[1] ?? 0);
        })
        .toBeGreaterThan(5);
    } finally {
      await page.keyboard.up('w');
    }
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.locator('#status')).toHaveAttribute('data-presentation-settled', 'true');
    const driven = await observe();
    evidence.push({ phase: 'actually-driven-before-reuse', ...driven });
    expect(driven.tick).toBeGreaterThan(0);
    expect(driven.graphics!.startupVisualState!.state).not.toBe(
      reference.graphics!.startupVisualState!.state,
    );

    expect(await restartThenPause()).toBe('Resume');
    const reset = await settledReset();
    evidence.push({ phase: 'reused-scene-fresh-reset-completed', ...reset });
    expect(reset.activeElementTag).toBe(reference.activeElementTag);
    expect(reset.activeElement).toBe(reference.activeElement);
    expect(reset.focusVisible).toBe(reference.focusVisible);
    expect(reset.graphics!.restartSceneDecision).toBe('reused-scene');
    expect(reset.graphics!.componentEpoch).toBe(driven.graphics!.componentEpoch + 1);
    expect(reset.graphics!.sceneEpoch).toBe(reference.graphics!.sceneEpoch);
    expect(reset.graphics!.sceneEpoch).toBe(driven.graphics!.sceneEpoch);
    expect(reset.graphics!.completed).toBeGreaterThanOrEqual(driven.graphics!.completed + 2);
    expect(reset.graphics!.startupVisualState!.sequence!).toBeGreaterThan(
      driven.graphics!.lastCompletedSequence,
    );
    const resetSubmissions = reset.submissions!.records.filter(
      (row) =>
        row.componentEpoch === reset.graphics!.componentEpoch &&
        row.sceneEpoch === reset.graphics!.sceneEpoch &&
        row.sequence <= reset.graphics!.lastCompletedSequence &&
        row.readyBefore &&
        row.readyAfter,
    );
    expect(resetSubmissions.length).toBeGreaterThanOrEqual(2);
    for (const row of resetSubmissions) {
      expect(row.paused).toBe(true);
      expect(row.tick).toBe(0);
      expect(row.throttle).toBe(0);
      expect(row.provenance).toBe('current');
    }
    // Exact canonical equality includes camera, mesh/node transforms, resource
    // unique IDs and texture/material bindings, not just copied target counts.
    expect(reset.graphics!.startupVisualState!.state).toBe(
      reference.graphics!.startupVisualState!.state,
    );
    const resetImage = await canvas.screenshot(screenshotOptions);
    await info.attach('restart-reused-scene-tick-zero-completed.png', {
      body: resetImage,
      contentType: 'image/png',
    });
    const comparison = compareDisplayedPng(referenceImage, resetImage);
    evidence.push({ phase: 'actual-reset-image-comparison', comparison });
    expect(comparison.sameDimensions).toBe(true);
    expect(comparison.changedPixels).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    release();
    try {
      await page.unrouteAll({ behavior: 'wait' });
    } finally {
      await info.attach('restart-scene-reuse.json', {
        body: Buffer.from(JSON.stringify(evidence, null, 2)),
        contentType: 'application/json',
      });
    }
  }
});
