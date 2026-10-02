import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { H } from '../src/simulation/protocol.ts';
import { CREW_PERFORMANCE } from '../src/rendering/crew-performance.ts';

const baseline = process.env.CREW_BASELINE === '1';
test.use({
  viewport: { width: 800, height: 500 },
  video: { mode: 'on', size: { width: 800, height: 500 } },
});
async function capture(page: Page, info: TestInfo, name: string) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await info.attach(name, { body: Buffer.from(data, 'base64'), contentType: 'image/png' });
  } finally {
    await cdp.detach();
  }
}

test('A41/A42 authored crew: continuous Low full-grid performance, held physics and race handover', async ({
  page,
}, info) => {
  test.setTimeout(600000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const read = () => page.evaluate(() => window.apexDiagnostics());
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 120000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  // Continuous evidence uses Low on the CPU rasterizer. The separate Medium
  // survey below retains the complete grid, shadows, contacts and close poses.
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await page.selectOption('#mode', 'race');
  await page.selectOption('#opponents', '11');
  await page.selectOption('#laps', '3');
  await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
  await expect.poll(async () => (await read()).frame?.[H.TICK] ?? -1).toBe(0);
  await expect
    .poll(async () => (await read()).workerPause)
    .toMatchObject({ paused: true, pending: false });
  const before = (await read()).frame;
  expect(before?.[H.CARS]).toBe(12);
  await page.getByRole('button', { name: 'PRE-RACE PRESENTATION', exact: true }).click();
  await page.getByRole('button', { name: 'PLAY PREPARATION', exact: true }).click();
  const observations: unknown[] = [];
  // No pose seek: video records every transition on the actual presentation clock.
  for (const time of [2, 6, 10, 14, 16.5, 21, 30, 37.8]) {
    await expect
      .poll(() => page.evaluate(() => window.apexDiagnostics().gridPresentation.time), {
        timeout: 120000,
        intervals: [500],
      })
      .toBeGreaterThan(time);
    const d = await read();
    expect(d.frame).toEqual(before);
    expect(d.workerPause.paused).toBe(true);
    const crew = d.renderer!.gridPerformance!;
    expect(crew.actors).toBeGreaterThan(0);
    if (!baseline) {
      expect(crew.asset).toBe(CREW_PERFORMANCE.runtimeSHA256);
      expect(CREW_PERFORMANCE.actions).toContain(crew.authoredAction);
    }
    for (const c of crew.contacts) {
      expect(c.arms).toBe(true);
      expect(c.feet).toBe(true);
      expect(c.gripError).toBeLessThan(0.001);
    }
    observations.push({ time: d.gridPresentation.time, crew, renderer: d.renderer });
    await capture(page, info, `crew-${baseline ? 'before' : 'after'}-${time}.png`);
  }
  await expect.poll(async () => (await read()).gridPresentation.complete).toBe(true);
  expect((await read()).frame).toEqual(before);
  await page.getByRole('button', { name: 'BEGIN RACE', exact: true }).click();
  await expect.poll(async () => (await read()).state).toBe('driving');
  await expect.poll(async () => (await read()).frame?.[H.TIME] ?? 0).toBeGreaterThan(1);
  expect((await read()).renderer?.gridPerformance?.parked).toBe(true);
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await read()).workerPause)
    .toMatchObject({ paused: true, pending: false });
  await info.attach('crew-observations.json', {
    body: JSON.stringify({
      baseline,
      quality: 'low',
      viewport: { width: 800, height: 500 },
      observations,
      final: await read(),
      boundary:
        'Continuous software-rendered integration evidence, not hardware FPS or final art approval.',
    }),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

// Do not drop the Medium visual workload to get continuous video. Inspect the
// same complete grid with its real paused timeline; no physics-channel writes.
test('A41/A42 authored crew: Medium full-grid pose and shadow survey', async ({ page }, info) => {
  test.setTimeout(600000);
  await page.setViewportSize({ width: 960, height: 600 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const read = () => page.evaluate(() => window.apexDiagnostics());
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 120000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('medium');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await page.selectOption('#mode', 'race');
  await page.selectOption('#opponents', '11');
  await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
  await expect.poll(async () => (await read()).frame?.[H.TICK] ?? -1).toBe(0);
  await expect
    .poll(async () => (await read()).workerPause)
    .toMatchObject({
      paused: true,
      pending: false,
    });
  const before = (await read()).frame;
  expect(before?.[H.CARS]).toBe(12);
  await page.getByRole('button', { name: 'PRE-RACE PRESENTATION', exact: true }).click();
  const observations: unknown[] = [];
  for (const time of [0, 8, 10.5, 14, 16.5, 21, 30, 38]) {
    await page.locator('#gridPresentationSeek').evaluate((node, value) => {
      const input = node as HTMLInputElement;
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, time);
    await expect
      .poll(() => page.evaluate(() => window.apexDiagnostics().gridPresentation.time))
      .toBe(time);
    // Wait for the production frame to consume the UI seek, not just the DOM.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const d = await read(),
      crew = d.renderer!.gridPerformance!;
    expect(d.frame).toEqual(before);
    expect(d.workerPause.paused).toBe(true);
    expect(d.gridPresentation.playing).toBe(false);
    expect(crew.actors).toBeGreaterThan(0);
    if (!baseline) {
      expect(crew.asset).toBe(CREW_PERFORMANCE.runtimeSHA256);
      expect(CREW_PERFORMANCE.actions).toContain(crew.authoredAction);
    }
    for (const c of crew.contacts) {
      expect(c.arms).toBe(true);
      expect(c.feet).toBe(true);
      expect(c.gripError).toBeLessThan(0.001);
    }
    observations.push({ time, crew, renderer: d.renderer });
    await capture(page, info, `crew-${baseline ? 'before' : 'after'}-medium-${time}.png`);
  }
  await info.attach('crew-medium-observations.json', {
    body: JSON.stringify({ baseline, quality: 'medium', observations }),
    contentType: 'application/json',
  });
  await page.getByRole('button', { name: 'BACK TO GRID MENU', exact: true }).click();
  await expect.poll(async () => (await read()).state).toBe('paused');
  expect((await read()).frame).toEqual(before);
  expect(errors).toEqual([]);
});
