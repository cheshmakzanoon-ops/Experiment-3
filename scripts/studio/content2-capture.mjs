#!/usr/bin/env node
/**
 * Content wave-2 capture (QA tooling; not part of the game or any test).
 *
 * Boots the real menu once (headless Chromium on SwiftShader), then for every
 * entry starts a session and keeps a frame at the start grid and after the AI
 * autopilot has driven for a number of simulated seconds:
 *
 *   venue:<circuit>:<weather>:<light>:<s1>,<s2>   a free-practice session from the form
 *   event:<wildcard-id>:<s1>,<s2>                 the Wildcard event, started from its board
 *
 * `s` is the simulated time to drive on the autopilot before the frame (0 = the
 * grid as the session opens). Frames are 1024x576 JPEGs of at most 150 KB named
 * NN-<what>-t<seconds>.jpg. One browser at a time.
 *
 *   npx vite preview --outDir dist --host 127.0.0.1 --port 4241 --strictPort &
 *   node scripts/studio/content2-capture.mjs OUT_DIR --url http://127.0.0.1:4241 \
 *     --plan venue:haut-givre:snow:day:0,35,event:karts-on-the-dam-road:0,40
 *
 * Entries are separated by ',' only where the next token starts with `venue:`
 * or `event:`; the seconds list uses ',' too, so give entries with --plan once
 * per entry (--plan may be repeated).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' },
    plan: { type: 'string', multiple: true },
    size: { type: 'string', default: '1024x576' },
    'max-kb': { type: 'string', default: '150' },
    view: { type: 'string', default: 'chase' },
  },
});
const out = positionals[0];
if (!out || !v.url || !v.plan?.length) {
  console.error(
    'usage: content2-capture.mjs OUT_DIR --url URL --plan venue:id:weather:light:0,30 --plan event:id:0,40',
  );
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const { chromium } = await import('@playwright/test');
const plan = v.plan.map((entry) => {
  const parts = entry.split(':');
  if (parts[0] === 'venue') {
    const [, circuit, weather, light, seconds] = parts;
    return { kind: 'venue', id: circuit, weather, light, seconds: seconds.split(',').map(Number) };
  }
  const [, id, seconds] = parts;
  return { kind: 'event', id, seconds: seconds.split(',').map(Number) };
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
page.setDefaultTimeout(1800000);
page.on('pageerror', (e) => {
  errors.push(`pageerror: ${e.message}`);
  log(`PAGE ERROR ${e.message.slice(0, 200)}`);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    errors.push(`console: ${m.text()}`);
    log(`CONSOLE ERROR ${m.text().slice(0, 200)}`);
  }
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
        speed: d.frame ? d.frame[24 + 13] : null,
      };
    })
    .catch(() => null);
async function waitFor(label, predicate, timeout = 1800000, interval = 400) {
  const end = Date.now() + timeout;
  let last = null,
    beat = Date.now();
  while (Date.now() < end) {
    last = await probe();
    if (last && predicate(last)) return last;
    if (Date.now() - beat > 120000) {
      beat = Date.now();
      log(`waiting for ${label}: ${JSON.stringify(last)}`);
    }
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
  await waitFor('pause', (x) => x.state === 'paused', 180000, 250);
  await click('#modal [data-action="menu"]');
  await waitFor('menu', (x) => x.state === 'menu', 180000, 250);
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
const setForm = (values) =>
  page.evaluate((fields) => {
    for (const [id, value] of Object.entries(fields)) {
      const select = document.querySelector(`#${id}`);
      if (!select) throw new Error(`no #${id}`);
      if (select.value === value) continue;
      select.value = value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return Object.fromEntries(
      Object.keys(fields).map((id) => [id, document.querySelector(`#${id}`).value]),
    );
  }, values);

await page.goto(v.url);
await waitFor('menu', (x) => x.state === 'menu', 1800000, 1000);
log('menu ready');
// Render quality stays at the game's default (medium).

let index = 0;
for (const entry of plan) {
  const label = `${String(index).padStart(2, '0')}-${entry.kind === 'venue' ? entry.id : entry.id}`;
  try {
    await toMenu();
    if (entry.kind === 'venue') {
      const set = await setForm({
        mode: 'practice',
        circuit: entry.id,
        weather: entry.weather,
        light: entry.light,
        opponents: '3',
      });
      log(`form ${JSON.stringify(set)}`);
      await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
    } else {
      if (!(await page.locator('.wc-board').count()))
        await page.locator('[data-action="career:wildcard"]').first().click();
      await page.waitForSelector('.wc-board');
      await page.locator(`.wc-row[data-id="${entry.id}"]`).click();
      await page.locator(`[data-action="career:wildcardGo:${entry.id}"]:visible`).click();
    }
    // A race opens a briefing first; practice goes straight to the grid.
    const briefing = page.getByRole('button', { name: /GO STRAIGHT TO LIGHTS|GO TO THE GATE/ });
    const first = await Promise.race([
      briefing.waitFor({ state: 'visible', timeout: 1800000 }).then(() => 'briefing'),
      waitFor('driving', (x) => x.state === 'driving', 1800000, 500).then(() => 'driving'),
    ]);
    if (first === 'briefing') {
      await briefing.click();
      await waitFor('driving', (x) => x.state === 'driving', 1800000, 500);
    }
    log(`driving: ${label}`);
    await setView(v.view);
    let driven = 0;
    for (const seconds of entry.seconds) {
      if (seconds > driven) {
        const before = (await probe())?.time ?? 0;
        if ((await probe())?.auto !== true) await page.keyboard.press('g');
        await waitFor('autopilot', (x) => x.auto === true, 60000, 250);
        await waitFor(
          `${seconds}s`,
          (x) => (x.time ?? 0) >= before + (seconds - driven),
          1800000,
          200,
        );
        driven = seconds;
        await page.keyboard.press('Escape');
        await waitFor('paused', (x) => x.state === 'paused', 180000, 250);
        await page.evaluate(() => {
          const s = document.createElement('style');
          s.id = 'c2-hide';
          s.textContent =
            '#modal{visibility:hidden!important}#modal::backdrop{background:transparent!important}';
          document.head.append(s);
        });
      }
      await sleep(3500);
      const file = `${label}-t${seconds}.jpg`;
      const info = await encode(join(out, file));
      const d = await probe();
      log(
        `${file} ${(info.bytes / 1024).toFixed(0)} KB q${info.quality} t=${d?.time?.toFixed(1)} s lighting=${d?.lighting}`,
      );
      if (seconds > 0 && seconds !== entry.seconds.at(-1)) {
        await page.evaluate(() => document.getElementById('c2-hide')?.remove());
        await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
        await waitFor('driving', (x) => x.state === 'driving', 180000, 250);
      }
    }
    await page.evaluate(() => document.getElementById('c2-hide')?.remove());
  } catch (error) {
    log(`FAILED ${label}: ${String(error.message).split('\n')[0]}`);
  }
  index++;
}
writeFileSync(join(out, 'errors.txt'), errors.join('\n'));
log(`done; ${errors.length} page/console errors`);
await browser.close();
process.exit(0);
