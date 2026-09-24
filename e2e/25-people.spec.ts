import { expect, test } from '@playwright/test';
import manifest from '../src/rendering/aurel-people.manifest.json' with { type: 'json' };

test('27H.3 normal startup binds the retained authored people and populated crowd without primitive fallback', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
  const read = () => page.evaluate(() => window.apexDiagnostics());
  const loaded = await read();
  expect(loaded.renderer?.pitPersonnel).toMatchObject({
    sha256: manifest.runtimeSha256,
    exchangeSha256: manifest.exchangeSha256,
    actors: 0,
    finalArtApproved: false,
  });
  expect(loaded.renderer?.crowdPersonnel.sha256).toBe(manifest.runtimeSha256);
  expect(loaded.renderer?.crowdPersonnel.clusters).toBeGreaterThan(1);
  expect(loaded.renderer?.crowdPersonnel.population).toBeGreaterThan(1000);
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '0');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await expect.poll(async () => (await read()).state, { timeout: 90000 }).toBe('driving');
  // Ordinary gameplay startup must compile the authored crowd materials. This
  // short test does not pretend to be an artistic review of an entire pit stop.
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await read()).workerPause)
    .toMatchObject({ pending: false, paused: true });
  const paused = await read();
  expect(paused.renderer?.crowdPersonnel.population).toBe(
    loaded.renderer?.crowdPersonnel.population,
  );
  expect(paused.renderer?.crowdPersonnel.selectedByLevel.some((n) => n > 0)).toBe(true);
  const session = await page.context().newCDPSession(page);
  try {
    const { data } = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      optimizeForSpeed: true,
    });
    const image = Buffer.from(data, 'base64');
    expect(image.readUInt32BE(16)).toBe(page.viewportSize()!.width);
    expect(image.readUInt32BE(20)).toBe(page.viewportSize()!.height);
    await info.attach('27h3-normal-startup.png', { body: image, contentType: 'image/png' });
  } finally {
    await session.detach();
  }
  await info.attach('27h3-normal-startup.json', {
    body: JSON.stringify({ loaded, paused }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
