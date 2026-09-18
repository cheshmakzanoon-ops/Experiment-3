import { expect, test } from '@playwright/test';
import { F, H, carBase } from '../src/simulation/protocol.ts';

test('individual rendering controls persist and allocate the selected buffer dimensions', async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByText('Individual graphics controls', { exact: true }).click();
  await page.locator('[name=graphics_resolutionScale]').press('Home');
  await page.locator('[name=graphics_textureSize]').selectOption('128');
  await page.locator('[name=graphics_mirrorQuality]').selectOption('medium');
  await page.locator('[name=graphics_particleDensity]').press('Home');
  for (let i = 0; i < 3; i++)
    await page.locator('[name=graphics_particleDensity]').press('ArrowRight');
  await page.locator('[name=graphics_vegetationDensity]').press('Home');
  await page.locator('[name=colorblind]').check();
  await page.locator('[name=highContrast]').check();
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await expect(page.locator('#toast')).toContainText('Preferences saved.');
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60000 });
  await expect(page.locator('html')).toHaveAttribute('data-colorblind', 'true');
  await page.locator('#mode').selectOption('practice');
  await page.locator('#opponents').selectOption('0');
  await page.getByRole('button', { name: /ENTER CIRCUIT/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.apexDiagnostics().state), { timeout: 60000 })
    .toBe('driving');
  const state = await page.evaluate(() => {
    const rect = document.getElementById('world')!.getBoundingClientRect();
    return {
      diagnostics: window.apexDiagnostics(),
      width: rect.width,
      height: rect.height,
      ratio: Math.min(devicePixelRatio, 1.5),
    };
  });
  const render = state.diagnostics.renderer!;
  expect(render.graphics.textureSize).toBe(128);
  expect(render.graphics.particleDensity).toBe(0.3);
  expect(render.graphics.vegetationDensity).toBe(0);
  expect(render.renderWidth).toBeCloseTo(state.width * state.ratio * 0.5, 0);
  expect(render.renderHeight).toBeCloseTo(state.height * state.ratio * 0.5, 0);
  expect(render.mirrorWidth).toBe(256);
  await info.attach('graphics-settings.json', {
    body: JSON.stringify(state),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('graphics-and-accessibility.png') });
  expect(errors).toEqual([]);
});

test('manual pedals reach the physics worker while rendering callbacks are suspended', async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    Object.assign(window, { holdRendering: false });
    window.requestAnimationFrame = (callback) => {
      const run = (time: number) => {
        if ((window as unknown as { holdRendering: boolean }).holdRendering) original(run);
        else callback(time);
      };
      return original(run);
    };
  });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await expect(page.locator('#modal')).toBeHidden();
  await page.locator('#mode').selectOption('practice');
  await page.locator('#opponents').selectOption('0');
  await page.getByRole('button', { name: /ENTER CIRCUIT/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.apexDiagnostics().state), { timeout: 60000 })
    .toBe('driving');
  const before = await page.evaluate(() => {
    (window as unknown as { holdRendering: boolean }).holdRendering = true;
    return window.apexDiagnostics();
  });
  await page.keyboard.down('w');
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.apexDiagnostics())).frame![carBase(0) + F.SPEED],
      { timeout: 20000 },
    )
    .toBeGreaterThan(5);
  await page.keyboard.up('w');
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.apexDiagnostics())).frame![carBase(0) + F.THROTTLE],
    )
    .toBe(0);
  const after = await page.evaluate(() => window.apexDiagnostics());
  expect(after.inputPolls).toBeGreaterThan(before.inputPolls + 5);
  expect(after.frame![H.TICK]).toBeGreaterThan(before.frame![H.TICK] + 20);
  expect(after.auto).toBe(false);
});
