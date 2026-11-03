// FULL-FLOW journey tool: drives the production bundle through a player's whole
// route in a real browser (menu -> configure -> start -> drive with keyboard input
// -> pause -> resume -> finish/results -> exit -> start another) and records what
// happened: timings, console/page errors, HUD + simulation snapshots, screenshots,
// memory, and a list of machine-checked findings.
//
//   npm run build && npx vite preview --port 4214 &
//   node --no-warnings --experimental-transform-types scripts/studio/tools/journey.mjs \
//        --journey formula-practice --out <dir> [--url http://127.0.0.1:4214] \
//        [--quality low|medium|high] [--sim-seconds 30] [--viewport 960x540]
//
// Journeys: formula-practice, formula-race, time-trial, gp-race, wildcard, festival.
// `--list` prints them. Each journey is one browser page reused for two back-to-back
// sessions (memory growth is reported across them). Software GL on a shared host is
// slow: every wait is generous and logs its progress, nothing is retried silently.
//
// Hooks used (all existing, none added to the product): window.apexDiagnostics()
// (src/main.ts), #app[data-mode], the menu form ids (#circuit #vehicle #mode #laps
// #opponents #weather ...) and the modal buttons. Inputs are real keyboard events.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { KeyboardDriver, headingOf } from './keyboard-driver.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const load = (p) => import(pathToFileURL(join(root, p)).href);

// ----------------------------------------------------------------- arguments
const args = (() => {
  const out = { _: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) out._.push(argv[i]);
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) out[argv[i].slice(2)] = true;
    else out[argv[i].slice(2)] = argv[++i];
  }
  return out;
})();

export const JOURNEYS = {
  'formula-practice': 'Formula APX-01, Aurel, free practice, solo (2 sessions)',
  'formula-race': 'Formula race, 3 laps, 4 cars, Arroyo Oro (2 sessions)',
  'time-trial': 'Time trial with a stored personal-best ghost, Aurel (2 sessions)',
  'gp-race': 'GP bike race, 3 laps, 4 bikes, Kansai East (2 sessions)',
  wildcard: 'Wildcard series pairing started from the menu form (2 sessions)',
  festival: 'Festival open world: load, drive, menu, exit, load again',
};
if (args.list) {
  for (const [k, v] of Object.entries(JOURNEYS)) console.log(k.padEnd(18), v);
  process.exit(0);
}

const cfg = {
  url: args.url ?? 'http://127.0.0.1:4214',
  journey: args.journey ?? args._[0],
  out: args.out ?? join(process.env.TMPDIR ?? '/tmp', 'journey-out'),
  quality: args.quality ?? null, // null: leave the saved/default preset
  simSeconds: Number(args['sim-seconds'] ?? 30),
  viewport: (args.viewport ?? '960x540').split('x').map(Number),
  chromium: args.chromium ?? process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  bootTimeoutS: Number(args['boot-timeout'] ?? 900),
  startTimeoutS: Number(args['start-timeout'] ?? 900),
  festivalMaxS: Number(args['festival-max'] ?? 1500),
  profile: !!args.profile,
  shots: args['no-shots'] ? false : true,
  wildcardId: args.wildcard ?? 'formula-on-the-wall',
  secondSimSeconds: Number(args['second-sim-seconds'] ?? 15),
  festivalSingle: !!args['festival-single'],
};
if (!JOURNEYS[cfg.journey]) {
  console.error(`Unknown journey "${cfg.journey}". Use --list.`);
  process.exit(2);
}

// --------------------------------------------------------------- repo modules
const P = await load('src/simulation/protocol.ts');
const { Track } = await load('src/simulation/track.ts');
const { circuitDefinition } = await load('src/simulation/circuits.ts');
const { H, F, B, R, HEADER, CAR_STRIDE, BIKE_BASE, RACE_BASE } = P;
const PROTO = { H, F, B, R, HEADER, CAR_STRIDE, BIKE_BASE, RACE_BASE };

// -------------------------------------------------------------------- logging
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const timeline = [];
const findings = [];
const consoleLog = [];
const requestFailures = [];
await mkdir(cfg.out, { recursive: true });
const logFile = join(cfg.out, 'progress.log');
const progressLines = [];
function say(kind, data = {}) {
  const e = { t: Number(now().toFixed(1)), kind, ...data };
  timeline.push(e);
  const line = `[${e.t.toFixed(1).padStart(7)}s] ${kind} ${Object.keys(data).length ? JSON.stringify(data) : ''}`;
  progressLines.push(line);
  console.log(line);
}
/** A machine-checked finding. severity: blocker | major | minor | polish | info. */
function finding(severity, where, message, evidence = {}) {
  findings.push({ severity, where, message, evidence, t: Number(now().toFixed(1)) });
  say('FINDING', { severity, where, message });
}
async function flush(extra = {}) {
  await writeFile(
    join(cfg.out, 'result.json'),
    JSON.stringify(
      {
        journey: cfg.journey,
        cfg: { ...cfg, chromium: undefined },
        timeline,
        findings,
        console: consoleLog,
        requestFailures,
        ...extra,
      },
      null,
      1,
    ),
  );
  await writeFile(logFile, progressLines.join('\n') + '\n');
}

// ----------------------------------------------------------- page-side probes
const INIT_SCRIPT = () => {
  const s = {
    frames: 0,
    maxGap: 0,
    last: performance.now(),
    stalls: [],
    longTasks: 0,
    longMs: 0,
    longMax: 0,
    longSupported: true,
  };
  const tick = (t) => {
    const gap = t - s.last;
    s.last = t;
    s.frames++;
    if (gap > s.maxGap) s.maxGap = gap;
    if (gap > 2000 && s.stalls.length < 60) s.stalls.push([Math.round(t), Math.round(gap)]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        s.longTasks++;
        s.longMs += e.duration;
        if (e.duration > s.longMax) s.longMax = e.duration;
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    s.longSupported = false;
  }
  // Tap the simulation workers' frame messages: the newest snapshot is copied into
  // window.__jr.frame so the driving loop reads state in microseconds instead of
  // calling the (heavy) apexDiagnostics() ten times a second. Read-only: the
  // listener runs before the application's own handler and never touches the data.
  s.frame = null;
  s.frameAt = 0;
  s.frameMessages = 0;
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (e) => {
        const d = e.data;
        if (d && d.type === 'frame' && d.buffer instanceof ArrayBuffer && d.buffer.byteLength >= 96) {
          const f = new Float32Array(d.buffer);
          if (!s.frame || s.frame.length !== f.length) s.frame = new Float32Array(f.length);
          s.frame.set(f);
          s.frameAt = performance.now();
          s.frameMessages++;
        }
      });
    }
  };
  /** Decode a snapshot into plain objects (shared by the heavy and the fast path). */
  s.info = (f, P) => {
    const { H, F, B, R, HEADER, CAR_STRIDE, BIKE_BASE, RACE_BASE } = P;
    const n = f[H.CARS];
    const sim = {
      time: f[H.TIME],
      phase: f[H.PHASE],
      raceTime: f[H.RACE_TIME],
      lights: f[H.LIGHTS],
      flag: f[H.FLAG],
      tick: f[H.TICK],
      stepMs: f[H.STEP_MS],
      dropped: f[H.DROPPED],
      cars: n,
      length: f[H.LENGTH],
      leaderLap: f[H.LAP_LEADER],
      rain: f[H.RAIN],
      length_ok: f.length === HEADER + n * CAR_STRIDE,
    };
    let nonFinite = 0;
    for (let i = 0; i < f.length; i++) if (!Number.isFinite(f[i])) nonFinite++;
    sim.nonFinite = nonFinite;
    const car = (i) => {
      const b = HEADER + i * CAR_STRIDE;
      return {
        id: i,
        x: f[b + F.X],
        z: f[b + F.Z],
        q: [f[b + F.QX], f[b + F.QY], f[b + F.QZ], f[b + F.QW]],
        speed: f[b + F.SPEED],
        s: f[b + F.S],
        lat: f[b + F.LATERAL],
        laps: f[b + F.LAPS],
        lapTime: f[b + F.LAP_TIME],
        best: f[b + F.BEST_LAP],
        last: f[b + F.LAST_LAP],
        rank: f[b + F.RANK],
        finish: f[b + F.FINISH],
        retired: f[b + F.RETIRED],
        penalty: f[b + F.PENALTY],
        lapValid: f[b + F.LAP_VALID],
        inPit: f[b + F.IN_PIT],
        gear: f[b + F.GEAR],
        rpm: f[b + F.RPM],
        throttle: f[b + F.THROTTLE],
        brake: f[b + F.BRAKE],
        steer: f[b + F.STEER],
        vehicleIndex: f[b + RACE_BASE + R.VEHICLE],
        bikeState: f[b + BIKE_BASE + B.STATE],
        crashes: f[b + BIKE_BASE + B.CRASHES],
        aiError: f[b + F.AI_ERROR_COUNT],
        delta: f[b + F.LAP_DELTA],
      };
    };
    const field = [];
    for (let i = 1; i < n; i++) field.push(car(i));
    return { sim, player: car(0), field };
  };
  window.__jr = s;
};

