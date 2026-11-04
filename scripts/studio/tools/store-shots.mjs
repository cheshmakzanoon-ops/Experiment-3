#!/usr/bin/env node
/**
 * STORE SCREENSHOT DIRECTOR (release engineering, wave 2).
 *
 * Boots the REAL game in headless Chromium (software GL: SwiftShader, so one shot takes minutes, a
 * full run hours) and captures 1920x1080 JPEG hero screenshots of curated moments for the Steam
 * store page into docs/studio/store/screenshots/, with a manifest (manifest.json: file, size,
 * quality, alt text, status, notes) that docs/studio/store/STORE_PAGE.md's shot list is built from.
 *
 *   npx vite preview --outDir dist --host 127.0.0.1 --port 4242 --strictPort &       (the FULL game build)
 *   node scripts/studio/tools/store-shots.mjs --url http://127.0.0.1:4242            run what is missing
 *   node scripts/studio/tools/store-shots.mjs --list                                  the shot table + status
 *   node scripts/studio/tools/store-shots.mjs --url ... --only formula-fog-golden     one or more (retakes)
 *   node scripts/studio/tools/store-shots.mjs --reject gp-corner --reason "bike clipped by the frame"
 *   node scripts/studio/tools/store-shots.mjs --manifest-only                         rewrite titles/alt text
 *
 * Resumable: a captured shot is skipped on the next run (use --only or --force to retake it);
 * progress goes to stdout and docs/studio/store/screenshots/progress.log; a failed shot is logged
 * and the run goes on (the browser is relaunched). --budget-minutes stops cleanly between shots.
 * One browser at a time: the host has 4 shared CPUs, so run it under `nice`.
 *
 * Honest limits: hero frames are parked with the game's own pause and replay (the replay clock is
 * seeked to the moment a scan of the recorded session picked), the HUD and menus are hidden by a
 * style rule for the "clean" shots and left on for the "hud" ones. Software GL shows the game's
 * look but not a GPU's frame rate, and reflections and bloom differ from a real GPU.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

// ---- Channels (src/simulation/protocol.ts: HEADER 24, car 0 starts at 24) -------------------------
const CAR0 = 24;
const CH = {
  time: 0,
  x: CAR0 + 0, // F.X, m
  z: CAR0 + 2, // F.Z, m
  speed: CAR0 + 13, // F.SPEED, m/s
  y: CAR0 + 1, // F.Y, m
  lean: CAR0 + 257 + 0, // BIKE_BASE + B.LEAN, rad (+ left)
  airborne: CAR0 + 277 + 0, // OFFROAD_BASE + O.AIRBORNE
  airTime: CAR0 + 277 + 1, // OFFROAD_BASE + O.AIR_TIME
};

/**
 * The shot table. `kind`: menu | wildcard | session | festival | results | photo.
 * Session shots name the entry (discipline plate, circuit, machine, sky, light) and the moment
 * (`pick`: scan the recorded session for it, or fixed seconds), `hud` keeps the HUD on.
 * `alt` is the draft alt text; it is checked against the actual frame when the shot is reviewed.
 */
