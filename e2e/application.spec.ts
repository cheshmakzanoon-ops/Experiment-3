import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { F, H, carBase } from '../src/simulation/protocol.ts';
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 60000 });
}
async function diag(page: Page) {
  return page.evaluate(() => window.apexDiagnostics());
}
async function begin(page: Page) {
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '3');
  await page.getByRole('button', { name: 'ENTER CIRCUIT' }).click();
  await expect.poll(async () => (await diag(page)).state, { timeout: 40000 }).toBe('driving');
}
test('browser session, cameras, pause safety, telemetry and replay', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error('PAGE ERROR:', e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') {
      errors.push(m.text());
      console.error('BROWSER ERROR:', m.text());
    }
  });
  await ready(page);
  const construction = (await diag(page)).renderer!.construction;
  expect(construction.tasks).toBeGreaterThan(100);
  expect(construction.yields).toBeGreaterThan(2);
  expect(construction.cancelled).toBe(false);
  await testInfo.attach('bootstrap-metrics.json', {
    body: JSON.stringify(construction, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: testInfo.outputPath('01-paddock.png') });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await begin(page);
  await page.keyboard.press('g');
  await expect
    .poll(
      async () => {
        const d = await diag(page);
        return d.frame?.[carBase(0) + F.SPEED] ?? 0;
      },
      { timeout: 60000 },
    )
    .toBeGreaterThan(15);
  await page.screenshot({ path: testInfo.outputPath('02-racing.png') });
  await page.keyboard.press('F3');
  await expect(page.locator('#debug')).toContainText('AI TARGET PATH');
  await expect(page.locator('#debug')).toContainText('RUBBER');
  await expect(page.locator('#debug')).toContainText('Fz N / Fx N / Fy N');
  await expect.poll(async () => (await diag(page)).engineering?.aiActive).toBe(true);
  await expect.poll(async () => (await diag(page)).presentation?.engineeringVisible).toBe(true);
  const engineering = (await diag(page)).engineering!;
  expect(engineering.wheels).toHaveLength(4);
  expect(engineering.wheels.some((wheel) => wheel.loadN > 1)).toBe(true);
  await testInfo.attach('live-engineering.json', {
    body: JSON.stringify(engineering, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: testInfo.outputPath('02-engineering.png') });
  await page.keyboard.press('F3');
  await expect(page.locator('#debug')).toBeHidden();

  await page.keyboard.press('c');
  await expect.poll(async () => (await diag(page)).renderer?.camera).toBe('cockpit');
  await expect.poll(async () => (await diag(page)).renderer?.mirrorUpdates).toBeGreaterThan(2);
  const visual = await page.evaluate(() => window.apexDiagnostics(true));
  const eye = visual.renderer!.cameraLocalPosition;
  expect(visual.visual!.driver).toHaveLength(2);
  for (const arm of visual.visual!.driver) {
    expect(arm.reachable).toBe(true);
    expect(arm.upperLength).toBeCloseTo(0.37, 6);
    expect(arm.lowerLength).toBeCloseTo(0.36, 6);
  }
  expect(Math.abs(eye[0])).toBeLessThan(0.06);
  expect(eye[1]).toBeGreaterThan(0.35);
  expect(eye[1]).toBeLessThan(0.48);
  expect(eye[2]).toBeGreaterThan(-0.56);
  expect(eye[2]).toBeLessThan(-0.4);
  expect(visual.visual!.screenVisible).toBe(true);
  expect(Math.abs(visual.visual!.wheelProjection[0])).toBeLessThan(1);
  expect(Math.abs(visual.visual!.wheelProjection[1])).toBeLessThan(1);
  expect(visual.visual!.mirrors.every((mirror) => mirror.range > 5)).toBe(true);
  await testInfo.attach('cockpit-diagnostics.json', {
    body: JSON.stringify(visual, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: testInfo.outputPath('03-cockpit.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'RESUME SESSION' })).toBeVisible();
  await page.waitForTimeout(500);
  const paused = await diag(page);
  await page.waitForTimeout(1000);
  const after = await diag(page);
  expect(after.frame?.[H.TICK]).toBe(paused.frame?.[H.TICK]);
  await page.getByRole('button', { name: 'RESUME SESSION' }).click();
  await expect
    .poll(async () => (await diag(page)).frame?.[H.TICK])
    .toBeGreaterThan(paused.frame![H.TICK]);
  expect(errors).toEqual([]);
});
test('recorded telemetry exports and replay leaves live physics paused', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await ready(page);
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  // Keep the inexpensive low preset but explicitly enable the existing particle
  // control: a zero-density preset cannot prove replay spray/rain works.
  await page.locator('[name=graphics_particleDensity]').evaluate((element) => {
    (element as HTMLInputElement).value = '0.4';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await page.selectOption('#weather', 'rain');
  await page.selectOption('#compound', 'wet');
  await begin(page);
  await page.keyboard.press('g');
  await expect
    .poll(async () => (await diag(page)).telemetrySamples, { timeout: 60000 })
    .toBeGreaterThan(60 * 22);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('apex-replay-cache', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<number>((resolve, reject) => {
            const tx = db.transaction('pages', 'readonly'),
              request = tx.objectStore('pages').count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        } finally {
          db.close();
        }
      }),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await diag(page)).presentation?.particles.spawned[3])
    .toBeGreaterThan(0);
  await page.keyboard.press('t');
  await expect(page.locator('#telemetryModal')).toBeVisible();
  await page.getByLabel('Telemetry channels').selectOption('tires');
  await expect(page.locator('#graph')).toHaveAttribute('data-view', 'tires');
  await expect(page.locator('#graph')).toHaveAttribute(
    'aria-label',
    /Carcass temperature.*Contact load/,
  );
  await page.screenshot({ path: testInfo.outputPath('04-telemetry.png') });
  await page.getByLabel('Telemetry channels').selectOption('balance');
  await expect(page.locator('#graph')).toHaveAttribute('aria-label', /Aerodynamic balance/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'EXPORT CSV' }).click();
  const csvDownload = await download;
  expect(csvDownload.suggestedFilename()).toBe('apex-telemetry.csv');
  const csv = (await readFile((await csvDownload.path())!, 'utf8')).trim().split('\n');
  const columns = csv[0].split(',');
  expect(columns).toHaveLength(211);
  expect(columns.slice(197, 199)).toEqual(['wind_x_mps', 'wind_z_mps']);
  expect(columns.slice(-4)).toEqual([
    'marble_pickup_fr_tread_covers',
    'marble_pickup_fl_tread_covers',
    'marble_pickup_rr_tread_covers',
    'marble_pickup_rl_tread_covers',
  ]);
  expect(columns).toContain('clutch_torque_Nm');
  expect(columns).toContain('motor_power_W');
  expect(columns).toContain('FL_pressure_kPa');
  expect(csv.length).toBeGreaterThan(1320);
  const tickColumn = columns.indexOf('tick');
  const firstTick = Number(csv[1].split(',')[tickColumn]);
  for (let row = 2; row < csv.length; row++) {
    expect(Number(csv[row].split(',')[tickColumn]) - firstTick).toBe(2 * (row - 1));
  }
  const stopped = await diag(page);
  await page.waitForTimeout(500);
  const stillStopped = await diag(page);
  expect(stillStopped.presentation!.time).toBe(stopped.presentation!.time);
  expect(stillStopped.presentation!.particles).toEqual(stopped.presentation!.particles);
  await page.getByRole('button', { name: 'Close telemetry' }).click();
  await page.getByRole('button', { name: 'WATCH REPLAY' }).click();
  await expect(page.locator('#replayBar')).toBeVisible();
  const tick = (await diag(page)).frame![H.TICK];
  await page.locator('#replaySeek').evaluate((element) => {
    (element as HTMLInputElement).value = '1';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect
    .poll(async () => (await diag(page)).presentation?.particles.spawned[3])
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await diag(page)).presentation?.particles.spawned[0])
    .toBeGreaterThan(0);
  // Camera changes must update the actual audio listener, not the recorded car.
  for (let i = 0; i < 3; i++) await page.locator('#replayBar [data-action=camera]').click();
  await expect.poll(async () => (await diag(page)).renderer?.camera).toBe('trackside');
  // The request is synchronous; the real camera/listener updates on the next
  // rendered frame. Require that presentation rather than read the old pod view.
  await expect.poll(async () => (await diag(page)).renderer?.presentedCamera).toBe('trackside');
  await expect.poll(async () => (await diag(page)).presentation?.listener.interior).toBe(false);
  await expect.poll(async () => (await diag(page)).audio.voices.length).toBeGreaterThan(0);
  const listening = await diag(page);
  expect(listening.presentation!.listener.interior).toBe(false);
  expect(
    Math.hypot(
      listening.presentation!.listener.vx,
      listening.presentation!.listener.vy,
      listening.presentation!.listener.vz,
    ),
  ).toBeLessThan(0.001);
  expect(listening.audio.voices.every((voice) => Number.isFinite(voice.pan + voice.doppler))).toBe(
    true,
  );
  await page.locator('#replayPlay').click();
  await expect(page.locator('#replayPlay')).toHaveText('PLAY');
  const replayPaused = await diag(page);
  await page.waitForTimeout(500);
  const replayStill = await diag(page);
  expect(replayStill.presentation).toEqual(replayPaused.presentation);
  expect(replayStill.replayPosition).toBe(replayPaused.replayPosition);
  await page.locator('#replaySpeed').selectOption('2');
  await page.locator('#replayPlay').click();
  await expect
    .poll(async () => (await diag(page)).replayPosition)
    .toBeGreaterThan(replayPaused.replayPosition);
  await testInfo.attach('replay-effects-and-listener.json', {
    body: JSON.stringify(await diag(page), null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: testInfo.outputPath('05-replay.png') });
  await page.waitForTimeout(1000);
  expect((await diag(page)).frame![H.TICK]).toBe(tick);
  expect((await diag(page)).replayError).toBeNull();
  expect((await diag(page)).recordingWarnings).toEqual([]);
  await page.getByRole('button', { name: 'RETURN', exact: true }).click();
  await page.getByRole('button', { name: 'RETURN TO PADDOCK' }).click();
  await expect(page.locator('#menu')).toBeVisible();
  await testInfo.attach('diagnostics.json', {
    body: JSON.stringify(await diag(page), null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
test('preferences persist and invalid setup import fails safely', async ({ page }, testInfo) => {
  await ready(page);
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('medium');
  await page.locator('[name=frontWing]').evaluate((element) => {
    (element as HTMLInputElement).value = '0.8';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.screenshot({ path: testInfo.outputPath('06-garage.png') });
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await expect(page.locator('#toast')).toContainText('saved');
  await page.reload();
  await expect(page.locator('#menu')).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await expect(page.locator('[name=frontWing]')).toHaveValue('0.8');
  await page.locator('#importSetup').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":42,"setup":{}}'),
  });
  await expect(page.locator('#toast')).toContainText('Import rejected');
});
test('small viewport keeps every session control reachable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await expect(page.getByRole('button', { name: 'ENTER CIRCUIT' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('07-mobile-menu.png') });
  await page.getByRole('button', { name: 'CONTROLS', exact: true }).click();
  await expect(page.getByRole('button', { name: 'UNDERSTOOD' })).toBeVisible();
  await page.getByRole('button', { name: 'UNDERSTOOD' }).click();
  await expect(page.locator('#menu')).toBeVisible();
});
test('race start and chequered flag produce an actual result', async ({ page }, testInfo) => {
  test.setTimeout(210000);
  await ready(page);
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await page.selectOption('#laps', '1');
  await page.selectOption('#opponents', '3');
  await page.getByRole('button', { name: 'ENTER CIRCUIT' }).click();
  await expect.poll(async () => (await diag(page)).state, { timeout: 40000 }).toBe('driving');
  await page.keyboard.press('g');
  await expect
    .poll(async () => (await diag(page)).state, { timeout: 150000, intervals: [2000] })
    .toBe('results');
  await expect(page.getByRole('heading', { name: 'Across the line.' })).toBeVisible();
  const frame = (await diag(page)).frame!;
  expect(frame[carBase(0) + F.LAPS]).toBe(1);
  expect(frame[carBase(0) + F.BEST_LAP]).toBeGreaterThan(20);
  expect(frame[H.CARS]).toBe(4);
  for (let id = 0; id < 4; id++) {
    const p = carBase(id);
    expect(frame[p + F.FINISH]).toBeGreaterThan(0);
    expect(frame[p + F.RETIRED]).toBe(0);
    expect(frame[p + F.SECTOR_3]).toBeGreaterThan(0);
  }
  await expect(page.locator('.results')).not.toContainText('RUNNING');
  await page.screenshot({ path: testInfo.outputPath('08-results.png') });
});

test('high quality compiles shaders and renders a live local reflection', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await ready(page);
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('high');
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await begin(page);
  const started = await diag(page);
  expect(started.renderer!.warmupFrames).toBeGreaterThanOrEqual(2);
  expect(started.recordingWarnings).toEqual([]);
  await page.keyboard.press('c');
  await expect
    .poll(async () => (await diag(page)).renderer?.reflectionProbeUpdates, { timeout: 60000 })
    .toBeGreaterThan(0);
  await expect.poll(async () => (await diag(page)).renderer?.mirrorUpdates).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('09-high-cockpit.png') });
  await testInfo.attach('high-quality-diagnostics.json', {
    body: JSON.stringify(await page.evaluate(() => window.apexDiagnostics(true)), null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('manual right steering and live rear-view passes work without autopilot', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await ready(page);
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '0');
  await page.getByRole('button', { name: 'ENTER CIRCUIT' }).click();
  await expect.poll(async () => (await diag(page)).state, { timeout: 40000 }).toBe('driving');
  expect((await diag(page)).auto).toBe(false);
  await page.keyboard.down('w');
  await expect
    .poll(async () => (await diag(page)).frame?.[carBase(0) + F.SPEED], { timeout: 30000 })
    .toBeGreaterThan(8);
  await page.keyboard.down('d');
  await expect
    .poll(async () => (await diag(page)).frame?.[carBase(0) + F.STEER])
    .toBeLessThan(-0.03);
  await page.keyboard.up('d');
  await page.keyboard.up('w');
  await page.keyboard.down('s');
  await page.keyboard.press('c');
  const before = (await diag(page)).renderer?.mirrorUpdates ?? 0;
  await expect
    .poll(async () => (await diag(page)).renderer?.mirrorUpdates)
    .toBeGreaterThan(before + 2);
  expect((await diag(page)).renderer?.mirrorWidth).toBe(128);
  await page.screenshot({ path: testInfo.outputPath('09-live-mirrors-manual.png') });
  await page.keyboard.up('s');
  await page.keyboard.press('Escape');
  await testInfo.attach('manual-mirror-diagnostics.json', {
    body: JSON.stringify(await diag(page), null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('keyboard remapping rejects conflicts, cleans cancelled capture and persists valid changes', async ({
  page,
}) => {
  await ready(page);
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  const throttle = page.locator('[data-bind="throttle"]');
  await throttle.click();
  await page.keyboard.press('c');
  await expect(page.locator('#toast')).toContainText('already assigned');
  await expect(throttle).toHaveAttribute('data-key', 'KeyW');
  await page.keyboard.press('Escape');
  await expect(throttle).toHaveText('W');
  await throttle.click();
  await page.keyboard.press('i');
  await expect(throttle).toHaveAttribute('data-key', 'KeyI');
  await page.locator('[data-bind="camera"]').click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await expect(page.locator('[data-bind="camera"]')).toHaveText('C');
  await page.locator('[data-bind="throttle"]').click();
  await page.keyboard.press('i');
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await expect(page.locator('#toast')).toContainText('Preferences saved');
  await page.reload();
  await ready(page);
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await expect(page.locator('[data-bind="throttle"]')).toHaveAttribute('data-key', 'KeyI');
});