/** Cheap read for the driving loop: tapped worker frame + a few DOM strings. */
const READ_FAST = (P) => {
  const text = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
  const s = window.__jr;
  const out = {
    mode: document.getElementById('app')?.dataset.mode ?? null,
    modal: !!document.getElementById('modal')?.open,
    page: { frames: s.frames, maxGap: Math.round(s.maxGap), longTasks: s.longTasks, longMs: Math.round(s.longMs), longMax: Math.round(s.longMax), now: Math.round(performance.now()) },
    tapAgeMs: s.frame ? Math.round(performance.now() - s.frameAt) : null,
    hud: { speed: text('speed'), lap: text('lapLabel'), position: text('positionBadge'), flag: text('flag'), message: text('raceMessage') },
  };
  if (s.frame) Object.assign(out, s.info(s.frame, P));
  return out;
};

/** Everything the journeys read from the page in one call. */
const READ_STATE = (P) => {
  const { HEADER } = P;
  const text = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
  const d = window.apexDiagnostics();
  const f = d.frame;
  const app = document.getElementById('app');
  const loading = document.getElementById('loading');
  const modal = document.getElementById('modal');
  const out = {
    state: d.state,
    mode: app?.dataset.mode ?? null,
    options: d.options
      ? {
          mode: d.options.mode,
          circuit: d.options.circuit,
          laps: d.options.laps,
          opponents: d.options.opponents,
          vehicles: d.options.vehicles ?? null,
          weather: d.options.weather,
          assist: d.options.assist,
        }
      : null,
    auto: d.auto,
    usedDemonstration: d.usedDemonstration,
    presentationFrames: d.presentation?.frames ?? null,
    presentationElapsed: d.presentation?.elapsed ?? null,
    inputPolls: d.inputPolls,
    workerPause: d.workerPause,
    grid: d.gridPresentation,
    settingsBusy: d.settingsTransition?.busy ?? null,
    menuPreview: d.menuPreview
      ? { completedRevision: d.menuPreview.completedRevision, requested: d.menuPreview.requestedRevision }
      : null,
    timeTrial: d.timeTrial,
    page: {
      frames: window.__jr?.frames ?? 0,
      maxGap: Math.round(window.__jr?.maxGap ?? 0),
      longTasks: window.__jr?.longTasks ?? 0,
      longMs: Math.round(window.__jr?.longMs ?? 0),
      longMax: Math.round(window.__jr?.longMax ?? 0),
      now: Math.round(performance.now()),
    },
    ui: {
      menuVisible: !!document.getElementById('menu') && !document.getElementById('menu').hidden,
      hudVisible: !!document.getElementById('hud') && !document.getElementById('hud').hidden,
      loadingVisible: !!loading && !loading.hidden,
      loadingStage: text('loadingStage'),
      loadingPercent: text('loadingPercent'),
      loadingText: text('loadingText'),
      modalOpen: !!modal?.open,
      modalHeading: modal?.open ? (modal.querySelector('h2')?.textContent ?? '').trim() : null,
      briefing: !!document.getElementById('raceBriefing') && !document.getElementById('raceBriefing').hidden,
      toast: (() => {
        const t = document.getElementById('toast');
        return t && !t.hidden ? t.textContent : null;
      })(),
      error: document.querySelector('.error-screen, #errorScreen, .fatal')?.textContent?.trim() ?? null,
    },
    hud: {
      speed: text('speed'),
      gear: text('gear'),
      rpm: text('rpm'),
      lap: text('lapLabel'),
      position: text('positionBadge'),
      field: text('positionField'),
      flag: text('flag'),
      weather: text('weatherLabel'),
      lapTime: text('lapTime'),
      best: text('bestLap'),
      last: text('lastLap'),
      delta: text('lapDelta'),
      deltaLabel: text('lapDeltaLabel'),
      message: text('raceMessage'),
      start: text('startText'),
      camera: text('cameraLabel'),
      auto: text('autoLabel'),
    },
  };
  if (d.renderer) {
    const r = d.renderer;
    out.renderer = {
      fps: r.fps,
      frameMs: r.frameMs,
      p1FPS: r.p1FPS,
      renderCPUms: r.renderCPUms,
      drawCalls: r.drawCalls,
      triangles: r.triangles,
      textures: r.textures,
      geometries: r.geometries,
      purpose: r.presentationPurpose,
    };
  }
  if (f && f.length >= HEADER) Object.assign(out, window.__jr.info(f, P));
  return out;
};

