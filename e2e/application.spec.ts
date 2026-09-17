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
  await page.waitForTimeout(300);
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
  await page.keyboard.press('t');
  await expect(page.locator('#telemetryModal')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('04-telemetry.png') });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'EXPORT CSV' }).click();
  expect((await download).suggestedFilename()).toBe('apex-telemetry.csv');
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
