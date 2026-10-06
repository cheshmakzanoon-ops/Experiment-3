#!/usr/bin/env node
/**
 * Studio capture matrix (QA tooling; not part of the game, CI or any test).
 *
 * Drives the real application UI in headless Chromium on SwiftShader and writes
 * index-named PNGs plus diag.json (per-shot renderer state, draw breakdown and
 * visual census) and errors.txt (page errors and console errors only). It uses
 * only the controls a player has: menus, the Academy lighting buttons, the pause
 * menu, camera cycling, throttle, autopilot and the pit request. It never writes
 * simulation state and never writes inside the repository.
 *
 * Shot indices are stable so `look-metrics.py` and `shotdiff.py` can match them
 * across builds (10-13 frame exactly like the original capture.mjs; 20-21 are
 * autopilot drive shots held at one simulated instant, while capture.mjs held the
 * throttle: --drive-mode throttle --drive 10):
 *   00 menu
 *   10-13 day/clear static chase, cockpit, pod (T-cam), trackside   20-21 day drive
 *   30-33 sunset static                                              34-35 sunset drive
 *   40-43 night static                                               44-45 night drive
 *   50-53 rain static                                                54-55 rain drive
 *   60-6x grid crew (pre-race presentation)    70-7x pit stop (TV, cockpit, ...)
 *   80-85 changeable weather, 90-95 any other lighting/weather pair
 *
 * Run `node scripts/studio/capture-matrix.mjs --help` for the options.
 */
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HELP = `Usage: node scripts/studio/capture-matrix.mjs <outDir> --url http://127.0.0.1:<port> [options]

Captures the running build (serve it with: npx vite preview --host 127.0.0.1 --port <port> --strictPort).
Run captures one at a time:  flock $S/capture.lock timeout 1800 node scripts/studio/capture-matrix.mjs ...

Options
  --url URL              Preview server of the build to capture (required; never the shared :4173).
  --quality Q            low | medium | high (default medium), applied through GARAGE & SETTINGS.
  --lighting L[,L...]    day | sunset | night (default day). The first is the primary session's lighting;
                         each further entry is captured in the same session through the Academy
                         lighting:* action (car still on the grid) with --variant-views.
  --weather W[,W...]     clear | rain | changeable (default clear). The first is the primary session's
                         weather; each further entry is a new practice session (static chase + T-cam,
                         then an autopilot drive shot from chase and T-cam).
  --views V[,V...]       Static views of the primary session (default chase,cockpit,pod,trackside).
                         A view keeps its slot: chase +0, cockpit +1, pod +2, trackside +3.
  --variant-views V,...  Views of each extra lighting (default chase,cockpit).
  --drive S              Seconds of driving before the drive shots (default 16: the turn-1 approach
                         at 265 km/h, where the shot 20/21 crops are calibrated; 0 = no drive shots,
                         also for --weather).
                         hold/auto: simulated seconds; throttle: wall seconds (capture.mjs used 10).
  --drive-mode M         hold (default): autopilot on the racing line for S simulated seconds, then
                         the session is paused (the player's Escape, dialog hidden) and every drive
                         view shows that same instant, so 20/21 land at the same place on every
                         run (driveElapsed in diag.json, S + under 0.2 s).
                         auto: the same drive without the pause; SwiftShader frames take 2-15 s
                         while the simulation runs in real time, so the shots land 10-60 s later
                         and position checks report INVALID. Use it only where motion blur can
                         render (frames under 0.12 s; never on SwiftShader).
                         throttle: hold ArrowUp like the original capture.mjs; the car leaves the
                         road at turn 1 and the frame depends on render speed.
  --drive-views V,...    Views shot while driving (default chase,cockpit).
  --grid                 Race session held on the grid: pre-race presentation shots of the grid crew.
  --grid-times T,...     Presentation seconds to capture (default 10,14; stages: 4-7 checks,
                         7-12 tyre preparation, 12-17 blankets off).
  --pit                  Race session (after --grid if given): autopilot + pit request, pause during
                         wheel service and capture --pit-views.
  --pit-views V,...      Views of the held pit stop (default trackside,cockpit; trackside = TV).
  --matrix               Shorthand for --lighting day,sunset,night --weather clear,rain --grid --pit.
  --graphics K=V[,K=V]   Individual graphics controls after the preset (the GARAGE & SETTINGS
                         graphics_<K> fields), e.g. motionBlur=0.35, temporalAA=true, cockpitFov=54.
                         Every preset has motionBlur 0, so a KPI 8 blurred capture must set it.
                         Unknown keys, unknown select values and non-boolean checkbox values fail
                         the run; range values are snapped by the control (diag.json graphics).
  --opponents N          Rival count (default 7).
  --size WxH             Viewport (default 1280x720).
  --no-census            Skip the visual census (apexDiagnostics(true).visual.census) on the cockpit shot.
  --plan                 Print the shot plan and exit without launching a browser.
  --help                 This text.

Output (outDir must be outside the repository): NN-<scenario>-<view>.png, diag.json (options, build
identity, timings, per-shot renderer state incl. drawBreakdown, census, failures), errors.txt (page and
console errors; must be empty), capture-log.txt. Exit code 0 = every planned shot written and no
page errors, 1 = setup failure, 2 = some shots missing or page errors.
Measured wall time (SwiftShader, Medium, 1280x720, box shared with another capture/build job, load
average 4-6): day run 8.2-9.8 min, --matrix 28.9 min; High day run 10.3 min. An idle box is about
30 % faster (capture.mjs: 6.8 min for the same day shots).
Per-shot records describe the frame submitted before the screenshot; on SwiftShader 1-4 more frames
are submitted while it waits, so the PNG lies between that record and its 'after' values (time,
speed, driveElapsed). Held and static shots read the same on both.`;

