#!/usr/bin/env node
/**
 * Weather capture, wave 2 (QA tooling; not part of the game or any test).
 *
 * As weather-capture.mjs (real menu, headless Chromium on SwiftShader, practice
 * session driven by the autopilot, the instant held by pausing), plus
 *  - a venue per shot (the menu's #circuit select, by circuit id),
 *  - `flash` shots: a stored session is replayed and the replay clock is parked
 *    on the strongest lightning flash the weather's own schedule produced, so a
 *    strike lasting a few hundredths of a second is held exactly,
 *  - 1024x576 JPEGs of at most 150 KB.
 *
 *   npx vite preview --outDir <dist> --host 127.0.0.1 --port 4222 --strictPort &
 *   node --experimental-transform-types scripts/studio/weather-capture-2.mjs OUT_DIR \
 *     --url http://127.0.0.1:4222 \
 *     --shots snow:day:chase:25:alpine-pass,storm:day:chase:110:riviera:flash
 *
 * A shot is weather:lighting:view:driveSeconds[:circuit[:flash]]. Shots of the
 * same weather, lighting and circuit share one session. Files are named
 * NN-weather-lighting-circuit-view[-flash].jpg. One browser at a time.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const weather = await import(
  pathToFileURL(new URL('src/simulation/weather.ts', root).pathname).href
);
const core = await import(pathToFileURL(new URL('src/core/math.ts', root).pathname).href);
const config = await import(pathToFileURL(new URL('src/simulation/config.ts', root).pathname).href);

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' },
    shots: { type: 'string' },
    opponents: { type: 'string', default: '3' },
    quality: { type: 'string', default: 'medium' },
    size: { type: 'string', default: '1024x576' },
    'max-kb': { type: 'string', default: '150' },
  },
});
const out = positionals[0];
if (!out || !v.url || !v.shots) {
  console.error(
    'usage: weather-capture-2.mjs OUT_DIR --url URL --shots weather:lighting:view:seconds[:circuit[:flash]],...',
  );
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const { chromium } = await import('@playwright/test');
const shots = v.shots.split(',').map((s) => {
  const [w, lighting = 'day', view = 'chase', seconds = '0', circuit = '', flash = ''] =
    s.split(':');
  return {
    weather: w,
    lighting,
    view,
    seconds: Number(seconds),
    circuit,
    flash: flash === 'flash',
  };
});
const maxBytes = Number(v['max-kb']) * 1024;
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
    '--headless=new',
  ],
});
const [width, height] = v.size.split('x').map(Number);
const page = await browser.newPage({ viewport: { width, height } });
page.setDefaultTimeout(300000);
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
        lighting: r.lighting,
        requestedCamera: r.requestedCamera,
        presentedCamera: r.presentedCamera,
        time: d.frame ? d.frame[0] : null,
        rain: d.frame ? d.frame[4] : null,
        speed: d.frame ? d.frame[24 + 13] : null,
        replay: d.replay ?? null,
      };
    })
    .catch(() => null);
async function waitFor(label, predicate, timeout = 300000, interval = 400) {
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
  if (d?.state === 'replay') await click('[data-action="replayExit"]');
  await waitFor('pause', (x) => x.state === 'paused', 120000, 250);
  await click('#modal [data-action="menu"]');
  await waitFor('menu', (x) => x.state === 'menu', 120000, 250);
}
async function setLighting(lighting) {
  if ((await probe())?.lighting === lighting) return;
  await click('#menu [data-action="academy"]');
  await page.locator(`#modal [data-action="lighting:${lighting}"]`).click();
  await waitFor(`lighting ${lighting}`, (x) => x.lighting === lighting, 120000, 250);
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
  for (const quality of [70, 58, 46, 36, 28]) {
    const buffer = await page.screenshot({ type: 'jpeg', quality, timeout: 1800000 });
    if (buffer.length <= maxBytes || quality === 28) {
      writeFileSync(file, buffer);
      return { bytes: buffer.length, quality };
    }
  }
}

// The flash schedule is a pure function of the session time and the rain rate
// (weather.ts), so the best frame can be computed before it is looked for.
function bestFlash(weatherId, seed, fromWeatherSec, toWeatherSec) {
  const greenAt = 5.6 + new core.Random(seed).next() * 0.9;
  const timeline = new weather.WeatherTimeline(weather.weatherKeyframes(weatherId));
  const s = { cloud: 0, rain: 0, ambient: 0, windX: 0, windZ: 0 };
  let best = { time: 0, flash: 0, rain: 0 };
  for (let w = fromWeatherSec; w < toWeatherSec; w += 0.005) {
    timeline.sample(w, s);
    const time = w + greenAt;
    const f = weather.lightningFlash(time, weather.lightningIntensity(s.rain));
    if (f > best.flash) best = { time, flash: f, rain: s.rain };
  }
  return best;
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
  if (
    last &&
    last.weather === shot.weather &&
    last.lighting === shot.lighting &&
    last.circuit === shot.circuit
  )
    last.shots.push(shot);
  else
    groups.push({
      weather: shot.weather,
      lighting: shot.lighting,
      circuit: shot.circuit,
      shots: [shot],
    });
}
for (const group of groups) {
  try {
    await toMenu();
    await page.locator('#mode').selectOption('practice');
    if (group.circuit) await page.locator('#circuit').selectOption(group.circuit);
    await page.locator('#weather').selectOption(group.weather);
    await page.locator('#opponents').selectOption(v.opponents);
    await setLighting(group.lighting);
    await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
    await waitFor('driving', (x) => x.state === 'driving', 1800000, 500);
    log(`driving: ${group.weather} / ${group.lighting} / ${group.circuit || 'default venue'}`);
    for (const shot of group.shots) {
      try {
        await setView(shot.view);
        if (shot.seconds > 0) {
          const before = (await probe())?.time ?? 0;
          if ((await probe())?.auto !== true) await page.keyboard.press('g');
          await waitFor('autopilot', (x) => x.auto === true, 60000, 250);
          await waitFor(
            `${shot.seconds}s`,
            (x) => (x.time ?? 0) >= before + shot.seconds,
            900000,
            200,
          );
          await page.keyboard.press('Escape');
          await waitFor('paused', (x) => x.state === 'paused', 120000, 250);
        }
        let suffix = '';
        if (shot.flash) {
          // Park the replay clock on the strongest strike of the session so far.
          const driven = (await probe())?.time ?? shot.seconds;
          const strike = bestFlash(
            group.weather,
            config.DEFAULT_OPTIONS.seed,
            20,
            Math.max(30, driven - 8),
          );
          log(`strongest flash at t=${strike.time.toFixed(3)} s (${strike.flash.toFixed(2)})`);
          await click('#modal [data-action="replay"]');
          await waitFor('replay', (x) => x.state === 'replay', 120000, 250);
          await page.evaluate(() => {
            const s = document.createElement('style');
            s.id = 'wc-hide-replay';
            s.textContent = '#replayBar{visibility:hidden!important}';
            document.head.append(s);
          });
          // Hold the replay clock first (it runs in real time while playing), then
          // park it on the strike. The clock counts seconds from the first recorded
          // frame, whose session time is a couple of ticks (about 0.017 s) in; the
          // presented time is interpolated, so the aim is exact to a few ms.
          await page.evaluate(() => {
            const play = document.getElementById('replayPlay');
            if (play && /PAUSE/.test(play.textContent ?? '')) play.click();
          });
          await sleep(3000);
          const aim = strike.time + 0.02;
          const position = aim - 0.017;
          for (let attempt = 0; attempt < 2; attempt++) {
            await page.evaluate((value) => {
              const el = document.getElementById('replaySeek');
              el.value = String(value);
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }, position);
            await sleep(20000);
          }
          log(
            `parked at about t=${aim.toFixed(3)} s; expected flash ${weather
              .lightningFlash(aim, weather.lightningIntensity(strike.rain))
              .toFixed(2)}`,
          );
          await page.evaluate(() => {
            const play = document.getElementById('replayPlay');
            if (play && /PAUSE/.test(play.textContent ?? '')) play.click();
          });
          suffix = '-flash';
        } else if (shot.seconds > 0) {
          await page.evaluate(() => {
            const s = document.createElement('style');
            s.id = 'wc-hide';
            s.textContent =
              '#modal{visibility:hidden!important}#modal::backdrop{background:transparent!important}';
            document.head.append(s);
          });
        }
        await sleep(4000);
        const name = `${String(index++).padStart(2, '0')}-${group.weather}-${group.lighting}-${group.circuit || 'aurel'}-${shot.view}${suffix}.jpg`;
        const info = await encode(join(out, name));
        const d = await probe();
        log(
          `${name} ${(info.bytes / 1024).toFixed(0)} KB q${info.quality}  t=${d?.time?.toFixed(2)} s`,
        );
        if (shot.flash) {
          await page.evaluate(() => document.getElementById('wc-hide-replay')?.remove());
          await click('[data-action="replayExit"]');
          await waitFor('paused', (x) => x.state === 'paused', 120000, 250);
        } else if (shot.seconds > 0) {
          await page.evaluate(() => document.getElementById('wc-hide')?.remove());
        }
        if (shot.seconds > 0 || shot.flash) {
          await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
          await waitFor('driving', (x) => x.state === 'driving', 120000, 250);
        }
      } catch (error) {
        log(
          `SHOT FAILED ${group.weather}/${group.lighting}: ${String(error.message).split('\n')[0]}`,
        );
        throw error;
      }
    }
  } catch (error) {
    log(
      `FAILED ${group.weather}/${group.lighting}/${group.circuit}: ${String(error.message).split('\n')[0]}`,
    );
  }
}
writeFileSync(join(out, 'errors.txt'), errors.join('\n'));
log(`done; ${errors.length} page/console errors`);
await browser.close();
process.exit(errors.length ? 2 : 0);
