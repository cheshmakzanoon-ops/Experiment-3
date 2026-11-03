import { expect, test } from '@playwright/test';
import { MENU_STARTUP_TIMEOUT_MS } from './menu-startup.ts';

/** Release gate G7 contract (production build served by `vite preview`): the
 * menu must not fetch circuit-only authored tables or the physics worker. They
 * are separate chunks (src/core/lazy-data.ts, vite.config.ts) that a session
 * start awaits behind the normal loading screen, and the session must still
 * reach driving with no page or console error. Software-GL shader warmup of a
 * cold circuit takes minutes on a shared runner, so the start deadline is
 * generous: this spec asserts chunk timing and a clean start, not start speed. */
const SESSION_START_TIMEOUT_MS = 600_000;
const CIRCUIT_ONLY = [
  'start-finish.geometry',
  'secondary-grandstands.geometry',
  'mx-authored-kit.mesh',
  'physics.worker',
  'free-roam',
];

test('circuit-only chunks load when a session starts, not with the menu', async ({ page }) => {
  test.setTimeout(MENU_STARTUP_TIMEOUT_MS + 2 * SESSION_START_TIMEOUT_MS);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const chunks: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/assets\/[^/]+\.js$/.test(path)) chunks.push(path.split('/').pop()!);
  });
  const fetched = (needle: string) => chunks.some((name) => name.startsWith(needle));

  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: MENU_STARTUP_TIMEOUT_MS });
  for (const needle of CIRCUIT_ONLY) expect(fetched(needle), `${needle} at menu`).toBe(false);
  // The showroom builds crew and the venue landmark, so these ship with it.
  for (const needle of ['crew-performance.geometry', 'human-kit', 'event-hall.geometry'])
    expect(fetched(needle), `${needle} at menu`).toBe(true);

  await page.selectOption('#mode', 'practice');
  await page.selectOption('#opponents', '0');
  await page.getByRole('button', { name: /ENTER CIRCUIT/ }).click();
  await expect
    .poll(
      async () => {
        if (await page.locator('#raceBriefing').isVisible())
          await page.getByRole('button', { name: 'GO STRAIGHT TO LIGHTS', exact: true }).click();
        return (await page.evaluate(() => window.apexDiagnostics())).state;
      },
      { timeout: SESSION_START_TIMEOUT_MS, intervals: [1000] },
    )
    .toBe('driving');
  for (const needle of [
    'start-finish.geometry',
    'secondary-grandstands.geometry',
    'physics.worker',
  ])
    expect(fetched(needle), `${needle} after session start`).toBe(true);
  await expect
    .poll(
      async () => (await page.evaluate(() => window.apexDiagnostics())).presentation?.frames ?? 0,
      {
        timeout: 60_000,
      },
    )
    .toBeGreaterThan(1);
  expect(errors).toEqual([]);
});