export const SHOTS = [
  {
    id: 'menu-board',
    title: 'The paddock board',
    kind: 'menu',
    alt: 'The MOTOBOUND paddock board: four discipline plates, the venue sheet with its line-art map and the option dials, with the formula car under studio light.',
  },
  {
    id: 'wildcard-board',
    title: 'The Wildcard Series board',
    kind: 'wildcard',
    event: 'descent-in-the-cloud',
    alt: 'The Wildcard Series board: a list of mismatched machine and venue events beside the programme page of one event with its map, weather and medal ladder.',
  },
  {
    id: 'formula-fog-golden',
    title: 'Formula car in fog at golden hour',
    kind: 'session',
    plate: 'circuit',
    circuit: 'alpine-pass',
    vehicle: 'apx01',
    weather: 'fog',
    light: 'sunset',
    view: 'chase',
    pick: { seconds: [24, 34, 44] },
    alt: 'A formula car on a mountain road in fog under a low golden sun, seen from behind.',
  },
  {
    id: 'gp-corner',
    title: 'GP bike leaning through a corner',
    kind: 'session',
    plate: 'gp',
    circuit: 'vellamar',
    vehicle: 'gpr1',
    weather: 'clear',
    light: 'day',
    view: 'chase',
    pick: { scan: 'lean', seconds: 70 },
    alt: 'A GP motorcycle leaned over through a corner on the Vellamar coast circuit.',
  },
  {
    id: 'motocross-jump',
    title: 'Motocross jump',
    kind: 'session',
    plate: 'dirt',
    circuit: 'valley-ridge-mx',
    vehicle: 'mx450',
    weather: 'clear',
    light: 'day',
    view: 'chase',
    pick: { scan: 'air', seconds: 80 },
    alt: 'A motocross rider in the air over a jump on a hillside loam course.',
  },
  {
    id: 'snow-pass',
    title: 'Trophy truck on the snow pass',
    kind: 'session',
    plate: 'circuit',
    circuit: 'alpine-pass',
    vehicle: 'dx8',
    weather: 'snow',
    light: 'day',
    view: 'chase',
    pick: { seconds: [26, 38, 50] },
    alt: 'A trophy truck driving up a snow-covered mountain pass in falling snow.',
  },
  {
    id: 'night-street-rain',
    title: 'Night street circuit in the rain',
    kind: 'session',
    plate: 'circuit',
    circuit: 'neon-city',
    vehicle: 'tc1',
    weather: 'rain',
    light: 'night',
    view: 'chase',
    pick: { seconds: [22, 32, 42] },
    alt: 'A touring car on a floodlit city street circuit at night in the rain, wet asphalt reflecting the lights.',
  },
  {
    id: 'results-board',
    title: 'The results board',
    kind: 'results',
    circuit: 'aurel',
    vehicle: 'apx01',
    alt: 'The results board after a race: the classification table with lap times, the podium and the next step.',
  },
  {
    id: 'photo-studio',
    title: 'Photo mode and livery studio',
    kind: 'photo',
    alt: 'The photo and livery studio with the formula car and the camera, lens and colour controls.',
  },  {
    id: 'festival-dawn',
    title: 'The coast festival at dawn',
    kind: 'festival',
    vehicle: 'eh3',
    weather: 'clear',
    light: 'sunset',
    seconds: 20,
    alt: 'A road car on the Solvane coast road under a low sun, the harbour region ahead.',
  },
];

// ---- Arguments --------------------------------------------------------------------------------------
const { values: v } = parseArgs({
  options: {
    url: { type: 'string' },
    out: { type: 'string', default: 'docs/studio/store/screenshots' },
    only: { type: 'string' },
    force: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    'manifest-only': { type: 'boolean', default: false },
    reject: { type: 'string' },
    reason: { type: 'string', default: '' },
    size: { type: 'string', default: '1920x1080' },
    quality: { type: 'string', default: '88' },
    preset: { type: 'string', default: 'high' },
    'scan-size': { type: 'string', default: '640x360' },
    'budget-minutes': { type: 'string', default: '0' },
  },
});
const out = resolve(v.out);
const [width, height] = v.size.split('x').map(Number);
const [scanW, scanH] = v['scan-size'].split('x').map(Number);
const jpegQuality = Number(v.quality);
const manifestPath = join(out, 'manifest.json');
mkdirSync(out, { recursive: true });

