import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { mountFirstRun } from './fixtures/first-run.ts';

test.use({ actionTimeout: 15000 });

/** DOM-only: the production Interface, the first-launch screen and the front-end CSS, no renderer. */
async function open(page: Page, device: 'keys' | 'pad' = 'keys') {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/first-run.ts'), name: 'FirstRun', formats: ['iife'] },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing first-run fixture output');
  const script = result.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing first-run fixture script');
  await page.setContent('<!doctype html><title>First run DOM-only</title>');
  await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
  await page.addScriptTag({ content: script.code });
  await page.evaluate((d) => {
    (
      window as unknown as { FirstRun: { mountFirstRun: typeof mountFirstRun } }
    ).FirstRun.mountFirstRun(d);
  }, device);
}
const events = (page: Page) => page.locator('#frEvents').textContent();

test('first launch: one input drives, the defaults are chosen, skip and Escape leave', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page);
  const screen = page.locator('#modal .fr');
  await expect(screen).toBeVisible();
  // Keyboard and the circuit plate arrive chosen, and DRIVE has the focus: Enter is the one input.
  await expect(screen.locator('.fr-device[aria-checked="true"]')).toHaveAttribute(
    'data-device',
    'keys',
  );
  await expect(screen.locator('.fr-plate[aria-checked="true"]')).toHaveAttribute(
    'data-discipline',
    'circuit',
  );
  await expect(screen.getByRole('button', { name: /DRIVE THE FIRST LAP/ })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await events(page)).toBe('firstrun:go;');
  // It fits the 1280x720 screen without scrolling the dialog.
  const fit = await page.locator('#modal').evaluate((el) => ({
    over: el.scrollHeight - el.clientHeight,
    w: el.scrollWidth - el.clientWidth,
  }));
  expect(fit.over).toBeLessThanOrEqual(1);
  expect(fit.w).toBeLessThanOrEqual(1);
  // Two radio groups, one tab stop each; arrows move and choose; the form is untouched until DRIVE.
  await expect(screen.locator('[role="radiogroup"]')).toHaveCount(2);
  await expect(screen.locator('.fr-plate[tabindex="0"]')).toHaveCount(1);
  await screen.locator('.fr-plate[aria-checked="true"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(screen.locator('.fr-plate[aria-checked="true"]')).toHaveAttribute(
    'data-discipline',
    'dirt',
  );
  await page.keyboard.press('End');
  await expect(screen.locator('.fr-plate[aria-checked="true"]')).toHaveAttribute(
    'data-discipline',
    'festival',
  );
  await screen.locator('.fr-device[data-device="pad"]').click();
  await expect(screen).toHaveAttribute('data-device', 'pad');
  expect(
    await page.evaluate(() =>
      (window as unknown as { frUi: { firstRunChoice(): unknown } }).frUi.firstRunChoice(),
    ),
  ).toEqual({ device: 'pad', discipline: 'festival' });
  // Three inputs at most: device, discipline, DRIVE (here: a click, an arrow press, Enter).
  // The pad hint replaces the keyboard hint.
  await expect(screen.locator('[data-for="pad"]')).toBeVisible();
  await expect(screen.locator('[data-for="keys"]')).toBeHidden();
  // SKIP is a native button with its own action.
  await screen.getByRole('button', { name: 'SKIP TO THE PADDOCK' }).click();
  expect((await events(page)) ?? '').toContain('firstrun:skip;');
  // Escape is the dialog's own cancel.
  await page.keyboard.press('Escape');
  expect((await events(page)) ?? '').toContain('modalClose;');
  expect(errors).toEqual([]);
});

test('first lap options are the Driving Academy practice in each discipline', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page);
  const options = await page.evaluate(() => {
    const ui = (
      window as unknown as {
        frUi: {
          firstLapOptions(d: string): Record<string, unknown> | null;
          options: Record<string, unknown>;
        };
      }
    ).frUi;
    return Object.fromEntries(
      ['circuit', 'gp', 'dirt', 'festival'].map((d) => {
        const o = ui.firstLapOptions(d);
        return [
          d,
          o && {
            mode: o.mode,
            opponents: o.opponents,
            laps: o.laps,
            weather: o.weather,
            compound: o.compound,
            vehicles: o.vehicles,
            circuit: o.circuit,
          },
        ];
      }),
    );
  });
  for (const d of ['circuit', 'gp', 'dirt'] as const) {
    expect(options[d], d).toMatchObject({
      mode: 'practice',
      opponents: 0,
      laps: 5,
      weather: 'clear',
      compound: 'medium',
    });
  }
  // The plate decides the machine: a bike on the GP plate, an off-road machine on the dirt plate.
  expect(options.gp!.vehicles).toBeTruthy();
  expect(options.dirt!.vehicles).toBeTruthy();
  expect(options.gp!.vehicles).not.toEqual(options.circuit!.vehicles);
  expect(options.dirt!.circuit).not.toEqual(options.circuit!.circuit);
  expect(options.festival).toMatchObject({ mode: 'festival' });
});
