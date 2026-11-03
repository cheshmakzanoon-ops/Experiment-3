import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'vite';
import type * as API from './fixtures/launch-board.ts';

declare global {
  interface Window {
    LaunchBoard: typeof API;
  }
}

/** DOM component checks of the paddock launch board: discipline plates, dials,
 * venue art, keyboard, controller and the series extension point. The real
 * Interface and style.css run with no renderer; nothing here is a race or a
 * hardware claim. */
async function load(page: Page) {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/launch-board.ts'), name: 'LaunchBoard', formats: ['iife'] },
    },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Missing launch board fixture output');
  const script = output.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing launch board fixture script');
  await page.setContent('<!doctype html><title>Launch board component checks</title>');
  await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
  for (const asset of output.output)
    if (asset.type === 'asset' && asset.fileName.endsWith('.css'))
      await page.addStyleTag({ content: String(asset.source) });
  await page.addScriptTag({ content: script.code });
  await page.evaluate(() => window.LaunchBoard.mountLaunchBoard());
  await page.evaluate(() => document.fonts.ready);
}
const started = async (page: Page) =>
  (
    JSON.parse((await page.locator('#boardEvents').textContent()) ?? '[]') as {
      start?: { circuit: string; mode: string; weather: string; vehicles: string[] };
    }[]
  )
    .filter((e) => e.start)
    .map((e) => e.start!);

test.use({ viewport: { width: 1280, height: 720 } });

test('quick start: launch to driving request in one input, two with a discipline', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await load(page);
  // The four disciplines are first-class and the default (circuit) is already armed.
  const plates = page.getByRole('radio');
  await expect(plates).toHaveCount(4);
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName(/^CIRCUIT/);
  // Input 1: GO. The default entry is a complete, valid session.
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  expect(await started(page)).toHaveLength(1);
  expect((await started(page))[0]).toMatchObject({ circuit: 'aurel', mode: 'race' });
  // Inputs 1 and 2: pick GP BIKE, then GO.
  await page.getByRole('radio', { name: /^GP BIKE/ }).click();
  await expect(page.locator('#vehicle')).toHaveValue('gpr1');
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  const entry = (await started(page))[1];
  expect(entry.vehicles[0]).toBe('gpr1');
  expect(errors).toEqual([]);
});

test('each discipline writes the form the rules already understand', async ({ page }) => {
  await load(page);
  const value = (id: string) => page.locator(`#${id}`).inputValue();
  await page.getByRole('radio', { name: /^DIRT/ }).click();
  expect(await value('circuit')).toBe('valley-ridge-mx');
  expect(await value('vehicle')).toBe('mx450');
  await expect(page.getByRole('radio', { name: /^DIRT/ })).toBeChecked();
  // Stepping to a car venue swaps the machine so the entry stays valid.
  const venue = page.locator('.lb-dial[data-dial="circuit"] .lb-step[data-step="1"]');
  await venue.click(); // arena-nord-sx
  await venue.click(); // kestrel-rx
  expect(await value('circuit')).toBe('kestrel-rx');
  // The rallycross venue is entered with a rallycross car.
  expect(['rcx6', 'rxe']).toContain(await value('vehicle'));
  await expect(page.getByRole('radio', { name: /^DIRT/ })).toBeChecked();
  // Festival is a session mode and renames the action.
  await page.getByRole('radio', { name: /^FESTIVAL/ }).click();
  expect(await value('mode')).toBe('festival');
  await expect(page.getByRole('button', { name: 'ENTER FESTIVAL', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ENTER FESTIVAL', exact: true }).click();
  expect((await started(page)).at(-1)).toMatchObject({ mode: 'festival' });
  // Each discipline remembers its own sheet while the menu is open.
  await page.getByRole('radio', { name: /^DIRT/ }).click();
  expect(await value('circuit')).toBe('kestrel-rx');
  await page.getByRole('radio', { name: /^CIRCUIT/ }).click();
  expect(await value('circuit')).toBe('aurel');
  expect(await value('mode')).toBe('race');
});

test('keyboard: plates are a roving radio group; selects keep native behaviour', async ({
  page,
}) => {
  await load(page);
  const checked = page.getByRole('radio', { checked: true });
  await checked.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /^GP BIKE/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /^GP BIKE/ })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('radio', { name: /^FESTIVAL/ })).toBeChecked();
  await page.keyboard.press('Home');
  await expect(page.getByRole('radio', { name: /^CIRCUIT/ })).toBeChecked();
  // One tab stop for the whole group.
  const tabbable = await page.locator('.lb-plate').evaluateAll(
    (els) => els.filter((e) => (e as HTMLElement).tabIndex >= 0).length,
  );
  expect(tabbable).toBe(1);
  // The weather dial is a real select: Down changes it, the glyph follows.
  await page.locator('#weather').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#weather')).toHaveValue('changeable');
  await expect(page.locator('.lb-dial[data-dial="weather"] .lb-dial-glyph')).toHaveAttribute(
    'data-glyph',
    'mixed',
  );
  // Enter on a dial confirms the entry.
  await page.keyboard.press('Enter');
  expect(await started(page)).toHaveLength(1);
  // The hands are pointer conveniences: not tabbable, hidden from assistive tech.
  const hands = page.locator('.lb-step');
  expect(await hands.count()).toBeGreaterThan(8);
  expect(
    await hands.evaluateAll((els) =>
      els.every((e) => (e as HTMLElement).tabIndex === -1 && e.getAttribute('aria-hidden') === 'true'),
    ),
  ).toBe(true);
});