// -------------------------------------------------------------------- the run
class Run {
  constructor() {
    this.inputs = { menu: 0, drive: 0, log: [] };
    this.snaps = [];
    this.shotIndex = 0;
    this.sessions = [];
    this.memory = [];
    this.driverCache = new Map();
  }
  async open() {
    this.browser = await chromium.launch({
      headless: true,
      executablePath: cfg.chromium,
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--no-sandbox',
        '--headless=new',
        '--enable-precise-memory-info',
      ],
    });
    this.context = await this.browser.newContext({
      viewport: { width: cfg.viewport[0], height: cfg.viewport[1] },
      deviceScaleFactor: 1,
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(180000);
    await this.page.addInitScript(INIT_SCRIPT);
    this.cdp = await this.context.newCDPSession(this.page);
    await this.cdp.send('Performance.enable');
    await this.cdp.send('HeapProfiler.enable');
    this.page.on('console', (m) => {
      const type = m.type();
      if (type === 'error' || type === 'warning' || type === 'assert') {
        const row = { t: Number(now().toFixed(1)), type, text: m.text().slice(0, 600), at: m.location()?.url?.split('/').pop() };
        consoleLog.push(row);
        if (type === 'error') say('console.error', { text: row.text.slice(0, 200) });
      }
    });
    this.page.on('pageerror', (e) => {
      consoleLog.push({ t: Number(now().toFixed(1)), type: 'pageerror', text: String(e.stack ?? e.message).slice(0, 1200) });
      say('PAGEERROR', { text: e.message.slice(0, 300) });
    });
    this.page.on('requestfailed', (r) => {
      const row = { t: Number(now().toFixed(1)), url: r.url().slice(0, 200), why: r.failure()?.errorText };
      requestFailures.push(row);
      say('requestfailed', row);
    });
    this.page.on('response', (r) => {
      if (r.status() >= 400) {
        const row = { t: Number(now().toFixed(1)), url: r.url().slice(0, 200), status: r.status() };
        requestFailures.push(row);
        say('http' + r.status(), row);
      }
    });
    this.page.on('crash', () => finding('blocker', 'browser', 'The page crashed'));
    this.page.on('worker', (w) => say('worker', { url: w.url().slice(0, 100) }));
    say('browser.open', { viewport: cfg.viewport, quality: cfg.quality ?? 'saved/default' });
  }
  // ---- inputs, counted
  async click(label, locator) {
    this.inputs.menu++;
    this.inputs.log.push(`${now().toFixed(1)}s click ${label}`);
    say('input.click', { n: this.inputs.menu, label });
    await locator.click();
  }
  async select(label, selector, value) {
    this.inputs.menu++;
    this.inputs.log.push(`${now().toFixed(1)}s select ${label}=${value}`);
    say('input.select', { n: this.inputs.menu, label, value });
    await this.page.selectOption(selector, value);
  }
  async key(label, code, count = true) {
    if (count) this.inputs.menu++;
    this.inputs.log.push(`${now().toFixed(1)}s key ${label}`);
    say('input.key', { label, code });
    await this.page.keyboard.press(code);
  }
  // ---- state reads
  async state() {
    return this.page.evaluate(READ_STATE, PROTO);
  }
  async fast() {
    return this.page.evaluate(READ_FAST, PROTO);
  }
  async cheap() {
    return this.page.evaluate(() => ({
      mode: document.getElementById('app')?.dataset.mode ?? null,
      menu: !!document.getElementById('menu') && !document.getElementById('menu').hidden,
      loading: !!document.getElementById('loading') && !document.getElementById('loading').hidden,
      loadingText: document.getElementById('loadingText')?.textContent ?? '',
      stage: document.getElementById('loadingStage')?.textContent ?? '',
      percent: document.getElementById('loadingPercent')?.textContent ?? '',
      modal: !!document.getElementById('modal')?.open,
      frames: window.__jr?.frames ?? 0,
      maxGap: Math.round(window.__jr?.maxGap ?? 0),
    }));
  }
  /** Poll until `done(cheap)` holds; log progress every 30 s; throw on timeout. */
  async until(label, done, timeoutS, intervalMs = 400) {
    const start = Date.now();
    let lastLog = start,
      last = null;
    for (;;) {
      last = await this.cheap();
      if (await done(last)) return { seconds: (Date.now() - start) / 1000, last };
      if ((Date.now() - start) / 1000 > timeoutS) {
        throw new Error(`Timed out after ${timeoutS}s waiting for ${label}: ${JSON.stringify(last)}`);
      }
      if (Date.now() - lastLog > 30000) {
        lastLog = Date.now();
        say('wait', { label, waited: Math.round((Date.now() - start) / 1000), mode: last.mode, stage: last.loadingText.slice(0, 60), percent: last.percent, rafFrames: last.frames, maxGapMs: last.maxGap });
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  async step(name, fn) {
    const start = Date.now();
    say('step.begin', { name });
    try {
      const result = await fn();
      say('step.end', { name, seconds: Number(((Date.now() - start) / 1000).toFixed(1)) });
      return result;
    } catch (error) {
      finding('blocker', name, `Step failed: ${String(error.message ?? error).slice(0, 400)}`);
      await this.shot(`FAIL-${name}`).catch((e) => say('shot.failed', { why: String(e.message).slice(0, 120) }));
      throw error;
    }
  }
  async shot(name) {
    if (!cfg.shots) return null;
    const file = `${String(++this.shotIndex).padStart(2, '0')}-${name.replace(/[^a-z0-9-]+/gi, '_')}.png`;
    const start = Date.now();
    await this.page.screenshot({ path: join(cfg.out, file), timeout: 240000 });
    say('screenshot', { file, ms: Date.now() - start });
    return file;
  }
  // ---- memory
  async memorySample(label) {
    await this.cdp.send('HeapProfiler.collectGarbage');
    const heap = await this.cdp.send('Runtime.getHeapUsage');
    const metrics = Object.fromEntries((await this.cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const st = await this.state().catch(() => null);
    const row = {
      label,
      t: Number(now().toFixed(1)),
      jsHeapMB: Number((heap.usedSize / 1048576).toFixed(1)),
      jsHeapTotalMB: Number((heap.totalSize / 1048576).toFixed(1)),
      nodes: metrics.Nodes,
      listeners: metrics.JSEventListeners,
      documents: metrics.Documents,
      rssMB: this.rssMB(),
      textures: st?.renderer?.textures ?? null,
      geometries: st?.renderer?.geometries ?? null,
    };
    this.memory.push(row);
    say('memory', row);
    return row;
  }
  /** Cumulative CPU ticks of this browser's processes by kind (gpu / renderer / browser / utility). */
  cpuTicks() {
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((l) => l.trim().split(/\s+/).map(Number));
    const keep = new Set([process.pid]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [pid, ppid] of rows)
        if (keep.has(ppid) && !keep.has(pid)) {
          keep.add(pid);
          grew = true;
        }
    }
    const out = { gpu: 0, renderer: 0, utility: 0, browser: 0 };
    for (const pid of keep) {
      if (pid === process.pid) continue;
      let stat, cmd;
      try {
        stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      } catch {
        continue; // the process exited between ps and the read
      }
      const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const ticks = Number(f[11]) + Number(f[12]); // utime + stime
      const kind = /--type=gpu-process/.test(cmd) ? 'gpu' : /--type=renderer/.test(cmd) ? 'renderer' : /--type=/.test(cmd) ? 'utility' : 'browser';
      out[kind] += ticks;
    }
    return out;
  }
  /** Sum of resident set sizes of this browser's process tree. */
  rssMB() {
    try {
      const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .map((l) => l.trim().split(/\s+/).map(Number));
      // chromium.launch() does not expose the browser pid: this tool's own process
      // tree is exactly its browser (other agents' browsers are not descendants).
      const root = process.pid;
      const keep = new Set([root]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const [pid, ppid] of rows)
          if (keep.has(ppid) && !keep.has(pid)) {
            keep.add(pid);
            grew = true;
          }
      }
      let kb = 0;
      for (const [pid, , rss] of rows) if (keep.has(pid)) kb += rss;
      return Math.round(kb / 1024);
    } catch (error) {
      say('rss.unavailable', { why: String(error.message).slice(0, 80) });
      return null;
    }
  }
  // ---- boot
  async boot() {
    const nav = Date.now();
    await this.step('boot', async () => {
      await this.page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 300000 });
      const domMs = Date.now() - nav;
      say('boot.domcontentloaded', { ms: domMs });
      await this.until('menu visible', (c) => c.menu && c.mode === 'menu', cfg.bootTimeoutS, 500);
      const paint = await this.page.evaluate(() =>
        Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, Math.round(e.startTime)])),
      );
      // First rendered frame of the menu preview.
      await this.until('first menu frame', async () => {
        const s = await this.state();
        return (s.presentationFrames ?? 0) > 0 || (s.menuPreview?.completedRevision ?? -1) >= 0;
      }, 600, 1000);
      this.bootInfo = {
        timeToMenuS: Number(((Date.now() - nav) / 1000).toFixed(1)),
        timeToFirstMenuFrameS: Number(((Date.now() - nav) / 1000).toFixed(1)),
        paint,
        domContentLoadedMs: domMs,
      };
      say('boot.done', this.bootInfo);
    });
    await this.shot('menu-boot');
    await this.memorySample('menu-after-boot');
  }
  /** Garage & settings -> quality select -> APPLY & SAVE, through the real UI. */
  async setQuality(quality) {
    await this.step(`quality-${quality}`, async () => {
      const start = Date.now();
      await this.click('GARAGE & SETTINGS', this.page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }));
      await this.page.locator('[name=quality]').waitFor({ state: 'visible' });
      await this.select('quality', '[name=quality]', quality);
      await this.click('APPLY & SAVE', this.page.getByRole('button', { name: 'APPLY & SAVE', exact: true }));
      await this.until('settings applied', async (c) => !c.modal && c.mode === 'menu', 900, 500);
      const s = await this.state();
      say('quality.applied', { quality, seconds: (Date.now() - start) / 1000, busy: s.settingsBusy });
      this.qualityApplied = quality;
    });
  }
  /** Set the menu form like a player and read every control back. */
  async configure(spec) {
    await this.step('configure', async () => {
      if (spec.discipline) {
        const plate = this.page.locator(`.lb-plate[data-discipline="${spec.discipline}"]`);
        await this.click(`plate ${spec.discipline}`, plate);
      }
      for (const key of ['circuit', 'vehicle', 'mode', 'laps', 'weather', 'compound', 'assist', 'opponents', 'startSlot']) {
        if (spec[key] === undefined) continue;
        const el = this.page.locator(`#${key}`);
        if (!(await el.count())) {
          finding('major', 'configure', `Menu control #${key} is missing`);
          continue;
        }
        const exists = await el.evaluate((node, v) => [...node.options].some((o) => o.value === String(v)), spec[key]);
        if (!exists) {
          finding('major', 'configure', `Menu control #${key} has no option "${spec[key]}"`);
          continue;
        }
        const current = await el.inputValue();
        if (current !== String(spec[key])) await this.select(key, `#${key}`, String(spec[key]));
      }
      const read = await this.page.evaluate(() =>
        Object.fromEntries(
          ['circuit', 'vehicle', 'mode', 'laps', 'weather', 'compound', 'assist', 'opponents', 'startSlot'].map((k) => [k, document.getElementById(k)?.value ?? null]),
        ),
      );
      say('configured', read);
      this.configured = read;
      for (const [k, v] of Object.entries(spec))
        if (k !== 'discipline' && read[k] !== String(v))
          finding('major', 'configure', `Menu control #${k} reads "${read[k]}" after setting "${v}" (a later control overrode it)`, { read, spec });
      this.sessionRules = await this.page.evaluate(() => document.getElementById('sessionRules')?.textContent?.trim() ?? '');
      if (this.sessionRules) say('sessionRules', { text: this.sessionRules.slice(0, 200) });
    });
    await this.shot('configured');
  }
  /** Press ENTER, take the briefing if it appears, wait for driving. */
  async enter(label) {
    const session = { label, startedAt: now() };
    this.sessions.push(session);
    await this.step(`enter-${label}`, async () => {
      const t = Date.now();
      if (cfg.profile) {
        await this.cdp.send('Profiler.enable');
        await this.cdp.send('Profiler.setSamplingInterval', { interval: 5000 });
        await this.cdp.send('Profiler.start');
      }
      await this.click('ENTER', this.page.getByRole('button', { name: /^ENTER (CIRCUIT|FESTIVAL)/ }).first());
      let briefing = false;
      await this.until('briefing or driving', async (c) => {
        if (c.mode === 'driving') return true;
        const b = this.page.getByRole('button', { name: /GO STRAIGHT TO LIGHTS|GO TO THE GATE/ });
        if (await b.isVisible().catch(() => false)) {
          briefing = true;
          await this.click('briefing: GO STRAIGHT TO LIGHTS', b.first());
          return false;
        }
        return false;
      }, cfg.startTimeoutS, 700);
      session.briefing = briefing;
      session.timeToDrivingS = Number(((Date.now() - t) / 1000).toFixed(1));
      // First presented frame of the session.
      const before = (await this.state()).presentationFrames ?? 0;
      await this.until('first session frame', async () => ((await this.state()).presentationFrames ?? 0) > before, 600, 700);
      session.timeToFirstFrameS = Number(((Date.now() - t) / 1000).toFixed(1));
      if (cfg.profile) {
        const { profile } = await this.cdp.send('Profiler.stop');
        session.profile = summariseProfile(profile);
        await writeFile(join(cfg.out, `cpu-session-${label}.cpuprofile.gz`), gzipSync(JSON.stringify(profile)));
        say('session.profile', { totalMs: session.profile.totalMs, idlePct: session.profile.idlePct, files: session.profile.files.slice(0, 6), top: session.profile.top.slice(0, 8) });
      }
      say('session.started', session);
    });
    await this.shot(`${label}-first-frame`);
  }
  // ---- driving
  driverFor(circuit, vehicle) {
    const key = `${circuit}/${vehicle}`;
    if (!this.driverCache.has(key)) {
      const track = new Track('clear', false, undefined, circuitDefinition(circuit));
      this.driverCache.set(key, { track, driver: new KeyboardDriver(track, this.driverOptions ?? {}) });
    }
    return this.driverCache.get(key);
  }
  /**
   * Drive with the keyboard until `simSeconds` of simulation time have passed or
   * the session ends. `fallback`: after sustained off-track/stuck time switch the
   * game's own AI DRIVER on (recorded as a finding, never hidden).
   */
  async drive({ simSeconds, label, wallTimeoutS = 1800, fallback = true, bike = false, stopAtResults = false }) {
    const stats = { label, rows: [], offTrackS: 0, stuckS: 0, maxKph: 0, keyEvents: 0, fallbackAt: null, ended: null };
    const held = new Set();
    const codes = { left: 'KeyA', right: 'KeyD', throttle: 'KeyW', brake: 'KeyS' };
    const setKeys = async (want) => {
      for (const [name, code] of Object.entries(codes)) {
        const on = !!want[name];
        if (on && !held.has(name)) {
          held.add(name);
          stats.keyEvents++;
          await this.page.keyboard.down(code);
        } else if (!on && held.has(name)) {
          held.delete(name);
          stats.keyEvents++;
          await this.page.keyboard.up(code);
        }
      }
    };
    await this.step(`drive-${label}`, async () => {
      const wallStart = Date.now();
      const first = await this.state();
      let simStart = null,
        lastWall = Date.now(),
        lastLog = 0,
        offRun = 0,
        stuckRun = 0,
        lastRow = -1,
        lastTick = -1,
        rowFrames = 0,
        rowWall = Date.now(),
        // The AI DRIVER is a toggle that outlives this call: read its real state so a
        // later fallback never switches it OFF by pressing G a second time.
        auto = !!first.auto;
      let current = first;
      for (;;) {
        if (stats.ended) break;
        const wallS = (Date.now() - wallStart) / 1000;
        if (wallS > wallTimeoutS) {
          stats.ended = 'wall-timeout';
          break;
        }
        current = await this.fast();
        if (current.mode === 'results') {
          stats.ended = 'results';
          break;
        }
        if (current.mode !== 'driving' && current.mode !== 'paused') {
          stats.ended = `mode-${current.mode}`;
          break;
        }
        const p = current.player;
        if (!p || !current.sim) {
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        // No new snapshot since the last decision: nothing to decide on.
        if (current.sim.tick === lastTick) {
          await new Promise((r) => setTimeout(r, 20));
          continue;
        }
        lastTick = current.sim.tick;
        if (current.sim.nonFinite) finding('major', 'sim', `Non-finite values in the snapshot (${current.sim.nonFinite})`, { t: current.sim.time });
        const racing = current.sim.phase === 2;
        if (racing && simStart === null) simStart = current.sim.time;
        if (simStart !== null && current.sim.time - simStart >= simSeconds && !stopAtResults) {
          stats.ended = 'sim-seconds';
          break;
        }
        const options = first.options ?? { circuit: 'aurel', vehicles: null };
        const vehicle = options.vehicles?.[0] ?? this.configured?.vehicle ?? 'apx01';
        const { track, driver } = this.driverFor(options.circuit, vehicle);
        const nowWall = Date.now();
        const dt = Math.min(0.25, (nowWall - lastWall) / 1000);
        lastWall = nowWall;
        let want = { left: false, right: false, throttle: false, brake: false };
        if (racing && !auto) {
          const [fx, fz] = headingOf(...p.q);
          const k = driver.decide({ x: p.x, z: p.z, fx, fz, speed: p.speed, s: p.s }, dt);
          want = k;
        } else if (!racing) {
          driver.est = 0;
        }
        await setKeys(want);
        // Track sanity for this sample.
        const half = track.at(p.s, {}).width / 2;
        const kph = p.speed * 3.6;
        stats.maxKph = Math.max(stats.maxKph, kph);
        if (racing) {
          if (Math.abs(p.lat) > half + 0.3) {
            offRun += dt;
            stats.offTrackS += dt;
          } else offRun = 0;
          if (p.speed < 2 && current.sim.time - (simStart ?? 0) > 6) {
            stuckRun += dt;
            stats.stuckS += dt;
          } else stuckRun = 0;
        }
        if (fallback && !auto && (offRun > 12 || stuckRun > 10)) {
          finding(
            bike ? 'minor' : 'major',
            'keyboard-driver',
            `Keyboard driver ${offRun > 12 ? 'off the track edge' : 'stationary'} for >10 s at t=${current.sim.time.toFixed(0)} s; switching on the in-game AI DRIVER (G)`,
            { player: p },
          );
          await setKeys({});
          await this.key('AI DRIVER (G)', 'KeyG', false);
          auto = true;
          stats.fallbackAt = Number(current.sim.time.toFixed(1));
        }
        if (Date.now() - lastRow >= 1000) {
          lastRow = Date.now();
          const rafFps = ((current.page.frames - rowFrames) * 1000) / Math.max(1, Date.now() - rowWall);
          rowFrames = current.page.frames;
          rowWall = Date.now();
          stats.rows.push({
            wall: Number(((Date.now() - wallStart) / 1000).toFixed(1)),
            sim: Number(current.sim.time.toFixed(2)),
            tick: current.sim.tick,
            phase: current.sim.phase,
            kph: Math.round(kph),
            hudSpeed: current.hud.speed,
            lap: p.laps,
            hudLap: current.hud.lap,
            s: Math.round(p.s),
            lat: Number(p.lat.toFixed(1)),
            rank: p.rank,
            hudPos: current.hud.position,
            rafFps: Number(rafFps.toFixed(2)),
            tapAgeMs: current.tapAgeMs,
            keys: [...held].map((k) => k[0].toUpperCase()).join(''),
            dropped: current.sim.dropped,
          });
        }
        if (Date.now() - lastLog > 15000) {
          lastLog = Date.now();
          say('driving', { sim: Number(current.sim.time.toFixed(1)), kph: Math.round(kph), lap: p.laps, rank: p.rank, s: Math.round(p.s), lat: Number(p.lat.toFixed(1)), keys: [...held].map((k) => k[0].toUpperCase()).join(''), rafFps: Number(((current.page.frames - rowFrames) * 1000 / Math.max(1, Date.now() - rowWall)).toFixed(2)), auto });
        }
        this.lastDriving = current;
        await new Promise((r) => setTimeout(r, 40));
      }
      await setKeys({});
      this.inputs.drive += stats.keyEvents;
      stats.simElapsed = simStart === null ? 0 : Number(((this.lastDriving?.sim?.time ?? 0) - simStart).toFixed(1));
      stats.wallS = Number(((Date.now() - wallStart) / 1000).toFixed(1));
      stats.offTrackS = Number(stats.offTrackS.toFixed(1));
      stats.stuckS = Number(stats.stuckS.toFixed(1));
      stats.maxKph = Math.round(stats.maxKph);
      stats.realTimeFactor = stats.wallS > 0 ? Number((stats.simElapsed / stats.wallS).toFixed(2)) : null;
      say('drive.done', { label, ended: stats.ended, simElapsed: stats.simElapsed, wallS: stats.wallS, rtf: stats.realTimeFactor, maxKph: stats.maxKph, offTrackS: stats.offTrackS, stuckS: stats.stuckS, keyEvents: stats.keyEvents });
    });
    this.analyseDrive(stats);
    return stats;
  }
  /** Machine-checked sanity of a driving trace: speed, lap, AI behaviour. */
  analyseDrive(stats) {
    const last = this.lastDriving;
    if (!last?.sim) return;
    const rows = stats.rows;
    // Lap counter and HUD agree; laps never go backwards.
    let lastLap = -1;
    for (const r of rows) {
      if (r.lap < lastLap) {
        finding('major', 'lap-sanity', `Lap counter went backwards (${lastLap} -> ${r.lap}) at sim ${r.sim}s`, { r });
        break;
      }
      lastLap = r.lap;
    }
    // The HUD is drawn once per presented frame: below ~2 fps it lags the simulation
    // by whole seconds, so only compare rows measured on a page that was drawing.
    const live = rows.filter((r) => r.rafFps >= 2 && r.hudSpeed !== null);
    const hudMismatch = live.filter((r) => Math.abs(Number(r.hudSpeed) - r.kph) > Math.max(15, r.kph * 0.1));
    if (!live.length) say('hud-speed.inconclusive', { rows: rows.length, reason: 'page below 2 fps for the whole drive' });
    else if (hudMismatch.length > Math.max(2, live.length * 0.2))
      finding('minor', 'hud-speed', `HUD speed disagrees with the simulation speed in ${hudMismatch.length}/${live.length} samples measured at >= 2 fps`, { example: hudMismatch[0] });
    if (stats.maxKph > 420) finding('major', 'speed-sanity', `Player speed reached ${stats.maxKph} km/h`, { max: stats.maxKph });
    // Frame-time stalls on the page (main thread).
    const f = last.page;
    if (f.maxGap > 5000) say('page.stall', { maxGapMs: f.maxGap, longTasks: f.longTasks, longMs: f.longMs });
    // AI behaviour: every rival moved, none stationary, none overlapping the player.
    if (last.field?.length) {
      // A car that has taken the flag may park; only a car still racing must not sit still.
      const still = last.field.filter((c) => c.speed < 1 && !c.retired && !(c.finish > 0) && last.sim.phase === 2 && last.sim.time > 25);
      if (still.length) finding('major', 'ai', `${still.length} AI car(s) stationary but not retired: ids ${still.map((c) => c.id).join(',')}`, { still });
      const near = last.field.filter((c) => Math.hypot(c.x - last.player.x, c.z - last.player.z) < 0.8);
      if (near.length) finding('major', 'ai', `AI car(s) overlap the player's position (<0.8 m): ids ${near.map((c) => c.id).join(',')}`, { near });
      const ranks = [last.player.rank, ...last.field.map((c) => c.rank)].sort((a, b) => a - b);
      const unique = new Set(ranks).size === ranks.length;
      if (!unique) finding('major', 'ranking', 'Duplicate race positions in the snapshot', { ranks });
    }
  }
  // ---- pause / resume
  async pauseResume() {
    const out = {};
    await this.step('pause-resume', async () => {
      const before = await this.state();
      let t = Date.now();
      await this.key('ESC (pause)', 'Escape');
      await this.until('paused', (c) => c.mode === 'paused', 120, 150);
      out.pauseLatencyMs = Date.now() - t;
      await this.until('pause modal', (c) => c.modal, 60, 150);
      // The UI state flips before the worker acknowledges the pause barrier: wait for
      // the handshake, then require the clock to stand still for three seconds.
      let acknowledged = null;
      for (let i = 0; i < 60; i++) {
        const w = (await this.state()).workerPause;
        if (w?.paused && !w?.pending) {
          acknowledged = w;
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      out.workerAcknowledgedPause = acknowledged;
      if (!acknowledged) finding('major', 'pause', 'The physics worker never acknowledged the pause (workerPause stays pending)');
      const p1 = await this.state();
      await new Promise((r) => setTimeout(r, 3000));
      const p2 = await this.state();
      out.paused = {
        simBefore: before.sim?.time,
        simAtPause: p1.sim?.time,
        simAfter3s: p2.sim?.time,
        tickAtPause: p1.sim?.tick,
        tickAfter3s: p2.sim?.tick,
        workerPause: p2.workerPause,
        modalHeading: p2.ui.modalHeading,
        speedAtPause: p1.player ? Number((p1.player.speed * 3.6).toFixed(1)) : null,
        speedAfter3s: p2.player ? Number((p2.player.speed * 3.6).toFixed(1)) : null,
        posAtPause: p1.player ? [p1.player.x, p1.player.z] : null,
        posAfter3s: p2.player ? [p2.player.x, p2.player.z] : null,
      };
      if (p1.sim && p2.sim && (p2.sim.tick !== p1.sim.tick || Math.abs(p2.sim.time - p1.sim.time) > 0.02))
        finding('major', 'pause', `Simulation advanced while paused (tick ${p1.sim.tick} -> ${p2.sim.tick}, time ${p1.sim.time.toFixed(3)} -> ${p2.sim.time.toFixed(3)})`, out.paused);
      if (p1.player && p2.player && Math.hypot(p1.player.x - p2.player.x, p1.player.z - p2.player.z) > 0.05)
        finding('major', 'pause', 'Player moved while paused', out.paused);
      const buttons = await this.page.evaluate(() => [...document.querySelectorAll('#modal button')].map((b) => b.textContent.trim()));
      out.pauseButtons = buttons;
      for (const need of ['RESUME SESSION', 'RESTART SESSION', 'RETURN TO PADDOCK'])
        if (!buttons.includes(need)) finding('major', 'pause', `Pause menu is missing "${need}"`, { buttons });
      await this.shot('paused');
      // Resume with the button.
      t = Date.now();
      await this.click('RESUME SESSION', this.page.getByRole('button', { name: 'RESUME SESSION', exact: true }));
      await this.until('driving after resume', (c) => c.mode === 'driving' && !c.modal, 120, 150);
      out.resumeLatencyMs = Date.now() - t;
      const r1 = await this.state();
      await new Promise((r) => setTimeout(r, 2500));
      const r2 = await this.state();
      const wall = 2.5;
      out.resumed = { simAdvanced: r2.sim && r1.sim ? Number((r2.sim.time - r1.sim.time).toFixed(2)) : null, wall, jumpAtResume: r1.sim && p2.sim ? Number((r1.sim.time - p2.sim.time).toFixed(3)) : null };
      if (out.resumed.simAdvanced !== null && out.resumed.simAdvanced > wall + 1.0)
        finding('major', 'resume', `Simulation advanced ${out.resumed.simAdvanced}s in ${wall}s after resume (catch-up jump)`, out.resumed);
      if (out.resumed.simAdvanced !== null && out.resumed.simAdvanced < 0.2)
        finding('major', 'resume', `Simulation did not advance after resume (${out.resumed.simAdvanced}s in ${wall}s)`, out.resumed);
      if (out.resumed.jumpAtResume !== null && out.resumed.jumpAtResume > 0.5)
        finding('major', 'resume', `Simulation clock jumped ${out.resumed.jumpAtResume}s between pause and the first resumed snapshot`, out.resumed);
      await this.shot('resumed');
      // Pause again and resume with ESC (the other documented route).
      await this.key('ESC (pause 2)', 'Escape');
      await this.until('paused again', (c) => c.mode === 'paused', 120, 150);
      await this.key('ESC (resume 2)', 'Escape');
      const second = await this.until('driving after ESC resume', (c) => c.mode === 'driving', 60, 150).catch((e) => {
        finding('major', 'resume', 'ESC does not resume a paused session (the pause menu stays open)', { error: String(e.message).slice(0, 200) });
        return null;
      });
      out.escResume = second ? 'resumed' : 'did-not-resume';
      if (!second) {
        await this.click('RESUME SESSION (fallback)', this.page.getByRole('button', { name: 'RESUME SESSION', exact: true }));
        await this.until('driving after fallback resume', (c) => c.mode === 'driving', 60, 150);
      }
    });
    return out;
  }
  // ---- results
  async readResults() {
    return this.page.evaluate(() => {
      const modal = document.getElementById('modal');
      const table = modal?.querySelector('table.results');
      const rows = table ? [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())) : [];
      return {
        open: !!modal?.open,
        heading: modal?.querySelector('h2')?.textContent?.trim() ?? null,
        eyebrow: modal?.querySelector('.eyebrow')?.textContent?.trim() ?? null,
        head: table ? [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : [],
        rows,
        buttons: modal ? [...modal.querySelectorAll('button')].map((b) => b.textContent.trim()) : [],
        text: (modal?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 600),
      };
    });
  }
  async finishAndCheckResults(expect) {
    const out = {};
    await this.step('results', async () => {
      await this.until('results screen', (c) => c.mode === 'results' && c.modal, 300, 400);
      await new Promise((r) => setTimeout(r, 1500));
      const s = await this.state();
      const res = await this.readResults();
      out.screen = res;
      out.final = { sim: s.sim, player: s.player, field: s.field };
      say('results', { heading: res.heading, rows: res.rows.length, buttons: res.buttons });
      await this.shot('results');
      if (!res.rows.length) finding('major', 'results', 'Results screen has no classification rows', { res });
      const expectRows = expect.cars;
      if (res.rows.length && res.rows.length !== expectRows)
        finding('major', 'results', `Results table shows ${res.rows.length} rows for ${expectRows} cars`, { rows: res.rows });
      const pos = res.rows.map((r) => Number(r[0]));
      if (pos.some((p, i) => p !== i + 1)) finding('major', 'results', 'Results positions are not 1..N in order', { pos });
      // Laps column against the simulation, and the ordering rule printed on the card.
      const lapsCol = res.rows.map((r) => Number(r[2]));
      for (let i = 1; i < lapsCol.length; i++)
        if (lapsCol[i] > lapsCol[i - 1]) {
          finding('major', 'results', `Row ${i + 1} completed more laps (${lapsCol[i]}) than the row above (${lapsCol[i - 1]}): classification order is wrong`, { rows: res.rows });
          break;
        }
      const parse = (t) => {
        const m = /^(\d+):(\d+\.\d+)/.exec(t ?? '');
        return m ? Number(m[1]) * 60 + Number(m[2]) : null;
      };
      for (let i = 1; i < res.rows.length; i++) {
        const a = parse(res.rows[i - 1][3]),
          b = parse(res.rows[i][3]);
        if (a !== null && b !== null && lapsCol[i] === lapsCol[i - 1] && b + 0.001 < a) {
          finding('major', 'results', `Row ${i + 1} (${res.rows[i][3]}) is faster than row ${i} (${res.rows[i - 1][3]}) on the same laps: ordering by time is wrong`, { rows: res.rows });
          break;
        }
      }
      if (expect.laps) {
        const finishers = res.rows.filter((r) => /^\d+:\d+/.test(r[3]));
        if (finishers.length && !finishers.some((r) => Number(r[2]) === expect.laps))
          finding('major', 'results', `No row shows the full ${expect.laps} laps`, { rows: res.rows });
      }
      if (!res.buttons.includes('PADDOCK')) finding('major', 'results', 'Results card has no PADDOCK button', { buttons: res.buttons });
      if (s.player) {
        const bestHud = res.rows[0] ? res.rows[0][4] : null;
        out.winnerBest = bestHud;
      }
    });
    return out;
  }
  async exitToMenu(via) {
    const t = Date.now();
    await this.step('exit-to-menu', async () => {
      const name = via === 'pause' ? 'RETURN TO PADDOCK' : 'PADDOCK';
      await this.click(name, this.page.getByRole('button', { name, exact: true }));
      await this.until('menu', (c) => c.mode === 'menu' && c.menu && !c.loading, 300, 400);
      const before = (await this.state()).presentationFrames ?? 0;
      await this.until('menu frame after exit', async () => ((await this.state()).presentationFrames ?? 0) > before, 300, 500).catch((e) => {
        finding('minor', 'menu-return', 'No new presented frame after returning to the menu', { error: String(e.message).slice(0, 200) });
      });
    });
    const secs = Number(((Date.now() - t) / 1000).toFixed(1));
    this.sessions.at(-1).timeToMenuAfterExitS = secs;
    say('exit.done', { seconds: secs });
    await this.shot('menu-after-exit');
    const s = await this.state();
    if (s.ui.hudVisible) finding('major', 'menu-return', 'HUD still visible after returning to the paddock', { ui: s.ui });
    if (s.ui.modalOpen) finding('major', 'menu-return', 'A modal is still open after returning to the paddock', { ui: s.ui });
  }
  async close() {
    await this.browser?.close().catch((e) => say('browser.close.failed', { why: String(e.message).slice(0, 100) }));
  }
}

// ------------------------------------------------------------------ journeys
const JOURNEY_FNS = {
  async 'formula-practice'(run) {
    await run.boot();
    if (cfg.quality) await run.setQuality(cfg.quality);
    await run.configure({ circuit: 'aurel', vehicle: 'apx01', mode: 'practice', weather: 'clear', opponents: 0 });
    await run.enter('practice-1');
    const d1 = await run.drive({ simSeconds: cfg.simSeconds, label: 'practice-1' });
    const pr = await run.pauseResume();
    const d1b = await run.drive({ simSeconds: 8, label: 'practice-1-after-resume' });
    await run.key('ESC (pause to exit)', 'Escape');
    await run.until('paused', (c) => c.mode === 'paused', 120, 200);
    await run.exitToMenu('pause');
    await run.memorySample('menu-after-session-1');
    await run.configure({ circuit: 'aurel', mode: 'practice', opponents: 0 });
    await run.enter('practice-2');
    const d2 = await run.drive({ simSeconds: cfg.secondSimSeconds, label: 'practice-2' });
    await run.key('ESC (pause to exit)', 'Escape');
    await run.until('paused', (c) => c.mode === 'paused', 120, 200);
    await run.exitToMenu('pause');
    await run.memorySample('menu-after-session-2');
    return { drives: [d1, d1b, d2], pause: pr };
  },
  async 'formula-race'(run) {
    await run.boot();
    if (cfg.quality) await run.setQuality(cfg.quality);
    await run.configure({ circuit: 'arroyo-oro', vehicle: 'apx01', mode: 'race', laps: 3, opponents: 3, weather: 'clear' });
    await run.enter('race-1');
    const d1 = await run.drive({ simSeconds: cfg.simSeconds, label: 'race-1-opening' });
    const pr = await run.pauseResume();
    const d2 = await run.drive({ simSeconds: 1e9, label: 'race-1-to-finish', stopAtResults: true, wallTimeoutS: 1500 });
    const res = await run.finishAndCheckResults({ cars: 4, laps: 3 });
    await run.exitToMenu('results');
    await run.memorySample('menu-after-session-1');
    await run.configure({ circuit: 'arroyo-oro', mode: 'race', laps: 1, opponents: 3 });
    await run.enter('race-2');
    const d3 = await run.drive({ simSeconds: cfg.secondSimSeconds, label: 'race-2' });
    await run.key('ESC (pause to exit)', 'Escape');
    await run.until('paused', (c) => c.mode === 'paused', 120, 200);
    await run.exitToMenu('pause');
    await run.memorySample('menu-after-session-2');
    return { drives: [d1, d2, d3], pause: pr, results: res };
  },
  async 'time-trial'(run) {
    await run.boot();
    if (cfg.quality) await run.setQuality(cfg.quality);
    // A personal-best ghost, stored exactly as the application does (IndexedDB), like e2e/47.
    await run.step('seed-ghost', async () => {
      const { Simulation } = await load('src/simulation/world.ts');
      const { DEFAULT_OPTIONS } = await load('src/simulation/config.ts');
      const { GHOST_FIELDS, GhostRecorder, ghostKey } = await load('src/core/ghost-lap.ts');
      const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'time-trial', opponents: 0 });
      const recorder = new GhostRecorder({ circuit: 'aurel', trackLength: sim.track.length, assist: 'sport', compound: 'medium', weather: 'clear' });
      const frame = new Float32Array(HEADER + CAR_STRIDE);
      let lap = null;
      for (let tick = 0; tick < 120 * 240 && !lap; tick++) {
        sim.ai[0].update(1 / 120, sim.track, sim.cars, sim.race);
        sim.step(1 / 120);
        if (tick % 2) continue;
        sim.writeFrame(frame);
        lap = recorder.observe(frame, true);
      }
      if (!lap) throw new Error('Could not record a ghost lap');
      for (let i = 0; i < lap.samples.length; i += GHOST_FIELDS) lap.samples[i] *= 0.97;
      lap.lapTime *= 0.97;
      lap.sectors = lap.sectors.map((x) => x * 0.97);
      await run.page.evaluate(
        async ({ key, meta, samples }) => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('apex-formula', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('saved');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          await new Promise((resolve, reject) => {
            const tx = db.transaction('saved', 'readwrite');
            tx.objectStore('saved').put({ ...meta, samples: new Float32Array(samples) }, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          db.close();
        },
        { key: ghostKey('aurel'), meta: { ...lap, samples: [] }, samples: Array.from(lap.samples) },
      );
      run.ghostLap = lap.lapTime;
      say('ghost.seeded', { lapTime: lap.lapTime });
    });
    await run.configure({ circuit: 'aurel', vehicle: 'apx01', mode: 'time-trial', weather: 'clear' });
    await run.enter('trial-1');
    const s0 = await run.state();
    if (Math.abs((s0.timeTrial?.ghostLap ?? 0) - run.ghostLap) > 0.01)
      finding('major', 'time-trial', `Ghost lap not loaded (diag ${s0.timeTrial?.ghostLap}, stored ${run.ghostLap})`, { tt: s0.timeTrial });
    const d1 = await run.drive({ simSeconds: Math.max(cfg.simSeconds, 30), label: 'trial-1' });
    const s1 = await run.state();
    const tt = { hud: s1.hud, ghostVisible: s1.timeTrial?.ghostVisible, delta: s1.timeTrial?.delta };
    say('time-trial.hud', tt);
    if (s1.hud.deltaLabel && !/PB|BEST/.test(s1.hud.deltaLabel)) finding('minor', 'time-trial', `Delta label is "${s1.hud.deltaLabel}"`, tt);
    const pr = await run.pauseResume();
    await run.key('ESC (pause to exit)', 'Escape');
    await run.until('paused', (c) => c.mode === 'paused', 120, 200);
    await run.exitToMenu('pause');
    await run.memorySample('menu-after-session-1');
    await run.configure({ circuit: 'aurel', mode: 'time-trial' });
    await run.enter('trial-2');
    const d2 = await run.drive({ simSeconds: cfg.secondSimSeconds, label: 'trial-2' });
    await run.key('ESC (pause to exit)', 'Escape');
    await run.until('paused', (c) => c.mode === 'paused', 120, 200);
    await run.exitToMenu('pause');
    await run.memorySample('menu-after-session-2');
    return { drives: [d1, d2], pause: pr, timeTrial: tt };
  },
  async 'gp-race'(run) {
    run.driverOptions = { gLat: 8, brake: 9, steerGain: 1.0, steerRate: 0.4, lookBase: 10, lookGain: 0.5 };
    await run.boot();
    if (cfg.quality) await run.setQuality(cfg.quality);
    await run.configure({ discipline: 'gp', circuit: 'kansai-east', vehicle: 'gpr1', mode: 'race', laps: 3, opponents: 3, weather: 'clear' });
    await run.enter('gp-1');
    const d1 = await run.drive({ simSeconds: cfg.simSeconds, label: 'gp-1-opening', bike: true });
    const pr = await run.pauseResume();
    const d2 = await run.drive({ simSeconds: 1e9, label: 'gp-1-to-finish', stopAtResults: true, wallTimeoutS: 1500, bike: true });
    const res = await run.finishAndCheckResults({ cars: 4, laps: 3 });
    await run.exitToMenu('results');
    await run.memorySample('menu-after-session-1');
    await run.configure({ circuit: 'kansai-east', vehicle: 'gpr1', mode: 'race', laps: 1, opponents: 3 });
    await run.enter('gp-2');
    const d3 = await run.drive({ simSeconds: cfg.secondSimSeconds, label: 'gp-2', bike: true });
    await run.key('ESC (pause to exit)', 'Escape');
    await run.until('paused', (c) => c.mode === 'paused', 120, 200);
    await run.exitToMenu('pause');
    await run.memorySample('menu-after-session-2');
    return { drives: [d1, d2, d3], pause: pr, results: res };
  },
  async wildcard(run) {
    const { wildcardEntry, wildcardSession } = await load('src/career/wildcard-series.ts');
    const entry = wildcardEntry(cfg.wildcardId);
    if (!entry) throw new Error(`Unknown wildcard event ${cfg.wildcardId}`);
    const session = wildcardSession(entry);
    say('wildcard.session', { id: entry.id, title: entry.title, options: { circuit: session.circuit, mode: session.mode, laps: session.laps, opponents: session.opponents, vehicles: session.vehicles, weather: session.weather, assist: session.assist } });
    await run.boot();
    if (cfg.quality) await run.setQuality(cfg.quality);
    // Is the series reachable from the menu? Record what the front end offers.
    const seriesUi = await run.page.evaluate(() => ({
      boardSeries: document.getElementById('boardSeries')?.hidden === false,
      chips: [...document.querySelectorAll('#boardSeries [data-series], .lb-series-extra [data-series]')].map((n) => n.dataset.series),
      eventsButton: !!document.querySelector('[data-action="events"]'),
    }));
    say('wildcard.ui', seriesUi);
    if (!seriesUi.chips.length)
      finding('major', 'wildcard-ui', 'No Wildcard series entry is reachable from the menu (no [data-series] chip exists; registerSeries() is never called in src). The pairing below is started through the menu form instead.', seriesUi);
    run.driverOptions = session.vehicles?.[0] && /^(gpr|sbk|ss6|nr9|cr7|mx|sm4|sk1)/.test(session.vehicles[0]) ? { gLat: 8, brake: 9, steerGain: 1.0, steerRate: 0.4, lookBase: 10, lookGain: 0.5 } : { gLat: 9, brake: 11, steerGain: 1.6 };
    // The grid selector offers 0/3/7/11 rivals; the event's own grid (4-5) is not one of them.
    const gridOptions = await run.page.evaluate(() => [...document.getElementById('opponents').options].map((o) => Number(o.value)));
    const rivals = gridOptions.includes(session.opponents) ? session.opponents : gridOptions.filter((n) => n > 0 && n <= session.opponents).at(-1) ?? 3;
    if (rivals !== session.opponents) say('wildcard.grid-mismatch', { eventRivals: session.opponents, menuOffers: gridOptions, used: rivals });
    await run.configure({ circuit: session.circuit, vehicle: session.vehicles?.[0], mode: session.mode, laps: session.laps, opponents: rivals, weather: session.weather, assist: session.assist });
    await run.enter('wildcard-1');
    const s0 = await run.state();
    if (s0.options && session.vehicles && s0.options.vehicles && s0.options.vehicles[0] !== session.vehicles[0])
      finding('major', 'wildcard', `The session started with ${s0.options.vehicles[0]} not the event's ${session.vehicles[0]}`, { options: s0.options });
    if (s0.options?.circuit !== session.circuit) finding('major', 'wildcard', `The session started on ${s0.options?.circuit}, not ${session.circuit}`, { options: s0.options });
    const d1 = await run.drive({ simSeconds: cfg.simSeconds, label: 'wildcard-1', bike: true });
    const pr = await run.pauseResume();
    await run.key('ESC (pause to exit)', 'Escape');
    await run.until('paused', (c) => c.mode === 'paused', 120, 200);
    await run.exitToMenu('pause');
    await run.memorySample('menu-after-session-1');
    await run.configure({ circuit: session.circuit, vehicle: session.vehicles?.[0], mode: session.mode });
    await run.enter('wildcard-2');
    const d2 = await run.drive({ simSeconds: cfg.secondSimSeconds, label: 'wildcard-2', bike: true });
    await run.key('ESC (pause to exit)', 'Escape');
    await run.until('paused', (c) => c.mode === 'paused', 120, 200);
    await run.exitToMenu('pause');
    await run.memorySample('menu-after-session-2');
    return { drives: [d1, d2], pause: pr, wildcard: entry.id };
  },
  async festival(run) {
    await run.boot();
    if (cfg.quality) await run.setQuality(cfg.quality);
    const out = { loads: [] };
    for (const attempt of [1, 2]) {
      const load1 = await festivalLoad(run, attempt);
      out.loads.push(load1);
      if (!load1.completed) break;
      if (attempt === 1) {
        out.drive = await festivalDrive(run);
        await festivalExit(run);
        await run.memorySample('menu-after-festival-1');
      } else {
        await festivalExit(run);
        await run.memorySample('menu-after-festival-2');
      }
      if (cfg.festivalSingle) break;
    }
    return out;
  },
};

// ------------------------------------------------------------------ festival
async function festivalLoad(run, attempt) {
  const rec = { attempt, completed: false, stages: [], samples: [] };
  await run.step(`festival-load-${attempt}`, async () => {
    await run.configure({ discipline: 'festival' });
    const mode = await run.page.evaluate(() => document.getElementById('mode')?.value);
    if (mode !== 'festival') finding('major', 'festival', `Choosing the FESTIVAL plate leaves SESSION at "${mode}"`);
    if (cfg.profile) {
      await run.cdp.send('Profiler.enable');
      await run.cdp.send('Profiler.setSamplingInterval', { interval: 4000 });
      await run.cdp.send('Profiler.start');
      rec.profile = { chunks: [] };
    }
    const t = Date.now();
    await run.click('ENTER FESTIVAL', run.page.getByRole('button', { name: /^ENTER FESTIVAL/ }).first());
    let lastText = '',
      lastProfile = Date.now(),
      lastSample = 0,
      lastFrames = 0,
      lastFramesAt = Date.now();
    for (;;) {
      const waited = (Date.now() - t) / 1000;
      const c = await run.page
        .evaluate(() => ({
          mode: document.getElementById('app')?.dataset.mode ?? null,
          loading: !!document.getElementById('loading') && !document.getElementById('loading').hidden,
          text: document.getElementById('loadingText')?.textContent ?? '',
          stage: document.getElementById('loadingStage')?.textContent ?? '',
          percent: document.getElementById('loadingPercent')?.textContent ?? '',
          hud: !!document.querySelector('.fest-hud'),
          speedEl: document.getElementById('festSpeed')?.textContent ?? null,
          frames: window.__jr?.frames ?? 0,
          maxGap: Math.round(window.__jr?.maxGap ?? 0),
          stalls: window.__jr?.stalls?.slice(-5) ?? [],
          longTasks: window.__jr?.longTasks ?? 0,
          longMs: Math.round(window.__jr?.longMs ?? 0),
          error: document.querySelector('.error-screen, #errorScreen')?.textContent?.trim() ?? null,
          toast: (() => {
            const e = document.getElementById('toast');
            return e && !e.hidden ? e.textContent : null;
          })(),
        }))
        .catch((e) => ({ evalError: String(e.message).slice(0, 160) }));
      if (c.evalError) {
        say('festival.eval-stalled', { waited: Math.round(waited), why: c.evalError });
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        if (c.text !== lastText) {
          lastText = c.text;
          rec.stages.push({ at: Number(waited.toFixed(1)), text: c.text, percent: c.percent });
          say('festival.stage', { at: Number(waited.toFixed(1)), text: c.text, percent: c.percent, mainThreadMaxGapMs: c.maxGap });
        }
        if (waited - lastSample >= 10) {
          lastSample = waited;
          const row = { at: Math.round(waited), frames: c.frames, maxGap: c.maxGap, longTasks: c.longTasks, longMs: c.longMs, text: c.text.slice(0, 50) };
          rec.samples.push(row);
          if (c.frames === lastFrames) {
            if (Date.now() - lastFramesAt > 30000) say('festival.no-raf', { sinceS: Math.round((Date.now() - lastFramesAt) / 1000), at: Math.round(waited) });
          } else {
            lastFrames = c.frames;
            lastFramesAt = Date.now();
          }
        }
        if (c.toast) say('festival.toast', { text: c.toast.slice(0, 200) });
        if (c.error) {
          finding('blocker', 'festival', `Error screen during festival load: ${c.error.slice(0, 200)}`);
          break;
        }
        if (c.hud && !c.loading) {
          rec.completed = true;
          rec.loadSeconds = Number(waited.toFixed(1));
          rec.modeAtLoaded = c.mode;
          rec.festivalDiag = await run.page.evaluate(() => window.apexDiagnostics().festival ?? null);
          say('festival.mode', { dataMode: c.mode, diag: rec.festivalDiag });
          if (c.mode === 'loading')
            finding('minor', 'festival', 'The festival is live but #app[data-mode] still reads "loading" (Steam rich presence reads this attribute)', { mode: c.mode });
          break;
        }
      }
      if (cfg.profile && Date.now() - lastProfile > 120000) {
        lastProfile = Date.now();
        await saveProfile(run, rec, `load${attempt}-${Math.round(waited)}s`, true);
      }
      if (waited > cfg.festivalMaxS) {
        rec.timedOut = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (cfg.profile) await saveProfile(run, rec, `load${attempt}-final`, rec.completed);
    if (!rec.completed) {
      finding(rec.timedOut ? 'blocker' : 'blocker', 'festival', `Festival did not finish loading in ${cfg.festivalMaxS}s; last stage "${lastText}"`, { stages: rec.stages.slice(-6) });
    } else {
      say('festival.loaded', { seconds: rec.loadSeconds });
    }
  });
  if (rec.completed) await run.shot(`festival-${attempt}-loaded`);
  return rec;
}
async function saveProfile(run, rec, name, restart) {
  const { profile } = await run.cdp.send('Profiler.stop');
  const summary = summariseProfile(profile);
  rec.profile.chunks.push({ name, ...summary });
  const file = join(cfg.out, `cpu-${name}.cpuprofile.gz`);
  await writeFile(file, gzipSync(JSON.stringify(profile)));
  say('festival.profile', { name, totalMs: summary.totalMs, idlePct: summary.idlePct, files: summary.files.slice(0, 6), top: summary.top.slice(0, 8) });
  if (restart) await run.cdp.send('Profiler.start');
}
/** Self time per function from a V8 CPU profile. */
function summariseProfile(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const byFile = new Map();
  let total = 0;
  const { samples, timeDeltas } = profile;
  for (let i = 0; i < samples.length; i++) {
    const dt = (timeDeltas[i] ?? 0) / 1000;
    total += dt;
    const n = byId.get(samples[i]);
    if (!n) continue;
    const cf = n.callFrame;
    const key = `${cf.functionName || '(anonymous)'} ${cf.url.split('/').pop()}:${cf.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + dt);
    const file = cf.url ? cf.url.split('/').pop().replace(/[-.][A-Za-z0-9_-]{8}\.js$/, '.js') : cf.functionName;
    byFile.set(file, (byFile.get(file) ?? 0) + dt);
  }
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, ms]) => ({ fn: k, ms: Math.round(ms) }));
  const idle = (self.get('(idle) :-1') ?? 0) + (self.get('(program) :-1') ?? 0) * 0;
  const files = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, ms]) => ({ file: k, ms: Math.round(ms) }));
  return { totalMs: Math.round(total), idlePct: total ? Math.round((100 * idle) / total) : 0, top: rows, files };
}
async function festivalDrive(run) {
  const out = { rows: [] };
  await run.step('festival-drive', async () => {
    const readHud = () =>
      run.page.evaluate(() => ({
        speed: document.getElementById('festSpeed')?.textContent ?? null,
        road: document.getElementById('festRoad')?.textContent ?? null,
        limit: document.getElementById('festLimit')?.textContent ?? null,
        machine: document.getElementById('festMachineName')?.textContent ?? null,
        state: document.getElementById('festDriveState')?.textContent ?? null,
        discovered: document.getElementById('festDiscovered')?.textContent ?? null,
      }));
    out.start = await readHud();
    say('festival.hud', out.start);
    const tick = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim()) || 100;
    let prevCpu = run.cpuTicks(),
      prevWall = Date.now(),
      prevFrames = (await run.fast()).page.frames;
    await run.page.keyboard.down('KeyW');
    run.inputs.drive++;
    const begin = Date.now();
    let peak = 0,
      first = null,
      last = null;
    while ((Date.now() - begin) / 1000 < Math.max(cfg.simSeconds, 25)) {
      await new Promise((r) => setTimeout(r, 2500));
      const f = await run.fast();
      const cpu = run.cpuTicks(),
        wall = (Date.now() - prevWall) / 1000;
      const pct = (k) => Math.round(((cpu[k] - prevCpu[k]) / tick / wall) * 100);
      const row = {
        wall: Number(((Date.now() - begin) / 1000).toFixed(1)),
        simTime: f.sim ? Number(f.sim.time.toFixed(2)) : null,
        kph: f.player ? Math.round(f.player.speed * 3.6) : null,
        x: f.player ? Math.round(f.player.x) : null,
        z: f.player ? Math.round(f.player.z) : null,
        cars: f.sim?.cars ?? null,
        hudSpeed: (await readHud()).speed,
        rafFps: Number(((f.page.frames - prevFrames) / wall).toFixed(3)),
        cpuPct: { gpuProcess: pct('gpu'), rendererProcess: pct('renderer'), browser: pct('browser'), utility: pct('utility') },
      };
      prevCpu = cpu;
      prevWall = Date.now();
      prevFrames = f.page.frames;
      if (f.player) {
        peak = Math.max(peak, f.player.speed * 3.6);
        first ??= { x: f.player.x, z: f.player.z };
        last = { x: f.player.x, z: f.player.z };
      }
      out.rows.push(row);
    }
    out.peakKph = Math.round(peak);
    out.distanceM = first && last ? Math.round(Math.hypot(last.x - first.x, last.z - first.z)) : null;
    out.tapped = out.rows.some((r) => r.kph !== null);
    say('festival.drive', { peakKph: out.peakKph, distanceM: out.distanceM, last: out.rows.at(-1) });
    if (cfg.profile) await saveProfile(run, { profile: { chunks: [] } }, 'festival-after-load', false);
    await run.shot('festival-driving');
    await run.page.keyboard.up('KeyW');
    if (!out.tapped) finding('minor', 'festival', 'No simulation frames reached the page during the festival drive (tool could not read speed)', { rows: out.rows.slice(-2) });
    else if (out.peakKph < 5) finding('major', 'festival', `Holding throttle for ${Math.max(cfg.simSeconds, 25)} s never moved the car (peak ${out.peakKph} km/h)`, { rows: out.rows.slice(-3) });
    // Festival menu.
    await run.key('ESC (festival menu)', 'Escape');
    await new Promise((r) => setTimeout(r, 2500));
    out.menu = await run.page.evaluate(() => {
      const m = document.getElementById('festMenu');
      return { open: !!m && !m.hidden, buttons: m ? [...m.querySelectorAll('button')].map((b) => b.textContent.trim()) : [] };
    });
    say('festival.menu', out.menu);
    if (!out.menu.open) finding('major', 'festival', 'ESC does not open the festival menu', out);
    await run.shot('festival-menu');
  });
  return out;
}
async function festivalExit(run) {
  await run.step('festival-exit', async () => {
    const menuOpen = await run.page.evaluate(() => !!document.getElementById('festMenu') && !document.getElementById('festMenu').hidden);
    if (!menuOpen) await run.key('ESC (festival menu)', 'Escape');
    const exit = run.page.locator('#festMenu button', { hasText: /EXIT|PADDOCK|RETURN/i }).first();
    if (!(await exit.count())) {
      finding('major', 'festival', 'Festival menu has no exit/paddock button', { buttons: await run.page.locator('#festMenu button').allTextContents() });
      return;
    }
    const label = (await exit.textContent()).trim();
    const t = Date.now();
    await run.click(label, exit);
    await run.until('menu after festival', (c) => c.mode === 'menu' && c.menu && !c.loading, 300, 500);
    say('festival.exit', { seconds: (Date.now() - t) / 1000 });
  });
  await run.shot('menu-after-festival');
}

// ------------------------------------------------------------------- summary
function summarise(run, extra) {
  const sessions = run.sessions;
  const mem = run.memory;
  const growth = (a, b) => (a && b ? Number((b.jsHeapMB - a.jsHeapMB).toFixed(1)) : null);
  const m0 = mem.find((m) => m.label === 'menu-after-boot'),
    m1 = mem.find((m) => /session-1|festival-1/.test(m.label)),
    m2 = mem.find((m) => /session-2|festival-2/.test(m.label));
  return {
    boot: run.bootInfo,
    sessions,
    inputs: { menuInputs: run.inputs.menu, driveKeyEvents: run.inputs.drive, log: run.inputs.log.slice(0, 40) },
    memory: {
      samples: mem,
      jsHeapGrowthSession1MB: growth(m0, m1),
      jsHeapGrowthSession2MB: growth(m1, m2),
      rssGrowthSession2MB: m1?.rssMB && m2?.rssMB ? m2.rssMB - m1.rssMB : null,
      textureGrowthSession2: m1?.textures != null && m2?.textures != null ? m2.textures - m1.textures : null,
      geometryGrowthSession2: m1?.geometries != null && m2?.geometries != null ? m2.geometries - m1.geometries : null,
    },
    ...extra,
  };
}

// ---------------------------------------------------------------------- main
const run = new Run();
let outcome = 'ok';
let extra = {};
try {
  await run.open();
  extra = await JOURNEY_FNS[cfg.journey](run);
} catch (error) {
  outcome = 'aborted';
  say('JOURNEY.ABORTED', { error: String(error.message ?? error).slice(0, 500) });
}
try {
  const consoleErrors = consoleLog.filter((c) => c.type === 'error' || c.type === 'pageerror');
  if (consoleErrors.length) finding('major', 'console', `${consoleErrors.length} console/page error(s) during the journey`, { first: consoleErrors.slice(0, 5) });
  const summary = summarise(run, { outcome, ...extra });
  if (summary.memory.jsHeapGrowthSession2MB !== null && summary.memory.jsHeapGrowthSession2MB > 60)
    finding('minor', 'memory', `JS heap grew ${summary.memory.jsHeapGrowthSession2MB} MB across the second back-to-back session`, summary.memory);
  await flush({ summary, pageCounters: await run.page.evaluate(() => ({ frames: window.__jr?.frames, maxGap: window.__jr?.maxGap, longTasks: window.__jr?.longTasks, longMs: window.__jr?.longMs, stalls: window.__jr?.stalls })).catch(() => null) });
  say('DONE', { outcome, findings: findings.length, out: cfg.out });
} finally {
  await run.close();
}
process.exit(outcome === 'ok' ? 0 : 1);
