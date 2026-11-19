import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { graphicsPreset } from '../src/rendering/options.ts';
import { H, carBase, hasRoadBikeContact } from '../src/simulation/protocol.ts';
import { MENU_STARTUP_TIMEOUT_MS } from './menu-startup.ts';

// Full production UI, worker, assets and High settings. Fixed small scene,
// original five-minute test deadline and all actual GPU completion gates.
// This is appearance/integration evidence, never a hardware FPS certificate.
test.use({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });

async function slide(page: Page, field: string, value: number) {
  await page.locator(`#photo-${field}`).evaluate((node, next) => {
    const input = node as HTMLInputElement;
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function capture(page: Page, info: TestInfo, name: string) {
  const session = await page.context().newCDPSession(page);
  try {
    const result = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await info.attach(name, {
      body: Buffer.from(result.data, 'base64'),
      contentType: 'image/png',
    });
  } finally {
    await session.detach();
  }
}

test('High production scene presents an active GP chassis and two completed photo views', async ({
  page,
}, info) => {
  const errors: string[] = [],
    observations = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const read = () => page.evaluate(() => window.apexDiagnostics());
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: MENU_STARTUP_TIMEOUT_MS });
  expect((await read()).renderer?.gpuFrameQueue.completed).toBeGreaterThan(0);
  await page.selectOption('#vehicle', 'gpr1');
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('high');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await expect(page.locator('#modal')).toBeHidden();
  await expect.poll(async () => (await read()).settingsTransition.busy).toBe(false);
  await expect.poll(async () => (await read()).renderer?.graphics).toEqual(graphicsPreset('high'));
  await page.selectOption('#circuit', 'aurel');
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '0');
  await page.selectOption('#weather', 'clear');
  await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
  await expect.poll(async () => (await read()).state, { timeout: 90000 }).toBe('paused');
  const prepared = await read();
  expect(prepared.renderer?.presentationPurpose).toBe('circuit');
  expect(prepared.renderer?.preparation?.status).toBe('complete');
  expect(prepared.renderer?.construction.cancelled).toBe(false);
  expect(prepared.renderer?.gpuFrameQueue.completed).toBeGreaterThan(0);
  expect(prepared.frame?.[H.CARS]).toBe(1);
  await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
  await expect.poll(async () => (await read()).frame?.[H.TICK] ?? 0).toBeGreaterThan(4);
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await read()).workerPause)
    .toMatchObject({ paused: true, pending: false });
  const held = await read();
  expect(held.frame?.every(Number.isFinite)).toBe(true);
  expect(hasRoadBikeContact(new Float32Array(held.frame!), carBase(0))).toBe(true);
  await page.getByRole('button', { name: 'PHOTO STUDIO', exact: true }).click();
  await slide(page, 'distance', 5.5);
  await slide(page, 'focalLength', 38);
  await slide(page, 'elevation', 10);
  for (const [view, azimuth] of [
    ['three-quarter', 38],
    ['side', 90],
  ] as const) {
    await slide(page, 'azimuth', azimuth);
    await expect
      .poll(async () => (await read()).renderer?.photo)
      .toMatchObject({ target: 0, azimuth, distance: 5.5 });
    const submitted = (await read()).renderer!.gpuFrameQueue.submitted;
    // At least one later submission must actually complete after this view
    // was requested. Two animation callbacks alone cannot establish that.
    await expect
      .poll(async () => (await read()).renderer?.gpuFrameQueue.completed ?? 0)
      .toBeGreaterThan(submitted);
    await page.getByRole('button', { name: 'CLEAN FRAME', exact: true }).click();
    await capture(page, info, `high-gp-${view}.png`);
    const observed = await read();
    expect(observed.frame).toEqual(held.frame);
    expect(observed.renderer?.graphics).toEqual(graphicsPreset('high'));
    expect(observed.renderer?.gpuFrameQueue.failure).toBeNull();
    expect(observed.renderer?.renderWidth).toBe(960);
    expect(observed.renderer?.renderHeight).toBe(600);
    expect(observed.renderer?.drawCalls).toBeGreaterThan(0);
    expect(observed.renderer?.triangles).toBeGreaterThan(0);
    observations.push({ view, renderer: observed.renderer, presented: observed.presentation });
    await page.getByRole('button', { name: 'SHOW CONTROLS', exact: true }).click();
  }
  const backend = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#world');
    const gl = canvas?.getContext('webgl2');
    if (!gl) throw new Error('Production WebGL2 canvas unavailable');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: String(gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)),
      renderer: String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
      contextAlive: !gl.isContextLost(),
    };
  });
  expect(backend.contextAlive).toBe(true);
  expect(held.buildIdentity.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  await info.attach('high-gp-application.json', {
    body: JSON.stringify(
      {
        scope: 'Full application at 960x600 High; paused appearance, not FPS certification',
        physicalHardwareValidated: false,
        buildIdentity: held.buildIdentity,
        backend,
        options: held.options,
        frame: held.frame,
        observations,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
