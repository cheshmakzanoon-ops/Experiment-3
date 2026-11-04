import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'vite';
import type * as API from './fixtures/launch-board.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

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
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/launch-board.ts'),
        name: 'LaunchBoard',
        formats: ['iife'],
      },
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
  const tabbable = await page
    .locator('.lb-plate')
    .evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex >= 0).length);
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
      els.every(
        (e) => (e as HTMLElement).tabIndex === -1 && e.getAttribute('aria-hidden') === 'true',
      ),
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
  expect(Math.abs(Number(await page.locator('#circuitLength').textContent()) - 4)).toBeLessThan(
    0.05,
  );
  await expect(page.locator('.lb-dial[data-dial="circuit"] .lb-dial-count')).toHaveText(
    /^02 \/ \d+$/,
  );
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
  /** Tap until the handler has acted. A host so loaded that the first poll comes late
   * treats an early press as one held when the screen opened (by design); the check
   * runs before every retry, so a handled press is never repeated. */
  const tapUntil = async (index: number, done: () => Promise<boolean>) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      await tap(index);
      if (await done()) return;
    }
    throw new Error(`controller button ${index} was not handled`);
  };
  const checked = (name: RegExp) => () =>
    page
      .getByRole('radio', { name })
      .getAttribute('aria-checked')
      .then((v) => v === 'true');
  await tapUntil(5, checked(/^GP BIKE/)); // RB
  await expect(page.getByRole('radio', { name: /^GP BIKE/ })).toBeChecked();
  await tapUntil(5, checked(/^DIRT/));
  await expect(page.getByRole('radio', { name: /^DIRT/ })).toBeChecked();
  await tapUntil(4, checked(/^GP BIKE/)); // LB
  await expect(page.getByRole('radio', { name: /^GP BIKE/ })).toBeChecked();
  await expect(page.locator('#app')).toHaveAttribute('data-pad', 'true');
  // D-pad down from the plates lands on a control and the focus ring is drawn.
  await page.locator('.lb-plate[aria-checked="true"]').focus();
  await tapUntil(13, async () =>
    page.evaluate(() => !document.activeElement?.matches('.lb-plate')),
  );
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  // Left/right on a focused dial steps its value.
  const weather = () => page.locator('#weather').inputValue();
  await page.locator('#weather').focus();
  await tapUntil(15, async () => (await weather()) === 'changeable');
  await tapUntil(14, async () => (await weather()) === 'clear');
  // Start launches the current entry.
  const launches = (await started(page)).length;
  await tapUntil(9, async () => (await started(page)).length > launches);
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

