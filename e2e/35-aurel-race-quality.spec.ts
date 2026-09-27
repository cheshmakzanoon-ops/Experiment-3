import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { raceHudLayout } from './fixtures/race-hud-layout.ts';
import type { inspectAurelQuality } from './fixtures/aurel-race-quality.ts';
import manifest from '../src/rendering/apx01-driver.manifest.json' with { type: 'json' };

async function fixture(path: string, name: string) {
  const output = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: { entry: resolve(path), name, formats: ['iife'] },
    },
  });
  const result = Array.isArray(output) ? output[0] : output;
  if (!('output' in result)) throw new Error('Missing fixture output');
  const chunk = result.output.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing fixture script');
  return chunk.code;
}

test('compact live HUD preserves readable driving space and every information panel across resize', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent('<!doctype html><title>DOM-only compact HUD continuity</title>');
  await page.addStyleTag({ content: await readFile('src/ui/style.css', 'utf8') });
  await page.addScriptTag({
    content: await fixture('e2e/fixtures/race-hud-layout.ts', 'RaceHudFixture'),
  });
  const rows = [];
  for (const [width, height, scale] of [
    [480, 300, 1],
    [640, 400, 1],
    [375, 667, 1],
    [320, 568, 1.35],
    [1024, 600, 1.35],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      ({ scale }) =>
        (
          window as unknown as {
            RaceHudFixture: { raceHudLayout: typeof raceHudLayout };
          }
        ).RaceHudFixture.raceHudLayout('chase', scale, false),
      { scale },
    );
    await expect(page.getByRole('button', { name: 'RACE INFO', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(page.locator('.timing')).toBeHidden();
    const observed = await page.evaluate(() => {
      const rect = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      return {
        instruments: rect('.instruments'),
        lights: rect('.start-sequence'),
        header: rect('.hud-top'),
        controls: rect('.touch-controls'),
        readouts: ['#speed', '#gear', '#rpm', '#battery', '#fuel'].map(rect),
      };
    });
    expect(observed.instruments.top).toBeGreaterThan(observed.header.bottom);
    expect(observed.instruments.bottom).toBeLessThan(height * 0.45);
    expect(observed.instruments.bottom).toBeLessThan(observed.lights.top);
    for (const r of observed.readouts) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(width);
      expect(r.bottom).toBeLessThanOrEqual(observed.instruments.bottom);
    }
    await expect(page.locator('#speed')).toHaveText('162');
    await expect(page.locator('#fuel')).toBeVisible();
    await expect(page.locator('#battery')).toBeVisible();
    await page.getByRole('button', { name: 'RACE INFO', exact: true }).click();
    const region = page.getByRole('region', { name: 'Live race information' });
    await expect(region).toBeVisible();
    await expect(page.locator('.tower-row')).toHaveCount(12);
    const timing = page.getByRole('complementary', { name: 'Live race classification' });
    await timing.focus();
    await page.keyboard.press('End');
    await expect.poll(() => timing.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(region).toBeHidden();
    await expect(page.getByRole('button', { name: 'RACE INFO', exact: true })).toBeFocused();
    rows.push({ width, height, scale, observed });
  }
  // The original nodes survive repeated compact/wide changes; no second data
  // source or stale timing/minimap is introduced by the information panel.
  await page.evaluate(() => {
    const timing = document.querySelector('.timing')!;
    timing.setAttribute('data-retained-witness', 'original-live-classification');
    const output = document.createElement('output');
    output.id = 'compactKeys';
    output.hidden = true;
    document.body.append(output);
    for (const type of ['keydown', 'keyup'])
      window.addEventListener(type, (event) => {
        output.textContent += `${type}:${(event as KeyboardEvent).key};`;
      });
  });
  await page.getByRole('button', { name: 'RACE INFO', exact: true }).click();
  await page.getByRole('complementary', { name: 'Live race classification' }).focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('Escape');
  await expect(page.locator('#compactKeys')).toHaveText('keyup:Home;keyup:Escape;');
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 640, height: 400 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.timing')).toHaveAttribute(
      'data-retained-witness',
      'original-live-classification',
    );
    await expect(page.locator('.tower-row')).toHaveCount(12);
    if (viewport.width >= 1280) {
      await expect(page.locator('.race-info-toggle')).toBeHidden();
      await expect(page.locator('.timing')).toBeVisible();
      await expect(page.locator('.minimap')).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
  await info.attach('compact-hud-dom-observations.json', {
    body: JSON.stringify({ scope: 'DOM-only, not gameplay', rows }),
    contentType: 'application/json',
  });
});

test('static Aurel traversal preserves the asset-loaded scene while dusk fill improves shadow readability', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 640, height: 400 });
  await page.route('**/aurel-quality-fixture', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Controlled Aurel full-scene comparison</title>',
    }),
  );
  await page.goto('/aurel-quality-fixture');
  await page.addScriptTag({
    content: await fixture('e2e/fixtures/aurel-race-quality.ts', 'AurelQuality'),
  });
  const report = await page.evaluate(() =>
    (
      window as unknown as {
        AurelQuality: { inspectAurelQuality: typeof inspectAurelQuality };
      }
    ).AurelQuality.inspectAurelQuality(),
  );
  for (const [name, image] of Object.entries(report.images))
    await info.attach(`${name}.png`, {
      body: Buffer.from(image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('aurel-controlled-scene-cost.json', {
    body: JSON.stringify(report, (k, v) => (k === 'images' ? undefined : v), 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(report.glError).toBe(0);
  expect(report.authored).toMatchObject({ loaded: true, sha256: manifest.sha256, joints: 9 });
  expect(report.sourceUnchanged).toBe(true);
  expect(report.matricesEqual).toBe(true);
  expect(report.pixelsEqual).toBe(true);
  expect(report.restoredPixelsEqual).toBe(true);
  expect(report.sealed).toEqual(report.unsealed);
  expect(report.restored).toEqual(report.sealed);
  expect(report.nodes).toBeGreaterThan(100);
  expect(report.counts[1].visits).toBeLessThan(report.counts[0].visits);
  expect(report.timings).toHaveLength(16);
  expect(report.dusk.balanced.luma).toBeGreaterThan(report.dusk.prior.luma);
  expect(report.dusk.balanced.clippedFraction).toBeLessThan(0.02);
});