const VIEWS = ['chase', 'cockpit', 'pod', 'trackside'];
const LIGHTINGS = ['day', 'sunset', 'night'];
const WEATHERS = ['clear', 'rain', 'changeable'];
const QUALITIES = ['low', 'medium', 'high'];
/** [static base, drive base] per lighting/weather pair; see the file header. */
const GROUPS = {
  'day/clear': [10, 20],
  'sunset/clear': [30, 34],
  'night/clear': [40, 44],
  'day/rain': [50, 54],
  'day/changeable': [80, 84],
};
const OTHER_GROUP = [90, 94];

function fail(message) {
  console.error(`capture-matrix: ${message}\n\nRun with --help for usage.`);
  process.exit(1);
}
function list(value, allowed, name) {
  const items = String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!items.length) fail(`--${name} needs at least one value`);
  for (const item of items)
    if (!allowed.includes(item)) fail(`--${name}: "${item}" is not one of ${allowed.join(', ')}`);
  if (new Set(items).size !== items.length) fail(`--${name}: duplicate entries`);
  return items;
}
function numbers(value, name, min, max) {
  const items = String(value)
    .split(',')
    .map((s) => Number(s.trim()));
  if (!items.length || items.some((n) => !Number.isFinite(n) || n < min || n > max))
    fail(`--${name}: expected numbers in [${min}, ${max}]`);
  return items;
}