test('machine character line sits in the nameplate card, is drawn from 680 up and never meets the rail', async ({
  page,
}) => {
  // The line used to sit under the MACHINE dial and was dropped below 790px tall to keep the board
  // in one screen (the e2e sweep's 720p fix). It now lives in the nameplate card at the foot of the
  // showroom (`.car-card`), so it costs the board nothing: it is drawn at 720p, the board fits at
  // every height, and the card must not touch the paddock rail or the footer.
  await load(page);
  const blurb = page.locator('#machineBlurb');
  const fits = () =>
    page.locator('.menu-body').evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
  for (const [width, height] of [
    [1280, 800],
    [1280, 789],
    [1280, 768],
    [1280, 720],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(blurb, `${width}x${height}`).toBeVisible();
    await expect(blurb).toContainText('The reference formula car');
    expect(await fits(), `board fits at ${width}x${height}`).toBe(true);
    // The card is the nameplate's, not the board's, and clear of the rail and the footer.
    const boxes = await page.evaluate(() => {
      const box = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      return {
        card: box('.car-card'),
        rail: box('.menu-actions'),
        footer: box('.menu-footer'),
        board: box('.lb-board'),
        blurbInBoard: !!document.querySelector('.lb-board #machineBlurb'),
        blurbInCard: !!document.querySelector('.car-card #machineBlurb'),
      };
    });
    expect(boxes.blurbInCard, `${width}x${height} blurb in the card`).toBe(true);
    expect(boxes.blurbInBoard).toBe(false);
    expect(boxes.card.top, `${width}x${height} card below the rail`).toBeGreaterThanOrEqual(
      boxes.rail.bottom,
    );
    expect(boxes.card.bottom).toBeLessThanOrEqual(boxes.footer.top);
    expect(boxes.card.left).toBeGreaterThanOrEqual(boxes.board.right);
  }
  // Below 680px tall the card keeps the nameplate and drops the line.
  await page.setViewportSize({ width: 1024, height: 600 });
  await expect(blurb).toBeHidden();
  await expect(page.locator('.car-label')).toBeVisible();
  // Hidden text still describes the control (aria-describedby reads it), so nothing is lost.
  await expect(page.locator('#vehicle')).toHaveAccessibleDescription(/The reference formula car/);
});

const logged = async (page: Page) =>
  JSON.parse((await page.locator('#boardEvents').textContent()) ?? '[]') as Record<
    string,
    unknown
  >[];

test('wildcard door opens the board: 29 events, arrow keys select, START is wired', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await load(page);
  const door = page.getByRole('button', {
    name: /^WILDCARD SERIES, 29 events, 17 cross-discipline/,
  });
  await expect(door).toBeVisible();
  await expect(door).toContainText('0 OF 29 MEDALLED');
  await door.click();
  const board = page.locator('.wc-board');
  await expect(board).toBeVisible();
  const rows = page.locator('.wc-row');
  await expect(rows).toHaveCount(29);
  // One radio group, one tab stop, the chosen event focused and showing its page.
  const checked = () => page.locator('.wc-row[aria-checked="true"]');
  await expect(checked()).toHaveCount(1);
  await expect(checked()).toBeFocused();
  await expect(page.locator('.wc-detail:not([hidden])')).toHaveCount(1);
  const first = await checked().getAttribute('data-id');
  // Arrow keys move and select; Home and End jump.
  await page.keyboard.press('ArrowDown');
  const second = await checked().getAttribute('data-id');
  expect(second).not.toBe(first);
  await expect(page.locator(`.wc-detail[data-id="${second}"]`)).toBeVisible();
  await expect(page.locator(`.wc-detail[data-id="${first}"]`)).toBeHidden();
  await page.keyboard.press('End');
  await expect(rows.last()).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(rows.first()).toHaveAttribute('aria-checked', 'true');
  // A pointer click on a row selects it too, and the page shows the real venue art.
  await rows.nth(3).click();
  const page3 = page.locator('.wc-detail:not([hidden])');
  await expect(page3.locator('svg.wc-map-art .ta-line')).toHaveCount(1);
  await expect(page3).toContainText('MACHINE');
  await expect(page3).toContainText('PAYS UP TO');
  // The medal ladder reads gold, silver, bronze.
  await expect(page3.locator('.wc-ladder li')).toHaveText([/GOLD/, /SILVER/, /BRONZE/]);
  // START EVENT names the event it starts (the career controller owns the launch).
  const id = await rows.nth(3).getAttribute('data-id');
  await page3.getByRole('button', { name: /^START EVENT/ }).click();
  expect((await logged(page)).some((e) => e.action === `career:wildcardGo:${id}`)).toBe(true);
  // Type stays at 11 px or more, and the dialog fits the 1280x720 screen.
  const geometry = await page.evaluate(() => {
    const small: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.wc-board *')) {
      if (el instanceof SVGElement || !el.getClientRects().length) continue;
      const own = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim(),
      );
      if (own && parseFloat(getComputedStyle(el).fontSize) < 11) small.push(el.className);
    }
    const box = document.querySelector('dialog')!.getBoundingClientRect();
    return { small, top: box.top, bottom: box.bottom, width: box.width };
  });
  expect(geometry.small).toEqual([]);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(720);
  // Close returns to the paddock.
  await page.getByRole('button', { name: 'Close Wildcard Series' }).click();
  await expect(board).toBeHidden();
  expect(errors).toEqual([]);
});

test('the door shows medal progress; CONTINUE relaunches the last entry in one input', async ({
  page,
}) => {
  await load(page);
  // No remembered entry yet: no CONTINUE.
  await expect(page.getByRole('button', { name: /^CONTINUE/ })).toHaveCount(0);
  await page.evaluate(() => window.LaunchBoard.setProgress());
  await expect(page.locator('.lb-wild')).toContainText('1 OF 29 MEDALLED');
  await expect(page.locator('.lb-wild')).toHaveAttribute('title', 'Next: FORMULA ON THE WALL');
  // A remembered form entry writes the same selects and launches: one input.
  await page.evaluate(() => window.LaunchBoard.setContinue('form'));
  const resume = page.getByRole('button', { name: /^CONTINUE: GP-R1 · VELLAMAR COAST, 5 LAPS/ });
  await expect(resume).toBeVisible();
  await resume.click();
  const entry = (await started(page)).at(-1)!;
  expect(entry).toMatchObject({ circuit: 'vellamar', mode: 'race', weather: 'rain' });
  expect(entry.vehicles[0]).toBe('gpr1');
  await expect(page.locator('#vehicle')).toHaveValue('gpr1');
  await expect(page.locator('#laps')).toHaveValue('5');
  await expect(page.locator('#startSlot')).toHaveValue('back');
  await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName(/^GP BIKE/);
  // A remembered Wildcard event routes to its start action instead of the form.
  await page.evaluate(() => window.LaunchBoard.setContinue('wildcard'));
  const wild = page.getByRole('button', { name: /^CONTINUE: KARTS AFTER DARK/ });
  await expect(wild).toHaveAttribute('data-action', 'career:wildcardGo:karts-after-dark');
  await wild.click();
  expect((await logged(page)).some((e) => e.action === 'career:wildcardGo:karts-after-dark')).toBe(
    true,
  );
});

