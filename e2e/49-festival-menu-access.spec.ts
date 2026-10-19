import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { mountFestivalMenu, mountFestivalResults } from './fixtures/festival-menu-access.ts';
import type { FestivalStatus } from '../src/simulation/open-world/session.ts';

type Fixture = {
  mountFestivalMenu: typeof mountFestivalMenu;
  mountFestivalResults: typeof mountFestivalResults;
};
type FestivalWindow = {
  FestivalMenu: Fixture;
  festivalHarness: ReturnType<typeof mountFestivalMenu>;
};

test.use({ actionTimeout: 15000 });

async function load(page: import('@playwright/test').Page) {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/festival-menu-access.ts'),
        name: 'FestivalMenu',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing festival fixture output');
  const script = result.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing festival fixture script');
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.setContent('<!doctype html><title>Festival menu accessibility</title>');
  await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
  await page.addStyleTag({ content: await readFile('src/ui/festival-hud.css', 'utf8') });
  await page.addScriptTag({ content: script.code });
}

async function mount(page: import('@playwright/test').Page, options: { card?: boolean } = {}) {
  await load(page);
  return page.evaluate((options) => {
    const scope = window as unknown as FestivalWindow;
    scope.festivalHarness = scope.FestivalMenu.mountFestivalMenu(options);
    return scope.festivalHarness.events;
  }, options);
}

/** Standard controller input through the real input/HUD polling paths. A
 * repeated call with the same buttons represents a held button, not a click. */
async function pad(page: import('@playwright/test').Page, pressed: number[]) {
  return page.evaluate((pressed) => {
    const gamepad = {
      id: 'Festival DOM controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: performance.now(),
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, index) => ({
        pressed: pressed.includes(index),
        touched: pressed.includes(index),
        value: Number(pressed.includes(index)),
      })),
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [gamepad] });
    return (window as unknown as FestivalWindow).festivalHarness.frame();
  }, pressed);
}

async function tapPad(page: import('@playwright/test').Page, button: number) {
  await pad(page, []);
  return pad(page, [button]);
}