test('venue sheet draws the real circuit and follows the selection', async ({ page }) => {
  await load(page);
  const outline = () => page.locator('#venueMap .ta-line').getAttribute('d');
  const aurel = await outline();
  expect(aurel).toMatch(/^M[\d.,L-]+Z$/);
  await page.locator('#circuit').selectOption('vellamar');
  expect(await outline()).not.toBe(aurel);
  // The sheet states the chosen circuit's own lap length (label: 4.00 km), not the loaded track's.
  expect(Math.abs(Number(await page.locator('#circuitLength').textContent()) - 4)).toBeLessThan(0.05);
  await expect(page.locator('.lb-dial[data-dial="circuit"] .lb-dial-count')).toHaveText(/^02 \/ \d+$/);
  // Festival swaps the sheet for the region map: roads, not a lap.
  await page.getByRole('radio', { name: /^FESTIVAL/ }).click();
  await expect(page.locator('#venueMap .ta-rd').first()).toBeVisible();
  await expect(page.locator('#regionTitle')).toContainText('SOLVANE');
  await expect(page.locator('#regionStats')).toContainText('EVENTS');
});

test('controller: LB/RB switch discipline, D-pad walks the board, A steps, Start launches', async ({
  page,
}) => {
  await load(page);
  await page.evaluate(() => window.LaunchBoard.installFakePad());
  await page.waitForTimeout(200); // first poll only records held buttons
  const tap = async (index: number) => {
    // Held for several animation frames: software rendering can be slow.
    await page.evaluate((i) => window.LaunchBoard.press(i, true), index);
    await page.waitForTimeout(300);
    await page.evaluate((i) => window.LaunchBoard.press(i, false), index);
    await page.waitForTimeout(300);
  };
  await tap(5); // RB
  await expect(page.getByRole('radio', { name: /^GP BIKE/ })).toBeChecked();
  await tap(5);
  await expect(page.getByRole('radio', { name: /^DIRT/ })).toBeChecked();
  await tap(4); // LB
  await expect(page.getByRole('radio', { name: /^GP BIKE/ })).toBeChecked();
  await expect(page.locator('#app')).toHaveAttribute('data-pad', 'true');
  // D-pad down from the plates lands on a control and the focus ring is drawn.
  await page.locator('.lb-plate[aria-checked="true"]').focus();
  await tap(13);
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  // Left/right on a focused dial steps its value.
  await page.locator('#weather').focus();
  await tap(15);
  await expect(page.locator('#weather')).toHaveValue('changeable');
  await tap(14);
  await expect(page.locator('#weather')).toHaveValue('clear');
  // Start launches the current entry.
  await tap(9);
  expect((await started(page)).at(-1)).toMatchObject({ weather: 'clear' });
  // Footer hints switch to controller glyphs.
  await expect(page.locator('.menu-keys [data-device="pad"]')).toBeVisible();
  await expect(page.locator('.menu-keys [data-device="keys"]')).toBeHidden();
});

test('wildcard series extension point adds a chip that writes the form', async ({ page }) => {
  await load(page);
  await page.evaluate(() => window.LaunchBoard.registerFixtureSeries());
  const chip = page.getByRole('button', { name: 'ALPINE HYPERCAR', exact: true });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.locator('#circuit')).toHaveValue('alpine-pass');
  await expect(page.locator('#vehicle')).toHaveValue('hy9');
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName(/^CIRCUIT/);
});

test('board fits 1280x720 without scrolling and keeps type at 11px or larger', async ({ page }) => {
  await load(page);
  const body = await page.locator('.menu-body').evaluate((el) => ({
    client: el.clientHeight,
    scroll: el.scrollHeight,
  }));
  expect(body.scroll).toBeLessThanOrEqual(body.client + 1);
  const small = await page.evaluate(() => {
    const smallest: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('#menu *')) {
      // SVG text is in view-box units (map beads, plate numerals), not screen px.
      if (el instanceof SVGElement || !el.childNodes.length || !el.getClientRects().length)
        continue;
      const own = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim(),
      );
      if (own && parseFloat(getComputedStyle(el).fontSize) < 11)
        smallest.push(`${el.className || el.tagName}:${getComputedStyle(el).fontSize}`);
    }
    return smallest;
  });
  expect(small).toEqual([]);
});