test('LIGHT dial: venue default, midday, sunset, night or the live sky, announced to the shell', async ({
  page,
}) => {
  await load(page);
  const light = page.locator('#light');
  await expect(light.locator('option')).toHaveText([
    'Venue',
    'Midday',
    'Sunset',
    'Night',
    'Live sky',
  ]);
  await expect(light).toHaveValue('auto');
  const glyphOf = () =>
    page.locator('.lb-dial[data-dial="light"] .lb-dial-glyph').getAttribute('data-glyph');
  expect(await glyphOf()).toBe('venue');
  await light.selectOption('sunset');
  expect(await glyphOf()).toBe('sunset');
  await light.selectOption('night');
  expect(await glyphOf()).toBe('night');
  // The hands step it like every dial, and the shell hears each change.
  await page.locator('.lb-dial[data-dial="light"] .lb-step[data-step="1"]').click();
  await expect(light).toHaveValue('live');
  expect((await logged(page)).filter((e) => 'light' in e).map((e) => e.light)).toEqual([
    'sunset',
    'night',
    'live',
  ]);
  // The submit does not carry the light: it is the shell's own choice, not a session option.
  await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
  expect((await started(page)).at(-1)).not.toHaveProperty('light');
  // And every dial label still fits: the board scrolls none at 1280x720.
  const body = await page
    .locator('.menu-body')
    .evaluate((el) => ({ c: el.clientHeight, s: el.scrollHeight }));
  expect(body.s).toBeLessThanOrEqual(body.c + 1);
});

test('controller: the D-pad walks the Wildcard events and B closes the board', async ({ page }) => {
  await load(page);
  await page.evaluate(() => window.LaunchBoard.installFakePad());
  await page.waitForTimeout(200); // the first poll only records held buttons
  await page.getByRole('button', { name: /^WILDCARD SERIES/ }).click();
  await expect(page.locator('.wc-board')).toBeVisible();
  const chosen = () => page.locator('.wc-row[aria-checked="true"]').getAttribute('data-id');
  const first = await chosen();
  // Held for several animation frames, and retried until handled (a loaded host polls late).
  const tapUntil = async (index: number, done: () => Promise<boolean>) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      await page.evaluate((i) => window.LaunchBoard.press(i, true), index);
      await page.waitForTimeout(300);
      await page.evaluate((i) => window.LaunchBoard.press(i, false), index);
      await page.waitForTimeout(300);
      if (await done()) return;
    }
    throw new Error(`controller button ${index} was not handled`);
  };
  await tapUntil(13, async () => (await chosen()) !== first); // down
  const second = await chosen();
  await expect(page.locator(`.wc-detail[data-id="${second}"]`)).toBeVisible();
  await tapUntil(13, async () => (await chosen()) !== second); // down again
  await tapUntil(12, async () => (await chosen()) === second); // up
  // B closes the board (the modal offers a close action).
  await tapUntil(1, async () => !(await page.locator('.wc-board').isVisible()));
});

