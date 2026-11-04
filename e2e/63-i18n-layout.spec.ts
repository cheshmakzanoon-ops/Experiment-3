import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fixtureDefine } from './fixtures/owner-build.ts';
import type * as Fixture from './fixtures/i18n-screens.ts';
import { LOCALES } from '../src/i18n/locales.ts';

test.use({ actionTimeout: 15000 });

/** DOM-only language checks over the production Interface and the real style sheets (no
 * renderer): the English markup is exactly what it was before any string was localised, and
 * every screen of the first hour fits at 1280x720 and 1024x600 in every language. Run with
 * the DOM config (scripts/studio/tools/pw-dom.config.ts):
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium APEX_WT=$PWD npx playwright test \
 *     -c scripts/studio/tools/pw-dom.config.ts e2e/63-i18n-layout.spec.ts
 * I18N_CAPTURE=1 rewrites the English baseline (e2e/fixtures/i18n-en) and the contact sheets
 * (docs/studio/reports/localization-screens). */
const BASELINE = resolve('e2e/fixtures/i18n-en');
const SHEETS = resolve('docs/studio/reports/localization-screens');
const SIZES = [
  { width: 1280, height: 720 },
  { width: 1024, height: 600 },
] as const;
const FONT_DIR = resolve('node_modules/@fontsource-variable/saira/files');

type Api = typeof Fixture;
declare global {
  interface Window {
    I18nScreens: Api;
  }
}

/** The Saira subsets the build ships (latin, latin-ext, vietnamese), as data URLs, so the
 * text is measured in the real face rather than a fallback. */
