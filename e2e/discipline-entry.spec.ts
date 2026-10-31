import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

test('all disciplines remain discoverable and switching never starts a session implicitly', async ({
  page,
}) => {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/menu-access.ts'), name: 'MenuAccess', formats: ['iife'] },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing menu fixture output');
  const script = result.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing menu fixture script');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<!doctype html><title>Discipline entry integration</title>');
  await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
  await page.addScriptTag({ content: script.code });
  await page.evaluate(() =>
    (
      window as unknown as { MenuAccess: { mountMenuAccess: () => void } }
    ).MenuAccess.mountMenuAccess(),
  );
  const choices = page.getByRole('navigation', { name: 'Driving disciplines' });
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    // Repeated entry and return from the MX dock must preserve controls/listeners.
    for (let repeat = 0; repeat < 2; repeat++) {
      await choices.getByRole('button', { name: 'OUTDOOR MX', exact: true }).click();
      await expect(page.locator('#circuit')).toHaveValue('valley-ridge-mx');
      await expect(page.locator('#vehicle')).toHaveValue('mx450');
      await choices.getByRole('button', { name: 'GP MOTORCYCLES', exact: true }).click();
      await expect(page.locator('#circuit')).toHaveValue('poggio-alto');
      await expect(page.locator('#vehicle')).toHaveValue('gpr1');
      await expect(page.locator('#mode')).toHaveValue('practice');
      await expect(page.locator('#sessionRules')).not.toContainText('Cannot start');
      await choices.getByRole('button', { name: 'OPEN WORLD', exact: true }).click();
      await expect(page.locator('#mode')).toHaveValue('festival');
      await expect(page.locator('#sessionRules')).toContainText('Festival:');
      await expect(
        choices.getByRole('button', { name: 'OPEN WORLD', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      await choices.getByRole('button', { name: 'FORMULA', exact: true }).click();
      await expect(page.locator('#vehicle')).toHaveValue('apx01');
      await expect(page.locator('#circuit')).toHaveValue('aurel');
      await expect(page.locator('#mode')).toHaveValue('practice');
      await expect(page.locator('#menuAccessEvents')).not.toContainText('start:');
    }
  }
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  await expect(page.locator('#menuAccessEvents')).toHaveText('start:practice;');
  expect(errors).toEqual([]);
});
