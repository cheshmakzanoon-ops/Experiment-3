import { test, expect } from '@playwright/test';
import { F, H, carBase } from '../src/simulation/protocol.ts';
import manifest from '../src/rendering/apx01-driver.manifest.json' with { type: 'json' };

test.use({ video: { mode: 'on', size: { width: 960, height: 600 } } });

test('27H.2 normal application: coupled driver survives both locks, countersteering, moving cameras and replay seeks', async ({
  page,
}, info) => {
  test.setTimeout(420000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Driver-pose evidence is CPU-only and comes from the actual presented rig.
  // Mirror pixels/raycast visibility have separate tests; reading them here
  // stalls the software GPU and input pump without testing another driver rule.
  const diagnostics = () => page.evaluate(() => window.apexDiagnostics());
  const captures: { name: string; milliseconds: number; bytes: number }[] = [];
  // Capture Chromium's existing viewport surface, without Playwright's redundant
  // page-wide caret/style preparation and explicit clip/viewport recalculation.
  // Full-resolution lossless PNGs and the continuous video are both retained.
  // Readiness is established from the real presented camera/rig below, not sleeps.
  const capture = async (name: string) => {
    const started = performance.now();
    const session = await page.context().newCDPSession(page);
    try {
      const { data } = await session.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
        optimizeForSpeed: true,
      });
      const image = Buffer.from(data, 'base64');
      const viewport = page.viewportSize()!;
      expect(image.length).toBeGreaterThan(10000);
      expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(image.toString('ascii', 12, 16)).toBe('IHDR');
      expect(image.readUInt32BE(16)).toBe(viewport.width);
      expect(image.readUInt32BE(20)).toBe(viewport.height);
      captures.push({ name, milliseconds: performance.now() - started, bytes: image.length });
      await info.attach(name, { body: image, contentType: 'image/png' });
    } finally {
      await session.detach();
    }
  };
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect((await diagnostics()).renderer?.authoredDriver).toMatchObject({
    loaded: true,
    sha256: manifest.sha256,
    skinnedSleeves: 2,
    joints: 9,
    finalArtApproved: false,
  });
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '0');
  const enterCircuit = page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true });
  await expect(enterCircuit).toHaveAccessibleName('ENTER CIRCUIT');
  await expect(enterCircuit).toBeEnabled();
  await enterCircuit.click();
  await expect.poll(async () => (await diagnostics()).state, { timeout: 90000 }).toBe('driving');
  await page.keyboard.press('c');
  await expect.poll(async () => (await diagnostics()).renderer?.camera).toBe('cockpit');
  await expect.poll(async () => (await diagnostics()).renderer?.presentedCamera).toBe('cockpit');
  await page.keyboard.down('s');
  const poses: unknown[] = [];
  for (const [key, direction] of [
    ['a', 1],
    ['d', -1],
    ['a', 1],
    ['d', -1],
  ] as const) {
    await page.keyboard.down(key);
    await expect
      .poll(async () => ((await diagnostics()).frame?.[carBase(0) + F.STEER] ?? 0) * direction)
      .toBeGreaterThan(0.3);
    await expect
      .poll(async () => ((await diagnostics()).renderer?.driverPose.wheelRadians ?? 0) * -direction)
      .toBeGreaterThan(0.3 * 2.2);
    const pose = await diagnostics();
    expect(pose.renderer?.driverPose.arms).toHaveLength(2);
    for (const arm of pose.renderer!.driverPose.arms) {
      expect(arm.authoredSkin).toBe(true);
      expect(arm.reachable).toBe(true);
      expect(arm.upperLength).toBeCloseTo(0.37, 6);
      expect(arm.lowerLength).toBeCloseTo(0.36, 6);
      expect([...arm.shoulder, ...arm.elbow, ...arm.wrist].every(Number.isFinite)).toBe(true);
    }
    poses.push(pose);
    await test.step(`Capture cockpit lock ${poses.length}: ${key}`, () =>
      capture(`27h2-cockpit-${poses.length}-${key}.png`),
    );
    await page.keyboard.up(key);
  }
  await page.keyboard.up('s');
  // Real input events, not writes to the simulation or renderer diagnostics.
  await page.keyboard.press(']');
  await page.keyboard.press('e');
  await page.keyboard.press('g');
  await expect
    .poll(async () => (await diagnostics()).replaySeconds, { timeout: 60000 })
    .toBeGreaterThan(7);
  for (const camera of ['pod', 'trackside', 'chase']) {
    await page.keyboard.press('c');
    await expect.poll(async () => (await diagnostics()).renderer?.camera).toBe(camera);
    await expect.poll(async () => (await diagnostics()).renderer?.presentedCamera).toBe(camera);
    expect(
      (await diagnostics()).renderer!.driverPose.arms.every((a) => a.authoredSkin && a.reachable),
    ).toBe(true);
    await test.step(`Capture moving ${camera} view`, () => capture(`27h2-moving-${camera}.png`));
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'RESUME SESSION', exact: true })).toBeVisible();
  const paused = await diagnostics();
  await page.getByRole('button', { name: 'WATCH REPLAY', exact: true }).click();
  await expect(page.locator('#replayBar')).toBeVisible();
  if ((await diagnostics()).replayPlaying) await page.locator('#replayPlay').click();
  const seek = async (seconds: number) => {
    await page.locator('#replaySeek').evaluate((element, value) => {
      (element as HTMLInputElement).value = String(value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, seconds);
    await expect.poll(async () => (await diagnostics()).replaySeekPending).toBe(false);
    await expect.poll(async () => (await diagnostics()).replayPosition).toBe(seconds);
    return diagnostics();
  };
  const first = await seek(0.75);
  const forward = await seek(4.5);
  const rewind = await seek(0.75);
  expect(rewind.renderer?.driverPose.arms).toEqual(first.renderer?.driverPose.arms);
  expect(rewind.renderer?.driverPose.time).toBe(first.renderer?.driverPose.time);
  expect(forward.renderer?.driverPose.time).toBeGreaterThan(first.renderer!.driverPose.time);
  expect(rewind.frame?.[H.TICK]).toBe(paused.frame?.[H.TICK]);
  expect(rewind.renderer?.authoredDriver?.sha256).toBe(manifest.sha256);
  expect(rewind.recordingWarnings).toEqual([]);
  await test.step('Capture the rewound replay', () => capture('27h2-external-replay-rewind.png'));
  expect(captures).toHaveLength(8);
  await info.attach('27h2-coupled-normal-game-evidence.json', {
    body: JSON.stringify({ poses, paused, first, forward, rewind, captures }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('27H.2 normal application rejects a missing driver without silently displaying legacy geometry', async ({
  page,
}) => {
  await page.route('**/apx01-driver*.gz', (route) =>
    route.fulfill({ status: 404, body: 'Driver unavailable' }),
  );
  await page.goto('/');
  await expect(page.locator('#errorMessage')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('#errorMessage')).toContainText(/driver/i);
  await expect(page.locator('#menu')).not.toBeVisible();
});