test('festival menu access: every pause-menu action is reachable with the keyboard', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await load(page);
  await page.evaluate(() =>
    (window as unknown as { FestivalMenu: Fixture }).FestivalMenu.mountFestivalMenu(),
  );
  const log = page.locator('#festivalEvents');
  const menu = page.locator('#festMenu');
  const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  const tabTo = async (label: string) => {
    for (let i = 0; i < 80 && (await focused()) !== label; i++) await page.keyboard.press('Tab');
    expect(await focused()).toBe(label);
  };
  // ESC while driving opens the menu with RESUME focused; driving input is off.
  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await expect(log).toContainText('action:pause;pause:true;driving:false;');
  expect(await focused()).toBe('RESUME');
  // Tab moves through the menu (it is not swallowed by the driving input).
  await page.keyboard.press('Tab');
  expect(await focused()).toBe('RESET TO ROAD');
  // Space activates the focused button: time of day keeps the menu open.
  await tabTo('Night');
  await page.keyboard.press('Space');
  await expect(log).toContainText('lighting:night;');
  await expect(menu).toBeVisible();
  // Machine, autopilot, ambient traffic and travel are reachable too; the
  // traffic toggle keeps the menu open.
  await tabTo('On');
  await tabTo('Traffic off');
  await page.keyboard.press('Space');
  await expect(log).toContainText('traffic:false;');
  await expect(menu).toBeVisible();
  // The redrawn menu states the new choice at once (before the worker's
  // next status), so a screen reader hears the right one.
  await expect(menu.getByRole('button', { name: 'Traffic off', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(menu.getByRole('button', { name: 'Traffic on', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await tabTo(
    await page
      .locator('#festMenu [data-fest="travel"]')
      .first()
      .evaluate((button) => button.textContent?.trim() ?? ''),
  );
  // ESC with a menu button focused resumes, and driving input returns.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(log).toContainText('pause:false;driving:true;');
  // EXIT FESTIVAL by keyboard alone.
  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await tabTo('EXIT FESTIVAL');
  await page.keyboard.press('Enter');
  await expect(log).toContainText('exit;');
  expect(errors).toEqual([]);
});

test('festival results: CONTINUE takes a normal mouse click while status keeps arriving', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await load(page);
  await page.evaluate(() =>
    (window as unknown as { FestivalMenu: Fixture }).FestivalMenu.mountFestivalResults(),
  );
  const button = page.locator('#festResults [data-fest="continue"]');
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  let clicks = 0;
  for (let i = 0; i < 5; i++) {
    // A human click: 150 ms between press and release, across status updates.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
    clicks++;
    await expect(page.locator('#festivalEvents')).toHaveText('continue;'.repeat(clicks));
  }
  expect(errors).toEqual([]);
});

test('festival results: keyboard and controller can retry without also continuing', async ({
  page,
}) => {
  await load(page);
  await page.evaluate(() =>
    (window as unknown as { FestivalMenu: Fixture }).FestivalMenu.mountFestivalResults(),
  );
  const log = page.locator('#festivalEvents');
  const again = page.locator('#festResults [data-fest="retry"]');
  const event = await again.getAttribute('data-value');
  await expect(page.locator('#festResults [data-fest="continue"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(again).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(log).toHaveText(`retry:${event};`);
  await page.keyboard.press('Space');
  await expect(log).toHaveText(`retry:${event};retry:${event};`);
  await page.keyboard.press('Tab');
  await expect(page.locator('#festResults [data-fest="continue"]')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(again).toBeFocused();
  // The real HUD polls this controller on animation frames, including
  // while driving input is disabled by the result dialog.
  await page.evaluate(() => {
    const buttons = Array.from({ length: 17 }, (_, index) => ({
      pressed: index === 0,
      touched: index === 0,
      value: Number(index === 0),
    }));
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [{ connected: true, buttons }],
    });
  });
  await expect(log).toHaveText(`retry:${event};retry:${event};retry:${event};`);
  await page.waitForTimeout(180);
  await expect(log).toHaveText(`retry:${event};retry:${event};retry:${event};`);
  // Results own driving input, but still offer the real pause menu from
  // a focused button and from the mapped controller pause action.
  await page.keyboard.press('Escape');
  await expect(page.locator('#festMenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#festMenu')).toBeHidden();
  await page.evaluate(() => {
    const buttons = Array.from({ length: 17 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [
        {
          id: 'Results controller',
          index: 0,
          connected: true,
          mapping: 'standard',
          axes: [0, 0, 0, 0],
          buttons,
        },
      ],
    });
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    Object.assign(navigator.getGamepads()[0]!.buttons[9], { pressed: true, value: 1 });
  });
  await expect(page.locator('#festMenu')).toBeVisible();
  await expect(log).toHaveText(`retry:${event};retry:${event};retry:${event};`);
});

test('festival activity retry: completed passive results remain reachable in the pause menu', async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
    const h = (window as unknown as FestivalWindow).festivalHarness;
    const result = {
      kind: 'festival-result' as const,
      version: 2 as const,
      runId: 'menu-activity:1',
      regionId: 'solvane',
      eventId: 'kestrel-drift',
      eventName: 'Kestrel Drift Playground',
      eventKind: 'drift-zone' as const,
      vehicleId: 'rd2',
      completed: true,
      abandoned: false,
      position: null,
      entrants: 1,
      time: 46.4,
      trapKmh: null,
      averageKmh: null,
      driftScore: 69,
      driftLines: [],
      stars: 1,
      legalDistance: 790,
      offRouteSeconds: 0,
      standings: [],
      at: 46.4,
      assisted: false,
    };
    h.recordActivity(result);
    h.recordActivity({ ...result, runId: 'menu-activity:2', completed: false, abandoned: true });
  });
  await expect(page.locator('#festResults')).toBeHidden();
  await page.keyboard.press('Escape');
  const activity = page.locator('.fest-last-activity');
  await expect(activity).toContainText('Kestrel Drift Playground');
  await expect(activity).toContainText('★☆☆ · 69 PTS');
  const retry = activity.getByRole('button', { name: 'TRY AGAIN' });
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#festivalEvents')).toContainText('retry:kestrel-drift;');
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: true, throttle: 0 });
});