function parse(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        url: { type: 'string' },
        quality: { type: 'string', default: 'medium' },
        lighting: { type: 'string', default: 'day' },
        weather: { type: 'string', default: 'clear' },
        views: { type: 'string', default: VIEWS.join(',') },
        'variant-views': { type: 'string', default: 'chase,cockpit' },
        drive: { type: 'string', default: '16' },
        'drive-mode': { type: 'string', default: 'hold' },
        'drive-views': { type: 'string', default: 'chase,cockpit' },
        grid: { type: 'boolean', default: false },
        'grid-times': { type: 'string', default: '10,14' },
        pit: { type: 'boolean', default: false },
        'pit-views': { type: 'string', default: 'trackside,cockpit' },
        matrix: { type: 'boolean', default: false },
        graphics: { type: 'string', default: '' },
        opponents: { type: 'string', default: '7' },
        size: { type: 'string', default: '1280x720' },
        'no-census': { type: 'boolean', default: false },
        plan: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    fail(error.message);
  }
  const v = parsed.values;
  if (v.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (parsed.positionals.length !== 1) fail('expected exactly one output directory');
  if (v.matrix) {
    v.lighting = 'day,sunset,night';
    v.weather = 'clear,rain';
    v.grid = true;
    v.pit = true;
  }
  if (!QUALITIES.includes(v.quality)) fail(`--quality must be one of ${QUALITIES.join(', ')}`);
  if (!['hold', 'auto', 'throttle'].includes(v['drive-mode']))
    fail('--drive-mode must be hold, auto or throttle');
  const size = /^(\d{3,4})x(\d{3,4})$/.exec(v.size);
  if (!size) fail('--size must look like 1280x720');
  const opponents = Number(v.opponents);
  if (!Number.isInteger(opponents) || opponents < 0 || opponents > 11)
    fail('--opponents must be an integer 0-11');
  const drive = Number(v.drive);
  if (!Number.isFinite(drive) || drive < 0 || drive > 120) fail('--drive must be 0-120 seconds');
  const options = {
    out: resolve(parsed.positionals[0]),
    url: v.url,
    quality: v.quality,
    lighting: list(v.lighting, LIGHTINGS, 'lighting'),
    weather: list(v.weather, WEATHERS, 'weather'),
    views: list(v.views, VIEWS, 'views'),
    variantViews: list(v['variant-views'], VIEWS, 'variant-views'),
    drive,
    driveMode: v['drive-mode'],
    driveViews: list(v['drive-views'], VIEWS, 'drive-views'),
    grid: v.grid,
    gridTimes: numbers(v['grid-times'], 'grid-times', 0, 38),
    pit: v.pit,
    pitViews: list(v['pit-views'], VIEWS, 'pit-views'),
    opponents,
    graphics: Object.fromEntries(
      String(v.graphics)
        .split(',')
        .filter(Boolean)
        .map((pair) => {
          const m = /^([A-Za-z]+)=([\w.-]+)$/.exec(pair.trim());
          if (!m) fail(`--graphics: expected key=value, got "${pair}"`);
          return [m[1], m[2]];
        }),
    ),
    width: Number(size[1]),
    height: Number(size[2]),
    census: !v['no-census'],
    plan: v.plan,
  };
  if (options.driveViews.length > 2) fail('--drive-views takes at most 2 views (slots +0, +1)');
  if (options.gridTimes.length > 9 || options.pitViews.length > 9) fail('at most 9 grid/pit shots');
  if (!options.plan) {
    if (!options.url) fail('--url is required (serve your build on your own port)');
    let url;
    try {
      url = new URL(options.url);
    } catch {
      fail(`--url is not a URL: ${options.url}`);
    }
    if (url.port === '4173')
      fail('port 4173 serves the shared main-checkout build; serve your own build on your port');
  }
  return options;
}

/** Captures belong in the scratchpad: refuse any directory inside this repository. */
function guardOutput(out) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const real = (p) => {
    let probe = p;
    while (!existsSync(probe)) probe = dirname(probe);
    return join(realpathSync(probe), relative(probe, p));
  };
  const rel = relative(real(repo), real(out));
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
    fail(`outDir ${out} is inside the repository; write captures to the scratchpad instead`);
  if (existsSync(out) && readdirSync(out).some((f) => /^\d\d-.*\.png$/.test(f)))
    fail(`outDir ${out} already holds captures; choose a new directory`);
}

/** The ordered shot plan. Every entry has a unique two-digit index. */
function buildPlan(o) {
  const blocks = [];
  const used = new Map();
  const claim = (index, label) => {
    if (used.has(index)) fail(`shot index ${index} used by ${used.get(index)} and ${label}`);
    used.set(index, label);
    return index;
  };
  const group = (lighting, weather) => GROUPS[`${lighting}/${weather}`] ?? OTHER_GROUP;
  const scenario = (lighting, weather) =>
    weather === 'clear' ? lighting : lighting === 'day' ? weather : `${lighting}-${weather}`;
  const shots = (lighting, weather, views, drive, driveViews) => {
    const [base, driveBase] = group(lighting, weather);
    const name = scenario(lighting, weather);
    return {
      static: views.map((view) => ({
        index: claim(base + VIEWS.indexOf(view), `${name} ${view}`),
        name: `${name}-${view}`,
        view,
      })),
      drive: drive
        ? driveViews.map((view, i) => ({
            index: claim(driveBase + i, `${name} drive ${view}`),
            name: `${name}-drive-${view}`,
            view,
          }))
        : [],
    };
  };
  claim(0, 'menu');
  const [primaryLighting, ...extraLighting] = o.lighting;
  const [primaryWeather, ...extraWeather] = o.weather;
  const primary = shots(primaryLighting, primaryWeather, o.views, o.drive, o.driveViews);
  blocks.push({
    kind: 'practice',
    weather: primaryWeather,
    lighting: primaryLighting,
    static: primary.static,
    variants: extraLighting.map((lighting) => ({
      lighting,
      ...shots(lighting, primaryWeather, o.variantViews, 0, []),
    })),
    drive: primary.drive,
    driveMode: o.driveMode,
    driveSeconds: o.drive,
  });
  for (const weather of extraWeather) {
    // --drive 0 means no drive shots here too; throttle would leave the road, so it drives held.
    const seconds = o.drive ? Math.max(o.drive, 12) : 0;
    const s = shots(primaryLighting, weather, ['chase', 'pod'], seconds, ['chase', 'pod']);
    blocks.push({
      kind: 'practice',
      weather,
      lighting: primaryLighting,
      static: s.static,
      variants: [],
      drive: s.drive,
      driveMode: o.driveMode === 'throttle' ? 'hold' : o.driveMode,
      driveSeconds: seconds,
    });
  }
  if (o.grid || o.pit) {
    blocks.push({
      kind: 'race',
      weather: primaryWeather,
      lighting: primaryLighting,
      grid: o.grid
        ? o.gridTimes.map((time, i) => ({
            index: claim(60 + i, `grid t${time}`),
            name: `grid-t${String(time).replace('.', 'p')}-chase`,
            view: 'chase',
            time,
          }))
        : [],
      pit: o.pit
        ? o.pitViews.map((view, i) => ({
            index: claim(70 + i, `pit ${view}`),
            name: `pit-${view === 'trackside' ? 'tv' : view}`,
            view,
          }))
        : [],
    });
  }
  return blocks;
}

