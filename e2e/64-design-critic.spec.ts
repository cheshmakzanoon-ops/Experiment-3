import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fixtureDefine } from './fixtures/owner-build.ts';

test.use({ actionTimeout: 15000 });

/** The design-critic guards (docs/studio/reports/ux4.md), DOM only: the production Interface and the
 * real style sheets with no renderer, through the fixture scenes the screenshot tools use
 * (scripts/studio/tools/ux-fixture.ts) and the in-page audit (ux4-audit.page.js). Every screen of the
 * front end is mounted and must
 *   - show no text under 11 px (the race HUD's scaled panels are the one declared exception: it is in
 *     the report's open items),
 *   - pass WCAG AA against its own background (4.5:1, 3:1 for large text) wherever the background is
 *     known (text over the 3D scene or a gradient is not judged here),
 *   - show a focus ring on every interactive element, under the keyboard and under the gamepad.
 * Run with the DOM config:
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium APEX_WT=$PWD npx playwright test \
 *     -c scripts/studio/tools/pw-dom.config.ts e2e/64-design-critic.spec.ts */
type Audit = {
  texts: number;
  judged: number;
  small: { name: string; text: string; size: number; hud: boolean }[];
  low: { name: string; text: string; ratio: number }[];
};
type Focus = { checked: number; failures: { el: string; text: string; outline: string }[] };
declare global {
  interface Window {
    UxFixture: Record<string, (...args: unknown[]) => unknown>;
    ux4Audit: { audit(): Audit; focus(pad: boolean): Focus };
  }
}

async function load(page: Page) {
  const built = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('scripts/studio/tools/ux-fixture.ts'),
        name: 'UxFixture',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing fixture output');
  const script = result.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing fixture script');
  await page.setContent('<!doctype html><title>Design critic</title>');
  for (const asset of result.output)
    if (asset.type === 'asset' && asset.fileName.endsWith('.css'))
      await page.addStyleTag({ content: String(asset.source) });
  await page.addScriptTag({ content: script.code });
  await page.addScriptTag({
    content: await readFile('scripts/studio/tools/ux4-audit.page.js', 'utf8'),
  });
  await page.evaluate(() => document.fonts.ready);
}
async function mountScene(page: Page, scene: string) {
  const [name, argument] = scene.split(':');
  await page.evaluate(
    async ([n, a]) => {
      const f = window.UxFixture;
      if (n === 'gp' || n === 'dirt' || n === 'festivalPlate') {
        f.menu();
        f.plate(n === 'festivalPlate' ? 'festival' : n);
      } else await f[n](...(a ? [a] : []));
    },
    [name, argument],
  );
  await page.evaluate(() => document.fonts.ready);
  // A dialog rises in over 220 ms (opacity from 0): measure the settled screen.
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
}

/** Screens a player reads: legible, in the board's colours. */
const SCREENS = [
  'menu',
  'gp',
  'dirt',
  'festivalPlate',
  'wildcardBoard',
  'career',
  'careerPlayed',
  'career:events',
  'career:licences',
  'career:garage',
  'career:dealership',
  'firstRun',
  'loadingScreen',
  'loadingGp',
  'loadingMx',
  'loadingFestival',
  'briefing',
  'briefingMx',
  'gridPresentation',
  'resultsCareer',
  'settings',
  'controls',
  'credits',
  'team',
  'teamEngineering',
  'teamPersonnel',
  'teamFinance',
  'academy',
  'championship',
  'events',
  'records',
  'recordsWildcard',
  'festival',
  'festivalMenu',
  'festivalCard',
  'festivalMap',
];
/** The race HUD and the screens that sit over it (their own text is held to the floor; the HUD's is not). */
const HUD_SCREENS = ['hud', 'hudGp', 'hudMx', 'replay', 'pause', 'results'];
/** Demo scenes switch the demo policy on for the rest of the page: last. */
const DEMO_SCREENS = ['demoMenu', 'demoWildcard', 'demoWildcardLocked', 'demoRecords'];
const VIEWPORTS = [
  { width: 1280, height: 800 }, // Steam Deck
  { width: 1280, height: 720 },
];

