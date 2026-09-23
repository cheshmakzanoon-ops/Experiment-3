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
  // State polling must not force synchronous mirror-pixel readback: on a software
  // GPU that blocks the input pump and trips the unchanged stale-input safeguard.
  const diagnostics = () => page.evaluate(() => window.apexDiagnostics());
  const visualDiagnostics = () => page.evaluate(() => window.apexDiagnostics(true));
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
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
    const pose = await visualDiagnostics();
    expect(pose.visual?.driver).toHaveLength(2);
    for (const arm of pose.visual!.driver) {
      expect(arm.authoredSkin).toBe(true);
      expect(arm.reachable).toBe(true);
      expect(arm.upperLength).toBeCloseTo(0.37, 6);
      expect(arm.lowerLength).toBeCloseTo(0.36, 6);
      expect([...arm.shoulder, ...arm.elbow, ...arm.wrist].every(Number.isFinite)).toBe(true);
    }
    poses.push(pose);
    await info.attach(`27h2-cockpit-${poses.length}-${key}.png`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
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
    expect(
      (await visualDiagnostics()).visual!.driver.every((a) => a.authoredSkin && a.reachable),
    ).toBe(true);
    await info.attach(`27h2-moving-${camera}.png`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
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
    return visualDiagnostics();
  };
  const first = await seek(0.75);
  const forward = await seek(4.5);
  const rewind = await seek(0.75);
  expect(rewind.visual?.driver).toEqual(first.visual?.driver);
  expect(rewind.frame?.[H.TICK]).toBe(paused.frame?.[H.TICK]);
  expect(rewind.renderer?.authoredDriver?.sha256).toBe(manifest.sha256);
  expect(rewind.recordingWarnings).toEqual([]);
  await info.attach('27h2-external-replay-rewind.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await info.attach('27h2-coupled-normal-game-evidence.json', {
    body: JSON.stringify({ poses, paused, first, forward, rewind }, null, 2),
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