const t0 = Date.now();
const log = (message) => {
  const line = `[${new Date().toISOString().slice(11, 19)} +${((Date.now() - t0) / 1000).toFixed(0)}s] ${message}`;
  console.log(line);
  appendFileSync(join(out, 'progress.log'), line + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Manifest ---------------------------------------------------------------------------------------
function readManifest() {
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (m?.version === 1 && m.shots) return m;
  } catch {
    /* a new manifest */
  }
  return { version: 1, size: v.size, format: 'jpeg', quality: jpegQuality, shots: {} };
}
const manifest = readManifest();
function saveManifest() {
  manifest.updated = new Date().toISOString();
  // Keep the table's order, then anything else (retired shots) after it.
  const ordered = {};
  for (const shot of SHOTS) if (manifest.shots[shot.id]) ordered[shot.id] = manifest.shots[shot.id];
  for (const [id, entry] of Object.entries(manifest.shots)) ordered[id] ??= entry;
  manifest.shots = ordered;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
function describe(shot, patch) {
  manifest.shots[shot.id] = {
    ...(manifest.shots[shot.id] ?? {}),
    id: shot.id,
    title: shot.title,
    alt: shot.alt,
    kind: shot.kind,
    ...patch,
  };
  saveManifest();
}
const fileOf = (shot) => join(out, `${shot.id}.jpg`);
const captured = (shot) =>
  manifest.shots[shot.id]?.status === 'captured' && existsSync(fileOf(shot));

if (v.list) {
  for (const shot of SHOTS) {
    const m = manifest.shots[shot.id];
    console.log(
      `${shot.id.padEnd(20)} ${(m?.status ?? 'todo').padEnd(9)} ${m?.bytes ? `${(m.bytes / 1024).toFixed(0)} KB` : ''.padEnd(6)} ${m?.note ?? ''}`,
    );
  }
  process.exit(0);
}
if (v.reject) {
  const shot = SHOTS.find((s) => s.id === v.reject);
  if (!shot) throw new Error(`unknown shot ${v.reject}`);
  rmSync(fileOf(shot), { force: true });
  describe(shot, { status: 'rejected', note: v.reason || 'rejected on review', bytes: 0 });
  log(`rejected ${shot.id}: ${v.reason}`);
  process.exit(0);
}
if (v['manifest-only']) {
  for (const shot of SHOTS)
    if (manifest.shots[shot.id]) describe(shot, {});
  log('manifest rewritten from the shot table');
  process.exit(0);
}
if (!v.url) {
  console.error('usage: store-shots.mjs --url http://127.0.0.1:4242 [--only id,id] [--force] | --list');
  process.exit(2);
}

const only = v.only ? new Set(v.only.split(',')) : null;
const todo = SHOTS.filter((s) => (only ? only.has(s.id) : v.force || !captured(s))).filter(
  (s) => only || v.force || manifest.shots[s.id]?.status !== 'rejected',
);
if (!todo.length) {
  log('nothing to do: every shot is captured or rejected (use --only / --force to retake)');
  process.exit(0);
}
const deadline = Number(v['budget-minutes']) > 0 ? t0 + Number(v['budget-minutes']) * 60000 : Infinity;

// ---- Browser ----------------------------------------------------------------------------------------
const { chromium } = await import('@playwright/test');
let browser = null;
let page = null;
const errors = [];

async function boot() {
  await closeBrowser();
  browser = await chromium.launch({
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
  page = await browser.newPage({ viewport: { width: scanW, height: scanH } });
  page.setDefaultTimeout(900000);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  log('boot: loading the game');
  await page.goto(v.url);
  await waitFor('menu', (d) => d.state === 'menu', 1800000, 1000);
  await sleep(6000);
  await applyQuality();
  log('boot: menu ready');
}
async function closeBrowser() {
  try {
    await browser?.close();
  } catch {
    /* already gone */
  }
  browser = null;
  page = null;
}

const probe = () =>
  page
    .evaluate(() => {
      const d = window.apexDiagnostics?.();
      if (!d) return null;
      const r = d.renderer ?? {};
      return {
        state: d.state,
        auto: d.auto,
        festival: d.festival,
        lighting: r.lighting,
        requestedCamera: r.requestedCamera,
        presentedCamera: r.presentedCamera,
        frame: d.frame,
        replaySeconds: d.replaySeconds,
        replayStart: d.replayStart,
        replayPosition: d.replayPosition,
        replayPlaying: d.replayPlaying,
        presented: d.presentation ? { time: d.presentation.time, car: d.presentation.car ?? null } : null,
        menuPreview: d.menuPreview,
        mode: document.querySelector('#app')?.dataset.mode ?? null,
      };
    })
    .catch(() => null);
async function waitFor(label, predicate, timeout = 600000, interval = 400) {
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end) {
    last = await probe();
    if (last && predicate(last)) return last;
    await sleep(interval);
  }
  throw new Error(`timed out: ${label} (last state ${last?.state}, mode ${last?.mode})`);
}
const click = (selector) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) throw new Error(`missing ${s}`);
    e.click();
  }, selector);