function describePlan(blocks) {
  const lines = ['00 menu'];
  for (const b of blocks) {
    if (b.kind === 'practice') {
      lines.push(`-- practice session: ${b.weather}, ${b.lighting}`);
      for (const s of b.static) lines.push(`${String(s.index).padStart(2, '0')} ${s.name}`);
      for (const v of b.variants) {
        lines.push(`   (Academy lighting:${v.lighting}, same session)`);
        for (const s of v.static) lines.push(`${String(s.index).padStart(2, '0')} ${s.name}`);
      }
      if (b.drive.length) {
        lines.push(`   (${b.driveMode} drive ${b.driveSeconds} s, lighting ${b.lighting})`);
        for (const s of b.drive) lines.push(`${String(s.index).padStart(2, '0')} ${s.name}`);
      }
    } else {
      lines.push(`-- race session: ${b.weather}, ${b.lighting}`);
      for (const s of b.grid) lines.push(`${String(s.index).padStart(2, '0')} ${s.name}`);
      if (b.pit.length) lines.push('   (autopilot + pit request; held during wheel service)');
      for (const s of b.pit) lines.push(`${String(s.index).padStart(2, '0')} ${s.name}`);
    }
  }
  return lines.join('\n');
}

const o = parse(process.argv.slice(2));
const blocks = buildPlan(o);
if (o.plan) {
  console.log(describePlan(blocks));
  process.exit(0);
}
guardOutput(o.out);

// Loaded only for a real run, so --help and --plan stay instant. The frame layout comes from the
// game's own protocol module (Node >= 22.18 strips the types; older 22.x needs
// --experimental-strip-types), so header and car offsets follow protocol version changes.
const { chromium } = await import('@playwright/test');
let protocol;
try {
  protocol = await import('../../src/simulation/protocol.ts');
} catch (error) {
  fail(
    `cannot load src/simulation/protocol.ts (${error.message}); run with node --experimental-strip-types`,
  );
}
const { H, F, carBase } = protocol;
const FRAME = {
  time: H.TIME,
  tick: H.TICK,
  phase: carBase(0) + F.PIT_PHASE,
  clock: carBase(0) + F.PIT_CLOCK,
  inPit: carBase(0) + F.IN_PIT,
  speed: carBase(0) + F.SPEED,
};
mkdirSync(o.out, { recursive: true });

const started = Date.now();
const logLines = [];
const log = (message) => {
  const line = `[${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`;
  logLines.push(line);
  console.log(line);
};
const errors = [];
const failures = [];
const records = [];
const timings = {};
const mark = (name) => (timings[name] = Math.round((Date.now() - started) / 100) / 10);
const short = (error) => String(error?.message ?? error).split('\n')[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: o.width, height: o.height } });
page.setDefaultTimeout(180000);
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

/** A small projection of apexDiagnostics(), read without touching the scene. */
const probe = () =>
  page
    .evaluate((I) => {
      const d = window.apexDiagnostics?.();
      if (!d) return null;
      const r = d.renderer ?? {};
      const f = d.frame;
      return {
        state: d.state,
        auto: d.auto,
        frames: d.presentation?.frames ?? 0,
        workerPause: d.workerPause,
        grid: d.gridPresentation,
        lighting: r.lighting,
        requestedCamera: r.requestedCamera,
        presentedCamera: r.presentedCamera,
        // The live worker frame, which leads the presented one by up to a slow render.
        pit: f
          ? { phase: f[I.phase], clock: f[I.clock], inPit: f[I.inPit], time: f[I.time] }
          : null,
        tick: f ? f[I.tick] : null,
        live: f ? { time: f[I.time], speed: f[I.speed] } : null,
      };
    }, FRAME)
    .catch(() => null);

