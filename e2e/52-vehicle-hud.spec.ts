import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type * as Fixture from './fixtures/race-hud-layout.ts';

test('Race-Day V2 DOM: vehicle pages, urgent warning, scale and keyboard ownership', async ({
  page,
}, info) => {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/race-hud-layout.ts'),
        name: 'RaceHudFixture',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing component output');
  const script = result.output.find((o) => o.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing component script');
  await page.setContent('<!doctype html><title>DOM-only vehicle panel</title>');
  await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
  await page.addScriptTag({ content: script.code });
  const records = [];
  for (const [width, height] of [
    [1280, 680],
    [1600, 900],
    [1920, 1080],
    [800, 600],
    [640, 400],
  ])
    for (const scale of [0.8, 1, 1.35]) {
      await page.setViewportSize({ width, height });
      await page.evaluate((scale) => {
        const api = (window as unknown as { RaceHudFixture: typeof Fixture }).RaceHudFixture;
        api.raceHudLayout('cockpit', scale, true);
        api.vehicleWarningFixture(true);
      }, scale);
      await expect(page.locator('#vehicleAlert')).toBeVisible();
      await expect(page.locator('#vehicleAlert')).toContainText('PUNCTURE');
      const compact = width < 1280 || height < 680;
      await page
        .getByRole('button', { name: compact ? 'RACE INFO' : 'VEHICLE', exact: true })
        .click();
      await expect(page.getByRole('tab', { name: 'TYRES', exact: true })).toBeVisible();
      await page.getByRole('tab', { name: 'ENERGY', exact: true }).click();
      await expect(page.locator('#mfdFuel')).toHaveText('24.0 KG');
      await expect(page.locator('#mfdBattery')).toHaveText('80%');
      await page.getByRole('tab', { name: 'ENERGY', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: 'DAMAGE', exact: true })).toBeFocused();
      await expect(page.locator('#mfdFloor')).toHaveText('100%');
      const box = await page.locator('#vehicleMfd').boundingBox();
      const dash = await page.locator('.instruments').boundingBox();
      if (!compact) {
        expect(box!.y).toBeGreaterThan(60);
        expect(box!.x + box!.width).toBeLessThan(dash!.x);
        expect(box!.y + box!.height).toBeLessThanOrEqual(height - 48);
      }
      records.push({ width, height, scale, box, dash });
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('button', { name: compact ? 'RACE INFO' : 'VEHICLE', exact: true }),
      ).toBeFocused();
      await expect(page.locator('#vehicleMfd')).toBeHidden();
      await expect(page.locator('#vehicleAlert')).toBeVisible();
    }
  await info.attach('vehicle-panel-layout.json', {
    body: JSON.stringify({
      boundary: 'DOM-only; synthetic warning; not gameplay or hardware performance',
      records,
    }),
    contentType: 'application/json',
  });
});
