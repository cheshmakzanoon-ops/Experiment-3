import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fixtureDefine } from './fixtures/owner-build.ts';

test.use({ actionTimeout: 15000 });

/** The HUD legibility floor (docs/studio/reports/hud-legibility.md), DOM only: the production Interface,
 * FestivalHud and the real style sheets with no renderer, through the ux-fixture scenes the screenshot tools use
 * and the in-page measurement (scripts/studio/tools/hud-legibility.page.js, the same one hud-measure.mjs prints).
 *
 *   - Every text the race HUD draws, in every state the fixtures can put it in (the plain frame, a flag banner,
 *     the pit lane, the start lights, a vehicle warning, the VEHICLE panel, the GP corner guide; circuit, GP bike,
 *     dirt, open world), is at its tier's floor as the player sees it: a readout read at a glance (speed, gear,
 *     position, lap time) at least 18 px, every other label 11 px. The only exemption is the MOTOBOUND wordmark.
 *   - At every HUD SCALE step and at 1280x800, 1280x720, 1366x768, 1920x1080 and 3840x2160, the HUD's panels
 *     stay inside the window, do not overlap one another, stay out of the sight window (the road ahead) and no text
 *     is clipped by the box that draws it.
 *   - The layout unit follows the setting and the window: automatic is 115% under 900 px tall; a step is honoured
 *     up to the window's limit.
 *   - The settings screen offers the HUD dial, applies it as it moves and puts it back when the screen is cancelled.
 * Run with the DOM config:
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium APEX_WT=$PWD npx playwright test \
 *     -c scripts/studio/tools/pw-dom.config.ts e2e/65-hud-legibility.spec.ts */
type Row = {
  name: string;
  text: string;
  px: number;
  tier: 'primary' | 'secondary' | 'tertiary' | 'decor';
  shown: boolean;
};
type Layout = {
  viewport: [number, number];
  blocks: { name: string; rect: number[] }[];
  overlaps: string[];
  outside: string[];
  sight: string[];
  clipped: string[];
};
declare global {
  interface Window {
    UxFixture: Record<string, (...args: unknown[]) => unknown>;
    hudLegibility: {
      measure(root?: Element): Row[];
      layout(): Layout;
      FLOOR: Record<'primary' | 'secondary' | 'tertiary', number>;
    };
  }
}

let bundled: Promise<{ styles: string[]; script: string }> | undefined;
/** One fixture build for the whole file (about half a minute). */
const bundle = () =>
  (bundled ??= (async () => {
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
    return {
      script: script.code,
      styles: result.output
        .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
        .map((item) => String((item as { source: string | Uint8Array }).source)),
    };
  })());

async function load(page: Page) {
  const { script, styles } = await bundle();
  await page.setContent('<!doctype html><title>HUD legibility</title>');
  for (const content of styles) await page.addStyleTag({ content });
  await page.addScriptTag({ content: script });
  await page.addScriptTag({
    content: await readFile('scripts/studio/tools/hud-legibility.page.js', 'utf8'),
  });
  await page.evaluate(() => document.fonts.ready);
}

/** The HUD in every state the fixtures reach: name[:state[:machine]], see ux-fixture.ts `hudState`. */
const SCENES = [
  'hud',
  'hudGp',
  'hudMx',
  'festival',
  'hudState:banner',
  'hudState:pit',
  'hudState:start',
  'hudState:alert',
  'hudState:vehicle',
  'hudState:vehicle:gp',
  'hudState:gpcraft:gp',
  'hudState:vehicle:mx',
];
const STEPS = ['auto', '1', '1.15', '1.3', '1.5'] as const;
/** [width, height, steps checked]: every step on the two handhelds, the extremes elsewhere. */
const WINDOWS: [number, number, readonly string[]][] = [
  [1280, 800, STEPS],
  [1280, 720, STEPS],
  [1366, 768, ['auto', '1.5']],
  [1920, 1080, ['auto', '1', '1.5']],
  [3840, 2160, ['auto', '1.5']],
];