test('menu sounds: silent before the first input, then the cue hook makes sound, mute and volume obeyed', async ({
  page,
}) => {
  // Playwright's own evaluate() grants user activation, so the page's activation flag is
  // replaced by one that follows the real rule: false until a real pointer or key event.
  await page.addInitScript(() => {
    let active = false;
    Object.defineProperty(Navigator.prototype, 'userActivation', {
      configurable: true,
      get: () => ({ hasBeenActive: active, isActive: active }),
    });
    (window as unknown as { markActive: () => void }).markActive = () => (active = true);
  });
  // A counting AudioContext (the real one cannot be heard here): what the sounds build.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.audioStats = { contexts: 0, oscillators: 0, noises: 0, masterGain: [] as number[] };
    const stats = w.audioStats as {
      contexts: number;
      oscillators: number;
      noises: number;
      masterGain: number[];
    };
    const param = (record?: boolean) => ({
      value: 0,
      setValueAtTime(v: number) {
        if (record) stats.masterGain.push(v);
      },
      linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {},
    });
    const node = () => ({ connect: (n: unknown) => n });
    let gains = 0;
    w.AudioContext = class {
      state = 'running';
      get currentTime() {
        return performance.now() / 1000;
      }
      sampleRate = 48000;
      destination = {};
      constructor() {
        stats.contexts++;
      }
      async resume() {}
      async close() {}
      createGain() {
        gains++;
        return { ...node(), gain: param(gains === 1) };
      }
      createOscillator() {
        stats.oscillators++;
        return { ...node(), type: '', frequency: param(), start() {}, stop() {} };
      }
      createBufferSource() {
        stats.noises++;
        return { ...node(), buffer: null, start() {}, stop() {} };
      }
      createBiquadFilter() {
        return { ...node(), type: '', frequency: param(), Q: { value: 0 } };
      }
      createBuffer(_c: number, length: number) {
        return { getChannelData: () => new Float32Array(length) };
      }
    };
  });
  // Init scripts run on navigation, not on setContent: navigate once so they are in place.
  await page.goto('about:blank');
  await load(page);
  await page.evaluate(() => window.LaunchBoard.mountSounds());
  // (document.open in setContent erased init-time listeners: attach after the load.)
  await page.evaluate(() => {
    for (const type of ['pointerdown', 'keydown'])
      window.addEventListener(
        type,
        () => (window as unknown as { markActive: () => void }).markActive(),
        true,
      );
  });
  const stats = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            audioStats: {
              contexts: number;
              oscillators: number;
              noises: number;
              masterGain: number[];
            };
          }
        ).audioStats,
    );
  // The page has had no user input: a cue is announced, and nothing is heard or even created.
  expect(await page.evaluate(() => navigator.userActivation?.hasBeenActive ?? false)).toBe(false);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('motobound:cue', { detail: { cue: 'confirm' } })),
  );
  expect((await stats()).contexts).toBe(0);
  // A real click is the first input: the next cue (a dial step) plays.
  await page.locator('.lb-dial[data-dial="weather"] .lb-step[data-step="1"]').click();
  const played = await stats();
  expect(played.contexts).toBe(1);
  expect(played.oscillators + played.noises).toBeGreaterThan(0);
  // Level: the quiet ceiling times the player's volume.
  expect(played.masterGain[0]).toBeCloseTo(0.35 * 0.5, 5);
  // Mute (the M key's flag) and a zero volume stop every further cue.
  await page.evaluate(() => ((window as unknown as { soundMuted: boolean }).soundMuted = true));
  await page.waitForTimeout(80);
  const muted = await stats();
  await page.locator('.lb-dial[data-dial="weather"] .lb-step[data-step="1"]').click();
  await page.keyboard.press('Escape');
  expect(await stats()).toEqual(muted);
  await page.evaluate(() => {
    const w = window as unknown as { soundMuted: boolean; soundVolume: number };
    w.soundMuted = false;
    w.soundVolume = 0;
  });
  await page.locator('.lb-dial[data-dial="weather"] .lb-step[data-step="1"]').click();
  expect(await stats()).toEqual(muted);
  // Unmuted at volume, a modal opening and closing makes the latch sounds.
  await page.evaluate(() => ((window as unknown as { soundVolume: number }).soundVolume = 0.8));
  await page.waitForTimeout(80);
  const before = (await stats()).oscillators + (await stats()).noises;
  await page.getByRole('button', { name: /^WILDCARD SERIES/ }).click();
  await expect(page.locator('.wc-board')).toBeVisible();
  expect((await stats()).oscillators + (await stats()).noises).toBeGreaterThan(before);
});

test('the DIRT SERIES shortcuts belong to the DIRT plate only', async ({ page }) => {
  await load(page);
  const outdoor = page.getByRole('button', { name: 'OUTDOOR MX', exact: true });
  const stadium = page.getByRole('button', { name: 'STADIUM SX', exact: true });
  const heading = page.getByLabel('Motocross venues').getByText('DIRT SERIES', { exact: true });
  // Circuit, GP bike and Festival have no use for motocross venues: no chips, no heading.
  for (const plate of [/^CIRCUIT/, /^GP BIKE/, /^FESTIVAL/]) {
    await page.getByRole('radio', { name: plate }).click();
    await expect(outdoor).toBeHidden();
    await expect(stadium).toBeHidden();
    await expect(heading).toBeHidden();
  }
  // Dirt shows them, and the chip of the chosen venue is pressed.
  await page.getByRole('radio', { name: /^DIRT/ }).click();
  await expect(heading).toBeVisible();
  await expect(outdoor).toBeVisible();
  await expect(outdoor).toHaveAttribute('aria-pressed', 'true');
  await stadium.click();
  await expect(page.locator('#circuit')).toHaveValue('arena-nord-sx');
  await expect(stadium).toHaveAttribute('aria-pressed', 'true');
  // Leaving dirt for a circuit hides them again.
  await page.getByRole('radio', { name: /^CIRCUIT/ }).click();
  await expect(outdoor).toBeHidden();
});
