import { test, expect } from '@playwright/test';
import { H } from '../src/simulation/protocol.ts';

test('recorded playback has exclusive modal, seek, audio and focus ownership', async ({
  page,
}, testInfo) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const diagnostics = () => page.evaluate(() => window.apexDiagnostics());
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '0');
  await page.selectOption('#weather', 'rain');
  await page.selectOption('#compound', 'wet');
  await page.getByRole('button', { name: 'ENTER CIRCUIT' }).click();
  await expect
    .poll(async () => (await diagnostics()).state, { timeout: 90000 })
    .toBe('driving');
  await page.keyboard.press('g');
  await expect
    .poll(async () => (await diagnostics()).replaySeconds, { timeout: 30000 })
    .toBeGreaterThan(6);

  // The physics worker must retain one-second telemetry/replay pages while the
  // render/UI thread is genuinely unavailable. This used to exhaust the six
  // transferable pages and create an archival hole after roughly six seconds.
  const beforeStall = await diagnostics();
  const stallMs = 8500;
  await page.evaluate((duration) => {
    const end = performance.now() + duration;
    while (performance.now() < end) {
      // Deliberately occupy the main thread; the dedicated physics worker must
      // continue stepping and recording without a recycle response.
    }
  }, stallMs);
  await expect
    .poll(async () => (await diagnostics()).replaySeconds, { timeout: 30000 })
    .toBeGreaterThan(beforeStall.replaySeconds + 5);
  const afterStall = await diagnostics();
  expect(afterStall.telemetrySamples).toBeGreaterThan(beforeStall.telemetrySamples + 300);
  expect(afterStall.recordingWarnings).toEqual([]);
  await testInfo.attach('recording-stall-continuity.json', {
    body: JSON.stringify(
      {
        stallMs,
        replayBefore: beforeStall.replaySeconds,
        replayAfter: afterStall.replaySeconds,
        telemetryBefore: beforeStall.telemetrySamples,
        telemetryAfter: afterStall.telemetrySamples,
        warnings: afterStall.recordingWarnings,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });

  await page.keyboard.press('t');
  await expect(page.locator('#telemetryModal')).toBeVisible();
  await page.waitForTimeout(200);
  const live = await diagnostics();
  await page.keyboard.press('Escape');
  await expect(page.locator('#telemetryModal')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'RESUME SESSION' })).toBeVisible();
  expect((await diagnostics()).state).toBe('paused');
  await page.getByRole('button', { name: 'WATCH REPLAY' }).click();
  await expect(page.locator('#replayBar')).toBeVisible();
  await expect.poll(async () => (await diagnostics()).audio.playing).toBe(true);

  // A seek while playing must display its exact requested point once, not
  // silently add the next wall interval before drawing the first sample.
  const sought = await page.evaluate(async () => {
    const seek = document.getElementById('replaySeek') as HTMLInputElement;
    seek.value = '0.75';
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return window.apexDiagnostics();
  });
  expect(sought.replaySeekPending).toBe(false);
  expect(sought.replayPosition).toBe(0.75);
  expect(sought.presentation!.time).toBeCloseTo(sought.replayStart + 0.75, 5);

  await page.keyboard.press('t');
  await expect(page.locator('#telemetryModal')).toBeVisible();
  await expect.poll(async () => (await diagnostics()).audio.playing).toBe(false);
  const modal = await diagnostics();
  await page.waitForTimeout(500);
  const modalAfter = await page.evaluate(async () => {
    // Prove callbacks actually ran while the dialog owned the frozen backdrop;
    // a wall-clock sleep alone can miss the bug on a slow software GPU.
    for (let i = 0; i < 4; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return window.apexDiagnostics();
  });
  expect(modalAfter.replayPosition).toBe(modal.replayPosition);
  expect(modalAfter.presentation).toEqual(modal.presentation);
  expect(modalAfter.frame).toEqual(live.frame);
  expect(modalAfter.replayPlaying).toBe(false);
  await page.keyboard.press('c');
  expect((await diagnostics()).renderer!.camera).toBe(modal.renderer!.camera);
  await page.keyboard.press('Escape');
  await expect(page.locator('#telemetryModal')).not.toBeVisible();
  await expect(page.locator('#modal')).not.toBeVisible();
  expect((await diagnostics()).state).toBe('replay');
  await expect(page.locator('#replayPlay')).toHaveText('PLAY');
  await page.waitForTimeout(300);
  expect((await diagnostics()).replayPosition).toBe(modal.replayPosition);

  // Focus restoration cannot resume a replay that a blur suspended.
  await page.locator('#replayPlay').click();
  await expect
    .poll(async () => (await diagnostics()).replayPosition)
    .toBeGreaterThan(modal.replayPosition);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const blurred = await diagnostics();
  expect(blurred.replayPlaying).toBe(false);
  expect(blurred.audio.playing).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(300);
  expect((await diagnostics()).replayPosition).toBe(blurred.replayPosition);
  await page.locator('#replayPlay').click();
  await expect.poll(async () => (await diagnostics()).audio.playing).toBe(true);
  await page.locator('#replayPlay').click();
  await page.locator('#replaySeek').evaluate((element) => {
    (element as HTMLInputElement).value = '0';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => (await diagnostics()).replaySeekPending).toBe(false);
  const held = await diagnostics();
  const heldAfter = await page.evaluate(async () => {
    for (let i = 0; i < 4; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return window.apexDiagnostics();
  });
  expect(heldAfter.presentation).toEqual(held.presentation);
  expect(heldAfter.frame).toEqual(live.frame);
  expect(heldAfter.replayPosition).toBe(0);
  expect(heldAfter.replaySurfaceTime).toBe(0);
  expect((await diagnostics()).frame![H.TICK]).toBe(live.frame![H.TICK]);
  expect((await diagnostics()).recordingWarnings).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('replay-first-frame.png') });
  await testInfo.attach('replay-ownership.json', {
    body: JSON.stringify(
      { sought, modal, modalAfter, blurred, final: await diagnostics() },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await page.getByRole('button', { name: 'RETURN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'RESUME SESSION' })).toBeVisible();
  expect((await diagnostics()).audio.playing).toBe(false);
  expect((await diagnostics()).frame).toEqual(live.frame);
  expect(errors).toEqual([]);
});
