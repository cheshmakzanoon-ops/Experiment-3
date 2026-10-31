import { expect } from '@playwright/test';

/** Exercise the retained production game through its installed native menu.
 * No fixture scripts, AI driver, frame writes, or synthetic simulation input. */
export async function verifyDesktopCompatibility(application, page, report, capture, stage) {
  await application.evaluate(({ Menu, BrowserWindow }) => {
    const game = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Game');
    const fallback = game?.submenu?.items.find(
      (item) => item.label === 'Existing content · migration fallback',
    );
    if (!fallback) throw new Error('Native compatibility menu entry is missing');
    fallback.click(fallback, BrowserWindow.getAllWindows()[0], {});
  });
  await page.waitForURL('motobound://game/index.html', { timeout: 180000 });
  await expect(page.locator('#menu')).toBeVisible({ timeout: 180000 });
  stage('compatibility-menu-ready');
  // Use the shipped settings UI for a repeatable software-runner workload.
  // This is functional coverage, not a high-quality graphics/performance claim.
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption('low');
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await expect(page.locator('#modal')).toBeHidden({ timeout: 180000 });
  const read = () =>
    page.evaluate(() => {
      const d = window.apexDiagnostics();
      return {
        state: d.state,
        auto: d.auto,
        options: d.options,
        motion: d.motion,
        workerPause: d.workerPause,
        presentationFrames: d.presentation?.frames,
      };
    });
  report.compatibility = [];
  const disciplines = [
    { id: 'formula', title: 'FORMULA', circuit: 'aurel', vehicle: 'apx01', mode: 'practice' },
    {
      id: 'gp',
      title: 'GP MOTORCYCLES',
      circuit: 'poggio-alto',
      vehicle: 'gpr1',
      mode: 'practice',
    },
    { id: 'mx', title: 'OUTDOOR MX', circuit: 'valley-ridge-mx', vehicle: 'mx450', mode: 'race' },
    { id: 'festival', title: 'OPEN WORLD', mode: 'festival' },
  ];
  for (const mode of disciplines) {
    stage(`compatibility-${mode.id}-starting`);
    await page
      .getByRole('navigation', { name: 'Driving disciplines' })
      .getByRole('button', { name: mode.title, exact: true })
      .click();
    await expect(page.locator('#mode')).toHaveValue(mode.mode);
    if (mode.circuit) await expect(page.locator('#circuit')).toHaveValue(mode.circuit);
    if (mode.vehicle) await expect(page.locator('#vehicle')).toHaveValue(mode.vehicle);
    const selectedVehicle = await page.locator('#vehicle').inputValue();
    const receipt = { discipline: mode.id, selectedVehicle, startedAt: Date.now() };
    report.compatibility.push(receipt);
    await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
    if (mode.id === 'festival') {
      await expect(page.locator('#festivalHud')).toBeVisible({ timeout: 300000 });
      await expect(page.locator('#loading')).toBeHidden({ timeout: 300000 });
      await expect
        .poll(async () => (await read()).motion?.kind, { timeout: 30000 })
        .toBe('festival');
    } else {
      if (mode.id === 'mx') {
        await expect(page.locator('#raceBriefing')).toBeVisible({ timeout: 300000 });
        await page.getByRole('button', { name: 'GO TO THE GATE', exact: true }).click();
      }
      await expect.poll(async () => (await read()).state, { timeout: 300000 }).toBe('driving');
      await expect
        .poll(async () => (await read()).motion?.kind, { timeout: 30000 })
        .toBe('circuit');
    }
    if (mode.id === 'mx')
      // Existing protocol PHASE.RACING is 2; countdown is not throttle latency.
      await expect
        .poll(async () => (await read()).motion?.sample?.phase, { timeout: 30000 })
        .toBe(2);
    await expect(
      page.locator(
        mode.id === 'festival' ? '#festivalHud' : mode.id === 'mx' ? '.mx-ride-hud' : '#hud',
      ),
    ).toBeVisible();
    await expect
      .poll(
        async () => {
          const motion = (await read()).motion;
          return (
            !!motion?.sample &&
            !!motion.presented &&
            motion.presentationFrames > 0 &&
            motion.autopilot === false
          );
        },
        { timeout: 30000 },
      )
      .toBe(true);
    receipt.ready = await read();
    receipt.readyAt = Date.now();
    stage(`compatibility-${mode.id}-ready`);
    expect(receipt.ready.motion.autopilot).toBe(false);
    expect(receipt.ready.motion.vehicleId).toBe(selectedVehicle);
    if (mode.id !== 'festival') {
      expect(receipt.ready.options.circuit).toBe(mode.circuit);
      expect(receipt.ready.options.mode).toBe(mode.mode);
    }
    expect(receipt.ready.motion.sample).not.toBeNull();
    await page.keyboard.down('w');
    try {
      await expect
        .poll(
          async () => {
            const d = await read(),
              sample = d.motion?.sample;
            return (
              !!sample &&
              sample.tick > receipt.ready.motion.sample.tick &&
              sample.speed > 3 &&
              sample.throttle > 0.2 &&
              d.motion.autopilot === false &&
              d.motion.presentationFrames > receipt.ready.motion.presentationFrames &&
              d.motion.presented?.tick > receipt.ready.motion.presented?.tick
            );
          },
          { timeout: 30000 },
        )
        .toBe(true);
      receipt.driving = await read();
      receipt.drivingAt = Date.now();
      stage(`compatibility-${mode.id}-driving`);
    } finally {
      await page.keyboard.up('w');
    }
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await read()).motion?.paused, { timeout: 30000 }).toBe(true);
    if (mode.id === 'festival') await expect(page.locator('#festMenu')).toBeVisible();
    else
      await expect
        .poll(async () => (await read()).workerPause, { timeout: 30000 })
        .toMatchObject({ pending: false, paused: true });
    // Allow the asynchronous worker acknowledgement to settle, then require
    // two observed receipts to hold the same tick across a real 300 ms window.
    await expect
      .poll(
        async () => {
          const before = (await read()).motion.sample.tick;
          await page.waitForTimeout(300);
          return (await read()).motion.sample.tick === before;
        },
        { timeout: 30000 },
      )
      .toBe(true);
    receipt.paused = await read();
    await page
      .getByRole('button', {
        name: mode.id === 'festival' ? 'RESUME' : 'RESUME SESSION',
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () => {
          const d = await read();
          return (
            d.motion.paused === false &&
            d.motion.sample.tick > receipt.paused.motion.sample.tick &&
            d.motion.presented.tick > receipt.paused.motion.presented.tick
          );
        },
        { timeout: 30000 },
      )
      .toBe(true);
    receipt.resumed = await read();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await read()).motion?.paused, { timeout: 30000 }).toBe(true);
    await expect
      .poll(
        async () => {
          const before = (await read()).motion.sample.tick;
          await page.waitForTimeout(300);
          return (await read()).motion.sample.tick === before;
        },
        { timeout: 30000 },
      )
      .toBe(true);
    receipt.pausedAgain = await read();
    await capture(page, `desktop-evidence/compatibility-${mode.id}.png`);
    if (mode.id === 'festival') {
      await page.getByRole('button', { name: 'EXIT FESTIVAL', exact: true }).click();
      await expect(page.locator('#festivalHud')).toHaveCount(0);
    } else await page.getByRole('button', { name: 'RETURN TO PADDOCK', exact: true }).click();
    await expect(page.locator('#menu')).toBeVisible({ timeout: 180000 });
    receipt.returned = await read();
    receipt.completedAt = Date.now();
    stage(`compatibility-${mode.id}-passed`);
  }
  report.checks.push(
    'all four retained disciplines enter, accept real throttle, pause and return in the installed game',
  );
}