test('festival activity targets: provisional pacing, route loss, and overlays stay coherent', async ({
  page,
}) => {
  await mount(page);
  const update = (patch: Record<string, unknown>) =>
    page.evaluate((patch) => {
      const h = (window as unknown as FestivalWindow).festivalHarness;
      h.setStatus(patch);
    }, patch);
  const event = {
    id: 'kestrel-drift',
    name: 'Kestrel Drift Playground',
    kind: 'drift-zone',
    countdown: 0,
    elapsed: 12,
    progress: 0.4,
    lap: 1,
    laps: 1,
    position: 1,
    entrants: 1,
    offRoute: false,
    live: { label: 'DRIFT', value: '160' },
    gate: null,
    challenge: {
      metric: 'drift',
      value: 160,
      unit: 'PTS',
      stars: 1,
      targetStars: 2,
      target: 300,
      delta: -140,
      progress: 160 / 300,
      remainingMeters: 410,
      requiredAverageKmh: null,
      targetTimeExpired: false,
      provisional: true,
      assisted: false,
      offRoute: false,
    },
  };
  await update({ mode: 'running', event });
  await expect(page.locator('#festChallenge')).toBeVisible();
  await expect(page.locator('#festChallengeStars')).toHaveText('★☆☆ LIVE');
  await expect(page.locator('#festChallengeTarget')).toHaveText('NEXT 2★ · 300 PTS');
  await expect(page.locator('#festChallengeAdvice')).toHaveText(
    '140 PTS TO NEXT STAR · 410 M LEFT',
  );
  await expect(page.locator('#festChallengeMeter')).toHaveAttribute('aria-valuenow', '53');
  // A provisional slide can be voided by route loss; the display must
  // move back immediately instead of keeping a fictitious earned star.
  event.challenge = {
    ...event.challenge,
    value: 0,
    stars: 0,
    targetStars: 1,
    target: 50,
    delta: -50,
    progress: 0,
    offRoute: true,
  };
  await update({ event });
  await expect(page.locator('#festChallengeStars')).toHaveText('☆☆☆ LIVE');
  await expect(page.locator('#festChallengeAdvice')).toContainText('RETURN TO THE MARKED ROUTE');
  // Switch to a speed-zone timing requirement, including an expired
  // target budget. These are HUD samples, not a physics driving claim.
  const zone = {
    ...event,
    id: 'test-zone',
    kind: 'speed-zone',
    challenge: {
      ...event.challenge,
      metric: 'average-speed',
      value: 118,
      unit: 'KM/H',
      target: 140,
      delta: -22,
      progress: 118 / 140,
      offRoute: false,
      requiredAverageKmh: 152.3,
      assisted: true,
    },
  };
  await update({ event: zone });
  await expect(page.locator('#festChallengeAdvice')).toHaveText(
    'ASSISTED · NEED 153 KM/H AVG FROM HERE · 410 M LEFT',
  );
  await update({
    event: {
      ...zone,
      challenge: { ...zone.challenge, requiredAverageKmh: null, targetTimeExpired: true },
    },
  });
  await expect(page.locator('#festChallengeAdvice')).toContainText(
    'NEXT TARGET OUT OF REACH THIS RUN',
  );
  await page.keyboard.press('Escape');
  await page.locator('[data-fest="photo"]').click();
  await expect(page.locator('#festChallenge')).toBeHidden();
  await update({ mode: 'free', event: null });
  await page.keyboard.press('Escape');
  await expect(page.locator('#festChallenge')).toBeHidden();
});

