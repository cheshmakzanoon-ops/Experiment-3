import gantryManifest from '../src/rendering/start-gantry.manifest.json' with { type: 'json' };
import { test, expect, type Page } from '@playwright/test';
import { exerciseBabylonContextRecovery } from './fixtures/babylon-context-recovery.ts';

const surfaceKeys = [
  'bannerState',
  'bannerParts',
  'bannerMaterials',
  'bannerTextures',
  'bannerTriangles',
  'bannerWidth',
  'bannerHeight',
  'bannerHardwareSrgb',
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