async function waitFor(label, predicate, timeoutMs = 240000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probe();
    if (last && predicate(last)) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${label} (last ${JSON.stringify(last)})`);
}
/** Wait until `count` further frames were submitted. The renderer submits a frame only after the
 * previous one completed on the GPU, so one submission after the view switch means the switched
 * frame is finished and the screenshot shows it (or a later one). */
async function settle(count = 1) {
  const start = (await probe())?.frames ?? 0;
  await waitFor(`${count} presented frames`, (d) => d.frames >= start + count);
}
const click = (selector) =>
  page.evaluate((s) => {
    const element = document.querySelector(s);
    if (!element) throw new Error(`missing ${s}`);
    element.click();
  }, selector);

/** Switch the camera with the player's controls; true when a switch was needed. */
async function setView(view) {
  const initial = (await probe())?.requestedCamera;
  for (let i = 0; i < 5; i++) {
    const d = await probe();
    if (d?.requestedCamera === view) break;
    if (d?.state === 'driving') await page.keyboard.press('c');
    else await click('#modal [data-action="camera"], .hud-actions [data-action="camera"]');
    const before = d?.requestedCamera;
    await waitFor('camera request', (x) => x.requestedCamera !== before, 30000, 200);
  }
  await waitFor(
    `presented ${view}`,
    (d) => d.presentedCamera === view && d.requestedCamera === view,
  );
  return initial !== view;
}

/** Hide only the pause dialog (and its backdrop) for held shots; the HUD stays as the player sees it. */
async function hideDialog(hidden) {
  await page.evaluate((h) => {
    const id = 'capture-matrix-hide-dialog';
    document.getElementById(id)?.remove();
    if (!h) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent =
      '#modal{visibility:hidden!important}#modal::backdrop{background:transparent!important}';
    document.head.append(style);
  }, hidden);
}

/** Renderer state of the most recently submitted frame (the one the next screenshot shows). */
const frameMeta = () =>
  page.evaluate((I) => {
    const d = window.apexDiagnostics();
    const r = d.renderer ?? {};
    const blur = r.motionBlur ?? null;
    return {
      state: d.state,
      frame: d.presentation?.frames ?? null,
      presentedCamera: r.presentedCamera,
      lighting: r.lighting,
      liveTime: d.frame ? d.frame[I.time] : null,
      presentedTime: r.pitState?.time ?? null,
      speedKmh: r.pitState ? Math.round(r.pitState.speed * 36) / 10 : null,
      pitPhase: r.pitState?.phase ?? null,
      gridTime: d.state === 'pregame' ? d.gridPresentation.time : null,
      drawCalls: r.drawCalls,
      triangles: r.triangles,
      frameMs: r.frameMs,
      gpuMilliseconds: r.gpuMilliseconds,
      renderCPUms: r.renderCPUms,
      exposure: r.automaticExposure ?? null,
      reflectionIntensity: r.reflectionIntensity,
      motionBlur: blur
        ? {
            active: blur.active,
            strength: blur.strength,
            resets: blur.resets,
            velocityFrames: blur.velocityFrames,
          }
        : null,
      drawBreakdown: r.drawBreakdown,
    };
  }, FRAME);

/** `immediate`: the view was already live (throttle drive shot), so capture the next frame at once. */
async function shot(entry, context, immediate = false) {
  const file = `${String(entry.index).padStart(2, '0')}-${entry.name}.png`;
  try {
    const switched = entry.view ? await setView(entry.view) : false;
    // After a switch the frame with the new view is already submitted (presentedCamera is set at
    // submission) and the screenshot waits for it on the GPU. Without a switch, wait for one fresh
    // submission so the shot reflects the current state (seek, resume, drive time).
    if (!switched && !immediate) await settle(1);
    // The PNG shows a frame between the one submitted before the screenshot and the one presented
    // after it: on SwiftShader the screenshot waits behind the GPU while the renderer submits 1-4
    // more frames. The record is the frame before; `after` bounds the shot (a held or static scene
    // reads the same on both). Draw calls and the breakdown are those of the frame before.
    const meta = await frameMeta();
    await page.screenshot({ path: join(o.out, file), timeout: 240000 });
    const later = await frameMeta();
    const elapsed = (time) =>
      context.driveStart !== undefined && time !== null
        ? Math.round((time - context.driveStart) * 100) / 100
        : undefined;
    // Simulated seconds between the drive start and the presented frame: the autopilot drive
    // from the grid is deterministic, so this places the frame on the lap (look-metrics gates
    // position-dependent checks on both ends).
    meta.driveElapsed = elapsed(meta.presentedTime);
    meta.after = {
      frames: meta.frame !== null && later.frame !== null ? later.frame - meta.frame : null,
      presentedTime: later.presentedTime,
      speedKmh: later.speedKmh,
      driveElapsed: elapsed(later.presentedTime),
    };
    records.push({ index: entry.index, file, ...context, view: entry.view ?? null, ...meta });
    log(
      `shot ${file} (${meta.presentedCamera}, ${meta.drawCalls} calls` +
        (meta.driveElapsed !== undefined
          ? `, drive +${meta.driveElapsed}..${meta.after.driveElapsed} s`
          : '') +
        `, ${meta.speedKmh}..${meta.after.speedKmh} km/h, +${meta.after.frames} frames)`,
    );
    return true;
  } catch (error) {
    failures.push(`${file}: ${short(error)}`);
    log(`shot FAILED ${file}: ${short(error)}`);
    return false;
  }
}

async function pause() {
  const d = await probe();
  if (d?.state === 'driving') await page.keyboard.press('Escape');
  await waitFor(
    'paused worker',
    (x) => x.state === 'paused' && x.workerPause?.paused && !x.workerPause?.pending,
    60000,
    200,
  );
}
async function resume() {
  await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
  await waitFor('driving', (x) => x.state === 'driving', 60000, 250);
}
/** Academy lighting:* (from the menu or the pause menu), then back. */
async function setLighting(lighting) {
  const d = await probe();
  if (d?.lighting === lighting) return;
  const scope = d?.state === 'menu' ? '#menu' : '#modal';
  await page.locator(`${scope} [data-action="academy"]`).first().click();
  await page.locator(`#modal [data-action="lighting:${lighting}"]`).click();
  await waitFor(`lighting ${lighting}`, (x) => x.lighting === lighting, 60000, 250);
  await page.locator('#modal [data-action="modalClose"]').first().click();
  log(`lighting ${lighting}`);
}
async function toMenu() {
  const d = await probe();
  if (d?.state === 'menu') return;
  if (d?.state === 'pregame') await click('#gridPresentationBack');
  if (d?.state === 'driving') await pause();
  if ((await probe())?.state !== 'menu') {
    await waitFor('pause dialog', (x) => x.state === 'paused', 60000, 250);
    await page.locator('#modal [data-action="menu"]').first().click();
  }
  await waitFor('menu', (x) => x.state === 'menu', 60000, 250);
}
async function enter({ mode, weather, hold }) {
  await page.locator('#mode').selectOption(mode);
  await page.locator('#weather').selectOption(weather);
  // Selecting rain switches the menu to wets and nothing switches back: set tyres explicitly.
  await page.locator('#compound').selectOption(weather === 'rain' ? 'wet' : 'medium');
  await page.locator('#opponents').selectOption(String(o.opponents));
  const button = hold ? 'PREPARE GRID START PAUSED' : 'ENTER CIRCUIT';
  await page.getByRole('button', { name: button, exact: true }).click();
  if (hold) {
    await waitFor(
      'held grid',
      (x) =>
        x.state === 'paused' && x.tick === 0 && x.workerPause?.paused && !x.workerPause?.pending,
      300000,
      1000,
    );
    return;
  }
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const d = await probe();
    if (d?.state === 'driving') return;
    if (
      await page
        .locator('#raceBriefing')
        .isVisible()
        .catch(() => false)
    )
      await page
        .getByRole('button', { name: 'GO STRAIGHT TO LIGHTS', exact: true })
        .click()
        .catch(() => {});
    await sleep(1000);
  }
  throw new Error(`session did not reach driving (${mode}, ${weather})`);
}
/** Autopilot on/off through the player's key ('g'), confirmed by diagnostics. */
async function setAuto(on) {
  if ((await probe())?.auto === on) return;
  await page.keyboard.press('g');
  await waitFor(`autopilot ${on}`, (x) => x.auto === on, 30000, 250);
}
/** Hold (default): autopilot for S simulated seconds, then pause and shoot every drive view of
 * that held instant (the deterministic drive puts it at the same place on the lap on every run).
 * Auto: the same drive, then a frame submitted after that instant without pausing; on SwiftShader
 * it lands one or more slow frames (10-60 simulated s) later. Throttle: S wall seconds and the next
 * frame, exactly like the original capture.mjs. */
