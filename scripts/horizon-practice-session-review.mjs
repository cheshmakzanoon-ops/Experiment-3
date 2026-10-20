/** Bounded actual Festival session/worker/input review. No synthetic status,
 * injected pose, assisted driving, or full-lap claim. Coordinate the browser
 * slot and freeze production source before running this script. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { createServer, preview } from 'vite';
import { chromium } from 'playwright';
import { browserBackend, requireBrowserBackend } from './browser-backend.ts';

const root = realpathSync(process.cwd());
const output = resolve(
  process.env.HORIZON_SESSION_OUTPUT ?? 'test-results/horizon-practice-session',
);
const backend = browserBackend(process.env.APEX_BROWSER_BACKEND);
const fixture = 'e2e/fixtures/horizon-session.html';
const buildDirectory = process.env.HORIZON_SESSION_BUILD_DIR;
let fixturePath = fixture;
const budgets = {
  startup: 180000,
  frame: 180000,
  action: 30000,
  entireReview: 600000,
  shutdown: 15000,
};
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const file = join(directory, entry.name);
        return entry.isDirectory() ? files(file) : [file];
      }),
    )
  ).flat();
}
async function fingerprint() {
  const hash = createHash('sha256');
  for (const file of [
    ...(await files(join(root, 'src'))),
    ...['package-lock.json', 'index.html', 'vite.config.ts'].map((name) => join(root, name)),
  ].sort()) {
    hash.update(relative(root, file).replaceAll('\\', '/') + '\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}
async function fixtureHashes() {
  return Object.fromEntries(
    await Promise.all(
      [
        fixture,
        'e2e/fixtures/horizon-session.ts',
        'scripts/horizon-practice-session-review.mjs',
      ].map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(join(root, file)))
          .digest('hex'),
      ]),
    ),
  );
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
await mkdir(output, { recursive: true });
const report = {
  passed: false,
  generatedAt: new Date().toISOString(),
  quality: 'medium',
  viewport: { width: 1120, height: 700 },
  backend: backend.name,
  budgetsMs: budgets,
  sourceFingerprint: await fingerprint(),
  fixtureSha256: await fixtureHashes(),
  scope:
    'Real production FestivalSession, renderer, workers, InputController, and HUD; brief native input and two paused views',
  limitations: [
    'No full lap, human playtest, or hardware frame-rate claim',
    'Automatic GPU submissions are stopped between explicit production draws; worker physics and native input remain active',
    'Startup measures session readiness plus the initial submitted frame; paused frame readbacks have their own 180-second deadlines',
  ],
  phase: 'prepare',
  steps: [],
  captures: [],
  errors: [],
  failedAssets: [],
  failedRequests: [],
  loadingStages: [],
};
const started = performance.now();
const save = () => writeFile(join(output, 'review.json'), JSON.stringify(report, null, 2) + '\n');
const phase = async (name) => {
  report.phase = name;
  console.log('PRACTICE_PHASE', name);
  await save();
};
const pass = async (name, data = {}) => {
  report.steps.push({ name, passed: true, ...data });
  console.log('PRACTICE_PASS', name);
  await save();
};
let browser,
  server,
  page,
  forceExit = false;
const state = () =>
  page.evaluate(() => {
    const { frame: _frame, ...value } = window.horizonReview.state();
    return value;
  });
const wait = (predicate, arg, timeout = budgets.action) =>
  page.waitForFunction(predicate, arg, { timeout });
const dom = () =>
  page.evaluate(() => {
    const practice = document.querySelector('#festPractice');
    return {
      practiceVisible: !!practice?.getClientRects().length,
      practiceText: practice?.textContent,
      practiceState: practice?.dataset.state,
      resultText: document.querySelector('#festResults')?.textContent,
      splitCount: document.querySelector('#festPracticeSplits')?.children.length,
    };
  });
async function draw(label) {
  await phase(label);
  const before = performance.now();
  await bounded(label, budgets.frame, () => page.evaluate(() => window.horizonReview.draw()));
  return performance.now() - before;
}
async function menu() {
  if (!(await state()).paused) await page.keyboard.press('Escape');
  await page.locator('#festMenu').waitFor({ state: 'visible' });
}
async function capture(name) {
  const before = await state();
  assert.equal(before.paused, true, 'Capture must pause through the production UI');
  assert.equal(before.photo, true, 'Capture must use production photo mode');
  await phase(`paused capture ${name}`);
  const begun = performance.now();
  await bounded(`paused capture ${name}`, budgets.frame, async () => {
    const image = await page.evaluate(() => {
      window.horizonReview.draw();
      const image = window.horizonReview.image();
      const gl = document.querySelector('#world').getContext('webgl2');
      return { image, glError: gl.getError(), contextLost: gl.isContextLost() };
    });
    assert.equal(image.glError, 0);
    assert.equal(image.contextLost, false);
    await writeFile(
      join(output, `${name}-scene.png`),
      Buffer.from(image.image.split(',')[1], 'base64'),
    );
    await page.screenshot({ path: join(output, `${name}-hud.png`), timeout: budgets.frame });
    const after = await state();
    report.captures.push({
      name,
      elapsedMs: performance.now() - begun,
      paused: after.paused,
      photo: after.photo,
      camera: after.position,
      player: after.player,
      simulationTimeBefore: before.status.time,
      simulationTimeAfter: after.status.time,
      render: after.render,
      memory: after.memory,
      glError: image.glError,
      contextLost: image.contextLost,
      files: [`${name}-scene.png`, `${name}-hud.png`],
    });
  });
  await save();
}
try {
  await bounded('entire Festival practice review', budgets.entireReview, async () => {
    if (buildDirectory) {
      const identity = JSON.parse(
        await readFile(join(buildDirectory, 'BUILD_IDENTITY.json'), 'utf8'),
      );
      assert.equal(
        identity.fingerprint,
        report.sourceFingerprint,
        'Production build source fingerprint mismatch',
      );
      assert.deepEqual(
        JSON.parse(await readFile(join(buildDirectory, 'HORIZON_FIXTURE_IDENTITY.json'), 'utf8')),
        report.fixtureSha256,
        'Production build fixture identity mismatch',
      );
      const built = await preview({
        root,
        configFile: false,
        base: './',
        build: { outDir: resolve(buildDirectory) },
        preview: {
          host: '127.0.0.1',
          port: Number(process.env.HORIZON_SESSION_PORT ?? 5319),
          strictPort: true,
        },
        logLevel: 'warn',
      });
      server = {
        resolvedUrls: built.resolvedUrls,
        close: () =>
          new Promise((resolve, reject) =>
            built.httpServer.close((error) => (error ? reject(error) : resolve())),
          ),
      };
      fixturePath = basename(fixture);
      report.servingMode = 'bundled';
      report.buildIdentity = identity;
    } else {
      server = await createServer({
        root,
        configFile: false,
        cacheDir: join(output, 'vite-cache'),
        logLevel: 'warn',
        define: {
          __APEX_SOURCE_FINGERPRINT__: JSON.stringify(report.sourceFingerprint),
          __APEX_SOURCE_COMMIT__: 'null',
        },
        worker: { format: 'es' },
        optimizeDeps: { entries: [fixture], include: ['three'] },
        server: {
          host: '127.0.0.1',
          port: Number(process.env.HORIZON_SESSION_PORT ?? 5319),
          strictPort: true,
          hmr: false,
          fs: { allow: [root, realpathSync(join(root, 'node_modules'))] },
        },
      });
      await server.listen();
      report.servingMode = 'development';
    }
    browser = await chromium.launch({
      headless: backend.headless,
      executablePath: process.env.HORIZON_REVIEW_EXECUTABLE || undefined,
      args: ['--no-sandbox', ...backend.args],
      timeout: 30000,
    });
    page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
    page.setDefaultTimeout(budgets.action);
    page.on('pageerror', (error) => report.errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.push(message.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 400)
        report.failedAssets.push({ status: response.status(), url: response.url() });
    });
    page.on('requestfailed', (request) =>
      report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }),
    );
    page.on('crash', () => {
      report.targetCrashed = true;
    });
    await page.exposeFunction('recordPracticeLoading', (entry) => {
      report.loadingStages.push({ ...entry, elapsedMs: performance.now() - started });
      console.log('PRACTICE_LOADING', JSON.stringify(entry));
    });
    await page.addInitScript(() => {
      let last = '';
      new MutationObserver(() => {
        const node = document.querySelector('#loading');
        if (!node) return;
        const value = { text: node.textContent, hidden: node.hidden },
          key = JSON.stringify(value);
        if (key !== last) {
          last = key;
          window.recordPracticeLoading(value).catch(() => {});
        }
      }).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['hidden'],
      });
    });
    await phase('startup and initial production draw');
    const startup = performance.now();
    await bounded('Festival startup', budgets.startup, async () => {
      await page.goto(
        `${server.resolvedUrls.local[0]}${fixturePath}?quality=medium&vehicle=rh3&travel=saltmarsh-practice&capture=1&frames=1`,
        { waitUntil: 'domcontentloaded', timeout: budgets.startup },
      );
      await wait(() => !!window.horizonReview, undefined, budgets.startup);
      await page.evaluate(() => window.horizonReview.rendering(false));
      await page.locator('#loading').waitFor({ state: 'hidden', timeout: budgets.startup });
      await wait(
        () =>
          window.horizonReview.state().ready &&
          window.horizonReview.state().status.card?.id === 'saltmarsh-practice',
        undefined,
        budgets.startup,
      );
      await page.evaluate(() => window.horizonReview.draw());
    });
    report.startupMs = performance.now() - startup;
    const initial = await state();
    assert.equal(initial.sourceIdentity.fingerprint, report.sourceFingerprint);
    assert.equal(initial.status.vehicleId, 'rh3');
    assert.equal(initial.status.autopilot, false);
    report.renderer = await page.evaluate(() => {
      const gl = document.querySelector('#world').getContext('webgl2'),
        debug = gl.getExtension('WEBGL_debug_renderer_info');
      return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    requireBrowserBackend(backend.name, report.renderer);
    await pass('fresh-save RH3 travel opens actual Saltmarsh Practice card', {
      startupMs: report.startupMs,
      sourceIdentity: initial.sourceIdentity,
    });

    await phase('native Start click and manual pedals');
    await page.locator('#festCard [data-fest="start"]').click();
    await wait(() => window.horizonReview.state().status.mode === 'running');
    const grid = await state();
    assert.equal(grid.status.event.practice.valid, true);
    assert.equal(grid.status.event.practice.referenceTime, null);
    await page.keyboard.down('w');
    try {
      await wait((start) => {
        const s = window.horizonReview.state();
        return s.status.speedKmh > 20 && Math.hypot(s.player.x - start.x, s.player.z - start.z) > 3;
      }, grid.player);
    } finally {
      await page.keyboard.up('w');
    }
    const moving = await state();
    await page.keyboard.down('s');
    try {
      await wait(() => window.horizonReview.state().status.speedKmh < 0.7);
      await draw('production practice HUD after native driving');
    } finally {
      await page.keyboard.up('s');
    }
    const stopped = await state(),
      runningDom = await dom();
    assert.equal(stopped.status.autopilot, false);
    assert.equal(stopped.status.event.offRoute, false);
    assert.equal(runningDom.practiceVisible, true);
    assert.equal(runningDom.splitCount, 3);
    assert.match(runningDom.practiceText, /SET YOUR FIRST CLEAN LAP/);
    assert.equal(stopped.status.event.practice.valid, true);
    await pass('real Start, W/S motion, braking, and worker-fed practice HUD', {
      movingKmh: moving.status.speedKmh,
      stoppedKmh: stopped.status.speedKmh,
      distanceM: Math.hypot(stopped.player.x - grid.player.x, stopped.player.z - grid.player.z),
      practice: stopped.status.event.practice,
      dom: runningDom,
    });

    await menu();
    assert.equal((await dom()).practiceVisible, false);
    await page.locator('#festMenu [data-fest="photo"]').click();
    await page.locator('#festPhoto').waitFor({ state: 'visible' });
    assert.equal((await dom()).practiceVisible, false);
    await pass('native menu and photo modes suppress practice immediately');
    await capture('rh3-practice-photo');
    await page.locator('#festPhoto [data-fest="photoRight"]').click();
    await page.locator('#festPhoto [data-fest="photoRight"]').click();
    await capture('rh3-practice-photo-orbit');
    await page.keyboard.press('Escape');
    await wait(() => !window.horizonReview.state().paused && !window.horizonReview.state().photo);

    await phase('native reset invalidation');
    await page.keyboard.press('r');
    await wait(() => window.horizonReview.state().status.event?.practice?.reason === 'reset');
    await page.keyboard.down('s');
    try {
      await draw('production reset-invalidated practice HUD');
    } finally {
      await page.keyboard.up('s');
    }
    const invalid = await state(),
      invalidDom = await dom();
    assert.equal(invalid.status.event.practice.valid, false);
    assert.match(invalidDom.practiceText, /CAR RESET/);
    assert.match(invalidDom.practiceText, /UNRANKED/);
    await pass('R resets the real car and invalidates its displayed benchmark', {
      practice: invalid.status.event.practice,
      dom: invalidDom,
    });

    await menu();
    await page.locator('#festMenu [data-fest="cancel"]').click();
    await page.locator('#festMenu [data-fest="resume"]').click();
    await wait(
      () =>
        window.horizonReview.state().status.mode === 'finished' &&
        window.horizonReview.state().results.length > 0,
    );
    await draw('production abandoned-practice result');
    const abandoned = await state();
    assert.equal(abandoned.results.at(-1).abandoned, true);
    assert.equal(abandoned.results.at(-1).practice.newBest, false);
    await page.locator('#festResults [data-fest="retry"]').click();
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await wait(
      () =>
        window.horizonReview.state().status.mode === 'running' &&
        !window.horizonReview.state().paused,
    );
    const retry = await state();
    assert.equal(retry.status.event.id, 'saltmarsh-practice');
    assert.equal(retry.status.event.practice.valid, true);
    assert.equal(retry.status.event.practice.reason, null);
    assert.equal(retry.status.event.practice.referenceTime, null);
    assert.equal(retry.status.event.practice.splits.length, 0);
    await page.keyboard.down('s');
    try {
      await draw('production clean retry HUD');
    } finally {
      await page.keyboard.up('s');
    }
    const retryDom = await dom();
    assert.equal(retryDom.practiceVisible, true);
    assert.equal(retryDom.practiceState, 'clean');
    assert.doesNotMatch(retryDom.practiceText, /UNRANKED|CAR RESET/);
    await pass('real Try Again returns to a fresh clean attempt without inventing a benchmark', {
      practice: retry.status.event.practice,
      dom: retryDom,
    });
    await menu();
    await page.locator('#festMenu [data-fest="exit"]').click();
    await wait(() => window.horizonReview.state().exited);
    assert.equal(await page.locator('#festivalHud').count(), 0);
    await pass('native exit disposes the session HUD');
    report.sourceStable = (await fingerprint()) === report.sourceFingerprint;
    report.fixtureStable =
      JSON.stringify(await fixtureHashes()) === JSON.stringify(report.fixtureSha256);
    assert.equal(report.sourceStable, true);
    assert.equal(report.fixtureStable, true);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.failedAssets, []);
    assert.equal(report.captures.length, 2);
    report.passed = true;
  });
} catch (error) {
  report.failure = { phase: report.phase, message: error.message, stack: error.stack };
  report.sourceStable = (await fingerprint()) === report.sourceFingerprint;
  await save();
  if (page)
    report.failureState = await bounded('failure observation', 5000, state).catch((e) => ({
      unavailable: e.message,
    }));
  process.exitCode = 1;
} finally {
  if (page)
    await bounded('release native pedals', 3000, async () => {
      await page.keyboard.up('w');
      await page.keyboard.up('s');
    }).catch(() => {});
  try {
    await bounded('browser shutdown', budgets.shutdown, () => browser?.close());
  } catch (error) {
    report.cleanupError = error.message;
    report.passed = false;
    forceExit = true;
    process.exitCode = 1;
  }
  await bounded('server shutdown', budgets.shutdown, () => server?.close()).catch((error) => {
    report.serverCleanupError = error.message;
    report.passed = false;
    forceExit = true;
    process.exitCode = 1;
  });
  report.elapsedMs = performance.now() - started;
  await save();
}
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      steps: report.steps.length,
      captures: report.captures.length,
      failure: report.failure,
      output,
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
if (forceExit) process.exit(1);