async function mount(page: Page, scene: string, step: string) {
  await page.evaluate(
    async ([s, scale]) => {
      const root = document.documentElement;
      if (scale === 'auto') root.style.removeProperty('--hud-scale');
      else root.style.setProperty('--hud-scale', scale);
      const [name, ...args] = s.split(':');
      await window.UxFixture[name](...args);
    },
    [scene, step],
  );
  await page.evaluate(() => document.fonts.ready);
  // Entering panels slide in over 220 ms: measure the settled HUD.
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
}

for (const [width, height, steps] of WINDOWS)
  test(`HUD legibility at ${width}x${height}: type floors, footprint and sight window at ${steps.join(' / ')}`, async ({
    page,
  }) => {
    test.setTimeout(290000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await load(page);
    const small: string[] = [];
    const layout: string[] = [];
    let judged = 0;
    for (const step of steps)
      for (const scene of SCENES) {
        await mount(page, scene, step);
        const at = `${width}x${height} HUD ${step} ${scene}`;
        const { rows, floors, box } = await page.evaluate(() => {
          const hud = document.getElementById('hud');
          return {
            rows: window.hudLegibility.measure(hud && !hud.hidden ? hud : document.getElementById('app')!),
            floors: window.hudLegibility.FLOOR,
            box: window.hudLegibility.layout(),
          };
        });
        const shown = rows.filter((row) => row.shown && row.tier !== 'decor');
        // A scene that drew almost nothing would pass vacuously: every one draws a real HUD.
        expect(shown.length, `${at} drew text`).toBeGreaterThan(scene === 'festival' ? 12 : 30);
        if (['hud', 'hudGp', 'hudMx', 'festival'].includes(scene))
          expect(
            shown.filter((row) => row.tier === 'primary').length,
            `${at}: the readouts are classified`,
          ).toBeGreaterThanOrEqual(scene === 'festival' ? 2 : 4);
        for (const row of shown) {
          judged++;
          if (row.px < floors[row.tier as 'primary' | 'secondary' | 'tertiary'])
            small.push(`${at}: ${row.tier} ${row.name} "${row.text}" ${row.px}px < ${floors[row.tier as 'primary']}px`);
        }
        for (const problem of [...box.overlaps, ...box.outside, ...box.sight, ...box.clipped])
          layout.push(`${at}: ${problem}`);
      }
    expect(judged).toBeGreaterThan(1000);
    expect(small, 'HUD text under its floor').toEqual([]);
    expect(layout, 'HUD footprint: overlaps, off-screen, sight window, clipped text').toEqual([]);
    expect(errors).toEqual([]);
  });

test('the layout unit follows the HUD SCALE and the window: 115% under 900 px tall, a step honoured up to the window', async ({
  page,
}) => {
  test.setTimeout(120000);
  await load(page);
  const unit = async (width: number, height: number, step: string, ui = '1') => {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      ([scale, uiScale]) => {
        const root = document.documentElement;
        root.style.setProperty('--ui-scale', uiScale);
        if (scale === 'auto') root.style.removeProperty('--hud-scale');
        else root.style.setProperty('--hud-scale', scale);
      },
      [step, ui],
    );
    await page.evaluate(() => window.UxFixture.hud());
    return page.evaluate(() => {
      const hud = document.getElementById('hud')!;
      const probe = document.createElement('i');
      probe.style.cssText = 'position:absolute;width:calc(100 * var(--u));height:1px';
      hud.append(probe);
      const u = probe.getBoundingClientRect().width / 100;
      probe.remove();
      return { u };
    });
  };
  const near = (value: number, expected: number) => expect(Math.abs(value - expected)).toBeLessThan(0.06);
  // The viewport's own unit never drops under 8 px, so a handheld's 1.4 u label is 11.2 px.
  near((await unit(1280, 800, '1')).u, 8);
  near((await unit(1280, 720, '1')).u, 8);
  // Automatic: 115% under 900 px tall, 100% at 900 and above.
  near((await unit(1280, 800, 'auto')).u, 8 * 1.15);
  near((await unit(1366, 768, 'auto')).u, 8 * 1.15);
  near((await unit(1600, 899, 'auto')).u, 0.5625 * 1600 * 0.01 * 1.15);
  near((await unit(1600, 900, 'auto')).u, 0.5625 * 1600 * 0.01);
  near((await unit(1920, 1080, 'auto')).u, 10.8);
  near((await unit(3840, 2160, 'auto')).u, 21.6);
  // A step is honoured whatever the window ...
  near((await unit(1280, 800, '1.15')).u, 8 * 1.15);
  near((await unit(1920, 1080, '1.3')).u, 10.8 * 1.3);
  near((await unit(1920, 1080, '1.15')).u, 10.8 * 1.15);
  // ... up to the limit of the window (0.8 vw: the tower, the banner and the lap panel side by side).
  near((await unit(1280, 800, '1.5')).u, 0.8 * 12.8);
  near((await unit(1920, 1080, '1.5')).u, 0.8 * 19.2);
  // The compact layout (under 1280 x 680) keeps its measured size at automatic and honours a step.
  const compact = async (width: number, height: number, step: string) => {
    await page.setViewportSize({ width, height });
    await page.evaluate((scale) => {
      const root = document.documentElement;
      if (scale === 'auto') root.style.removeProperty('--hud-scale');
      else root.style.setProperty('--hud-scale', scale);
    }, step);
    await page.evaluate(() => window.UxFixture.hud());
    return page.evaluate(() => {
      const hud = document.getElementById('hud')!;
      const probe = document.createElement('i');
      probe.style.cssText = 'position:absolute;width:calc(100px * var(--scale));height:1px';
      hud.append(probe);
      const scale = probe.getBoundingClientRect().width / 100;
      probe.remove();
      return scale;
    });
  };
  near(await compact(800, 600, 'auto'), 1);
  near(await compact(640, 400, 'auto'), 1);
  near(await compact(1024, 768, '1.15'), 1.15);
  near(await compact(1024, 768, '1.5'), 1.35);
  // The interface size multiplies it, inside the same limits.
  near((await unit(1920, 1080, '1', '1.35')).u, 10.8 * 1.35);
  near((await unit(1920, 1080, 'auto', '0.8')).u, 10.8 * 0.8);
});