for (const viewport of VIEWPORTS)
  test(`legibility at ${viewport.width}x${viewport.height}: type floor, contrast and focus rings on every screen`, async ({
    page,
  }) => {
    test.setTimeout(280000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await load(page);
    const small: string[] = [];
    const low: string[] = [];
    const ringless: string[] = [];
    let focusables = 0;
    for (const scene of [...SCREENS, ...HUD_SCREENS, ...DEMO_SCREENS]) {
      await mountScene(page, scene);
      const audit = await page.evaluate(() => window.ux4Audit.audit());
      expect(audit.texts, `${scene} drew text`).toBeGreaterThan(5);
      // The race HUD's scaled panels are the declared exception (they sit under every screen that
      // keeps the HUD on show, such as the results board); everything else is held to 11 px.
      for (const s of audit.small)
        if (!s.hud) small.push(`${scene}: ${s.name} "${s.text}" ${s.size}px`);
      for (const l of audit.low) low.push(`${scene}: ${l.name} "${l.text}" ${l.ratio}:1`);
      await page.keyboard.press('Tab'); // keyboard modality: :focus-visible matches
      for (const pad of [false, true]) {
        const focus = await page.evaluate((p) => window.ux4Audit.focus(p), pad);
        focusables += focus.checked;
        for (const f of focus.failures)
          ringless.push(`${scene} ${pad ? 'pad' : 'keys'}: ${f.el} "${f.text}" ${f.outline}`);
      }
    }
    expect(small, 'text under 11 px').toEqual([]);
    expect(low, 'text under WCAG AA').toEqual([]);
    expect(ringless, 'interactive elements with no focus ring').toEqual([]);
    expect(focusables).toBeGreaterThan(500);
    expect(errors).toEqual([]);
  });

test('loading boards carry their discipline: plate, colour and facts differ per discipline', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await load(page);
  const seen = new Map<string, { numeral: string; colour: string; label: string }>();
  for (const [scene, discipline] of [
    ['loadingScreen', 'circuit'],
    ['loadingGp', 'gp'],
    ['loadingMx', 'dirt'],
    ['loadingFestival', 'festival'],
  ] as const) {
    await mountScene(page, scene);
    const info = await page.evaluate(() => {
      const loading = document.getElementById('loading')!;
      const plate = loading.querySelector('.loading-plate')!;
      return {
        discipline: loading.dataset.discipline,
        numeral: plate.querySelector('.plate-numeral')?.textContent ?? '',
        colour: getComputedStyle(plate.querySelector('.plate-body')!).fill,
        label: plate.querySelector('.lp-text b')?.textContent ?? '',
        facts: plate.querySelector('.lp-stats')?.textContent ?? '',
        motto: plate.querySelector('.lp-motto')?.textContent ?? '',
      };
    });
    expect(info.discipline).toBe(discipline);
    expect(info.facts.length).toBeGreaterThan(4);
    expect(info.motto.length).toBeGreaterThan(8);
    seen.set(discipline, { numeral: info.numeral, colour: info.colour, label: info.label });
  }
  // Four disciplines, four numerals, four plate colours, four names: never colour alone.
  expect(new Set([...seen.values()].map((v) => v.numeral)).size).toBe(4);
  expect(new Set([...seen.values()].map((v) => v.colour)).size).toBe(4);
  expect(new Set([...seen.values()].map((v) => v.label)).size).toBe(4);
});

test('reduced motion stops the pre-race lower third and the loading bar', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await load(page);
  await mountScene(page, 'gridPresentation');
  const third = await page.evaluate(
    () => getComputedStyle(document.querySelector('.grid-lower-third')!).transitionDuration,
  );
  expect(third).toBe('0s');
  await mountScene(page, 'loadingScreen');
  const bar = await page.evaluate(
    () => getComputedStyle(document.querySelector('#loading .loader i')!).transitionDuration,
  );
  expect(bar).toBe('0s');
});