async function drive(block, context) {
  if (!block.drive.length) return;
  await setView(block.drive[0].view);
  const throttle = block.driveMode === 'throttle';
  const held = block.driveMode === 'hold';
  if (throttle) await page.keyboard.down('ArrowUp');
  else await setAuto(true);
  // Read after the key was handled: the main thread can be blocked for a whole slow frame.
  const t0 = (await probe())?.live?.time ?? 0;
  log(`${block.driveMode} drive ${block.driveSeconds} s from t=${t0.toFixed(2)}`);
  try {
    if (throttle) await sleep(block.driveSeconds * 1000);
    else
      await waitFor(
        `${block.driveSeconds} s of simulated driving`,
        (x) => (x.live?.time ?? 0) >= t0 + block.driveSeconds,
        300000,
        held ? 100 : 250,
      );
    if (held) {
      await pause();
      await hideDialog(true);
      // The HUD panels refresh on every third drawn frame; two more frames (plus the shot's own)
      // let them catch up with the held instant instead of showing the drive start.
      await settle(2);
    }
    const shotContext = { ...context, drive: block.driveMode, driveStart: t0, held };
    for (const [i, entry] of block.drive.entries())
      await shot(entry, shotContext, throttle && i === 0);
  } finally {
    if (throttle) await page.keyboard.up('ArrowUp');
    if (held) {
      await hideDialog(false);
      if ((await probe())?.state === 'paused') await resume();
    }
  }
  if (!throttle) await setAuto(false);
}