const setViewport = async (w, h) => {
  await page.setViewportSize({ width: w, height: h });
  await sleep(2500);
};

async function applyQuality() {
  if (!v.preset || v.preset === 'medium') return;
  try {
    await click('#menu [data-action="settings"]');
    await page.locator('[name=quality]').selectOption(v.preset);
    await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
    await page.locator('#modal').waitFor({ state: 'hidden', timeout: 600000 });
    await waitFor('menu after settings', (d) => d.state === 'menu', 600000, 500);
    await sleep(4000);
    log(`render quality ${v.preset}`);
  } catch (error) {
    log(`render quality ${v.preset} not applied (${String(error.message).split('\n')[0]}); keeping the default`);
    await page.keyboard.press('Escape').catch(() => {});
  }
}
async function toMenu() {
  const d = await probe();
  if (d?.state === 'menu' && !d.festival?.active) return;
  if (d?.festival?.active) {
    await page.keyboard.press('Escape');
    await sleep(1500);
    const exit = page.locator('[data-fest="exit"]');
    if (await exit.count()) await exit.first().click();
    await waitFor('menu', (x) => x.state === 'menu' && !x.festival?.active, 300000, 500);
    return;
  }
  if (d?.state === 'driving') await page.keyboard.press('Escape');
  if (d?.state === 'replay') await click('[data-action="replayExit"]');
  if (d?.state === 'results' || d?.state === 'photo') {
    await click('#modal [data-action="menu"]').catch(() => {});
  } else {
    await waitFor('pause', (x) => x.state === 'paused' || x.state === 'menu', 180000, 300);
    if ((await probe())?.state === 'paused') await click('#modal [data-action="menu"]');
  }
  await waitFor('menu', (x) => x.state === 'menu', 300000, 400);
  await sleep(3000);
}

// ---- Output -----------------------------------------------------------------------------------------
async function encode(shot, note = '') {
  const file = fileOf(shot);
  const started = Date.now();
  const buffer = await page.screenshot({ type: 'jpeg', quality: jpegQuality, timeout: 3600000 });
  writeFileSync(file, buffer);
  const seconds = (Date.now() - started) / 1000;
  describe(shot, {
    status: 'captured',
    file: `${shot.id}.jpg`,
    bytes: buffer.length,
    quality: jpegQuality,
    size: `${width}x${height}`,
    takenAt: new Date().toISOString(),
    note,
  });
  log(`captured ${shot.id}: ${(buffer.length / 1024).toFixed(0)} KB (screenshot ${seconds.toFixed(0)} s) ${note}`);
}
// The canvas is outside #app: hiding #app hides every HUD, tag, bar, toast and dialog at once.
const HIDE_CHROME = `#app,#app *{visibility:hidden!important}#modal::backdrop{background:transparent!important}`;
async function hideChrome(on) {
  await page.evaluate(
    ([css, enable]) => {
      document.getElementById('store-shots-hide')?.remove();
      if (!enable) return;
      const s = document.createElement('style');
      s.id = 'store-shots-hide';
      s.textContent = css;
      document.head.append(s);
    },
    [HIDE_CHROME, on],
  );
}
const mdash = (value) => (value === undefined || value === null ? '' : String(value));