async function fontCss() {
  const faces: string[] = [];
  const ranges: Record<string, string> = {
    vietnamese:
      'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB',
    'latin-ext':
      'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
    latin:
      'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  };
  for (const style of ['normal', 'italic'])
    for (const [subset, range] of Object.entries(ranges)) {
      const data = await readFile(`${FONT_DIR}/saira-${subset}-wdth-${style}.woff2`);
      faces.push(
        `@font-face{font-family:'Saira Variable';font-style:${style};font-display:block;font-weight:100 900;font-stretch:50% 125%;src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2-variations');unicode-range:${range}}`,
      );
    }
  const stencil = await readFile(resolve('src/ui/fonts/saira-stencil-one-latin-400-normal.woff2'));
  faces.push(
    `@font-face{font-family:'Saira Stencil One';font-style:normal;font-weight:400;font-display:block;src:url(data:font/woff2;base64,${stencil.toString('base64')}) format('woff2')}`,
  );
  return faces.join('\n');
}

async function load(page: Page) {
  const built = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/i18n-screens.ts'),
        name: 'I18nScreens',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing i18n fixture output');
  const script = result.output.find((item) => item.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing i18n fixture script');
  await page.setContent('<!doctype html><title>Language checks</title>');
  await page.addStyleTag({ content: await fontCss() });
  await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
  await page.addScriptTag({ content: script.code });
  return result.output.some((o) => o.type === 'chunk' && o.fileName !== script.fileName);
}
const mountScene = async (page: Page, scene: Fixture.Scene, locale: string) => {
  await page.evaluate(([s, l]) => window.I18nScreens.mount(s as Fixture.Scene, l as never), [
    scene,
    locale,
  ]);
  await page.evaluate(() => document.fonts.ready);
};
const SCENES: readonly Fixture.Scene[] = [
  'loading',
  'paddock',
  'hud',
  'firstrun',
  'results',
  'settings',
  'career',
  'wildcard',
  'pause',
];
/** The scenes whose width matters in the layout matrix (the HUD is a fixed overlay). */
const FIT: readonly Fixture.Scene[] = [
  'paddock',
  'firstrun',
  'results',
  'settings',
  'career',
  'wildcard',
  'pause',
];

test('English markup is unchanged by localisation', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await load(page);
  await mkdir(BASELINE, { recursive: true });
  for (const scene of SCENES) {
    await mountScene(page, scene, 'en');
    const html = await page.evaluate((s) => window.I18nScreens.snapshot(s), scene);
    const file = `${BASELINE}/${scene}.html`;
    if (process.env.I18N_CAPTURE === '1') await writeFile(file, html + '\n');
    else {
      // Report the first difference with context, not two whole screens.
      const expected = await readFile(file, 'utf8');
      const actual = html + '\n';
      let at = 0;
      while (at < actual.length && actual[at] === expected[at]) at++;
      expect(
        actual === expected
          ? 'identical'
          : `differs at ${at}: expected …${expected.slice(Math.max(0, at - 60), at + 100)}… got …${actual.slice(Math.max(0, at - 60), at + 100)}…`,
        `${scene} markup under English`,
      ).toBe('identical');
    }
  }
  expect(errors).toEqual([]);
});

test('every language fits the first-hour screens at 1280x720 and 1024x600', async ({
  page,
  browser,
}) => {
  test.setTimeout(600000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize(SIZES[0]);
  await load(page);
  const problems: string[] = [];
  // Text that English already ellipsizes (long venue names on a Wildcard row: proper names, not
  // translated) is acceptable in every language; anything else that is cut off is a defect.
  const english = new Map<string, Set<string>>();
  const length: Record<string, number> = {};
  const shots: Record<string, { scene: string; jpeg: string }[]> = {};
  for (const locale of LOCALES) {
    length[locale] = 0;
    shots[locale] = [];
    for (const size of SIZES) {
      await page.setViewportSize(size);
      for (const scene of FIT) {
        await mountScene(page, scene, locale);
        const facts = await page.evaluate((s) => window.I18nScreens.layout(s), scene);
        const where = `${locale} ${size.width}x${size.height} ${scene}`;
        if (facts.page > 1) problems.push(`${where}: page scrolls sideways by ${facts.page}px`);
        if (facts.dialog > 1) problems.push(`${where}: dialog scrolls sideways by ${facts.dialog}px`);
        if (facts.menuBody > 1) problems.push(`${where}: paddock body scrolls sideways by ${facts.menuBody}px`);
        const here = `${size.width}x${size.height} ${scene}`;
        if (locale === 'en') english.set(here, new Set(facts.clipped.map((c) => c.sig)));
        for (const c of facts.clipped)
          if (locale !== 'en' && !english.get(here)?.has(c.sig))
            problems.push(`${where}: clipped ${c.name}`);
        for (const c of facts.outside) problems.push(`${where}: outside the viewport ${c}`);
        if (size.width === 1280) {
          length[locale] += await page.evaluate(
            () => (document.querySelector('#menu, #modalContent')?.textContent ?? '').length,
          );
          if (process.env.I18N_CAPTURE === '1')
            shots[locale].push({
              scene,
              jpeg: (await page.screenshot({ type: 'jpeg', quality: 72 })).toString('base64'),
            });
        }
      }
    }
  }
  if (process.env.I18N_CAPTURE === '1') {
    // Contact sheets for the two languages with the most text on these screens.
    const longest = Object.entries(length)
      .filter(([locale]) => locale !== 'en')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([locale]) => locale);
    await mkdir(SHEETS, { recursive: true });
    const sheetPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    for (const locale of ['en', ...longest]) {
      const tiles = shots[locale]
        .map(
          (s) =>
            `<figure><img src="data:image/jpeg;base64,${s.jpeg}"><figcaption>${locale} · ${s.scene}</figcaption></figure>`,
        )
        .join('');
      await sheetPage.setContent(
        `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(3,640px);gap:6px;font:12px sans-serif;color:#ddd}figure{margin:0}img{width:640px;height:360px;display:block}figcaption{padding:2px 6px}</style>${tiles}`,
      );
      let quality = 62;
      let jpeg = await sheetPage.screenshot({ type: 'jpeg', quality, fullPage: true });
      while (jpeg.length > 190 * 1024 && quality > 20) {
        quality -= 6;
        jpeg = await sheetPage.screenshot({ type: 'jpeg', quality, fullPage: true });
      }
      await writeFile(`${SHEETS}/${locale}-contact-sheet.jpg`, jpeg);
    }
    await sheetPage.close();
    await writeFile(
      `${SHEETS}/text-length.json`,
      JSON.stringify(length, null, 2) + '\n',
    );
  }
  expect(problems).toEqual([]);
  expect(errors).toEqual([]);
});
