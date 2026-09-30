import { test, expect, type Page } from '@playwright/test';
import { F, carBase } from '../src/simulation/protocol.ts';

async function diag(page: Page) {
  return page.evaluate(() => window.apexDiagnostics());
}

/** The second circuit is reachable from the menu, drives through the same
 * worker physics on its own elevation, and hands back to Aurel cleanly. */
test('Vellamar: menu selection, climbing lap in the production worker and return to Aurel', async ({
  page,
}, info) => {
  test.setTimeout(600000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await page.selectOption('#circuit', 'vellamar');
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '3');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await expect.poll(async () => (await diag(page)).state, { timeout: 240000 }).toBe('driving');
  const start = await diag(page);
  expect(start.options.circuit).toBe('vellamar');
  await expect(page.locator('#minimapCaption')).toHaveText('VELLAMAR / COAST CIRCUIT');
  await expect(page.locator('#circuitLength')).toHaveText('3.997');
  await page.keyboard.press('g');
  // Past the Ascent switchback the road is ~12 m above the coast straight.
  let climb = 0;
  await expect
    .poll(
      async () => {
        const f = (await diag(page)).frame!,
          o = carBase(0);
        if (f[o + F.S] > 1300 && f[o + F.S] < 1900) climb = Math.max(climb, f[o + F.Y]);
        return climb;
      },
      { timeout: 300000, intervals: [500] },
    )
    .toBeGreaterThan(9);
  await page.screenshot({ path: info.outputPath('vellamar-ascent.png') });
  const moving = await diag(page);
  expect(moving.frame![carBase(0) + F.RETIRED]).toBe(0);
  expect(moving.renderer!.drawCalls).toBeGreaterThan(0);
  // Return to the paddock and start Aurel: the renderer is rebuilt for it.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'RETURN TO PADDOCK', exact: true }).click();
  await expect(page.locator('#menu')).toBeVisible();
  await page.selectOption('#circuit', 'aurel');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await expect.poll(async () => (await diag(page)).state, { timeout: 240000 }).toBe('driving');
  expect((await diag(page)).options.circuit).toBe('aurel');
  await expect(page.locator('#minimapCaption')).toHaveText('AUREL / GRAND CIRCUIT');
  await expect(page.locator('#circuitLength')).toHaveText(/^2\.9\d\d$/);
  expect(errors).toEqual([]);
});
