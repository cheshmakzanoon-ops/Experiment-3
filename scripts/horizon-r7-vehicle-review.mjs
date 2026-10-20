/** Bounded isolated production-car comparison with no product feature toggle.
 * Set HORIZON_R7_VEHICLE_BASELINE_DIR to a directory containing saved
 * closed-body.ts and festival-detail.ts, or HORIZON_R7_VEHICLE_BASELINE_REF to
 * a full commit SHA. By default only these two modules differ between the frozen source
 * snapshots. A private Vite load hook serves their actual bytes at their normal
 * module IDs, preserving normal TypeScript and import processing.
 *
 * Run: node --experimental-transform-types scripts/horizon-r7-vehicle-review.mjs
 * HORIZON_R7_VEHICLE_CHANGED_FILES, HORIZON_R7_VEHICLE_SHOTS and
 * HORIZON_R7_VEHICLE_BUDGET accept explicit JSON for later car revisions;
 * the report records these inputs. The original R7 profile remains the default.
 * One Chromium, two sequential pages, deterministic views per variant.
 * Outputs are isolated geometry evidence, not a full-world performance claim. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { chromium } from 'playwright';
import { horizonReviewServer } from './horizon-review-server.mjs';
import { browserBackend, requireBrowserBackend } from './browser-backend.ts';

const root = realpathSync(resolve(process.env.HORIZON_REVIEW_ROOT ?? process.cwd()));
const output = resolve(process.env.HORIZON_REVIEW_OUTPUT ?? 'test-results/horizon-r7-vehicle');
const port = Number(process.env.HORIZON_R7_VEHICLE_PORT ?? 5192);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Invalid review port');
const backend = browserBackend(process.env.APEX_BROWSER_BACKEND);
const baselineDir = process.env.HORIZON_R7_VEHICLE_BASELINE_DIR;
const baselineRef = process.env.HORIZON_R7_VEHICLE_BASELINE_REF;
assert(
  Boolean(baselineDir) !== Boolean(baselineRef),
  'Provide exactly one baseline directory or full commit SHA',
);
if (baselineRef)
  assert(/^[0-9a-f]{40}$/.test(baselineRef), 'Baseline ref must be a full commit SHA');
const changedFiles = JSON.parse(process.env.HORIZON_R7_VEHICLE_CHANGED_FILES ?? 'null') ?? [
  'src/rendering/vehicle-bodies/closed-body.ts',
  'src/rendering/vehicle-bodies/festival-detail.ts',
];
assert(Array.isArray(changedFiles) && changedFiles.length > 0);
assert(changedFiles.every((file) => /^src\/rendering\/vehicle-bodies\/[a-z-]+\.ts$/.test(file)));
const selectedShots = JSON.parse(process.env.HORIZON_R7_VEHICLE_SHOTS ?? 'null') ?? [
  'rh3-front-quarter',
  'rh3-windscreen',
  'rh3-side-glass',
  'sc7-rear-glass',
];
assert(Array.isArray(selectedShots) && selectedShots.length > 0);
const explicitBudget = process.env.HORIZON_R7_VEHICLE_BUDGET;
const resourceBudget = JSON.parse(
  explicitBudget ?? '{"calls":0,"geometries":0,"textures":0,"materials":0}',
);
for (const key of ['calls', 'geometries', 'textures', 'materials'])
  assert(
    Number.isInteger(resourceBudget[key]) && resourceBudget[key] >= 0,
    `Invalid ${key} budget`,
  );
const fixtureFiles = [
  'e2e/fixtures/horizon-r7-vehicle.html',
  'e2e/fixtures/horizon-r7-vehicle.ts',
  'scripts/horizon-r7-vehicle-review.mjs',
  'scripts/browser-backend.ts',
  'scripts/horizon-review-server.mjs',
];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function tree(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await tree(path)));
    else result.push(path);
  }
  return result;
}
const identityFiles = [
  ...(await tree(join(root, 'src'))),
  ...['package-lock.json', 'index.html', 'vite.config.ts'].map((file) => join(root, file)),
].sort();
const current = new Map();
for (const file of [...identityFiles, ...fixtureFiles.map((file) => join(root, file))])
  current.set(file, await readFile(file));
const before = new Map(current);
for (const file of changedFiles) {
  const bytes = baselineDir
    ? await readFile(resolve(baselineDir, basename(file)))
    : execFileSync('git', ['show', `${baselineRef}:${file}`], {
        cwd: root,
        maxBuffer: 4 * 1024 * 1024,
      });
  before.set(join(root, file), bytes);
}
assert(
  changedFiles.some(
    (file) => sha(before.get(join(root, file))) !== sha(current.get(join(root, file))),
  ),
  'Baseline and revised vehicle sources are identical',
);
const fingerprint = (snapshot) => {
  const hash = createHash('sha256');
  for (const file of identityFiles) {
    hash.update(relative(root, file).replaceAll('\\', '/') + '\0');
    hash.update(snapshot.get(file));
    hash.update('\0');
  }
  return hash.digest('hex');
};
await mkdir(output, { recursive: true });
const report = {
  kind: 'horizon-isolated-production-vehicle-comparison',
  selectedShots,
  resourceBudget,
  generatedAt: new Date().toISOString(),
  sourceBoundary: {
    method:
      'One frozen current application source snapshot; baseline replaces exactly the listed vehicle modules with saved original bytes. All imports retain their normal production module IDs. New modules remain in both snapshots and are used only if imported by that variant.',
    differingFiles: changedFiles,
    baselineCommitForThoseFiles: baselineRef ?? null,
    frozenFileCount: current.size,
    fixtures: Object.fromEntries(
      fixtureFiles.map((file) => [file, sha(current.get(join(root, file)))]),
    ),
    before: {
      fingerprint: fingerprint(before),
      files: Object.fromEntries(
        changedFiles.map((file) => [file, sha(before.get(join(root, file)))]),
      ),
    },
    after: {
      fingerprint: fingerprint(current),
      files: Object.fromEntries(
        changedFiles.map((file) => [file, sha(current.get(join(root, file)))]),
      ),
    },
    fullOldApplicationClaimed: false,
  },
  environment: { backend: backend.name, oneBrowser: true, sequentialPages: true },
  limits: { launchMs: 60000, variantMs: 180000, closeMs: 15000 },
  limitations: {
    isolatedProductionVehicle: true,
    fullWorldRenderer: false,
    motionOrPhysicsComparison: false,
    targetDevicePerformance: false,
    humanVisualAcceptance: false,
    calibratedPhysicalLighting: false,
    sourcePhotosRenderedInFixture: false,
  },
  variants: [],
  comparisons: [],
  errors: [],
  failedAssets: [],
  warnings: [],
  passed: false,
};
const save = () =>
  writeFile(resolve(output, 'review.json'), JSON.stringify(report, null, 2) + '\n');
let browser = null,
  server = null,
  activePage = null;
const started = performance.now();
const baselinePixels = new Map();
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
function difference(a, b) {
  assert.equal(a.length, b.length, 'Readback dimensions differ');
  let changedPixels = 0,
    maxChannelDelta = 0,
    totalChannelDelta = 0;
  for (let i = 0; i < a.length; i += 4) {
    let changed = false;
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs(a[i + c] - b[i + c]);
      changed ||= delta !== 0;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      totalChannelDelta += delta;
    }
    if (changed) changedPixels++;
  }
  return {
    changedPixels,
    maxChannelDelta,
    meanChannelDelta: totalChannelDelta / ((a.length / 4) * 3),
  };
}
async function saveFrame(frame, filename) {
  assert(frame.image.startsWith('data:image/png;base64,'), 'Expected actual canvas PNG');
  const png = Buffer.from(frame.image.slice('data:image/png;base64,'.length), 'base64');
  const rgba = Buffer.from(frame.rgba, 'base64');
  assert(png.length > 1000, 'Empty image readback');
  await writeFile(resolve(output, filename), png);
  return {
    rgba,
    info: {
      file: filename,
      bytes: png.length,
      sha256: sha(png),
      rgbaSha256: sha(rgba),
      calls: frame.calls,
      triangles: frame.triangles,
      memory: frame.memory,
      glError: frame.glError,
    },
  };
}
async function serve(snapshot, variant, loads) {
  const dependencyRoot = realpathSync(join(root, 'node_modules'));
  return horizonReviewServer(
    {
      root,
      configFile: false,
      cacheDir: resolve(output, 'vite-cache'),
      base: './',
      define: {
        __APEX_SOURCE_FINGERPRINT__: JSON.stringify(fingerprint(snapshot)),
        __APEX_SOURCE_COMMIT__: 'null',
      },
      plugins: [
        {
          name: `horizon-r7-frozen-${variant}`,
          enforce: 'pre',
          load(id) {
            const [file, query = ''] = id.split('?');
            const parameters = new URLSearchParams(query);
            const bytes = snapshot.get(file);
            if (
              !bytes ||
              !['.ts', '.js', '.json', '.glsl', '.frag', '.vert'].includes(extname(file))
            )
              return null;
            // Match Vite's raw-import contract while keeping shader bytes frozen.
            // Serving literal GLSL at a ?raw module ID produces invalid JavaScript.
            if (parameters.has('raw')) {
              loads.set(relative(root, file).replaceAll('\\', '/'), sha(bytes));
              return `export default ${JSON.stringify(bytes.toString('utf8'))};`;
            }
            if (parameters.has('url') || parameters.has('worker') || parameters.has('sharedworker'))
              return null;
            loads.set(relative(root, file).replaceAll('\\', '/'), sha(bytes));
            return bytes.toString('utf8');
          },
        },
      ],
      optimizeDeps: { entries: ['e2e/fixtures/horizon-r7-vehicle.html'], include: ['three'] },
      server: {
        host: '127.0.0.1',
        port,
        strictPort: true,
        hmr: false,
        fs: { strict: true, allow: [root, dependencyRoot] },
      },
      logLevel: 'warn',
    },
    { output, fixture: fixtureFiles[0], variant },
  );
}

async function loadFixture(page, url) {
  let moduleErrorHandler;
  const moduleFailure = new Promise((_, reject) => {
    moduleErrorHandler = (error) => reject(error);
    page.on('pageerror', moduleErrorHandler);
  });
  try {
    await Promise.race([
      (async () => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.horizonR7Vehicle?.capture);
      })(),
      moduleFailure,
    ]);
  } finally {
    page.off('pageerror', moduleErrorHandler);
  }
}

try {
  await save();
  browser = await bounded('Chromium launch', report.limits.launchMs, () =>
    chromium.launch({
      executablePath: process.env.HORIZON_REVIEW_EXECUTABLE || undefined,
      headless: backend.headless,
      args: ['--no-sandbox', ...backend.args],
    }),
  );
  report.environment.browser = browser.version();
  for (const [variant, snapshot] of [
    ['before', before],
    ['after', current],
  ]) {
    const loads = new Map(),
      began = performance.now();
    const variantRecord = {
      variant,
      fingerprint: fingerprint(snapshot),
      views: [],
      servedVehicleModules: {},
      wallMs: null,
    };
    report.variants.push(variantRecord);
    console.log('R7_VEHICLE_BEGIN', variant);
    server = await serve(snapshot, variant, loads);
    variantRecord.servingMode = server.servingMode;
    variantRecord.buildMs = server.buildMs;
    await bounded(`${variant} views`, report.limits.variantMs, async () => {
      activePage = await browser.newPage({
        viewport: { width: 1120, height: 700 },
        deviceScaleFactor: 1,
      });
      activePage.setDefaultTimeout(120000);
      activePage.on('pageerror', (error) => {
        report.errors.push({ variant, message: error.message, stack: error.stack });
        console.error('R7_VEHICLE_PAGE_ERROR', variant, error.stack || error.message);
      });
      activePage.on('console', (message) => {
        if (message.type() === 'error') report.errors.push({ variant, message: message.text() });
        if (message.type() === 'warning')
          report.warnings.push({ variant, message: message.text() });
      });
      activePage.on('response', (response) => {
        if (response.status() >= 400)
          report.failedAssets.push({ variant, status: response.status(), url: response.url() });
      });
      await loadFixture(activePage, server.fixtureUrl);
      const identity = await activePage.evaluate(() => window.horizonR7Vehicle.sourceIdentity());
      assert.equal(
        identity.fingerprint,
        fingerprint(snapshot),
        'Frozen source fingerprint mismatch',
      );
      const availableShots = await activePage.evaluate(() => window.horizonR7Vehicle.shots);
      assert(
        selectedShots.every((name) => availableShots.includes(name)),
        'Unknown camera view',
      );
      for (const name of selectedShots) {
        const result = await activePage.evaluate(
          (shot) => window.horizonR7Vehicle.capture(shot),
          name,
        );
        assert.equal(result.sourceIdentity.fingerprint, identity.fingerprint);
        requireBrowserBackend(backend.name, result.rendererName);
        const first = await saveFrame(result.first, `${variant}-${name}.png`);
        const repeated = Buffer.from(result.repeated.rgba, 'base64');
        const repeatDifference = difference(first.rgba, repeated);
        assert.equal(
          repeatDifference.changedPixels,
          0,
          `${variant}/${name} repeated frozen frame changed`,
        );
        assert.equal(result.first.glError, 0, `${variant}/${name} WebGL error`);
        assert.equal(result.repeated.glError, 0, `${variant}/${name} repeated WebGL error`);
        assert.equal(
          result.resourceInventory.nonFinite,
          0,
          `${variant}/${name} non-finite geometry`,
        );
        assert(
          result.shaderDiagnostics.every((diagnostic) => diagnostic.runnable),
          `${variant}/${name} shader failed to link`,
        );
        assert.deepEqual(
          result.first.memory,
          result.repeated.memory,
          `${variant}/${name} repeated draw allocated resources`,
        );
        const { first: _first, repeated: _repeated, ...metadata } = result;
        const view = { ...metadata, image: first.info, repeatDifference };
        variantRecord.views.push(view);
        if (variant === 'before') baselinePixels.set(name, { rgba: first.rgba, view });
        else {
          const previous = baselinePixels.get(name);
          assert(previous, `Missing baseline for ${name}`);
          assert.deepEqual(result.camera, previous.view.camera, 'Camera changed between variants');
          const delta = difference(previous.rgba, first.rgba);
          const resources = {
            calls: first.info.calls - previous.view.image.calls,
            triangles: first.info.triangles - previous.view.image.triangles,
            geometries: first.info.memory.geometries - previous.view.image.memory.geometries,
            textures: first.info.memory.textures - previous.view.image.memory.textures,
            materials: view.resourceInventory.materials - previous.view.resourceInventory.materials,
            attributeBytes:
              view.resourceInventory.attributeBytes -
              previous.view.resourceInventory.attributeBytes,
            indexBytes:
              view.resourceInventory.indexBytes - previous.view.resourceInventory.indexBytes,
          };
          report.comparisons.push({ name, difference: delta, resourceDelta: resources });
          assert(delta.changedPixels > 0, `${name} did not show the changed production geometry`);
          for (const key of ['calls', 'geometries', 'textures', 'materials']) {
            if (explicitBudget)
              assert(resources[key] <= resourceBudget[key], `${name} exceeded ${key} budget`);
            else assert.equal(resources[key], 0, `${name} added ${key}`);
          }
          baselinePixels.delete(name);
        }
        console.log('R7_VEHICLE_VIEW', variant, name, first.info.calls, first.info.triangles);
        await save();
      }
      for (const file of changedFiles) {
        assert.equal(
          loads.get(file),
          sha(snapshot.get(join(root, file))),
          `Vite did not serve expected ${variant} source ${file}`,
        );
        variantRecord.servedVehicleModules[file] = loads.get(file);
      }
      await activePage.evaluate(() => window.horizonR7Vehicle.dispose());
      await activePage.close();
      activePage = null;
      await server.close();
      server = null;
    });
    variantRecord.wallMs = performance.now() - began;
    await save();
  }
  assert.equal(report.errors.length, 0, `Browser errors: ${JSON.stringify(report.errors)}`);
  assert.equal(
    report.failedAssets.length,
    0,
    `Failed assets: ${JSON.stringify(report.failedAssets)}`,
  );
  report.passed = true;
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  if (activePage)
    await bounded('Page cleanup', report.limits.closeMs, () => activePage.close()).catch(() => {});
  if (server)
    await bounded('Server cleanup', report.limits.closeMs, () => server.close()).catch(() => {});
  if (browser)
    await bounded('Browser cleanup', report.limits.closeMs, () => browser.close()).catch(() => {});
  report.wallMs = performance.now() - started;
  await save();
  console.log(
    JSON.stringify({
      report: resolve(output, 'review.json'),
      passed: report.passed,
      comparisons: report.comparisons.length,
      wallMs: report.wallMs,
      failure: report.failure?.message ?? null,
    }),
  );
}
