import { test, expect } from '@playwright/test';
import { MENU_STARTUP_TIMEOUT_MS } from './menu-startup.ts';
import { OWNER_BUILD } from './fixtures/owner-build.ts';

/**
 * Release gate G15 (docs/studio/reports/ip-audit.md): in a product build the default
 * circuit car APX-01 is the ORIGINAL authored car (apx01-shell + the A61 levels, the
 * procedural cockpit), and the owner-supplied real-brand model is never requested, even
 * though the menu showroom and every session build the player's car. This ports the
 * "which car is the player really driving" check that 39-supplied-player.spec.ts and the
 * cockpit block of application.spec.ts make for the owner build.
 */
test('G15 product build: the player drives the original APX-01 and never requests the supplied model', async ({
  page,
}) => {
  test.skip(
    OWNER_BUILD,
    'product-build behaviour; the owner build is covered by 39-supplied-player',
  );
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: MENU_STARTUP_TIMEOUT_MS });
  const diagnostics = await page.evaluate(() => window.apexDiagnostics(true));
  const renderer = diagnostics.renderer!;
  expect(renderer.presentationPurpose).toBe('showroom');
  expect(renderer.suppliedPlayer).toBeNull();
  expect(diagnostics.visual!.suppliedPlayer).toBeNull();
  // The player's own car carries the authored A61 levels, like every opponent.
  expect(diagnostics.visual!.rivalCars[0]).toMatchObject({ id: 0, supplied: false, a61: true });
  expect(renderer.driverPose.suppliedRig).toBeNull();
  expect(requests.filter((url) => /supplied-player/i.test(url))).toEqual([]);
  expect(errors).toEqual([]);
});
