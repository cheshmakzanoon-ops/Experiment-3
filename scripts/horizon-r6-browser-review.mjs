/** Focused R6 optics review. One Chromium, sequential pages, no target-device
 * FPS claim. Run the separate horizon-browser-review.mjs for the real
 * worker/input/HUD journey. Serve this same checkout with
 * HORIZON_REVIEW_PORT=5188 node scripts/solvane-review-server.mjs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { browserBackend, requireBrowserBackend } from './browser-backend.ts';

const base = process.env.HORIZON_REVIEW_URL ?? 'http://127.0.0.1:5188';
const output = resolve(process.env.HORIZON_REVIEW_OUTPUT ?? 'test-results/horizon-r6-review');
const backend = browserBackend(process.env.APEX_BROWSER_BACKEND);
const identityPath = process.env.HORIZON_REVIEW_IDENTITY;
const expectedIdentity = identityPath ? JSON.parse(await readFile(identityPath, 'utf8')) : null;
const choices = ['smoke', 'dust', 'water', 'night'];
const selected = process.env.HORIZON_R6_SCENARIOS?.split(',') ?? choices;
assert(
  selected.length > 0 && selected.every((choice) => choices.includes(choice)),
  'Unknown R6 scenario',
);
await mkdir(output, { recursive: true });
const sourceFiles = [
  'scripts/horizon-r6-browser-review.mjs',
  'e2e/fixtures/horizon-r6-effects.ts',
  'e2e/fixtures/horizon-r6-effects.html',
  'e2e/fixtures/horizon-session.ts',
];
const report = {
  kind: 'horizon-r6-frozen-optics-and-measured-motion',
  generatedAt: new Date().toISOString(),
  sourceIdentity: expectedIdentity,
  validationSourceSha256: Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      ]),
    ),
  ),
  environment: { backend: backend.name, oneBrowser: true, baseURL: base },
  limitations: {
    softwareRendering: true,
    targetDevicePerformance: false,
    humanPlaytest: false,
    dryFrames: 'isolated Effects on actual carved ground; real recorded controls and physics',
    nightFrames: 'frozen production composer and geometry; only practical-light intensity toggled',
    gameplayJourney: 'run scripts/horizon-browser-review.mjs separately',
  },
  phase: 'launch',
  effects: [],
  night: [],
  errors: [],
  failedAssets: [],
  warnings: [],
  passed: false,
};
let browser = null,
  activePage = null;
const started = performance.now();
const hasFingerprint = (identity) =>
  typeof identity?.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(identity.fingerprint);
const save = () =>
  writeFile(resolve(output, 'review.json'), JSON.stringify(report, null, 2) + '\n');
const observe = (page) => {
  activePage = page;
  page.setDefaultTimeout(240000);
  page.on('pageerror', (error) =>
    report.errors.push({ phase: report.phase, message: error.message }),
  );
  page.on('console', (message) => {
    if (message.type() === 'error')
      report.errors.push({ phase: report.phase, message: message.text() });
    if (message.type() === 'warning')
      report.warnings.push({ phase: report.phase, message: message.text() });
  });
  page.on('response', (response) => {
    if (response.status() >= 400)
      report.failedAssets.push({
        phase: report.phase,
        status: response.status(),
        url: response.url(),
      });
  });
};
const identify = (identity) => {
  assert(hasFingerprint(identity), 'The served fixture must expose a real source fingerprint');
  if (report.sourceIdentity)
    assert.equal(
      identity.fingerprint,
      report.sourceIdentity.fingerprint,
      'The tested source changed or does not match the requested identity',
    );
  else report.sourceIdentity = identity;
};
const assertClean = () => {
  assert.equal(report.errors.length, 0, `Browser errors: ${JSON.stringify(report.errors)}`);
  assert.equal(
    report.failedAssets.length,
    0,
    `Failed assets: ${JSON.stringify(report.failedAssets)}`,
  );
};
async function saveImages(images) {
  const files = [];
  for (const { name, image } of images) {
    assert(/^[a-z0-9-]+$/.test(name), 'Invalid review image name');
    assert(image.startsWith('data:image/png;base64,'), 'Expected the actual canvas PNG');
    const bytes = Buffer.from(image.slice('data:image/png;base64,'.length), 'base64');
    assert(bytes.length > 1000, 'PNG readback unexpectedly empty');
    await writeFile(resolve(output, `${name}.png`), bytes);
    files.push({
      file: `${name}.png`,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    });
  }
  return files;
}
async function draw(page) {
  await page.evaluate(() => {
    window.horizonReview.draw();
    // Synchronous readback drains a software GPU queue before the next frame.
    return window.horizonReview.image().length;
  });
}

try {
  browser = await chromium.launch({
    executablePath: process.env.HORIZON_REVIEW_EXECUTABLE || undefined,
    headless: backend.headless,
    args: ['--no-sandbox', ...backend.args],
  });
  report.environment.browser = browser.version();
  for (const scenario of selected.filter((choice) => choice !== 'night')) {
    report.phase = `effects:${scenario}`;
    console.log('R6_BEGIN', report.phase);
    await save();
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    observe(page);
    await page.goto(`${base}/e2e/fixtures/horizon-r6-effects.html`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => !!window.horizonR6Effects?.capture);
    identify(await page.evaluate(() => window.horizonR6Effects.sourceIdentity()));
    const { images, ...result } = await page.evaluate(
      (choice) => window.horizonR6Effects.capture(choice),
      scenario,
    );
    identify(result.sourceIdentity);
    requireBrowserBackend(backend.name, result.rendererName);
    result.images = await saveImages(images);
    report.effects.push(result);
    await save();
    assert.equal(
      result.passed,
      true,
      `Failed ${scenario} checks: ${Object.entries(result.checks)
        .filter(([, passed]) => !passed)
        .map(([name]) => name)
        .join(', ')}`,
    );
    assertClean();
    console.log(
      'R6_PASS',
      scenario,
      JSON.stringify({
        peakActive: result.peakActive,
        captures: result.captures.length,
        recordingMs: result.cpuRecordingMs,
      }),
    );
    await page.close();
    activePage = null;
  }
  if (selected.includes('night')) {
    report.phase = 'night:load';
    console.log('R6_BEGIN', report.phase);
    await save();
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    observe(page);
    await page.goto(
      `${base}/e2e/fixtures/horizon-session.html?quality=medium&vehicle=tc1&lighting=night&weather=rain&capture=1&frames=1`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.horizonReview?.state().draws >= 1);
    const initial = await page.evaluate(() => window.horizonReview.state());
    identify(initial.sourceIdentity);
    assert.equal(
      initial.details?.loaded,
      true,
      'Night review must retain the production detail kit',
    );
    const rendererName = await page.evaluate(() => {
      const gl = document.querySelector('#world').getContext('webgl2');
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      return gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    });
    requireBrowserBackend(backend.name, rendererName);
    const nightCameras = [
      {
        kind: 'storefront',
        position: [574.6115210853, 6.0416001034, -2601.42],
        target: [567.6115210853, 5.7330224657, -2593.72],
      },
      {
        kind: 'festoon',
        position: [512, 6.0600000858, -2600.5],
        target: [521, 4.9, -2599.185],
      },
    ];
    for (const camera of nightCameras) {
      const { kind } = camera;
      report.phase = `night:${kind}`;
      console.log('R6_BEGIN', report.phase);
      // Both eye positions were checked against the actual authored building
      // footprints and carved road; these are fixed review cameras only.
      await page.evaluate(
        ({ position, target }) => window.horizonReview.inspect(position, target),
        camera,
      );
      await page.waitForFunction(() => window.horizonReview.state().paused);
      // Settle the real bounded light fade and the existing six-face probe.
      // This never changes the source snapshot or renderer quality.
      for (let i = 0; i < 9; i++) {
        await page.waitForTimeout(85);
        await draw(page);
      }
      const state = await page.evaluate(() => window.horizonReview.state());
      identify(state.sourceIdentity);
      assert(
        state.practicalLights.sockets > 0 && state.practicalLights.active > 0,
        'Authored practical lights must actually be active',
      );
      assert(
        state.practicalLights.active <= 2,
        'Medium quality admits at most two practical lights',
      );
      const { images, ...result } = await page.evaluate(
        (value) => window.horizonReview.practicalOptics(`night-${value}`),
        kind,
      );
      identify(result.sourceIdentity);
      result.camera = camera;
      result.rendererName = rendererName;
      result.images = await saveImages(images);
      result.checks = {
        visibleLightContribution:
          result.difference.changedByAtLeastTwo > 25 && result.difference.maxChannelDelta >= 2,
        unchangedPhysics: result.physicsUnchanged,
        unchangedCamera: result.cameraUnchanged,
        exactRepeatedControl: result.repeatDifference.changedPixels === 0,
        fixedCapacity: result.practicalLights.capacity === 4 && result.lights.length === 4,
        boundedMediumLights:
          result.practicalLights.active > 0 && result.practicalLights.active <= 2,
        noShadowPassAdded: result.lights.every((light) => light.castShadow === false),
        unchangedDrawCalls: result.before.calls === result.after.calls,
        unchangedTriangles: result.before.triangles === result.after.triangles,
        unchangedGeometryAllocation:
          result.before.memory.geometries === result.after.memory.geometries,
        unchangedTextureAllocation: result.before.memory.textures === result.after.memory.textures,
        noGlErrors: result.errors.length === 0,
      };
      result.passed = Object.values(result.checks).every(Boolean);
      report.night.push(result);
      await save();
      assert.equal(
        result.passed,
        true,
        `Failed ${kind} checks: ${Object.entries(result.checks)
          .filter(([, passed]) => !passed)
          .map(([name]) => name)
          .join(', ')}`,
      );
      assertClean();
      console.log(
        'R6_PASS',
        kind,
        JSON.stringify({
          changedPixels: result.difference.changedPixels,
          activeLights: result.practicalLights.active,
        }),
      );
    }
    await page.close();
    activePage = null;
  }
  assertClean();
  report.phase = 'complete';
  report.passed = true;
} catch (error) {
  report.failure = error.stack ?? String(error);
  if (activePage && !activePage.isClosed()) {
    try {
      report.failureState = await activePage.evaluate(() => window.horizonReview?.state() ?? null);
    } catch {
      /* A renderer crash must not hide the original failure. */
    }
  }
  console.error('R6_FAIL', report.phase, error.message ?? String(error));
  process.exitCode = 1;
} finally {
  report.wallMs = performance.now() - started;
  await save();
  await browser?.close();
}
console.log(
  'R6_RESULT',
  JSON.stringify({
    passed: report.passed,
    report: resolve(output, 'review.json'),
    phase: report.phase,
  }),
);
