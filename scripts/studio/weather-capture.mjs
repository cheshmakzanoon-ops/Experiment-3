#!/usr/bin/env node
/**
 * Weather capture (QA tooling; not part of the game or any test).
 *
 * Drives the real menu in headless Chromium on SwiftShader, starts a practice
 * session for each requested weather / lighting pair, lets the autopilot drive
 * for N simulated seconds, holds the instant (pause, dialog hidden) and writes
 * a JPEG per view. Usage:
 *
 *   npx vite preview --host 127.0.0.1 --port 4203 --strictPort &
 *   node --experimental-strip-types scripts/studio/weather-capture.mjs OUT_DIR \
 *     --url http://127.0.0.1:4203 \
 *     --shots fog:day:chase:20,storm:day:chase:30,dust:sunset:cockpit:20
 *
 * A shot is weather:lighting:view:driveSeconds (weather: any catalogue id;
 * lighting: day | sunset | night; view: chase | cockpit | pod | trackside).
 * Shots of the same weather and lighting share one session. Files are named
 * NN-weather-lighting-view.jpg, 1280x720, under 300 KB (quality is lowered
 * until they are). One browser at a time on a shared box.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' },
    shots: { type: 'string' },
    opponents: { type: 'string', default: '3' },
    quality: { type: 'string', default: 'medium' },
    size: { type: 'string', default: '1280x720' },
  },
});
const out = positionals[0];
if (!out || !v.url || !v.shots) {
  console.error(
    'usage: weather-capture.mjs OUT_DIR --url URL --shots weather:lighting:view:seconds,...',
  );
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const { chromium } = await import('@playwright/test');
const shots = v.shots.split(',').map((s) => {
  const [weather, lighting = 'day', view = 'chase', seconds = '0'] = s.split(':');
  return { weather, lighting, view, seconds: Number(seconds) };
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const errors = [];

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
  ],
});
const [width, height] = v.size.split('x').map(Number);
const page = await browser.newPage({ viewport: { width, height } });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const probe = () =>
  page
    .evaluate(() => {
      const d = window.apexDiagnostics?.();
      if (!d) return null;
      const r = d.renderer ?? {};
      return {
        state: d.state,
        auto: d.auto,
        frames: d.presentation?.frames ?? 0,
        lighting: r.lighting,
        requestedCamera: r.requestedCamera,
        presentedCamera: r.presentedCamera,
        time: d.frame ? d.frame[0] : null,
        speed: d.frame ? d.frame[24 + 13] : null,
      };
    })
    .catch(() => null);
async function waitFor(label, predicate, timeout = 240000, interval = 400) {
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end) {
    last = await probe();
    if (last && predicate(last)) return last;
    await sleep(interval);
  }
  throw new Error(`timed out: ${label} (last ${JSON.stringify(last)})`);
}
const click = (selector) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) throw new Error(`missing ${s}`);
    e.click();
  }, selector);

async function toMenu() {
  const d = await probe();
  if (d?.state === 'menu') return;
  if (d?.state === 'driving') await page.keyboard.press('Escape');
  await waitFor('pause', (x) => x.state === 'paused', 60000, 250);
  await click('#modal [data-action="menu"]');
  await waitFor('menu', (x) => x.state === 'menu', 60000, 250);
}
async function setLighting(lighting) {
  if ((await probe())?.lighting === lighting) return;
  await click('#menu [data-action="academy"]');
  await page.locator(`#modal [data-action="lighting:${lighting}"]`).click();
  await waitFor(`lighting ${lighting}`, (x) => x.lighting === lighting, 60000, 250);
  await click('#modal [data-action="modalClose"]');
}
async function setView(view) {
  for (let i = 0; i < 6; i++) {
    const d = await probe();
    if (d?.presentedCamera === view && d?.requestedCamera === view) return;
    if (d?.requestedCamera !== view) await page.keyboard.press('c');
    await sleep(900);
  }
}
async function encode(file) {
  // JPEG under 300 KB: lower the quality until the screenshot fits.
  for (const quality of [72, 58, 44]) {
    const buffer = await page.screenshot({ type: 'jpeg', quality, timeout: 1200000 });
    if (buffer.length <= 300 * 1024 || quality === 44) {
      writeFileSync(file, buffer);
      return { bytes: buffer.length, quality };
    }
  }
}

await page.goto(v.url);
await waitFor('menu', (x) => x.state === 'menu', 1200000, 1000);
log('menu ready');
await page
  .locator('[name=quality]')
  .selectOption(v.quality)
  .catch(() => {});

let index = 0;
const groups = [];
for (const shot of shots) {
  const last = groups.at(-1);
  if (last && last.weather === shot.weather && last.lighting === shot.lighting)
    last.shots.push(shot);
  else groups.push({ weather: shot.weather, lighting: shot.lighting, shots: [shot] });
}
for (const group of groups) {
  try {
    await toMenu();
    await page.locator('#mode').selectOption('practice');
    await page.locator('#weather').selectOption(group.weather);
    await page.locator('#opponents').selectOption(v.opponents);
    await setLighting(group.lighting);
    await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
    await waitFor('driving', (x) => x.state === 'driving', 1500000, 500);
    log(`driving: ${group.weather} / ${group.lighting}`);
    for (const shot of group.shots) {
      await setView(shot.view);
      if (shot.seconds > 0) {
        // Autopilot for the requested simulated seconds from the current time.
        const before = (await probe())?.time ?? 0;
        if ((await probe())?.auto !== true) await page.keyboard.press('g');
        await waitFor('autopilot', (x) => x.auto === true, 30000, 250);
        await waitFor(
          `${shot.seconds}s`,
          (x) => (x.time ?? 0) >= before + shot.seconds,
          600000,
          200,
        );
        await page.keyboard.press('Escape');
        await waitFor('paused', (x) => x.state === 'paused', 60000, 200);
        await page.evaluate(() => {
          const s = document.createElement('style');
          s.id = 'wc-hide';
          s.textContent =
            '#modal{visibility:hidden!important}#modal::backdrop{background:transparent!important}';
          document.head.append(s);
        });
      }
      // On a loaded software-GL box a frame takes minutes: give the held scene a
      // few seconds to settle, then let the screenshot itself wait for a frame.
      await sleep(4000);
      const name = `${String(index++).padStart(2, '0')}-${group.weather}-${group.lighting}-${shot.view}.jpg`;
      const info = await encode(join(out, name));
      const d = await probe();
      log(
        `${name} ${(info.bytes / 1024).toFixed(0)} KB q${info.quality}  t=${d?.time?.toFixed(1)} s  ${((d?.speed ?? 0) * 3.6).toFixed(0)} km/h`,
      );
      if (shot.seconds > 0) {
        await page.evaluate(() => document.getElementById('wc-hide')?.remove());
        await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
        await waitFor('driving', (x) => x.state === 'driving', 60000, 250);
      }
    }
  } catch (error) {
    log(`FAILED ${group.weather}/${group.lighting}: ${String(error.message).split('\n')[0]}`);
  }
}
writeFileSync(join(out, 'errors.txt'), errors.join('\n'));
log(`done; ${errors.length} page/console errors`);
await browser.close();
process.exit(errors.length ? 2 : 0);