// ---- Scenes -----------------------------------------------------------------------------------------
async function sceneMenu(shot) {
  await toMenu();
  await setViewport(width, height);
  await page.locator('.lb-plate[data-discipline="circuit"]').click();
  await sleep(6000);
  await waitFor(
    'menu preview',
    (d) => d.menuPreview?.completedRevision >= d.menuPreview?.requestedRevision,
    300000,
    500,
  ).catch(() => {});
  await sleep(3000);
  await hideChrome(false);
  await encode(shot);
}
async function sceneWildcard(shot) {
  await toMenu();
  await setViewport(width, height);
  await click('[data-action="career:wildcard"]');
  await page.waitForSelector('.wc-board');
  await page.locator(`.wc-row[data-id="${shot.event}"]`).click();
  await sleep(2500);
  await encode(shot, `event ${shot.event}`);
  await click('#modal [data-action="modalClose"]');
  await sleep(1500);
}
async function setEntry(shot) {
  await toMenu();
  if (shot.plate) {
    await page.locator(`.lb-plate[data-discipline="${shot.plate}"]`).click();
    await sleep(2500);
  }
  const select = async (id, value) => {
    if (value === undefined) return;
    await page.locator(`#${id}`).selectOption(value);
    await sleep(500);
  };
  await select('mode', shot.mode ?? 'practice');
  await select('circuit', shot.circuit);
  await select('vehicle', shot.vehicle);
  await select('weather', shot.weather);
  await select('light', shot.light);
  await select('opponents', shot.opponents ?? '0');
  if (shot.laps) await select('laps', shot.laps);
}
async function enterAndDrive(label) {
  await page.locator('#sessionForm .enter.primary').click();
  const briefing = page.getByRole('button', { name: /GO STRAIGHT TO LIGHTS|GO TO THE GATE/ });
  const first = await Promise.race([
    briefing.waitFor({ state: 'visible', timeout: 1800000 }).then(() => 'briefing'),
    waitFor('driving', (d) => d.state === 'driving', 1800000, 500).then(() => 'driving'),
  ]);
  if (first === 'briefing') {
    await briefing.click();
    await waitFor('driving', (d) => d.state === 'driving', 1800000, 500);
  }
  log(`${label}: driving`);
}
async function setView(view) {
  for (let i = 0; i < 8; i++) {
    const d = await probe();
    if (d?.presentedCamera === view && d?.requestedCamera === view) return true;
    if (d?.requestedCamera !== view) await page.keyboard.press('c');
    await sleep(1200);
  }
  return false;
}
async function driveFor(seconds) {
  const start = (await probe())?.frame?.[CH.time] ?? 0;
  if ((await probe())?.auto !== true) await page.keyboard.press('g');
  await waitFor('autopilot', (d) => d.auto === true, 120000, 300);
  await waitFor(`${seconds} s of driving`, (d) => (d.frame?.[CH.time] ?? 0) >= start + seconds, 1800000, 500);
}
async function pauseAndReplay() {
  await page.keyboard.press('Escape');
  await waitFor('paused', (d) => d.state === 'paused', 180000, 300);
  await click('#modal [data-action="replay"]');
  await waitFor('replay', (d) => d.state === 'replay', 180000, 300);
  await page.evaluate(() => {
    const play = document.getElementById('replayPlay');
    if (play && /PAUSE/.test(play.textContent ?? '')) play.click();
  });
  await sleep(1500);
}
/** Wait until the frame being DRAWN is the one asked for (a slow software-GL frame can lag the seek by minutes). */
async function waitPresented(simTime, timeout = 900000) {
  await waitFor(
    `frame at ${simTime.toFixed(2)} s`,
    (d) => Math.abs((d.presented?.time ?? -1) - simTime) < 0.05,
    timeout,
    400,
  );
  await sleep(1500);
}
async function seekTo(time) {
  await page.evaluate((value) => {
    const el = document.getElementById('replaySeek');
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, time);
}
async function logReplay(label) {
  const d = await probe();
  const c = d?.presented?.car;
  log(
    `${label}: state ${d?.state}, replay ${d?.replaySeconds?.toFixed?.(1)} s from ${d?.replayStart?.toFixed?.(2)}, position ${d?.replayPosition?.toFixed?.(2)}, presented t=${d?.presented?.time?.toFixed?.(2)} speed=${c?.speed?.toFixed?.(1)} x=${c?.x?.toFixed?.(1)} z=${c?.z?.toFixed?.(1)} lean=${c?.lean?.toFixed?.(2)} air=${c?.airborne}`,
  );
}
/** Scan the recorded session (replay seeks at low resolution) for the strongest moment. */
async function scan(kind, from, to, first) {
  const rows = [];
  for (let t = from; t <= to; t += 0.25) {
    await seekTo(t);
    await waitPresented(t + first, 15000).catch(() => {});
    const d = await probe();
    const car = d?.presented?.car;
    if (!car) continue;
    rows.push({
      t,
      sim: d.presented.time,
      speed: car.speed,
      lean: car.lean,
      air: car.airborne,
      airTime: car.airTime,
      y: car.y,
    });
  }
  let best = null;
  if (kind === 'lean') {
    // The deepest lean while still moving fast: a corner at pace, not a crash on the floor.
    for (const r of rows)
      if (r.speed > 18 && Math.abs(r.lean) < 1.25 && (!best || Math.abs(r.lean) > Math.abs(best.lean)))
        best = r;
  } else if (kind === 'air') {
    // The middle of the longest flight.
    let run = [];
    const runs = [];
    for (const r of rows) {
      if (r.air > 0.5) run.push(r);
      else if (run.length) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
    const longest = runs.sort((a, b) => b.length - a.length)[0];
    if (longest) best = longest[Math.floor(longest.length / 2)];
  }
  log(
    `scan ${kind}: ${rows.length} samples, ${best ? `best at t=${best.t.toFixed(2)} s (speed ${best.speed.toFixed(1)}, lean ${best.lean.toFixed(2)}, air ${best.air})` : 'no moment found'}`,
  );
  return { rows, best };
}

async function sceneSession(shot) {
  await setViewport(scanW, scanH);
  await setEntry(shot);
  await enterAndDrive(shot.id);
  if (shot.view) await setView(shot.view);
  const picks = Array.isArray(shot.pick.seconds) ? shot.pick.seconds : [shot.pick.seconds];
  // Fixed-time shots: one candidate per time, kept as `<id>.jpg` (the best) and `<id>-N.jpg` (the rest).
  const total = Math.max(...picks) + 2;
  await driveFor(total);
  const live = await probe();
  log(
    `${shot.id}: live t=${live?.frame?.[CH.time]?.toFixed(2)} s, speed ${live?.frame?.[CH.speed]?.toFixed(1)} m/s, x=${live?.frame?.[CH.x]?.toFixed(1)} z=${live?.frame?.[CH.z]?.toFixed(1)}`,
  );
  await pauseAndReplay();
  const first = (await probe())?.replayStart ?? 0;
  await logReplay(`${shot.id}: replay opened`);
  const targets = [];
  if (shot.pick.scan) {
    const { best } = await scan(shot.pick.scan, 4, Math.max(8, total - 2), first);
    if (best) targets.push(best.t);
  }
  if (!targets.length) targets.push(...picks.map((s) => s - first));
  await setViewport(width, height);
  await hideChrome(!shot.hud);
  const notes = [];
  for (const [i, t] of targets.entries()) {
    await seekTo(t);
    await waitPresented(t + first);
    await logReplay(`${shot.id}: after seek to ${t.toFixed(2)}`);
    const candidate = i === 0 ? shot : { ...shot, id: `${shot.id}-alt${i}` };
    await encode(candidate, `replay t=${t.toFixed(2)} s`);
    if (i > 0) describe(candidate, { alt: shot.alt, title: `${shot.title} (alternate ${i})`, kind: shot.kind });
    notes.push(t.toFixed(2));
  }
  await hideChrome(false);
  await setViewport(scanW, scanH);
}
async function sceneFestival(shot) {
  await setViewport(scanW, scanH);
  await toMenu();
  await page.locator('.lb-plate[data-discipline="festival"]').click();
  await sleep(2500);
  await page.locator('#weather').selectOption(shot.weather ?? 'clear');
  await page.locator('#light').selectOption(shot.light ?? 'day');
  if (shot.vehicle) await page.locator('#vehicle').selectOption(shot.vehicle);
  await sleep(800);
  await page.locator('#sessionForm .enter.primary').click();
  await waitFor('festival', (d) => d.festival?.active === true, 1800000, 1000);
  await waitFor('festival mode', (d) => d.mode === 'festival', 1800000, 1000);
  log(`${shot.id}: festival running`);
  await sleep((shot.seconds ?? 15) * 1000);
  await setViewport(width, height);
  await hideChrome(true);
  await sleep(12000);
  await encode(shot);
  await hideChrome(false);
  await setViewport(scanW, scanH);
}
async function sceneResults(shot) {
  await setViewport(scanW, scanH);
  await setEntry({ ...shot, plate: 'circuit', mode: 'race', opponents: '3', laps: '1', weather: 'clear', light: 'day' });
  await enterAndDrive(shot.id);
  if ((await probe())?.auto !== true) await page.keyboard.press('g');
  await waitFor('results', (d) => d.state === 'results', 3600000, 1000);
  log(`${shot.id}: results on screen`);
  await setViewport(width, height);
  await sleep(10000);
  await hideChrome(false);
  await encode(shot);
  await toMenu();
}
async function scenePhoto(shot) {
  await toMenu();
  await setViewport(width, height);
  await click('#menu [data-action="photo"]');
  await waitFor('photo studio', (d) => d.state === 'photo', 600000, 500);
  await sleep(12000);
  await hideChrome(false);
  await encode(shot);
  await click('#modal [data-action="modalClose"]').catch(() => {});
  await page.keyboard.press('Escape');
  await sleep(2000);
}
const SCENES = {
  menu: sceneMenu,
  wildcard: sceneWildcard,
  session: sceneSession,
  festival: sceneFestival,
  results: sceneResults,
  photo: scenePhoto,
};

// ---- Run --------------------------------------------------------------------------------------------
log(`store shots: ${todo.map((s) => s.id).join(', ')} -> ${out} (${width}x${height}, jpeg q${jpegQuality}, ${v.preset})`);
let ok = 0;
let failed = 0;
for (const shot of todo) {
  if (Date.now() > deadline) {
    log('budget reached: stopping between shots (rerun to resume)');
    break;
  }
  const started = Date.now();
  try {
    if (!browser) await boot();
    await SCENES[shot.kind](shot);
    ok++;
  } catch (error) {
    failed++;
    const message = String(error?.stack ?? error).split('\n').slice(0, 3).join(' | ');
    log(`FAILED ${shot.id}: ${message}`);
    describe(shot, { status: 'failed', note: mdash(String(error?.message ?? error).split('\n')[0]).slice(0, 240) });
    // A crashed page or lost GL context poisons the next shot: start clean.
    await closeBrowser();
  }
  log(`${shot.id} took ${((Date.now() - started) / 60000).toFixed(1)} min`);
}
writeFileSync(join(out, 'console-errors.txt'), errors.join('\n') + (errors.length ? '\n' : ''));
log(`done: ${ok} captured, ${failed} failed, ${errors.length} page/console errors`);
await closeBrowser();
process.exit(failed ? 3 : 0);
