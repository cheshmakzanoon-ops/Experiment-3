import { expect, test } from '@playwright/test';
import { F, carBase } from '../src/simulation/protocol.ts';

test('custom wheel calibration persists, drives a real clutch and disconnects safely', async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.addInitScript(() => {
    const pad = {
      index: 2,
      id: 'Regression wheel',
      mapping: '',
      connected: true,
      axes: [0, 1, -1, 1],
      buttons: Array.from({ length: 12 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    Object.assign(window, { testWheel: pad });
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [null, null, pad.connected ? pad : null],
    });
  });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.getByLabel('Active input device').selectOption('2');
  await page.locator('[name=steerAxis]').fill('0');
  await page.locator('[name=throttleAxis]').fill('1');
  await page.locator('[name=brakeAxis]').fill('2');
  await page.locator('[name=clutchAxis]').fill('3');
  await page.locator('[name=shiftUpButton]').fill('10');
  await page.locator('[name=shiftDownButton]').fill('11');
  await page.locator('[name=action_camera]').fill('3');
  await page.locator('[name=action_ers]').fill('2');
  await page.locator('[name=action_pause]').fill('9');
  await page.locator('[name=axisPedals]').check();
  await page.locator('[name=wheelSteering]').check();
  await page.locator('[name=manualClutch]').check();
  const set = async (axis: number, value: number) =>
    page.evaluate(
      ({ axis, value }) => {
        (window as unknown as { testWheel: { axes: number[] } }).testWheel.axes[axis] = value;
      },
      { axis, value },
    );
  for (const [capture, axis, value] of [
    ['steering:left', 0, -0.8],
    ['steering:center', 0, 0.1],
    ['steering:right', 0, 0.7],
    ['throttle:released', 1, 1],
    ['throttle:pressed', 1, -1],
    ['brake:released', 2, -1],
    ['brake:pressed', 2, 1],
    ['clutch:released', 3, 1],
    ['clutch:pressed', 3, -1],
  ] as const) {
    await set(axis, value);
    await page.locator(`[data-capture="${capture}"]`).click();
    await expect(page.locator(`[data-capture="${capture}"]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await expect(page.locator('#toast')).toContainText('Preferences saved.');
  await expect(page.locator('#modal')).toBeHidden();
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await expect(page.getByLabel('Active input device')).toHaveValue('2');
  await expect(page.locator('[name=manualClutch]')).toBeChecked();
  await expect(page.locator('[name=shiftUpButton]')).toHaveValue('10');
  await expect(page.locator('[name=action_camera]')).toHaveValue('3');
  await expect(page.locator('[name=action_pause]')).toHaveValue('9');
  // A driving-button conflict must remain visible and leave persisted input intact.
  await page.locator('[name=action_camera]').fill('10');
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await expect(page.locator('#toast')).toContainText('conflicts');
  await expect(page.locator('#modal')).toBeVisible();
  await page.locator('[name=action_camera]').fill('3');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await set(0, 0.1);
  await set(1, -0.7);
  await set(2, -1);
  await set(3, -1);
  await page.locator('#mode').selectOption('practice');
  await page.locator('#opponents').selectOption('0');
  await page.getByRole('button', { name: /ENTER CIRCUIT/ }).click();
  // Session startup replaces the preview and initializes a module worker.
  // A null frame during that transition is not a failed clutch response.
  await expect
    .poll(async () => page.evaluate(() => window.apexDiagnostics().state), {
      timeout: 60000,
    })
    .toBe('driving');
  const press = async (index: number, down: boolean) =>
    page.evaluate(
      ({ index, down }) => {
        const pad = (window as unknown as { testWheel: { buttons: GamepadButton[] } }).testWheel;
        pad.buttons[index] = { pressed: down, touched: down, value: Number(down) };
      },
      { index, down },
    );
  await press(3, true);
  await expect
    .poll(() => page.evaluate(() => window.apexDiagnostics().renderer?.presentedCamera))
    .toBe('cockpit');
  await press(3, false);
  await press(9, true);
  await expect(page.getByRole('button', { name: 'RESUME SESSION' })).toBeVisible();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.apexDiagnostics().state)).toBe('paused');
  await press(9, false);
  await page.waitForTimeout(60);
  await press(9, true);
  await expect.poll(() => page.evaluate(() => window.apexDiagnostics().state)).toBe('driving');
  await press(9, false);
  const frame = () => page.evaluate(() => window.apexDiagnostics().frame!);
  await expect
    .poll(async () => (await frame())[carBase(0) + F.RPM], { timeout: 60000 })
    .toBeGreaterThan(8000);
  expect((await frame())[carBase(0) + F.SPEED]).toBeLessThan(0.5);
  expect((await frame())[carBase(0) + F.CLUTCH_ENGAGEMENT]).toBe(0);
  await set(3, 1);
  await expect
    .poll(async () => (await frame())[carBase(0) + F.SPEED], { timeout: 60000 })
    .toBeGreaterThan(5);
  await page.evaluate(() => {
    (window as unknown as { testWheel: { connected: boolean } }).testWheel.connected = false;
  });
  await expect(page.getByRole('button', { name: 'RESUME SESSION' })).toBeVisible();
  await expect(page.locator('#toast')).toContainText('controller disconnected');
});

test('incomplete calibration cannot be saved and closing the editor discards capture state', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const pad = {
      index: 0,
      id: 'Incomplete wheel',
      mapping: '',
      connected: true,
      axes: [-0.8],
      buttons: [],
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60000 });
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.getByLabel('Active input device').selectOption('0');
  await page.locator('[data-capture="steering:left"]').click();
  await page.getByRole('button', { name: 'APPLY & SAVE' }).click();
  await expect(page.locator('#toast')).toContainText('Finish all endpoint captures');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await expect(page.getByLabel('Active input device')).toHaveValue('-1');
  await expect(page.locator('[data-capture="steering:left"]')).not.toHaveAttribute(
    'data-captured',
    /./,
  );
});