test('the settings screen has a HUD dial: it applies as it moves and goes back when the screen is cancelled', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await load(page);
  await page.evaluate(() => window.UxFixture.settings());
  const dial = page.locator('#settingsForm select[name="hudScale"]');
  await expect(page.locator('#settingsForm fieldset.hud-scale legend')).toHaveText('HUD');
  await expect(dial).toHaveValue('auto');
  await expect(dial.locator('option')).toHaveText([
    'Automatic · 115% on screens under 900 px tall',
    '100%',
    '115%',
    '130%',
    '150%',
  ]);
  const root = () =>
    page.evaluate(() => ({
      scale: document.documentElement.style.getPropertyValue('--hud-scale'),
      mark: document.documentElement.dataset.hudScale ?? '',
    }));
  await dial.selectOption('1.3');
  expect(await root()).toEqual({ scale: '1.3', mark: '1.3' });
  await dial.selectOption('auto');
  expect(await root()).toEqual({ scale: '', mark: 'auto' });
  await dial.selectOption('1.5');
  expect(await root()).toEqual({ scale: '1.5', mark: '1.5' });
  // CANCEL: the screen closes without applying and the saved choice (automatic) comes back.
  await page.getByRole('button', { name: 'CANCEL', exact: true }).click();
  await expect(page.locator('#modal')).toBeHidden();
  expect(await root()).toEqual({ scale: '', mark: 'auto' });
});
