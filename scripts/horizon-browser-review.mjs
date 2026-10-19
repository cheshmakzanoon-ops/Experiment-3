/** Real festival worker/input/rendering journey. Run against `npm run dev`,
 * or a production review build that includes e2e/fixtures/horizon-session.html.
 * Still frames pause GPU submissions after boot; simulation and real input
 * continue normally. This is functional evidence, not a frame-rate benchmark. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { browserBackend, requireBrowserBackend } from './browser-backend.ts';

const baseURL = process.env.HORIZON_REVIEW_URL ?? 'http://127.0.0.1:5173';
const output = resolve(process.env.HORIZON_REVIEW_OUTPUT ?? 'test-results/horizon-review');
const quality = process.env.HORIZON_REVIEW_QUALITY ?? 'low';
await mkdir(output, { recursive: true });
const sourceIdentityPath = process.env.HORIZON_REVIEW_IDENTITY;
const reviewSourceIdentity = sourceIdentityPath
  ? JSON.parse(await readFile(sourceIdentityPath, 'utf8'))
  : null;
const backend = browserBackend(process.env.APEX_BROWSER_BACKEND);
const browser = await chromium.launch({
  executablePath: process.env.HORIZON_REVIEW_EXECUTABLE || undefined,
  headless: backend.headless,
  args: ['--no-sandbox', ...backend.args],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(300000);
const errors = [],
  failedAssets = [],
  steps = [];
let phase = 'load',
  sourceIdentity = null,
  renderer = null,
  failureState = null;
page.on('pageerror', (error) => {
  errors.push(error.message);
  console.error('BROWSER ERROR', error.message);
});
page.on('console', (message) => {
  if (message.type() === 'error') {
    errors.push(message.text());
    console.error('BROWSER CONSOLE ERROR', message.text());
  }
});
page.on('response', (response) => {
  if (response.status() >= 400) {
    failedAssets.push({ status: response.status(), url: response.url() });
    console.error('ASSET ERROR', response.status(), response.url());
  }
});
const state = () => page.evaluate(() => window.horizonReview.state());
const hasSourceFingerprint = (identity) =>
  typeof identity?.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(identity.fingerprint);
const pass = (name, details = {}) => {
  steps.push({ name, passed: true, ...details });
  console.log('PASS', name, JSON.stringify(details));
};
async function draw() {
  await page.evaluate(() => window.horizonReview.draw());
  // Readback drains the software GPU queue before Chromium captures the DOM.
  await page.evaluate(() => window.horizonReview.image());
}
async function capture(name) {
  await draw();
  await page.screenshot({ path: resolve(output, `${name}.png`), timeout: 90000 });
}
try {
  const identityResponse = await page.request.get(`${baseURL}/BUILD_IDENTITY.json`);
  if (identityResponse.ok()) {
    try {
      const identity = await identityResponse.json();
      if (hasSourceFingerprint(identity)) sourceIdentity = identity;
    } catch {
      /* Development server has no build identity. */
    }
  }
  console.log('LOAD', 'requesting Festival fixture');
  await page.goto(
    `${baseURL}/e2e/fixtures/horizon-session.html?quality=${quality}&vehicle=tc1&capture=1&frames=1`,
    { waitUntil: 'domcontentloaded' },
  );
  console.log('LOAD', 'document ready; waiting for the real session and first rendered frame');
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.horizonReview?.state().draws >= 1);
  const initial = await state();
  if (!sourceIdentity) sourceIdentity = initial.sourceIdentity ?? null;
  if (sourceIdentityPath) {
    assert(hasSourceFingerprint(reviewSourceIdentity), 'Review identity must contain a source fingerprint.');
    assert.equal(
      initial.sourceIdentity?.fingerprint,
      reviewSourceIdentity.fingerprint,
      'The live fixture must match the requested review source before driving.',
    );
    assert.equal(
      sourceIdentity?.fingerprint,
      reviewSourceIdentity.fingerprint,
      'The recorded source identity must match the live review source.',
    );
  }
  assert.equal(initial.status.vehicleId, 'tc1');
  assert(initial.status.discovered.includes('harbour-welcome'));
  assert(
    initial.status.discovered.length < 16,
    'This journey must use natural discoveries, not a fully unlocked save.',
  );
  renderer = await page.evaluate(() => {
    const gl = document.querySelector('#world').getContext('webgl2');
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return extension
      ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
  });
  requireBrowserBackend(backend.name, renderer);
  pass('real session boot and natural harbour discovery', {
    discoveries: initial.status.discovered,
    renderer,
  });

  phase = 'manual driving';
  await page.keyboard.down('w');
  await page.waitForFunction(
    (start) => {
      const s = window.horizonReview.state();
      return s.status.speedKmh > 15 && Math.hypot(s.player.x - start.x, s.player.z - start.z) > 30;
    },
    initial.player,
    { timeout: 30000 },
  );
  await page.keyboard.up('w');
  const moving = await state();
  await draw();
  await page.keyboard.down('s');
  await page.waitForFunction(() => window.horizonReview.state().status.speedKmh < 1, undefined, {
    timeout: 20000,
  });
  await page.keyboard.up('s');
  const stopped = await state();
  const distance = Math.hypot(
    stopped.player.x - initial.player.x,
    stopped.player.z - initial.player.z,
  );
  assert(
    distance > 30,
    `Expected a meaningful launch and brake journey, measured ${distance.toFixed(2)} m`,
  );
  assert.equal(stopped.status.autopilot, false);
  pass('keyboard throttle, rendered movement and braking', {
    distanceM: distance,
    movingKmh: moving.status.speedKmh,
    stoppedKmh: stopped.status.speedKmh,
  });

  phase = 'map and pause';
  await page.keyboard.press('t');
  await page.locator('#festMap').waitFor({ state: 'visible' });
  assert.equal((await state()).paused, true);
  await page.locator('[data-fest="mapFilter"][data-value="races"]').click();
  await page.locator('[data-fest="mapSelect"][data-value="coast-to-summit"]').click();
  assert.equal(
    await page.locator('#festMapDetail [data-fest="travel"]').count(),
    0,
    'Undiscovered events must not allow fast travel.',
  );
  await capture('journey-map');
  await page.keyboard.press('Escape');
  await page.locator('#festMenu').waitFor({ state: 'visible' });
  pass('world map route preview, discovery gate and return to pause menu');

  phase = 'photo';
  await page.locator('[data-fest="photo"]').click();
  await page.locator('#festPhoto').waitFor({ state: 'visible' });
  const photoStart = await state();
  await page.locator('[data-fest="photoRight"]').click();
  await page.locator('[data-fest="photoRight"]').click();
  await capture('journey-photo');
  const photoEnd = await state();
  assert.equal(photoEnd.paused, true);
  assert(
    Math.hypot(...photoEnd.position.map((value, index) => value - photoStart.position[index])) > 1,
  );
  assert(Math.abs(photoEnd.status.time - photoStart.status.time) < 0.3);
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => !window.horizonReview.state().paused && !window.horizonReview.state().photo,
  );
  pass('paused photo orbit and Escape return', {
    cameraTravelM: Math.hypot(
      ...photoEnd.position.map((value, index) => value - photoStart.position[index]),
    ),
  });

  phase = 'garage round trip';
  for (const vehicle of ['apx01', 'eh3', 'rh3', 'tc1']) {
    await page.keyboard.press('Escape');
    await page.locator(`[data-fest="vehicle"][data-value="${vehicle}"]`).click();
    await page.waitForFunction(
      (id) => window.horizonReview.state().status.vehicleId === id,
      vehicle,
    );
    await draw();
    assert.equal((await state()).paused, false);
  }
  pass('garage Formula to road-car round trip through real worker and renderer');

  phase = 'travel and event entry';
  await page.keyboard.press('Escape');
  await page.locator('#festMenu [data-fest="travel"][data-value="harbour-welcome"]').click();
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () => window.horizonReview.state().status.card?.id === 'harbour-welcome',
  );
  await draw();
  await page.locator('#festCard [data-fest="start"]').click();
  await page.waitForFunction(() =>
    ['countdown', 'running'].includes(window.horizonReview.state().status.mode),
  );
  await page.keyboard.press('g');
  await page.waitForFunction(
    () =>
      window.horizonReview.state().status.mode === 'running' &&
      window.horizonReview.state().status.autopilot,
  );
  // Draw and sample in one synchronous browser task, so an incoming worker
  // status cannot change a rival between the model and DOM observations.
  const rivalHud = await page.evaluate(() => {
    window.horizonReview.draw();
    const status = window.horizonReview.state().status;
    const root = document.querySelector('#festRivals');
    const label = root?.querySelector(':scope > small');
    const visible = (element) =>
      !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible';
    return {
      mode: status.mode,
      rivals: status.event?.rivals ?? null,
      visible: visible(root),
      label: label?.textContent,
      labelVisible: visible(label),
      rowCount: root?.querySelectorAll('[data-relation]').length,
      rows: Object.fromEntries(['ahead', 'behind'].map((side) => {
        const row = root?.querySelector(`[data-relation="${side}"]`);
        const name = row?.querySelector('b');
        return [side, row ? {
          visible: visible(row),
          relation: row.querySelector('small')?.textContent,
          name: name?.textContent,
          nameElements: name?.childElementCount,
          gap: row.querySelector('em')?.textContent,
        } : null];
      })),
    };
  });
  assert.equal(rivalHud.mode, 'running');
  assert(rivalHud.rivals?.ahead || rivalHud.rivals?.behind, 'A running race must expose a live rival.');
  assert.equal(rivalHud.visible, true);
  assert.equal(rivalHud.labelVisible, true);
  assert.equal(rivalHud.label, 'ROUTE GAP');
  assert.equal(rivalHud.rowCount, Object.values(rivalHud.rivals).filter(Boolean).length);
  for (const side of ['ahead', 'behind']) {
    const expected = rivalHud.rivals[side], actual = rivalHud.rows[side];
    if (!expected) {
      assert.equal(actual, null, `No stale ${side} rival should remain.`);
      continue;
    }
    assert(actual, `The ${side} rival must have a HUD row.`);
    assert.equal(actual.visible, true);
    assert.equal(actual.relation, side.toUpperCase());
    assert.equal(actual.name, expected.name, 'Rival names must render as literal text.');
    assert.equal(actual.nameElements, 0, 'Rival names must not create HTML elements.');
    assert(Number.isFinite(expected.metres) && expected.metres >= 0);
    assert.equal(
      actual.gap,
      expected.metres >= 1000
        ? `${(expected.metres / 1000).toFixed(1)} KM`
        : `${Math.round(expected.metres)} M`,
      `The ${side} route gap must match the sampled worker status.`,
    );
  }
  pass('live worker rivals match the visible route-gap HUD', {
    rivals: rivalHud.rivals,
    displayed: rivalHud.rows,
  });
  await capture('journey-event');
  pass('discovered-event travel, start card, countdown, real rivals and route presentation');

  phase = 'race to result';
  let finished = false;
  for (let check = 0; check < 40; check++) {
    const current = await state();
    if (current.status.mode === 'finished') {
      finished = true;
      break;
    }
    console.log(
      'RACE',
      JSON.stringify({
        elapsed: current.status.event?.elapsed,
        progress: current.status.event?.progress,
        mode: current.status.mode,
      }),
    );
    await page.waitForTimeout(10000);
  }
  assert(finished, 'Harbour race must finish within the bounded review window.');
  const resultState = await state();
  assert.equal(resultState.results.length, 1);
  const result = resultState.results[0];
  assert.equal(result.eventId, 'harbour-welcome');
  assert.equal(result.completed, true);
  assert.equal(result.assisted, true, 'Autopilot verification must be marked assisted.');
  await capture('journey-results');
  assert.equal(await page.locator('#festRivals').isVisible(), false, 'Completed results must hide rival gaps.');
  pass('one typed completed result and visible results card', { result, rivalHudHidden: true });

  phase = 'result retry';
  await page.locator('#festResults [data-fest="retry"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () =>
      window.horizonReview.state().status.event?.id === 'harbour-welcome' &&
      ['countdown', 'running'].includes(window.horizonReview.state().status.mode),
  );
  await draw();
  assert.equal(
    (await state()).results.length,
    1,
    'Retry must not pay or emit the first run twice.',
  );
  assert.equal(await page.locator('#festResults').isVisible(), false);
  await page.waitForFunction(
    () =>
      window.horizonReview.state().status.mode === 'running' &&
      window.horizonReview.state().status.event.elapsed > 1,
  );
  assert.equal((await state()).paused, false);
  // Stop this second attempt through the normal pause-menu action. The
  // first run already established completion; this checks retry lifecycle
  // and distinct result identity without repeating the same full race.
  await page.keyboard.press('Escape');
  await page.locator('#festMenu [data-fest="cancel"]').click();
  await page.waitForFunction(() => window.horizonReview.state().status.mode === 'finished');
  await page.locator('#festMenu [data-fest="resume"]').click();
  await page.waitForFunction(() => window.horizonReview.state().results.length === 2);
  await draw();
  const retried = (await state()).results[1];
  assert.notEqual(retried.runId, result.runId);
  assert.equal(retried.completed, false);
  pass('keyboard Try Again streams and starts a distinct run without duplicate results', {
    firstRunId: result.runId,
    retryRunId: retried.runId,
    retryCompleted: retried.completed,
  });
  await page.locator('#festResults [data-fest="continue"]').click();
  await page.waitForFunction(() => window.horizonReview.state().status.mode === 'free');
  await draw();
  assert.equal(await page.locator('#festRivals').isVisible(), false, 'Free roam must hide rival gaps.');
  pass('results Continue returns to free roam', { rivalHudHidden: true });

  phase = 'exit';
  await page.keyboard.press('Escape');
  const beforeExit = await state();
  await page.locator('[data-fest="exit"]').click();
  await page.waitForFunction(() => window.horizonReview.state().exited);
  const exited = await state();
  assert.equal(await page.locator('#festivalHud').count(), 0);
  assert.equal(exited.ready, false);
  assert(exited.memory.geometries < beforeExit.memory.geometries);
  pass('session exit removes HUD, terminates session and releases geometry', {
    before: beforeExit.memory,
    after: exited.memory,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(failedAssets, []);
  phase = 'complete';
} catch (error) {
  const observed = await state().catch(() => null);
  if (observed)
    failureState = {
      paused: observed.paused,
      status: observed.status,
      player: observed.player,
      draws: observed.draws,
      results: observed.results,
    };
  steps.push({ name: phase, passed: false, error: error.stack ?? String(error) });
  console.error('FAILED', phase, error);
  process.exitCode = 1;
} finally {
  await writeFile(
    resolve(output, 'journey.json'),
    JSON.stringify(
      {
        version: 1,
        completed: phase === 'complete',
        sourceIdentity,
        reviewSourceIdentity,
        browserVersion: browser.version(),
        renderer,
        quality,
        viewport: { width: 960, height: 540 },
        methodology:
          'Real FestivalSession, workers, InputController and renderer. Natural initial discoveries. GPU submissions held between deliberate rendered states for software-GPU readback; no simulation acceleration. Manual keyboard launch/brake; race completion uses explicitly assisted production autopilot. This is not a hardware performance test.',
        errors,
        failedAssets,
        failureState,
        steps,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
