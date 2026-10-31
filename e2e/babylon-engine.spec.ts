import { test, expect } from '@playwright/test';

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
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(status).toContainText('PAUSED');
  const stopped = await tick();
  await page.waitForTimeout(400);
  expect(await tick()).toBe(stopped);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(tick).toBeGreaterThan(stopped);
  await page.locator('#game').click();
  await page.keyboard.press('KeyG');
  await expect(status).toContainText('AI DEMO');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(status).toContainText('DRIVING');
  await expect(page.getByRole('link', { name: 'Full Three.js game' })).toHaveAttribute(
    'href',
    './',
  );
  expect(errors).toEqual([]);
  await info.attach('babylon-engine-preview.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Babylon imports the existing authored Formula asset and restart cancels obsolete loading', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/babylon.html');
  await expect(page.locator('#status')).toContainText('DRIVING');
  const load = page.getByRole('button', {
    name: 'Inspect existing Formula asset (35 MB)',
    exact: true,
  });
  await load.click();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(load).toBeEnabled();
  await expect(page.locator('#assetStatus')).toContainText('optional');
  await load.click();
  await expect(page.locator('#assetStatus')).toContainText(
    'Original Formula asset loaded in Babylon',
    { timeout: 120000 },
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toContainText('PAUSED');
  await info.attach('babylon-original-formula-model.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(load).toBeEnabled();
  await expect(page.locator('#assetStatus')).toContainText('optional');
  expect(errors).toEqual([]);
});
