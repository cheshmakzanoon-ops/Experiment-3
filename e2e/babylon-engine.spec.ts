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
  const driverSteering = async () =>
    Number(await page.locator('#assetStatus').getAttribute('data-steering'));
  await page.keyboard.down('a');
  try {
    await expect.poll(driverSteering).toBeGreaterThan(0.7);
  } finally {
    await page.keyboard.up('a');
  }
  await page.keyboard.down('d');
  try {
    await expect.poll(driverSteering).toBeLessThan(0.3);
  } finally {
    await page.keyboard.up('d');
  }
  await expect.poll(async () => Math.abs((await driverSteering()) - 0.5)).toBeLessThan(0.05);
  const wheelPhase = async () =>
    Number(await page.locator('#assetStatus').getAttribute('data-wheel-phase'));
  const initialWheel = await wheelPhase();
  await page.keyboard.down('w');
  try {
    await expect
      .poll(
        async () => {
          const delta = (await wheelPhase()) - initialWheel;
          return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
        },
        { timeout: 15000 },
      )
      .toBeGreaterThan(0.1);
  } finally {
    await page.keyboard.up('w');
  }
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toContainText('PAUSED');
  const frozenWheel = await wheelPhase();
  const frozenDriver = await driverSteering();
  await page.waitForTimeout(300);
  expect(await driverSteering()).toBe(frozenDriver);
  expect(await wheelPhase()).toBe(frozenWheel);
  // The reported phase is read back from the applied Babylon spin node.
  await info.attach('babylon-original-formula-model.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(load).toBeEnabled();
  await expect(page.locator('#assetStatus')).toContainText('optional');
  await expect(page.locator('#assetStatus')).not.toHaveAttribute('data-wheel-phase');
  expect(errors).toEqual([]);
});

test('Babylon uses the production driving inputs, including keyboard throttle and touch steering', async ({
  page,
}) => {
  await page.goto('/babylon.html');
  await expect(page.locator('#status')).toContainText('DRIVING');
  const speed = async () =>
    Number((await page.locator('#status').textContent())?.match(/(\d+) km\/h/)?.[1] ?? -1);
  await page.locator('#game').click();
  await page.keyboard.down('w');
  await expect.poll(speed, { timeout: 15000 }).toBeGreaterThan(8);
  await page.keyboard.up('w');
  await expect(page.getByRole('navigation', { name: 'Touch driving controls' })).toBeVisible();
  const right = await page.getByRole('button', { name: 'Steer right', exact: true }).boundingBox();
  expect(right).not.toBeNull();
  await page.mouse.move(right!.x + right!.width / 2, right!.y + right!.height / 2);
  await page.mouse.down();
  await expect
    .poll(async () => Number(await page.locator('#status').getAttribute('data-steer')))
    .toBeLessThan(-0.02);
  await page.mouse.up();
  await expect
    .poll(async () => Math.abs(Number(await page.locator('#status').getAttribute('data-steer'))))
    .toBeLessThan(0.01);

  await page.keyboard.press('Escape');
  await expect(page.locator('#status')).toContainText('PAUSED');
  await page.keyboard.press('Escape');
  await expect(page.locator('#status')).toContainText('DRIVING');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect.poll(speed).toBeLessThan(3);
});

test('Babylon diagnostic panel leaves the native driving view clear at minimum window size', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1008, height: 689 });
  await page.goto('/babylon.html');
  await expect(page.locator('#status')).toContainText('DRIVING');
  const panel = await page.locator('#panel').boundingBox();
  const controls = await page.locator('#touchDrive').boundingBox();
  expect(panel).not.toBeNull();
  expect(controls).not.toBeNull();
  expect(panel!.x + panel!.width).toBeLessThan(1008 * 0.45);
  expect(panel!.y + panel!.height).toBeLessThan(controls!.y);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toContainText('PAUSED');
});
