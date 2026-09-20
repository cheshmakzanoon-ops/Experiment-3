import { test, expect, type Page } from '@playwright/test';
import { H, F, carBase } from '../src/simulation/protocol.ts';
const diag = (page: Page) => page.evaluate(() => window.apexDiagnostics());
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
}
async function inspect(page: Page, id: number) {
  await page.getByRole('button', { name: 'REFERENCE REVIEW', exact: true }).click();
  const entry = page.locator(`[data-reference="${id}"]`);
  await entry.locator('summary').click();
  await entry.locator(`[data-action="reference:${id}"]`).click();
}
test('reference continuation: native showroom and grid views preserve the held simulation', async ({
  page,
}, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const original = await diag(page);
  await inspect(page, 5);
  await expect(page.locator('#photoBackdrop')).toHaveValue('studio');
  await expect.poll(async () => (await diag(page)).renderer!.photo!.backdrop).toBe('studio');
  await expect(page.locator('#photoStatus')).toContainText('REFERENCE 005');
  await info.attach('reference-005-native-showroom.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  const held = await diag(page);
  expect(held.frame).toEqual(original.frame);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  expect((await diag(page)).renderer!.photo).toBeNull();
  await inspect(page, 47);
  await expect.poll(async () => (await diag(page)).renderer!.gridPreparation.blankets).toBe(4);
  await info.attach('reference-047-grid-blankets.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  expect((await diag(page)).frame).toEqual(original.frame);
  expect(errors).toEqual([]);
});
test('reference continuation: night and guide controls are real, reversible and non-physical', async ({
  page,
}, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const original = await diag(page);
  await inspect(page, 79);
  await expect(page.locator('.driving-academy')).toBeVisible();
  await expect.poll(async () => (await diag(page)).renderer!.venueLighting.nearbyLights).toBe(4);
  expect((await diag(page)).renderer!.night).toBe(true);
  await page.locator('[data-action="guide:full"]').click();
  expect((await diag(page)).renderer!.guide.mode).toBe('full');
  await page.locator('[data-action="modalClose"]').click();
  await info.attach('reference-079-original-night-venue.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect((await diag(page)).frame).toEqual(original.frame);
  await page.getByRole('button', { name: 'DRIVING ACADEMY', exact: true }).click();
  await page.locator('[data-action="lighting:day"]').click();
  await expect.poll(async () => (await diag(page)).renderer!.venueLighting.nearbyLights).toBe(0);
  expect((await diag(page)).frame![H.WATER]).toBe(original.frame![H.WATER]);
  expect(errors).toEqual([]);
});
test('reference continuation: explicit programme replacement, live chevrons and no replay awards', async ({
  page,
}, info) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await page.getByRole('button', { name: 'DRIVING ACADEMY', exact: true }).click();
  await page.locator('[data-action="academy:start"]').click();
  await expect(page.getByRole('heading', { name: 'Replace the current session?' })).toBeVisible();
  expect((await diag(page)).state).toBe('menu');
  await page.locator('[data-action="academy:confirm"]').click();
  await expect.poll(async () => (await diag(page)).state, { timeout: 90000 }).toBe('driving');
  expect((await diag(page)).options).toMatchObject({
    mode: 'practice',
    opponents: 0,
    compound: 'medium',
    weather: 'clear',
  });
  await expect.poll(async () => (await diag(page)).renderer!.guide.markers).toBe(64);
  await expect(page.locator('#programmeHud')).toContainText('BANK A CLEAN LAP');
  await info.attach('reference-037-live-guidance.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('g');
  await expect
    .poll(async () => (await diag(page)).frame![carBase(0) + F.SPEED], { timeout: 60000 })
    .toBeGreaterThan(10);
  const progress = (await diag(page)).practiceProgramme;
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'WATCH REPLAY', exact: true }).click();
  await expect.poll(async () => (await diag(page)).state).toBe('replay');
  await expect(page.locator('#programmeHud')).toContainText('AWARDS PAUSED');
  expect((await diag(page)).practiceProgramme).toEqual(progress);
  expect(errors).toEqual([]);
});
