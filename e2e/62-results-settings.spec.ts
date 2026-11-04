import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fixtureDefine } from './fixtures/owner-build.ts';
import type * as Fixture from './fixtures/results-settings.ts';

test.use({ actionTimeout: 15000 });

/** DOM-only: the production Interface, the results and settings screens and the front-end CSS, no renderer. */
async function open(page: Page, scene: 'showResults' | 'showSettings') {
  const built = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/results-settings.ts'),
        name: 'Screens',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing fixture output');
  const script = result.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing fixture script');
  await page.setContent('<!doctype html><title>Results and settings DOM-only</title>');
  await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
  await page.addScriptTag({ content: script.code });
  await page.evaluate((name) => {
    (window as unknown as { Screens: typeof Fixture }).Screens[name]();
  }, scene);
}
const events = (page: Page) => page.locator('#rsEvents').textContent();

test('results: podium, gaps, sheet and every action are on one screen and reachable', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page, 'showResults');
  const board = page.locator('#modal .rs');
  await expect(board).toBeVisible();
  await expect(board.locator('.rs-step')).toHaveCount(3);
  await expect(board.locator('.rs-position b').first()).toHaveText('P1');
  await expect(board.locator('.rs-facts')).toContainText('MARGIN OVER 2ND');
  await expect(board.locator('.rs-table tbody tr')).toHaveCount(8);
  await expect(board.locator('.rs-table tr.you')).toHaveCount(1);
  // The podium reads in order first, second, third whatever the visual order.
  expect(
    await board
      .locator('.rs-step')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.place)),
  ).toEqual(['1', '2', '3']);
  // Every control is a native button, in the tab order, and none leaves the dialog.
  const buttons = board.locator('button');
  const count = await buttons.count();
  expect(count).toBeGreaterThanOrEqual(6);
  await buttons.first().focus();
  for (let i = 0; i < count; i++) {
    const inside = await page.evaluate(() => !!document.activeElement?.closest('#modal'));
    expect(inside).toBe(true);
    if (i < count - 1) await page.keyboard.press('Tab');
  }
  await board.getByRole('button', { name: 'SHARE CARD' }).click();
  expect(await events(page)).toContain('resultsShare;');
  // It stays inside the screen at 1280x720 and at a narrow width.
  const wide = await page
    .locator('#modal')
    .evaluate((el) => ({
      w: el.scrollWidth - el.clientWidth,
      top: el.getBoundingClientRect().top,
    }));
  expect(wide.w).toBeLessThanOrEqual(1);
  expect(wide.top).toBeGreaterThanOrEqual(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = await page.locator('#modal').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(narrow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('share card: a local 1200 x 630 PNG with the board drawn on it', async ({ page }) => {
  test.setTimeout(120000);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('data:') && !request.url().startsWith('about:'))
      requests.push(request.url());
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page, 'showResults');
  const before = requests.length;
  const probe = await page.evaluate(() =>
    (window as unknown as { Screens: typeof Fixture }).Screens.shareCardProbe(),
  );
  expect(probe.type).toBe('image/png');
  expect(probe.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect([probe.width, probe.height]).toEqual([1200, 630]);
  expect(probe.size).toBeGreaterThan(8000);
  // The paper strip and the asphalt board are where the design puts them.
  expect(probe.strip.slice(0, 3)).toEqual([232, 223, 200]);
  expect(probe.board.slice(0, 3)).toEqual([26, 27, 30]);
  // Position numeral, text, venue line and podium cover a real share of the card.
  expect(probe.inkedShare).toBeGreaterThan(0.12);
  // Drawing the card made no network request.
  expect(requests.length).toBe(before);
});

test('settings: preset guide, GPU suggestion, live frame rate and live text size', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page, 'showSettings');
  const guide = page.locator('#modal .gq');
  await expect(guide).toBeVisible();
  await expect(guide.locator('.gq-list li')).toHaveCount(4);
  await expect(guide.locator('.gq-list [aria-current="true"]')).toHaveAttribute(
    'data-preset',
    'medium',
  );
  // The suggestion names the GPU the browser reports and is labelled a guess.
  await expect(guide.locator('.gq-rec')).toContainText('It is a guess from the name');
  // USE sets the quality select and moves the mark.
  const use = guide.locator('.gq-use');
  const wanted = await use.getAttribute('data-use');
  await use.click();
  await expect(page.locator('select[name="quality"]')).toHaveValue(wanted!);
  await expect(guide.locator('.gq-list [aria-current="true"]')).toHaveAttribute(
    'data-preset',
    wanted!,
  );
  // The frame rate reads out within a few seconds (a figure, then its 1% low).
  await expect(guide.locator('.gq-fps-now')).toHaveText(/^\d+ FPS$/, { timeout: 8000 });
  await expect(guide.locator('.gq-fps-low')).toHaveText(/^1% LOW \d+ FPS$/);
  // The select and the guide are reachable by keyboard alone.
  await page.locator('select[name="quality"]').focus();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => !!document.activeElement?.closest('#modal'))).toBe(true);
  // Text size is labelled for what it does and previews as it is dragged...
  const slider = page.locator('input[name="uiScale"]');
  await expect(page.locator('label.range-row', { has: slider })).toContainText(
    'Text and interface size',
  );
  await slider.evaluate((el: HTMLInputElement) => {
    el.value = '1.3';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale')),
  ).toBe('1.3');
  await expect(page.locator('label.range-row', { has: slider }).locator('output')).toHaveText(
    '130%',
  );
  // ...and goes back to the saved size when the screen is closed without applying.
  await page.getByRole('button', { name: 'CANCEL', exact: true }).click();
  expect(await events(page)).toContain('modalClose;');
  expect(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale')),
  ).not.toBe('1.3');
  // The accessibility group says what the colour-blind option changes.
  await page.evaluate(() =>
    (window as unknown as { Screens: typeof Fixture }).Screens.showSettings(),
  );
  await expect(page.locator('#modal')).toContainText('Colour-blind-safe HUD');
  await expect(page.locator('#modal')).toContainText('Reduced motion');
  expect(errors).toEqual([]);
});
