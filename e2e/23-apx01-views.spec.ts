import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import manifest from '../src/rendering/apx01-shell.manifest.json' with { type: 'json' };
/** Actual normal app startup and real renderer. No CPU stage can pass this gate. */
for (const view of [
  { name: 'front', azimuth: 0 },
  { name: 'side', azimuth: 90 },
  { name: 'rear', azimuth: 180 },
  { name: 'three-quarter', azimuth: 38 },
] as const)
  test(`27H.1 normal application: deterministic ${view.name} whole-car inspection`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('#menu')).toBeVisible({ timeout: 90000 });
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.apexDiagnostics())).renderer?.authoredBodywork?.sha256,
      )
      .toBe(manifest.sha256);
    expect(
      (await page.evaluate(() => window.apexDiagnostics())).renderer?.authoredBodywork,
    ).toMatchObject({ partCount: 41, loaded: true, finalArtApproved: false });
    await page.getByRole('button', { name: 'PHOTO / LIVERY', exact: true }).click();
    await expect(page.locator('#photoStudio')).toBeVisible();
    await page.locator('#photoBackdrop').selectOption('studio');
    for (const [key, value] of Object.entries({
      azimuth: view.azimuth,
      elevation: 12,
      distance: 8.5,
      focalLength: 48,
      exposure: 0,
      roll: 0,
    })) {
      await page.locator(`#photo-${key}`).evaluate((element, value) => {
        (element as HTMLInputElement).value = String(value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
    }
    await expect
      .poll(
        async () => (await page.evaluate(() => window.apexDiagnostics())).renderer?.photo?.azimuth,
      )
      .toBe(view.azimuth);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'DOWNLOAD PNG', exact: true }).click();
    const image = await readFile((await (await download).path())!);
    expect(image.length).toBeGreaterThan(10000);
    await info.attach(`27h1-game-${view.name}.png`, { body: image, contentType: 'image/png' });
    await info.attach(`27h1-game-${view.name}-diagnostics.json`, {
      body: JSON.stringify(await page.evaluate(() => window.apexDiagnostics()), null, 2),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });
