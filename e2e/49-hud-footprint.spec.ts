import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { raceHudLayout } from './fixtures/race-hud-layout.ts';
import { fixtureDefine } from './fixtures/owner-build.ts';

/** Broadcast racing HUDs keep the road visible: small peripheral clusters for
 * standings, timing, telemetry and car state. This measures the opaque panel
 * area of the production race HUD (DOM fixture, UI scale 1, no guidance). */
const PANELS = ['.timing', '.lap-panel', '.car-status', '.instruments', '.position-badge', '.session-status'];
/** Upper bound on the panel share of the frame at desktop resolutions. */
const MAX_SHARE = 0.12;
/** Handheld windows (a 1280 x 800 Steam Deck, a 720p handheld, a 768 px laptop). The 12% line above is for 1600 x 900
 * and up, where the unit is 9 px or more. On a 1280 px wide screen an 11 px label needs a unit of 8 px (a 1.4 u label,
 * docs/studio/reports/hud-legibility.md) where the old unit was 7.2 px, and the HUD's automatic scale is 115% under 900
 * px tall: the panels take more of a small frame, and this pins how much, so the cost of legibility cannot grow
 * silently. Measured when these were set (share of the frame, this metric): 100%: 12.1 / 13.4 / 11.8; automatic:
 * 15.9 / 17.7 / 15.5 (before the pass: 9.7 / 10.8 / 10.8, which no test pinned). Bounds leave about a point. */
const HANDHELD: { width: number; height: number; at100: number; auto: number }[] = [
  { width: 1280, height: 800, at100: 0.13, auto: 0.17 },
  { width: 1280, height: 720, at100: 0.145, auto: 0.19 },
  { width: 1366, height: 768, at100: 0.13, auto: 0.17 },
];

async function loadFixture(page: Page) {
  const bundled = await build({
    configFile: false,
    define: fixtureDefine(),
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve('e2e/fixtures/race-hud-layout.ts'), name: 'RaceHudFixture', formats: ['iife'] },
    },
  });
  const result = Array.isArray(bundled) ? bundled[0] : bundled;
  if (!('output' in result)) throw new Error('Missing HUD fixture build');
  const script = result.output.find((o) => o.type === 'chunk');
  if (!script || script.type !== 'chunk') throw new Error('Missing HUD fixture entry');
  await page.setContent('<!doctype html><title>Race HUD footprint</title>');
  await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
  await page.addScriptTag({ content: script.code });
}

/** The panel share of the frame at each viewport and camera; `scale` is a HUD SCALE step, or null for automatic. */
async function measure(page: Page, viewports: { width: number; height: number }[], scale: string | null) {
  const report = [];
  for (const viewport of viewports)
    for (const camera of ['chase', 'cockpit'] as const) {
      await page.setViewportSize(viewport);
      await page.evaluate((step) => {
        const root = document.documentElement;
        if (step === null) root.style.removeProperty('--hud-scale');
        else root.style.setProperty('--hud-scale', step);
      }, scale);
      await page.evaluate((camera) => {
        (
          window as unknown as { RaceHudFixture: { raceHudLayout: typeof raceHudLayout } }
        ).RaceHudFixture.raceHudLayout(camera, 1, false);
      }, camera);
      const panels = await page.evaluate((selectors) => {
        return selectors.map((selector) => {
          const r = document.querySelector(selector)!.getBoundingClientRect();
          return { selector, width: r.width, height: r.height, area: r.width * r.height };
        });
      }, PANELS);
      const share = panels.reduce((a, p) => a + p.area, 0) / (viewport.width * viewport.height);
      report.push({ viewport, camera, share, panels });
    }
  return report;
}

test('race HUD panels leave the road visible at desktop resolutions', async ({ page }, info) => {
  await loadFixture(page);
  const report = await measure(
    page,
    [
      { width: 1600, height: 900 },
      { width: 1920, height: 1080 },
    ],
    null,
  );
  console.log(
    report
      .map((r) => `${r.viewport.width}x${r.viewport.height} ${r.camera} ${(100 * r.share).toFixed(1)}% ${r.panels.map((p) => `${p.selector}=${Math.round(p.width)}x${Math.round(p.height)}`).join(' ')}`)
      .join('\n'),
  );
  await info.attach('hud-footprint.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  for (const r of report)
    expect(r.share, `${r.viewport.width}x${r.viewport.height} ${r.camera}`).toBeLessThan(MAX_SHARE);
});

test('race HUD panels at handheld sizes stay inside the measured bound, at 100% and at automatic', async ({ page }, info) => {
  await loadFixture(page);
  const rows: string[] = [];
  const over: string[] = [];
  for (const [scale, key] of [
    ['1', 'at100'],
    [null, 'auto'],
  ] as const) {
    const report = await measure(page, HANDHELD, scale);
    for (const r of report) {
      const bound = HANDHELD.find((h) => h.width === r.viewport.width && h.height === r.viewport.height)![key];
      rows.push(`${r.viewport.width}x${r.viewport.height} ${r.camera} ${scale ?? 'auto'} ${(100 * r.share).toFixed(1)}% (< ${(100 * bound).toFixed(1)}%)`);
      if (r.share >= bound) over.push(rows[rows.length - 1]);
    }
  }
  console.log(rows.join('\n'));
  await info.attach('hud-footprint-handheld.json', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
  expect(over, 'handheld HUD footprint over its bound').toEqual([]);
});
