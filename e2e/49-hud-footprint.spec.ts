import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { raceHudLayout } from './fixtures/race-hud-layout.ts';

/** Broadcast racing HUDs keep the road visible: small peripheral clusters for
 * standings, timing, telemetry and car state. This measures the opaque panel
 * area of the production race HUD (DOM fixture, UI scale 1, no guidance). */
const PANELS = ['.timing', '.lap-panel', '.car-status', '.instruments', '.position-badge', '.session-status'];
/** Upper bound on the panel share of the frame at desktop resolutions. */
const MAX_SHARE = 0.12;

test('race HUD panels leave the road visible at desktop resolutions', async ({ page }, info) => {
  const bundled = await build({
    configFile: false,
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
  const report = [];
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 1920, height: 1080 },
  ])
    for (const camera of ['chase', 'cockpit'] as const) {
      await page.setViewportSize(viewport);
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
