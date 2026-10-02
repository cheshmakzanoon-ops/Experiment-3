import { finishRaceEntry } from './race-entry.ts';
import { expect, test } from '@playwright/test';

test('27H.4 normal startup constructs the upgraded districts and retained event hall', async ({
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
  const environment = loaded.renderer?.environmentAssets;
  if (!environment?.frontage)
    throw new Error('A21 frontage diagnostics are unavailable at startup');
  expect(environment.source).toBe('constructed-runtime-groups');
  expect(environment.districts.map((d) => d.kind)).toEqual([
    'club',
    'terrace',
    'works',
    'concourse',
  ]);
  for (const district of environment.districts) {
    expect(district.revision).toBe('27H.4-constructed-venue-v1');
    expect(district.position.every(Number.isFinite)).toBe(true);
    expect(district.finalArtApproved).toBe(false);
  }
  expect(loaded.renderer?.venueLighting.landmark).toBeDefined();
  expect(loaded.renderer?.broadcastSolidOccluders).toBeLessThanOrEqual(256);
  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '0');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await finishRaceEntry(page);
  await expect.poll(async () => (await read()).state, { timeout: 90000 }).toBe('driving');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await read()).workerPause)
    .toMatchObject({ pending: false, paused: true });
  const paused = await read();
  const pausedEnvironment = paused.renderer?.environmentAssets;
  if (!pausedEnvironment?.frontage)
    throw new Error('A21 frontage diagnostics are unavailable after practice entry');

  // Entering the circuit moves the camera from the menu framing and therefore
  // legitimately changes A21's distance-based LODs. Keep every static asset
  // identity field strict while accepting only the documented dynamic counters.
  expect(pausedEnvironment).toEqual({
    ...environment,
    frontage: {
      ...environment.frontage,
      chunks: environment.frontage.chunks.map((chunk) => ({
        ...chunk,
        lod: expect.any(Number),
        triangles: expect.any(Number),
      })),
      triangles: expect.any(Number),
    },
  });
  for (const chunk of pausedEnvironment.frontage.chunks) {
    expect(Number.isInteger(chunk.lod)).toBe(true);
    expect(chunk.lod).toBeGreaterThanOrEqual(0);
    expect(chunk.lod).toBeLessThanOrEqual(2);
    expect(chunk.triangles).toBeGreaterThan(0);
  }
  expect(pausedEnvironment.frontage.triangles).toBe(
    pausedEnvironment.frontage.chunks.reduce((total, chunk) => total + chunk.triangles, 0),
  );
  await info.attach('27h4-normal-startup.json', {
    body: JSON.stringify(
      {
        loaded,
        paused,
        evidenceBoundary: 'Startup integration only; not full-lap art acceptance.',
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
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
    await info.attach('27h4-normal-startup.png', { body: image, contentType: 'image/png' });
  } finally {
    await session.detach();
  }
  expect(errors).toEqual([]);
});