test('festival map: filters, event selection and keyboard focus survive redraws', async ({
  page,
}) => {
  const events = await mount(page);
  const map = page.locator('#festMap'),
    menu = page.locator('#festMenu');
  // The driving shortcut pauses the simulation and focuses the map itself.
  await page.keyboard.press('t');
  await expect(map).toBeVisible();
  const close = map.getByRole('button', { name: 'CLOSE', exact: true });
  await expect(close).toBeFocused();
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: true, throttle: 0 });
  const eventIds = () =>
    map
      .locator('[data-fest="mapSelect"]')
      .evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.value));
  expect(await eventIds()).toEqual(events.map((event) => event.id));
  const races = map.getByRole('button', { name: 'Races', exact: true });
  await races.focus();
  await page.keyboard.press('Space');
  await expect(races).toHaveAttribute('aria-pressed', 'true');
  await expect(races).toBeFocused();
  expect(await eventIds()).toEqual(events.filter((event) => event.race).map((event) => event.id));
  const undiscovered = events.find((event) => event.race && !event.discovered)!;
  const preview = map.locator(`[data-fest="mapSelect"][data-value="${undiscovered.id}"]`);
  await preview.focus();
  await page.keyboard.press('Enter');
  await expect(preview).toHaveAttribute('aria-pressed', 'true');
  await expect(preview).toBeFocused();
  await expect(page.locator('#festMapDetail h3')).toHaveText(undiscovered.name);
  await expect(page.locator('#festMapDetail')).toContainText('Drive near the marker');
  await expect(page.locator('#festMapDetail [data-fest="travel"]')).toHaveCount(0);
  // A discovered event has a real travel action; a preview never grants it.
  await map.getByRole('button', { name: 'All', exact: true }).click();
  const discovered = events.find((event) => event.discovered)!;
  await map.locator(`[data-fest="mapSelect"][data-value="${discovered.id}"]`).click();
  await expect(page.locator('#festMapDetail [data-fest="travel"]')).toHaveAttribute(
    'data-value',
    discovered.id,
  );
  await map.getByRole('button', { name: 'Skills', exact: true }).click();
  expect(await eventIds()).toEqual(events.filter((event) => !event.race).map((event) => event.id));
  await expect(map.getByRole('button', { name: 'Skills', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Tab is trapped inside the top overlay in both directions.
  const last = map.locator('button:visible').last();
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(map).toBeHidden();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'RESUME', exact: true })).toBeFocused();
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: true });
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.keyboard.down('w');
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: false, throttle: 1 });
  await page.keyboard.up('w');
});

test('festival photo: keyboard return cannot activate the race card behind the controls', async ({
  page,
}) => {
  await mount(page, { card: true });
  const photo = page.locator('#festPhoto'),
    log = page.locator('#festivalEvents');
  await page.keyboard.press('Escape');
  await page.locator('#festMenu').getByRole('button', { name: 'PHOTO MODE', exact: true }).click();
  await expect(photo).toBeVisible();
  const back = photo.locator('[data-fest="photoClose"]');
  await expect(back).toBeFocused();
  // Native button activation must not also run the event's Enter shortcut.
  await page.keyboard.press('Enter');
  await expect(photo).toBeHidden();
  await expect(log).not.toContainText('start:');
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: false, photoOpen: false });
  await page.keyboard.press('Escape');
  await page.locator('#festMenu').getByRole('button', { name: 'PHOTO MODE', exact: true }).click();
  await photo.getByRole('button', { name: 'Orbit camera left' }).click();
  await photo.getByRole('button', { name: 'Orbit camera right' }).click();
  await expect(log).toContainText('orbit:-1;orbit:1;');
  await photo.getByRole('button', { name: 'HIDE CONTROLS', exact: true }).click();
  const show = photo.getByRole('button', { name: 'SHOW CONTROLS', exact: true });
  await expect(show).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(show).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(photo).toBeHidden();
  await expect(log).not.toContainText('start:');
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: false, photoOpen: false });
});

test('festival gamepad: D-pad, accept and back use fresh presses across map and photo transitions', async ({
  page,
}) => {
  await mount(page);
  const menu = page.locator('#festMenu'),
    map = page.locator('#festMap'),
    photo = page.locator('#festPhoto');
  await pad(page, []);
  await pad(page, [9]);
  await expect(menu).toBeVisible();
  await pad(page, [9]);
  await expect(menu).toBeVisible();
  await tapPad(page, 13);
  const reset = menu.getByRole('button', { name: 'RESET TO ROAD', exact: true });
  await expect(reset).toBeFocused();
  await pad(page, [13]);
  await expect(reset).toBeFocused();
  await tapPad(page, 13);
  await tapPad(page, 13);
  await expect(menu.getByRole('button', { name: 'WORLD MAP', exact: true })).toBeFocused();
  await tapPad(page, 0);
  await expect(map).toBeVisible();
  await expect(map.getByRole('button', { name: 'CLOSE', exact: true })).toBeFocused();
  await pad(page, [0]);
  await expect(map).toBeVisible();
  await tapPad(page, 1);
  await expect(map).toBeHidden();
  await expect(menu).toBeVisible();
  // Holding Back after closing the map cannot also resume the game.
  await pad(page, [1]);
  await expect(menu).toBeVisible();
  expect(await tapPad(page, 1)).toMatchObject({ paused: false });
  await expect(menu).toBeHidden();
  await tapPad(page, 9);
  for (let step = 0; step < 4; step++) await tapPad(page, 13);
  await expect(menu.getByRole('button', { name: 'PHOTO MODE', exact: true })).toBeFocused();
  expect(await tapPad(page, 0)).toMatchObject({ paused: true, photoOpen: true });
  await expect(photo).toBeVisible();
  await pad(page, [0]);
  await expect(photo).toBeVisible();
  expect(await tapPad(page, 1)).toMatchObject({ paused: false, photoOpen: false });
  await expect(photo).toBeHidden();
});

