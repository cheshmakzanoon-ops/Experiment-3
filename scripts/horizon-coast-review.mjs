/** Fixed coast/valley evidence through real saved-discovery travel and pause.
 * Run against a served horizon-session fixture with node --experimental-strip-types.
 * HORIZON_REVIEW_{URL,OUTPUT,EXECUTABLE,QUALITY,SCENES,IDENTITY} configure the run;
 * IDENTITY is a JSON file with a source fingerprint. APEX_BROWSER_BACKEND selects
 * the existing software backend; these captures do not measure hardware FPS. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { browserBackend, requireBrowserBackend } from './browser-backend.ts';

const base = (process.env.HORIZON_REVIEW_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const output = resolve(process.env.HORIZON_REVIEW_OUTPUT ?? 'test-results/horizon-coast-review');
const quality = process.env.HORIZON_REVIEW_QUALITY ?? 'medium';
const selected = (process.env.HORIZON_REVIEW_SCENES ?? 'coast,valley')
  .split(',')
  .map((s) => s.trim());
assert(['low', 'medium', 'high', 'ultra'].includes(quality), 'Unknown review quality');
assert(selected.length && selected.every((s) => ['coast', 'valley'].includes(s)), 'Unknown scene');
assert.equal(new Set(selected).size, selected.length, 'Duplicate review scene');
const identityPath = process.env.HORIZON_REVIEW_IDENTITY;
const expected = identityPath ? JSON.parse(await readFile(identityPath, 'utf8')) : null;
if (identityPath)
  assert.match(expected?.fingerprint, /^[a-f0-9]{64}$/, 'Invalid expected fingerprint');
const backend = browserBackend(process.env.APEX_BROWSER_BACKEND);
const viewport = { width: 1280, height: 720 };
const shots = [
  { name: 'coast', travel: 'coast-trap', camera: [-1818, 12, -2732], target: [-1768, 0, -2682] },
  { name: 'valley', travel: 'pass-zone', camera: [-1900, 420, 2600], target: [-4000, 660, 4500] },
].filter((shot) => selected.includes(shot.name));
const report = {
  base,
  quality,
  viewport,
  backend: backend.name,
  expectedSourceIdentity: expected,
  notHardwarePerformance: true,
  started: new Date().toISOString(),
  completed: false,
  views: [],
  errors: [],
  warnings: [],
  failedAssets: [],
};
const save = () =>
  writeFile(resolve(output, 'review.json'), JSON.stringify(report, null, 2) + '\n');
let browser, page;
const closeBrowser = async () => {
  // All requests through readback were checked; intentional teardown may abort pending requests.
  page?.removeAllListeners('requestfailed');
  await browser?.close();
  browser = page = null;
};
await mkdir(output, { recursive: true });
try {
  for (const shot of shots) {
    // A new browser isolates each view's resources and lifecycle.
    browser = await chromium.launch({
      executablePath: process.env.HORIZON_REVIEW_EXECUTABLE || undefined,
      headless: backend.headless,
      args: ['--no-sandbox', ...backend.args],
    });
    page = await browser.newPage({ viewport });
    page.setDefaultTimeout(240000);
    const view = { ...shot, browser: browser.version(), loading: [] };
    report.views.push(view);
    report.phase = `load ${shot.name}`;
    page.on('pageerror', (e) => report.errors.push({ view: shot.name, error: e.message }));
    page.on('console', (m) => {
      if (m.type() === 'error') report.errors.push({ view: shot.name, error: m.text() });
      if (m.type() === 'warning') report.warnings.push({ view: shot.name, warning: m.text() });
    });
    page.on('response', (r) => {
      if (r.status() >= 400)
        report.failedAssets.push({ view: shot.name, status: r.status(), url: r.url() });
    });
    page.on('requestfailed', (r) =>
      report.failedAssets.push({
        view: shot.name,
        url: r.url(),
        error: r.failure()?.errorText,
      }),
    );
    await page.exposeFunction('horizonCapturePhase', (phase) => {
      view.loading.push(phase);
      console.log('LOADING', shot.name, JSON.stringify(phase));
    });
    await page.addInitScript(() => {
      const pending = new MutationObserver(() => {
        const loading = document.querySelector('#loading');
        if (!loading) return;
        pending.disconnect();
        let previous;
        const record = () => {
          const phase = { text: loading.textContent, hidden: loading.hidden };
          const key = JSON.stringify(phase);
          if (key === previous) return;
          previous = key;
          void window.horizonCapturePhase({ ms: Math.round(performance.now()), ...phase });
        };
        new MutationObserver(record).observe(loading, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['hidden'],
        });
        record();
      });
      pending.observe(document, { childList: true, subtree: true });
    });
    const query = new URLSearchParams({
      quality,
      vehicle: 'eh3',
      lighting: 'day',
      weather: 'clear',
      discovered: 'all',
      travel: shot.travel,
      capture: '1',
      frames: '1',
    });
    await page.goto(`${base}/e2e/fixtures/horizon-session.html?${query}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.horizonReview?.state().draws >= 1);
    report.phase = `capture ${shot.name}`;
    await page.evaluate((s) => window.horizonReview.inspect(s.camera, s.target), shot);
    // Exactly five intentional inspection draws after the one boot frame.
    for (let frame = 0; frame < 5; frame++) {
      await page.evaluate(() => window.horizonReview.draw());
      await page.waitForTimeout(250);
    }
    const png = await page.evaluate(() => window.horizonReview.image());
    assert(png.startsWith('data:image/png;base64,'), 'Missing PNG readback');
    view.state = await page.evaluate(() => {
      const s = window.horizonReview.state();
      const gl = document.querySelector('#world').getContext('webgl2');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        sourceIdentity: s.sourceIdentity ?? null,
        position: s.position,
        player: s.player,
        render: s.render,
        memory: s.memory,
        draws: s.draws,
        time: s.status?.time,
        paused: s.paused,
        photo: s.photo,
        water: s.water,
        atmosphere: s.atmosphere,
        adapter: gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        error: gl.getError(),
        lost: gl.isContextLost(),
      };
    });
    requireBrowserBackend(backend.name, view.state.adapter);
    assert.equal(view.state.error, 0, 'WebGL error during capture');
    assert.equal(view.state.lost, false, 'WebGL context lost');
    assert.equal(view.state.draws, 6, 'Unexpected GPU frame submissions');
    assert.equal(view.state.paused, true, 'Inspection must pause the real session');
    assert.equal(view.state.photo, true, 'Inspection must use photo presentation');
    if (expected)
      assert.equal(view.state.sourceIdentity?.fingerprint, expected.fingerprint, 'Source mismatch');
    assert.deepEqual(report.errors, [], 'Page or console errors');
    assert.deepEqual(report.failedAssets, [], 'Failed asset requests');
    const bytes = Buffer.from(png.split(',')[1], 'base64');
    view.file = `${shot.name}.png`;
    view.bytes = bytes.length;
    view.sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(resolve(output, view.file), bytes);
    console.log('CAPTURE', shot.name, view.sha256, JSON.stringify(view.state));
    await save();
    await closeBrowser();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedAssets, []);
  report.completed = true;
} catch (error) {
  report.failure = String(error.stack || error);
  if (page)
    report.loading = await page
      .locator('#loading')
      .textContent({ timeout: 5000 })
      .catch(() => null);
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  await closeBrowser();
  report.finished = new Date().toISOString();
  await save();
}
