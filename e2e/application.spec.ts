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
  await page.keyboard.press('c');
  await expect.poll(async () => (await diag(page)).renderer?.camera).toBe('cockpit');
  await expect.poll(async () => (await diag(page)).renderer?.mirrorUpdates).toBeGreaterThan(2);
  const visual = await page.evaluate(() => window.apexDiagnostics(true));
  const eye = visual.renderer!.cameraLocalPosition;
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
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
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
  await page.keyboard.press('t');
  await expect(page.locator('#telemetryModal')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('04-telemetry.png') });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'EXPORT CSV' }).click();
  const csvDownload = await download;
  expect(csvDownload.suggestedFilename()).toBe('apex-telemetry.csv');
  const csv = (await readFile((await csvDownload.path())!, 'utf8')).trim().split('\n');
  const columns = csv[0].split(',');
  expect(columns).toHaveLength(176);
  expect(columns).toContain('motor_power_W');
  expect(columns).toContain('FL_pressure_kPa');
  expect(csv.length).toBeGreaterThan(1320);
  const tickColumn = columns.indexOf('tick');
  const firstTick = Number(csv[1].split(',')[tickColumn]);
  for (let row = 2; row < csv.length; row++) {
    expect(Number(csv[row].split(',')[tickColumn]) - firstTick).toBe(2 * (row - 1));
  }
  await page.getByRole('button', { name: 'Close telemetry' }).click();
  await page.getByRole('button', { name: 'WATCH REPLAY' }).click();
  await expect(page.locator('#replayBar')).toBeVisible();
  const tick = (await diag(page)).frame![H.TICK];
  await page.locator('#replaySeek').evaluate((element) => {
    (element as HTMLInputElement).value = '1';
    element.dispatchEvent(new Event('input', { bubbles: true }));
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
  await page.selectOption('#opponents', '0');
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