test('festival menus remain usable when browser policy denies gamepad access', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mount(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => {
        throw new DOMException('Gamepad access denied by browser policy', 'SecurityError');
      },
    });
    (window as unknown as FestivalWindow).festivalHarness.frame();
  });
  await page.keyboard.press('Escape');
  await page.locator('#festMenu').getByRole('button', { name: 'WORLD MAP', exact: true }).click();
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: true });
  await expect(page.locator('#festMap')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame()),
  ).toMatchObject({ paused: false });
  expect(errors).toEqual([]);
});

test('festival rival feedback updates route gaps, preserves focus and clears stale race targets', async ({
  page,
}) => {
  const events = await mount(page);
  const race = events.find((event) => event.race)!;
  const event: NonNullable<FestivalStatus['event']> = {
    id: race.id,
    name: race.name,
    kind: 'sprint',
    countdown: 0,
    elapsed: 30,
    progress: 0.35,
    lap: 1,
    laps: 1,
    position: 2,
    entrants: 4,
    offRoute: false,
    live: null,
    challenge: null,
    gate: null,
    rivals: {
      ahead: { car: 1, name: 'Nera <test>', metres: 24.6 },
      behind: { car: 2, name: 'Ivo', metres: 10.4 },
    },
  };
  const update = (patch: Partial<FestivalStatus>) =>
    page.evaluate(
      (patch) => (window as unknown as FestivalWindow).festivalHarness.setStatus(patch),
      patch,
    );
  const focus = await page.evaluate(() => document.activeElement?.tagName);
  await update({ mode: 'running', event });
  const rivals = page.locator('#festRivals');
  await expect(rivals).toBeVisible();
  await expect(rivals).toContainText('ROUTE GAP');
  await expect(rivals.locator('[data-relation="ahead"]')).toContainText('Nera <test>');
  await expect(rivals.locator('[data-relation="ahead"]')).toContainText('25 M');
  await expect(rivals.locator('[data-relation="behind"]')).toContainText('10 M');
  expect(await rivals.locator('test').count()).toBe(0);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(focus);
  // The opponent just passed becomes the nearest car behind; full-lap gaps
  // remain route kilometres instead of collapsing to a false close battle.
  event.rivals = {
    ahead: { car: 3, name: 'Mara', metres: 1540 },
    behind: { car: 1, name: 'Nera <test>', metres: 5.2 },
  };
  await update({ event });
  await expect(rivals.locator('[data-relation="ahead"]')).toContainText('1.5 KM');
  await expect(rivals.locator('[data-relation="behind"]')).toContainText('Nera <test>');
  await expect(rivals.locator('[data-relation="behind"]')).toContainText('5 M');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame());
  await expect(rivals).toBeHidden();
  await expect(page.locator('#festMenu [data-fest="resume"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame());
  await expect(rivals).toBeVisible();
  await update({ event: { ...event, kind: 'drift-zone' } });
  await expect(rivals).toBeHidden();
  await update({ mode: 'finished', event });
  await expect(rivals).toBeHidden();
  await update({ mode: 'free', event: null });
  await expect(rivals).toBeHidden();
});

test('festival rival route gaps fit desktop and phone event panels', async ({ page }) => {
  const events = await mount(page);
  const race = events.find((event) => event.race)!;
  await page.evaluate(
    (race) =>
      (window as unknown as FestivalWindow).festivalHarness.setStatus({
        mode: 'running',
        event: {
          id: race.id,
          name: race.name,
          kind: 'circuit',
          countdown: 0,
          elapsed: 196.6,
          progress: 0.7,
          lap: 2,
          laps: 3,
          position: 2,
          entrants: 8,
          offRoute: false,
          live: null,
          challenge: null,
          gate: null,
          rivals: {
            ahead: { car: 1, name: 'A deliberately long rival name', metres: 10020 },
            behind: { car: 2, name: 'Another lengthy opponent name', metres: 14.9 },
          },
        },
      }),
    race,
  );
  for (const [width, height] of [
    [1440, 900],
    [900, 640],
    [360, 780],
    [640, 360],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('#festRivals')).toBeVisible();
    const layout = await page.evaluate(() => {
      const panel = document.getElementById('festEvent')!,
        row = document.getElementById('festRivals')!,
        p = panel.getBoundingClientRect(),
        r = row.getBoundingClientRect();
      return {
        left: p.left,
        right: p.right,
        bottom: p.bottom,
        clipped: panel.scrollWidth > panel.clientWidth,
        inside: r.left >= p.left && r.right <= p.right && r.bottom <= p.bottom,
        numbers: [...row.querySelectorAll('em')].every((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left >= r.left && rect.right <= r.right;
        }),
      };
    });
    expect(layout.left, `${width} px`).toBeGreaterThanOrEqual(0);
    expect(layout.right, `${width} px`).toBeLessThanOrEqual(width);
    expect(layout.bottom, `${height} px`).toBeLessThan(height - 140);
    expect(layout).toMatchObject({ clipped: false, inside: true, numbers: true });
  }
});

test('festival slipstream coaching follows worker phases and clears across menus, assistance and events', async ({
  page,
}) => {
  const events = await mount(page),
    race = events.find((event) => event.race)!;
  const event: NonNullable<FestivalStatus['event']> = {
    id: race.id,
    name: race.name,
    kind: 'sprint',
    countdown: 0,
    elapsed: 35,
    progress: 0.4,
    lap: 1,
    laps: 1,
    position: 2,
    entrants: 4,
    offRoute: false,
    live: null,
    challenge: null,
    gate: null,
    racecraft: {
      phase: 'following',
      car: 1,
      target: 'Nera <test>',
      progress: 0.4,
      passes: 0,
      sequence: 0,
    },
    rivals: {
      ahead: { car: 1, name: 'Nera <test>', metres: 24.6 },
      behind: { car: 2, name: 'A lengthy pursuing rival name', metres: 10.4 },
    },
  };
  const update = (patch: Partial<FestivalStatus>) =>
    page.evaluate(
      (patch) => (window as unknown as FestivalWindow).festivalHarness.setStatus(patch),
      patch,
    );
  await update({ mode: 'running', event });
  const panel = page.locator('#festRacecraft'),
    meter = page.locator('#festRacecraftMeter');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('BUILDING THE TOW');
  await expect(panel).toContainText('Nera <test>');
  expect(await panel.locator('test').count()).toBe(0);
  await expect(meter).toHaveAttribute('aria-valuenow', '40');
  for (const [phase, label] of [
    ['ready', 'SLIPSTREAM READY'],
    ['passing', 'COMPLETE THE PASS'],
    ['complete', 'CLEAN SLIPSTREAM PASS'],
  ] as const) {
    event.racecraft = {
      ...event.racecraft!,
      phase,
      progress: 1,
      passes: phase === 'complete' ? 1 : 0,
    };
    await update({ event });
    await expect(panel).toContainText(label);
    await expect(meter).toHaveAttribute('aria-valuetext', new RegExp(label));
  }
  await expect(panel).toContainText('1 clean pass this race');
  for (const [width, height] of [
    [1440, 900],
    [360, 780],
    [640, 360],
  ]) {
    await page.setViewportSize({ width, height });
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y + bounds!.height).toBeLessThan(height - 110);
    expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as FestivalWindow).festivalHarness.frame());
  await expect(panel).toBeHidden();
  await expect(page.locator('#festMenu [data-fest="resume"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await update({});
  await expect(panel).toBeVisible();
  await update({ autopilot: true });
  await expect(panel).toBeHidden();
  await update({ autopilot: false, event: { ...event, kind: 'drift-zone' } });
  await expect(panel).toBeHidden();
  await update({ mode: 'countdown', event });
  await expect(panel).toBeHidden();
  await update({ mode: 'finished', event });
  await expect(panel).toBeHidden();
  await update({ mode: 'free', event: null });
  await expect(panel).toBeHidden();
});