async function practice(block, first) {
  const context = { session: 'practice', weather: block.weather, lighting: block.lighting };
  if (!first) await toMenu();
  await setLighting(block.lighting);
  await enter({ mode: 'practice', weather: block.weather, hold: false });
  log(`driving (practice, ${block.weather}, ${block.lighting})`);
  mark(`enter-${block.weather}`);
  for (const entry of block.static) {
    await shot(entry, context);
    if (first && o.census && entry.view === 'cockpit') await census();
  }
  for (const variant of block.variants) {
    await pause();
    await setLighting(variant.lighting);
    await resume();
    for (const entry of variant.static)
      await shot(entry, { ...context, lighting: variant.lighting });
    mark(`variant-${variant.lighting}`);
  }
  if (block.variants.length) {
    await pause();
    await setLighting(block.lighting);
    await resume();
  }
  await drive(block, context);
  if (first) await rendererSummary();
  mark(`done-${block.weather}`);
}

async function race(block) {
  const context = { session: 'race', weather: block.weather, lighting: block.lighting };
  await toMenu();
  await setLighting(block.lighting);
  if (block.grid.length) {
    await enter({ mode: 'race', weather: block.weather, hold: true });
    log('grid held');
    await page.getByRole('button', { name: 'PRE-RACE PRESENTATION', exact: true }).click();
    await waitFor('pre-race presentation', (x) => x.state === 'pregame', 60000, 250);
    for (const entry of block.grid) {
      await page.locator('#gridPresentationSeek').evaluate((element, value) => {
        const input = element;
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, entry.time);
      await waitFor(`grid t=${entry.time}`, (x) => x.grid?.time === entry.time, 30000, 250);
      await shot({ ...entry, view: null }, { ...context, grid: entry.time });
    }
    mark('grid');
    if (!block.pit.length) return;
    await click('#gridPresentationStart');
    await waitFor('race start', (x) => x.state === 'driving', 60000, 250);
  } else {
    await enter({ mode: 'race', weather: block.weather, hold: false });
  }
  log('race running; autopilot + pit request');
  await setAuto(true);
  await page.keyboard.press('p');
  // Pause inside the wheel service (phase 3 = wheels off) so every view shows the same held instant.
  let held = null;
  try {
    held = await waitFor(
      'wheel service',
      (x) => {
        if (x.pit?.phase === 6) throw new Error('pit service already finished; polling too slow');
        return x.pit?.phase >= 3 && x.pit?.phase <= 5;
      },
      600000,
      150,
    );
    await pause();
  } catch (error) {
    failures.push(`pit: ${short(error)}`);
    log(`pit FAILED: ${short(error)}`);
    return;
  }
  const after = await probe();
  log(`pit held: phase ${held.pit.phase} -> ${after?.pit?.phase}, clock ${after?.pit?.clock}`);
  mark('pit-held');
  await hideDialog(true);
  try {
    for (const entry of block.pit) await shot(entry, { ...context, pit: true, held: true });
  } finally {
    await hideDialog(false);
  }
  mark('pit');
}

async function census() {
  try {
    const visual = await page.evaluate(() => window.apexDiagnostics(true).visual?.census ?? null);
    censusResult = visual;
    log('census collected');
  } catch (error) {
    failures.push(`census: ${short(error)}`);
  }
}
async function rendererSummary() {
  summary = await page
    .evaluate(() => {
      const d = window.apexDiagnostics();
      const r = d.renderer ?? {};
      return {
        state: d.state,
        camera: r.camera,
        buildIdentity: d.buildIdentity,
        renderer: Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v !== 'object')),
        drawBreakdown: r.drawBreakdown,
        graphics: r.graphics,
      };
    })
    .catch(() => null);
}

