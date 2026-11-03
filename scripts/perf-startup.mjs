/**
 * Cold-start profile of a served production build (gate G7 evidence).
 *
 *   npm run build && npx vite preview --port 4204 &
 *   node scripts/perf-startup.mjs --url http://127.0.0.1:4204 --label after [--race] [--profile]
 *
 * Boots the menu in headless Chromium and records: when the entry module has
 * run, when the menu is revealed, main-thread long tasks, V8 parse/compile
 * time, JS heap after a forced GC, and every response over 100 KB. With
 * --race it then starts a Free practice session and counts rendered frames;
 * with --profile it also records a 30 s main-thread CPU profile while driving
 * and prints the top self-time functions.
 *
 * Results go to --out (default perf-results/). Software GL (SwiftShader) makes
 * absolute times slow and noisy on shared machines: compare runs taken under
 * similar load, and prefer the byte and long-task figures over wall time.
 * Set CHROMIUM_PATH to use a specific browser binary.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const url = option('--url', 'http://127.0.0.1:4204');
const label = option('--label', 'run');
const out = option('--out', 'perf-results');
const race = args.includes('--race') || args.includes('--profile');
const profile = args.includes('--profile');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--headless=new',
    '--enable-precise-memory-info',
  ],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const responses = [];
page.on('response', (response) =>
  responses.push({
    url: response.url().replace(url, ''),
    bytes: Number(response.headers()['content-length'] ?? 0),
  }),
);
await page.addInitScript(() => {
  const marks = { longtasks: [], entry: null, menu: null };
  window.__perf = marks;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries())
      marks.longtasks.push({ start: Math.round(e.startTime), duration: Math.round(e.duration) });
  }).observe({ type: 'longtask', buffered: true });
  const entry = setInterval(() => {
    if (!window.apexDiagnostics) return;
    marks.entry = performance.now();
    clearInterval(entry);
  }, 2);
  const poll = () => {
    try {
      if (window.apexDiagnostics?.().state === 'menu') return void (marks.menu = performance.now());
    } catch {
      /* diagnostics not ready */
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
});
const cdp = await context.newCDPSession(page);
await browser.startTracing(page, { categories: ['devtools.timeline', 'v8'] });
await page.goto(`${url}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__perf.menu !== null, null, {
  timeout: 600_000,
  polling: 250,
});
const trace = JSON.parse((await browser.stopTracing()).toString());
const compile = {};
for (const event of trace.traceEvents ?? trace) {
  if (event.ph !== 'X' || !/^v8\.(parseOnBackground|compile)$/.test(event.name)) continue;
  const file = (event.args?.data?.url ?? '').replace(url, '') || '(inline)';
  compile[`${event.name} ${file}`] = (compile[`${event.name} ${file}`] ?? 0) + event.dur / 1000;
}
const marks = await page.evaluate(() => window.__perf);
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.collectGarbage');
const heap = await cdp.send('Runtime.getHeapUsage');
const menu = {
  label,
  entryEvaluatedMs: Math.round(marks.entry ?? -1),
  menuMs: Math.round(marks.menu),
  longTaskCount: marks.longtasks.length,
  longTaskTotalMs: marks.longtasks.reduce((sum, t) => sum + t.duration, 0),
  longTasksTop: [...marks.longtasks].sort((a, b) => b.duration - a.duration).slice(0, 10),
  heapUsedMB: +(heap.usedSize / 1048576).toFixed(1),
  v8ParseCompileMs: Object.fromEntries(
    Object.entries(compile)
      .filter(([, ms]) => ms >= 5)
      .map(([key, ms]) => [key, Math.round(ms)]),
  ),
  bigResponses: responses
    .filter((r) => r.bytes > 100_000)
    .sort((a, b) => b.bytes - a.bytes)
    .map((r) => `${r.url} ${(r.bytes / 1048576).toFixed(2)} MB`),
  errors,
};
writeFileSync(`${out}/${label}-menu.json`, JSON.stringify(menu, null, 2));
console.log(JSON.stringify(menu, null, 2));

if (race) {
  const started = Date.now();
  await page.locator('#mode').selectOption('practice');
  await page.locator('#opponents').selectOption('0');
  await page.getByRole('button', { name: /ENTER CIRCUIT/ }).click();
  for (;;) {
    const state = await page.evaluate(() => window.apexDiagnostics().state);
    if (state === 'driving') break;
    if (await page.locator('#raceBriefing').isVisible())
      await page.getByRole('button', { name: 'GO STRAIGHT TO LIGHTS', exact: true }).click();
    if (Date.now() - started > 1_500_000) throw new Error('Session did not reach driving');
    await page.waitForTimeout(1000);
  }
  const toDrivingMs = Date.now() - started;
  await page.evaluate(() => {
    window.__frames = 0;
    const tick = () => {
      window.__frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.down('w');
  if (profile) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    await cdp.send('Profiler.start');
  }
  const sampleStart = Date.now();
  await page.waitForTimeout(profile ? 30_000 : 8_000);
  const sampleMs = Date.now() - sampleStart;
  const cpu = profile ? (await cdp.send('Profiler.stop')).profile : null;
  const frames = await page.evaluate(() => window.__frames);
  const raceResult = {
    label,
    toDrivingMs,
    sampleMs,
    rafFrames: frames,
    rafFps: +((frames * 1000) / sampleMs).toFixed(2),
    errors,
  };
  writeFileSync(`${out}/${label}-race.json`, JSON.stringify(raceResult, null, 2));
  console.log(JSON.stringify(raceResult, null, 2));
  if (cpu) {
    const nodes = new Map(cpu.nodes.map((node) => [node.id, node]));
    const self = new Map();
    cpu.samples.forEach((id, i) => {
      const frame = nodes.get(id).callFrame;
      const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').pop()}:${frame.lineNumber}`;
      self.set(key, (self.get(key) ?? 0) + (cpu.timeDeltas[i] ?? 0));
    });
    const total = [...self.values()].reduce((sum, t) => sum + t, 0);
    const rows = [...self]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(
        ([key, t]) =>
          `${(t / 1000).toFixed(0).padStart(7)} ms ${((100 * t) / total).toFixed(1).padStart(5)}%  ${key}`,
      );
    writeFileSync(`${out}/${label}-profile.cpuprofile`, JSON.stringify(cpu));
    writeFileSync(`${out}/${label}-profile-top.txt`, rows.join('\n'));
    console.log(rows.join('\n'));
  }
}
await browser.close();
if (errors.length) process.exitCode = 1;
