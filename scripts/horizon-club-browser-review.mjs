/** Real Festival worker, keyboard, HUD, car selection and club-event review.
 * Run against Vite after the production sources are stable. GPU submissions
 * stop between captures on the software renderer; input and physics continue.
 * This records functional and visual evidence, not a target-device FPS test.
 * node --experimental-transform-types scripts/horizon-club-browser-review.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { chromium } from 'playwright';
import { browserBackend, requireBrowserBackend } from './browser-backend.ts';

const root = process.cwd();
const reviewStarted = performance.now();
const output = resolve(process.env.HORIZON_REVIEW_OUTPUT ?? 'test-results/horizon-club/browser');
const baseURL = process.env.HORIZON_REVIEW_URL ?? 'http://127.0.0.1:5193';
const backend = browserBackend(process.env.APEX_BROWSER_BACKEND);
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}
async function fingerprint() {
  const hash = createHash('sha256');
  for (const path of [
    ...(await files(join(root, 'src'))),
    ...['package-lock.json', 'index.html', 'vite.config.ts'].map((name) => join(root, name)),
  ].sort()) {
    hash.update(relative(root, path).replaceAll('\\', '/') + '\0');
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}
await mkdir(output, { recursive: true });
const report = {
  scope: 'Staged functional interaction review; original startup budget reported separately',
  generatedAt: new Date().toISOString(),
  sourceFingerprint: await fingerprint(),
  quality: 'medium',
  viewport: { width: 1120, height: 700 },
  timing: { originalStartupBudgetMs: 180000 },
  initialSave: { discovered: [], vehicle: 'rh3' },
  budgetsMs: { loading: 180000, coldFrameReview: 360000, failureState: 10000, shutdown: 15000 },
  limitations: [
    'Software GPU',
    'Brief manual driving, not a human playtest',
    'GPU frames submitted explicitly between functional checks',
    'Still captures use the production map or photo pause so GPU latency cannot extend driving input',
  ],
  steps: [],
  loadingStages: [],
  loadingOverlayStages: [],
  errors: [],
  failedAssets: [],
  failedRequests: [],
  captures: [],
  functionalPassed: false,
};
const save = () =>
  writeFile(resolve(output, 'review.json'), JSON.stringify(report, null, 2) + '\n');
async function resources() {
  const values = {};
  for (const name of ['memory.current', 'memory.max', 'memory.events']) {
    try {
      values[name] = (await readFile(`/sys/fs/cgroup/${name}`, 'utf8')).trim();
    } catch {
      // Resource counters are optional diagnostics outside Linux containers.
    }
  }
  return values;
}
async function loadingStage(name) {
  const value = { name, elapsedMs: performance.now() - reviewStarted };
  report.loadingStages.push(value);
  console.log('CLUB_LOADING', JSON.stringify(value));
  await save();
}
async function bounded(label, milliseconds, operation) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds} ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
report.resourcesBeforeLaunch = await resources();
const browser = await chromium.launch({
  executablePath: process.env.HORIZON_REVIEW_EXECUTABLE || undefined,
  headless: backend.headless,
  args: ['--no-sandbox', ...backend.args],
});
const page = await browser.newPage({ viewport: report.viewport });
page.setDefaultTimeout(90000);
page.on('crash', () => {
  report.targetCrashed = true;
  console.error('CLUB_CRASH', 'browser page crashed');
});
page.on('pageerror', (error) => report.errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') report.errors.push(message.text());
});
page.on('response', (response) => {
  if (response.status() >= 400)
    report.failedAssets.push({ status: response.status(), url: response.url() });
});
page.on('requestfailed', (request) => {
  report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText });
});
await page.exposeFunction('recordFestivalLoading', (value) => {
  const entry = { ...value, elapsedMs: performance.now() - reviewStarted };
  report.loadingOverlayStages.push(entry);
  console.log('CLUB_OVERLAY', JSON.stringify(entry));
});
await page.addInitScript(() => {
  let previous = '';
  const observer = new MutationObserver(() => {
    const overlay = document.querySelector('#loading');
    if (!overlay) return;
    const value = { text: overlay.textContent, hidden: overlay.hidden };
    const key = JSON.stringify(value);
    if (key === previous) return;
    previous = key;
    window.recordFestivalLoading(value).catch(() => {});
  });
  observer.observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
});
const state = () => page.evaluate(() => window.horizonReview.state());
const wait = (predicate, arg, timeout = 30000) => page.waitForFunction(predicate, arg, { timeout });
const pass = (name, data = {}) => {
  report.steps.push({ name, ...data });
  console.log('CLUB_PASS', name, JSON.stringify(data));
};
let forceExit = false;
async function capture(name) {
  assert.equal((await state()).paused, true, 'Pause through the production UI before a still');
  console.log('CLUB_CAPTURE', name);
  await bounded(`capture ${name}`, report.budgetsMs.coldFrameReview, async () => {
    await page.evaluate(() => window.horizonReview.draw());
    await page.evaluate(() => window.horizonReview.image());
  });
  await page.screenshot({ path: resolve(output, `${name}.png`), timeout: 90000 });
  const value = await state();
  const glError = await page.evaluate(() =>
    document.querySelector('#world').getContext('webgl2').getError(),
  );
  assert.equal(glError, 0, `WebGL error while capturing ${name}`);
  report.captures.push({
    name,
    camera: value.position,
    player: value.player,
    render: value.render,
    memory: value.memory,
    paused: value.paused,
    glError,
  });
}
async function menu() {
  if (!(await state()).paused) await page.keyboard.press('Escape');
  await page.locator('#festMenu').waitFor({ state: 'visible' });
}
async function photo() {
  await menu();
  await page.locator('#festMenu [data-fest="photo"]').click();
  await page.locator('#festPhoto').waitFor({ state: 'visible' });
  await page.locator('#festPhoto [data-fest="photoHide"]').click();
}
async function abandon() {
  const previousResults = (await state()).results.length;
  await menu();
  await page.locator('#festMenu [data-fest="cancel"]').click();
  await wait(() => window.horizonReview.state().status.mode === 'finished');
  if ((await state()).paused) await page.locator('#festMenu [data-fest="resume"]').click();
  await page.evaluate(() => window.horizonReview.draw());
  await wait((count) => window.horizonReview.state().results.length > count, previousResults);
}
try {
  console.log('CLUB_PHASE', 'loading production Festival session', backend.name);
  const navigationStarted = performance.now();
  // Module initialization shares the documented loading deadline. The
  // generic 30-second interaction wait must not end this phase early.
  await bounded('Festival loading', report.budgetsMs.loading, async () => {
    await loadingStage('navigation started');
    await page.goto(
      `${baseURL}/e2e/fixtures/horizon-session.html?quality=medium&vehicle=rh3&travel=saltmarsh-club-race&capture=1&frames=1`,
      { waitUntil: 'domcontentloaded', timeout: report.budgetsMs.loading },
    );
    await loadingStage('document loaded');
    // Submit the first full-quality frame explicitly after CPU/asset loading.
    await wait(() => !!window.horizonReview, undefined, report.budgetsMs.loading);
    await loadingStage('fixture module initialized');
    report.timing.automaticDrawsBeforeSuppression = (await state()).draws;
    await page.evaluate(() => window.horizonReview.rendering(false));
    await loadingStage('automatic GPU submissions suppressed');
    await page.locator('#loading').waitFor({ state: 'hidden', timeout: report.budgetsMs.loading });
    await loadingStage('production loading overlay closed');
    await wait(() => window.horizonReview.state().ready, undefined, report.budgetsMs.loading);
    await loadingStage('production session ready');
    await wait(
      () => window.horizonReview.state().status.card?.id === 'saltmarsh-club-race',
      undefined,
      report.budgetsMs.loading,
    );
    await loadingStage('fresh-save race card available');
  });
  report.timing.loadingObservedMs = performance.now() - navigationStarted;
  console.log('CLUB_PHASE', 'loading observed; submitting first full-quality frame');
  await bounded(
    'first full-quality frame and readback',
    report.budgetsMs.coldFrameReview,
    async () => {
      await page.evaluate(() => window.horizonReview.draw());
      await page.evaluate(() => window.horizonReview.image());
    },
  );
  report.timing.firstFrameReadbackMs = performance.now() - navigationStarted;
  report.timing.originalStartupBudgetMet =
    report.timing.firstFrameReadbackMs <= report.timing.originalStartupBudgetMs;
  console.log('CLUB_PHASE', 'first frame read back', JSON.stringify(report.timing));
  const initial = await state();
  assert.equal(
    initial.sourceIdentity.fingerprint,
    report.sourceFingerprint,
    'Vite source differs from the reviewed source',
  );
  assert.equal(initial.status.vehicleId, 'rh3');
  assert.equal(initial.status.card?.id, 'saltmarsh-club-race');
  assert(initial.roads.circuitBoards > 0 && initial.roads.circuitChevrons > 0);
  report.roadGeometry = initial.roads;
  report.renderer = await page.evaluate(() => {
    const gl = document.querySelector('#world').getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  requireBrowserBackend(backend.name, report.renderer);
  assert(initial.status.discovered.includes('saltmarsh-club-race'));
  assert(!initial.status.discovered.includes('saltmarsh-practice'));
  pass('fresh-save RH3 travels to the real club race marker without discovery gating');
  await page.keyboard.press('t');
  await page.locator('#festMap').waitFor({ state: 'visible' });
  await page.locator('[data-fest="mapSelect"][data-value="saltmarsh-club-race"]').click();
  assert((await page.locator('#festMapDetail').innerText()).includes('Saltmarsh Club Race'));
  await capture('club-world-map');
  await page.keyboard.press('Escape');
  await page.locator('#festMenu [data-fest="resume"]').click();
  pass('new circuit appears in the world map and returns to driving');
  await page.locator('#festCard [data-fest="start"]').click();
  await wait(() => window.horizonReview.state().status.mode === 'running');
  const grid = await state();
  assert.equal(grid.status.event.id, 'saltmarsh-club-race');
  // Drive immediately after green. A software-GPU readback can block the
  // browser for many seconds while the independent simulation keeps running.
  // Review the grid through a normal paused retry after checking the pedals.
  console.log('CLUB_PHASE', 'manual throttle and brake');
  await page.keyboard.down('w');
  await wait((start) => {
    const s = window.horizonReview.state();
    return s.status.speedKmh > 35 && Math.hypot(s.player.x - start.x, s.player.z - start.z) > 45;
  }, grid.player);
  await page.keyboard.up('w');
  const moving = await state();
  await page.keyboard.down('s');
  await wait(() => window.horizonReview.state().status.speedKmh < 1);
  await page.keyboard.up('s');
  const stopped = await state();
  assert.equal(stopped.status.autopilot, false);
  assert.equal(stopped.status.event.offRoute, false);
  pass('manual RH3 throttle and braking on the actual circuit', {
    speedKmh: moving.status.speedKmh,
    distanceM: Math.hypot(stopped.player.x - grid.player.x, stopped.player.z - grid.player.z),
    stoppedKmh: stopped.status.speedKmh,
  });
  await abandon();
  assert((await state()).results.at(-1).abandoned);
  await page.locator('#festResults [data-fest="retry"]').click();
  await wait(() => ['countdown', 'running'].includes(window.horizonReview.state().status.mode));
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await wait(() => !window.horizonReview.state().paused);
  await photo();
  await capture('rh3-club-grid');
  await page.keyboard.press('Escape');
  await wait(() => !window.horizonReview.state().paused && !window.horizonReview.state().photo);
  pass('abandon result and Try Again return to a fresh race grid');
  await abandon();
  await page.locator('#festResults [data-fest="continue"]').click();
  await wait(() => window.horizonReview.state().status.mode === 'free');
  await page.evaluate(() => window.horizonReview.draw());
  await menu();
  await page.locator('[data-fest="vehicle"][data-value="sc7"]').click();
  await wait(() => window.horizonReview.state().status.vehicleId === 'sc7');
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await page.evaluate(() => window.horizonReview.draw());
  await page.keyboard.press('t');
  await page.locator('#festMap').waitFor({ state: 'visible' });
  await page.locator('[data-fest="mapSelect"][data-value="saltmarsh-practice"]').click();
  await page.locator('#festMapDetail [data-fest="travel"]').click();
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await wait(() => window.horizonReview.state().status.card?.id === 'saltmarsh-practice');
  await page.evaluate(() => window.horizonReview.draw());
  await page.locator('#festCard [data-fest="start"]').click();
  await wait(() => window.horizonReview.state().status.mode === 'running');
  const practice = await state();
  assert.equal(practice.status.event.id, 'saltmarsh-practice');
  await photo();
  await capture('sc7-practice-start');
  pass('garage SC7 selection, mapped travel and solo practice start');
  const practicePhoto = await state();
  await page.evaluate(
    (p) => window.horizonReview.inspect([p.x + 8, p.y + 3.2, p.z + 7], [p.x, p.y + 0.9, p.z]),
    practicePhoto.player,
  );
  await capture('sc7-track-car');
  await page.evaluate(() =>
    window.horizonReview.inspect(
      [-1471.4604, 87.4762, -855.1367],
      [-1489.7208, 86.0352, -856.8233],
    ),
  );
  await capture('club-corner-markers');
  pass('permanent bend markers render beside the actual practice course');
  await page.keyboard.press('Escape');
  await wait(() => !window.horizonReview.state().paused && !window.horizonReview.state().photo);
  pass('paused car inspection returns to normal session input');
  await abandon();
  await page.locator('#festResults [data-fest="continue"]').click();
  await wait(() => window.horizonReview.state().status.mode === 'free');
  await page.evaluate(() => window.horizonReview.draw());
  await page.keyboard.press('t');
  await page.locator('#festMap').waitFor({ state: 'visible' });
  await page.locator('[data-fest="mapSelect"][data-value="harbour-welcome"]').click();
  await page.locator('#festMapDetail [data-fest="travel"]').click();
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await wait(() => window.horizonReview.state().status.card?.id === 'harbour-welcome');
  await page.evaluate(() => window.horizonReview.draw());
  await photo();
  await page.evaluate(() =>
    window.horizonReview.inspect([140.5183, 39.5552, -2067.3233], [149.7385, 39.0052, -2065.6655]),
  );
  await capture('highway-guardrail');
  await page.keyboard.press('Escape');
  await wait(() => !window.horizonReview.state().paused && !window.horizonReview.state().photo);
  pass('guardrail inspection on the existing collision-backed highway');
  await menu();
  const beforeExit = await state();
  await page.locator('#festMenu [data-fest="exit"]').click();
  await wait(() => window.horizonReview.state().exited);
  const afterExit = await state();
  assert.equal(await page.locator('#festivalHud').count(), 0);
  assert.equal(afterExit.ready, false);
  assert(afterExit.memory.geometries < beforeExit.memory.geometries);
  pass('session exit removes HUD and releases GPU geometry', {
    before: beforeExit.memory,
    after: afterExit.memory,
  });
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  assert.equal(report.failedAssets.length, 0, JSON.stringify(report.failedAssets));
  report.sourceStable = (await fingerprint()) === report.sourceFingerprint;
  assert(report.sourceStable, 'Source changed during browser review');
  report.functionalPassed = true;
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  report.resourcesAtFailure = await resources();
  console.error('CLUB_FAIL', error.message);
  await save();
  try {
    report.failureState = await bounded('failure state', report.budgetsMs.failureState, state);
  } catch (stateError) {
    report.failureStateError = stateError.message;
  }
  process.exitCode = 1;
} finally {
  report.resourcesBeforeCleanup = await resources();
  await save();
  await bounded('release keyboard', 3000, async () => {
    await page.keyboard.up('w');
    await page.keyboard.up('s');
  }).catch(() => {});
  try {
    await bounded('browser shutdown', report.budgetsMs.shutdown, () => browser.close());
  } catch (closeError) {
    report.cleanupError = closeError.message;
    report.functionalPassed = false;
    process.exitCode = 1;
    forceExit = true;
  }
  await save();
  console.log(
    JSON.stringify({
      functionalPassed: report.functionalPassed,
      originalStartupBudgetMet: report.timing.originalStartupBudgetMet,
      steps: report.steps.length,
      failure: report.failure?.message,
      output,
    }),
  );
}
// Playwright's process-exit cleanup terminates only the Chromium child it owns.
if (forceExit) process.exit(1);
