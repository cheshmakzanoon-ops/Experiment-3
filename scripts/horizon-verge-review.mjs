/** Matched before/after rendering of actual Horizon roadside modules.
 * One browser, sequential source snapshots, a fixed 768 m terrain patch.
 * Example: HORIZON_VERGE_BASELINE_REF=<full sha> node --experimental-transform-types scripts/horizon-verge-review.mjs
 * Software-GPU evidence only; the complete playable session is a separate gate. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { browserBackend, requireBrowserBackend } from './browser-backend.ts';

const root = realpathSync(process.cwd()),
  output = resolve(process.env.HORIZON_REVIEW_OUTPUT ?? 'test-results/horizon-verge'),
  baseline = process.env.HORIZON_VERGE_BASELINE_REF,
  port = Number(process.env.HORIZON_VERGE_PORT ?? 5317),
  backend = browserBackend(process.env.APEX_BROWSER_BACKEND),
  changed = [
    'src/rendering/open-world/horizon-dressing.ts',
    'src/rendering/open-world/vegetation.ts',
  ],
  introduced = ['src/rendering/open-world/festival-meadow.ts'],
  fixture = 'e2e/fixtures/horizon-verge.html';
assert(/^[0-9a-f]{40}$/.test(baseline ?? ''), 'Supply the full baseline commit SHA');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const snapshot = new Map();
async function freeze(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await freeze(file);
    else snapshot.set(file, await readFile(file, 'utf8'));
  }
}
await freeze(join(root, 'src'));
for (const file of [fixture, 'e2e/fixtures/horizon-verge.ts'])
  snapshot.set(join(root, file), await readFile(join(root, file), 'utf8'));
const before = new Map(snapshot);
for (const file of changed)
  before.set(
    join(root, file),
    execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' }),
  );
await mkdir(output, { recursive: true });
const report = {
  baselineCommitForChangedModules: baseline,
  changed,
  source: Object.fromEntries(
    changed.map((file) => [
      file,
      { before: sha(before.get(join(root, file))), after: sha(snapshot.get(join(root, file))) },
    ]),
  ),
  introducedSource: Object.fromEntries(
    introduced.map((file) => [file, sha(snapshot.get(join(root, file)))]),
  ),
  fixtureSha256: sha(snapshot.get(join(root, 'e2e/fixtures/horizon-verge.ts'))),
  fixtureHtmlSha256: sha(snapshot.get(join(root, fixture))),
  limits: { variantMs: 180000, launchMs: 60000 },
  limitations: [
    'Fixed component lighting; no full-world compositor, photographed packs, player input, or hardware frame-rate claim',
    'Baseline substitutes only listed modules into the same frozen current source graph',
  ],
  backend: backend.name,
  variants: [],
  comparisons: [],
  errors: [],
  passed: false,
};
const save = () => writeFile(join(output, 'review.json'), JSON.stringify(report, null, 2) + '\n');
async function bounded(milliseconds, work) {
  let timer;
  try {
    return await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Review exceeded ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
let browser, server, page;
const pixels = new Map();
try {
  browser = await chromium.launch({
    headless: backend.headless,
    executablePath: process.env.HORIZON_REVIEW_EXECUTABLE || undefined,
    args: ['--no-sandbox', ...backend.args],
    timeout: report.limits.launchMs,
  });
  for (const [variant, frozen] of [
    ['before', before],
    ['after', snapshot],
  ]) {
    await bounded(report.limits.variantMs, async () => {
      const served = {};
      server = await createServer({
        root,
        configFile: false,
        cacheDir: join(output, 'vite-cache'),
        logLevel: 'warn',
        define: {
          __APEX_SOURCE_FINGERPRINT__: JSON.stringify('isolated-verge-review'),
          __APEX_SOURCE_COMMIT__: 'null',
        },
        plugins: [
          {
            name: `frozen-verge-${variant}`,
            enforce: 'pre',
            transformIndexHtml: {
              order: 'pre',
              handler(html, context) {
                return context.path === `/${fixture}` ? frozen.get(join(root, fixture)) : html;
              },
            },
            load(id) {
              const [file, query = ''] = id.split('?'),
                bytes = frozen.get(file);
              if (
                bytes === undefined ||
                !['.ts', '.js', '.json', '.glsl', '.vert', '.frag'].includes(extname(file))
              )
                return null;
              const params = new URLSearchParams(query);
              if (params.has('worker') || params.has('url')) return null;
              served[relative(root, file)] = sha(bytes);
              return params.has('raw') ? `export default ${JSON.stringify(bytes)};` : bytes;
            },
          },
        ],
        optimizeDeps: { entries: [fixture], include: ['three'] },
        server: {
          host: '127.0.0.1',
          port,
          strictPort: true,
          hmr: false,
          fs: { allow: [root, realpathSync(join(root, 'node_modules'))] },
        },
      });
      await server.listen();
      page = await browser.newPage({
        viewport: { width: 1120, height: 700 },
        deviceScaleFactor: 1,
      });
      page.on('pageerror', (error) => report.errors.push({ variant, message: error.message }));
      page.on('console', (message) => {
        if (message.type() === 'error')
          report.errors.push({
            variant,
            message: message.text(),
            url: message.location().url,
          });
      });
      page.setDefaultTimeout(120000);
      await page.goto(`http://127.0.0.1:${port}/${fixture}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.horizonVerge?.capture);
      const record = { variant, views: [], servedModules: {} };
      report.variants.push(record);
      for (const name of ['club-verge', 'club-low', 'club-planting']) {
        const result = await page.evaluate((name) => window.horizonVerge.capture(name), name);
        assert.equal(result.first.glError, 0);
        assert.equal(result.repeat.glError, 0);
        assert.equal(result.contextLost, false);
        requireBrowserBackend(backend.name, result.renderer);
        assert.equal(result.first.rgba, result.repeat.rgba, 'Repeated held frame changed');
        const png = Buffer.from(result.first.image.split(',')[1], 'base64'),
          rgba = Buffer.from(result.first.rgba, 'base64'),
          file = `${variant}-${name}.png`;
        await writeFile(join(output, file), png);
        const { first, repeat: _repeat, ...metadata } = result;
        record.views.push({
          name,
          ...metadata,
          render: { calls: first.calls, triangles: first.triangles, memory: first.memory },
          image: { file, bytes: png.length, sha256: sha(png) },
        });
        if (variant === 'before') pixels.set(name, { rgba, camera: result.camera });
        else {
          const previous = pixels.get(name);
          assert.deepEqual(previous.camera, result.camera, 'Camera differed between variants');
          let changedPixels = 0;
          for (let i = 0; i < rgba.length; i += 4)
            if (
              rgba[i] !== previous.rgba[i] ||
              rgba[i + 1] !== previous.rgba[i + 1] ||
              rgba[i + 2] !== previous.rgba[i + 2]
            )
              changedPixels++;
          assert(changedPixels > 50, 'Changed geometry is not visible');
          assert(
            result.meadow.submittedTriangles < 250000,
            'Near meadow geometry exceeds bounded camera budget',
          );
          assert(result.meadow.calls < 18, 'Near meadow adds too many chunk draws');
          report.comparisons.push({ name, changedPixels });
        }
        console.log(
          'VERGE_VIEW',
          variant,
          name,
          JSON.stringify({ calls: first.calls, triangles: first.triangles, meadow: result.meadow }),
        );
        await save();
      }
      for (const file of changed) {
        assert.equal(served[file], sha(frozen.get(join(root, file))));
        record.servedModules[file] = served[file];
      }
      if (variant === 'after')
        for (const file of introduced) {
          assert.equal(served[file], sha(frozen.get(join(root, file))));
          record.servedModules[file] = served[file];
        }
      await page.close();
      page = null;
      await server.close();
      server = null;
    });
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  await page?.close().catch(() => {});
  await server?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await save();
  console.log(JSON.stringify({ passed: report.passed, output, failure: report.failure }));
}