let censusResult = null;
let summary = null;
let fatal = null;
try {
  await page.goto(o.url);
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 300000 });
  log('loaded');
  mark('loaded');
  await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
  await page.locator('[name=quality]').selectOption(o.quality);
  if (Object.keys(o.graphics).length) {
    const { rejected, applied } = await page.evaluate((overrides) => {
      const form = document.querySelector('#settingsForm');
      const rejected = [];
      const applied = {};
      for (const [key, value] of Object.entries(overrides)) {
        const input = form?.elements.namedItem(`graphics_${key}`);
        if (!input) {
          rejected.push(`${key} (no such control)`);
          continue;
        }
        if (input.type === 'checkbox') {
          const on = ['true', '1', 'on'].includes(value);
          if (!on && !['false', '0', 'off'].includes(value)) {
            rejected.push(`${key}=${value} (checkbox: true or false)`);
            continue;
          }
          input.checked = on;
        } else {
          input.value = value;
          // A select drops values it has no option for; a range snaps to its min/max/step.
          if (input.tagName === 'SELECT' && input.value !== value) {
            const options = [...input.options].map((x) => x.value).join(', ');
            rejected.push(`${key}=${value} (options: ${options})`);
            continue;
          }
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        applied[key] = input.type === 'checkbox' ? input.checked : input.value;
      }
      return { rejected, applied };
    }, o.graphics);
    if (rejected.length) throw new Error(`--graphics rejected: ${rejected.join('; ')}`);
    log(`graphics ${JSON.stringify(applied)}`);
  }
  await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
  await page.locator('#modal').waitFor({ state: 'hidden', timeout: 120000 });
  log(`quality ${o.quality}`);
  // The menu has been redrawing since the settings closed: shoot its next completed frame.
  await shot({ index: 0, name: 'menu', view: null }, { session: 'menu' }, true);
  mark('menu');
  for (const [i, block] of blocks.entries()) {
    try {
      if (block.kind === 'practice') await practice(block, i === 0);
      else await race(block);
    } catch (error) {
      failures.push(`${block.kind} ${block.weather}/${block.lighting}: ${short(error)}`);
      log(`block FAILED (${block.kind} ${block.weather}/${block.lighting}): ${short(error)}`);
      await hideDialog(false).catch(() => {});
    }
  }
} catch (error) {
  fatal = short(error);
  log(`FATAL ${fatal}`);
  errors.push(`fatal: ${fatal}`);
}
if (!summary && !fatal) await rendererSummary();
mark('total');
const planned =
  blocks.flatMap((b) =>
    b.kind === 'practice'
      ? [...b.static, ...b.variants.flatMap((v) => v.static), ...b.drive]
      : [...b.grid, ...b.pit],
  ).length + 1;
const diag = {
  tool: 'scripts/studio/capture-matrix.mjs',
  version: 1,
  options: { ...o, out: undefined },
  plan: describePlan(blocks).split('\n'),
  ...(summary ?? { state: null, camera: null, renderer: null }),
  census: censusResult,
  shots: records,
  planned,
  written: records.length,
  failures,
  timings,
};
writeFileSync(join(o.out, 'diag.json'), JSON.stringify(diag, null, 2));
writeFileSync(join(o.out, 'errors.txt'), errors.join('\n'));
log(
  `shots ${records.length}/${planned}, failures ${failures.length}, page errors ${errors.length}`,
);
writeFileSync(join(o.out, 'capture-log.txt'), logLines.join('\n') + '\n');
await browser.close();
process.exit(fatal ? 1 : failures.length || errors.length ? 2 : 0);
