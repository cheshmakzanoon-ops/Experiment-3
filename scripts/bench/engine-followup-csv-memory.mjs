#!/usr/bin/env node
/** Compare actual old/current CSV source with identical deterministic input.
 * Run alone under the shared COMPUTE lease. No npm hooks or git mutations.
 * node scripts/bench/engine-followup-csv-memory.mjs --mode all --output /tmp/csv-memory.json
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = {
  baseline: 'f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6',
  mode: 'node',
  capacity: '54000',
  pairs: '5',
  'browser-pairs': '3',
  warmups: '3',
};
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index].replace(/^--/, '');
  assert.ok(
    name in args || ['repo', 'output', 'work-dir'].includes(name),
    `Unknown argument ${name}`,
  );
  assert.ok(process.argv[index + 1], `Missing value for ${name}`);
  args[name] = process.argv[index + 1];
}
assert.ok(['node', 'browser', 'all'].includes(args.mode));
const positive = (value) => {
  const number = Number(value);
  assert.ok(Number.isSafeInteger(number) && number > 0);
  return number;
};
const settings = {
  capacity: positive(args.capacity),
  pairs: positive(args.pairs),
  browserPairs: positive(args['browser-pairs']),
  warmups: positive(args.warmups),
};
assert.ok(settings.capacity >= 600 && settings.capacity <= 54000 && settings.capacity % 60 === 0);
if (args.mode !== 'node') assert.equal(settings.capacity, 54000);
const repo = path.resolve(args.repo ?? fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(path.join(repo, 'package.json'));
const { build, version: esbuildVersion } = require('esbuild');
const git = (...gitArgs) =>
  execFileSync('git', gitArgs, { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
const baselineRef = git('rev-parse', `${args.baseline}^{commit}`).toString().trim();
const workDir = args['work-dir']
  ? path.resolve(args['work-dir'])
  : mkdtempSync(path.join(tmpdir(), 'engine-followup-csv-memory-'));
const output = path.resolve(args.output ?? path.join(workDir, 'csv-memory.json'));
mkdirSync(workDir, { recursive: true });
mkdirSync(path.dirname(output), { recursive: true });
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const gitBlob = (value) =>
  createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex');
const sources = new Map();
const bundles = {};
const statistics = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0],
    max: sorted.at(-1),
    samples: values.length,
  };
};
const report = {
  schema: 1,
  measuredAt: new Date().toISOString(),
  baselineRef,
  currentMode:
    'actual working-tree source, checked against the pinned baseline for unrelated dependency changes',
  settings,
  environment: {
    node: process.version,
    v8: process.versions.v8,
    esbuild: esbuildVersion,
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logicalCpuCount: cpus().length,
    systemTotalMemoryBytes: totalmem(),
    childOldHeapMiB: 768,
  },
  harness: [
    'scripts/bench/engine-followup-csv-memory.mjs',
    'scripts/bench/engine-followup-csv-memory.runner.mjs',
    'scripts/bench/engine-followup-telemetry.fixture.mjs',
    'scripts/bench/engine-followup-telemetry.browser.mjs',
  ].map((name) => {
    const content = readFileSync(path.join(repo, name));
    return { path: name, sha256: sha256(content), bytes: content.length };
  }),
  methodology: [
    'The baseline bundle loads actual files from the pinned git tree; current loads actual working-tree files. No copied or rewritten CSV function.',
    'All imported production dependencies except telemetry-schema.ts must be byte-identical before measurements start.',
    'The unchanged worker40 fixture fills a real recorder with capacity+243 rows and snapshots its retained chronological suffix.',
    'Each Node sample is a separate sequential process; baseline/current order alternates per pair. Three 600-row warmups by default.',
    'GC is outside timers. Uninstrumented production export includes formatting and native Blob construction. Source initialization, fixture construction and exact verification are excluded.',
    'Every export is compared byte for byte with one bounded independently generated expected chunk at a time and hashed in Node.',
    'Separate observed exports sample native Blob constructor boundaries without retaining part references or running GC within the export.',
    'Node memory categories are separate and overlapping. Process max RSS is lifetime high water; discrete heap samples are not exact peak live memory.',
    'Optional browser pairs use actual production TelemetryExport and worker; only Vite inline-worker construction receives a native Worker adapter.',
    'Browser memory is not measured. Output Blob bytes and part references still scale with the complete CSV output.',
    'No 216000-row maximum allocation, physical-hardware/FPS claim, or old worker40 evidence replacement.',
  ],
  nodePairs: [],
  observed: {},
  browserPairs: [],
  failures: [],
};

function save() {
  report.sources = [...sources.values()]
    .map(({ content: _content, ...metadata }) => metadata)
    .sort((a, b) => a.role.localeCompare(b.role) || a.path.localeCompare(b.path));
  report.bundles = bundles;
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}

process.on('uncaughtExceptionMonitor', (error) => {
  report.failures.push({
    at: new Date().toISOString(),
    message: error.message,
    stack: error.stack,
  });
  save();
});

function sourcePlugin(role, nativeWorkerSource = () => undefined) {
  return {
    name: `actual-csv-${role}`,
    setup(builder) {
      builder.onResolve({ filter: /^engine:/ }, ({ path: specifier }) => {
        const name = specifier.slice('engine:'.length);
        if (name === 'subject' || name === 'current')
          return { path: role, namespace: 'engine-entry' };
        assert.ok(['worker', 'export'].includes(name));
        return {
          path:
            name === 'worker'
              ? 'src/workers/telemetry.worker.ts'
              : 'src/storage/telemetry-export.ts',
          namespace: 'actual-source',
        };
      });
      builder.onLoad({ filter: /.*/, namespace: 'engine-entry' }, () => ({
        loader: 'js',
        contents:
          "export { TelemetryRecorder } from 'src/storage/recorders.ts';\nexport { CHANNELS, telemetryCsv } from 'src/storage/telemetry-schema.ts';",
      }));
      builder.onResolve({ filter: /^src\//, namespace: 'engine-entry' }, ({ path: imported }) => ({
        path: imported,
        namespace: 'actual-source',
      }));
      builder.onResolve(
        { filter: /telemetry\.worker\.ts\?worker&inline$/, namespace: 'actual-source' },
        () => {
          assert.equal(typeof nativeWorkerSource(), 'string');
          return { path: 'native-worker-constructor', namespace: 'worker-adapter' };
        },
      );
      builder.onLoad({ filter: /.*/, namespace: 'worker-adapter' }, () => ({
        loader: 'js',
        contents: `export default class InlineTelemetryWorker { constructor(options) { const url = URL.createObjectURL(new Blob([${JSON.stringify(nativeWorkerSource())}], {type:'text/javascript'})); try { return new Worker(url, options); } finally { URL.revokeObjectURL(url); } } }`,
      }));
      builder.onResolve(
        { filter: /^\./, namespace: 'actual-source' },
        ({ path: imported, importer }) => ({
          path: path.posix.normalize(path.posix.join(path.posix.dirname(importer), imported)),
          namespace: 'actual-source',
        }),
      );
      builder.onLoad({ filter: /.*/, namespace: 'actual-source' }, ({ path: sourcePath }) => {
        const key = `${role}:${sourcePath}`;
        if (!sources.has(key)) {
          const content =
            role === 'baseline'
              ? git('show', `${baselineRef}:${sourcePath}`)
              : readFileSync(path.join(repo, sourcePath));
          sources.set(key, {
            role,
            path: sourcePath,
            gitBlob: gitBlob(content),
            sha256: sha256(content),
            bytes: content.length,
            content,
          });
        }
        return { contents: sources.get(key).content, loader: 'ts' };
      });
    },
  };
}

for (const role of ['baseline', 'current']) {
  bundles[role] = {};
  const keepBundle = (kind, filename, contents) => {
    writeFileSync(path.join(workDir, filename), contents);
    bundles[role][kind] = {
      filename,
      sha256: sha256(contents),
      bytes: Buffer.byteLength(contents),
    };
  };
  if (args.mode !== 'browser') {
    const result = await build({
      entryPoints: [path.join(repo, 'scripts/bench/engine-followup-csv-memory.runner.mjs')],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent',
      plugins: [sourcePlugin(role)],
    });
    keepBundle('node', `${role}-csv-memory-node.bundle.mjs`, result.outputFiles[0].text);
  }
  if (args.mode !== 'node') {
    const worker = await build({
      stdin: { contents: "import 'engine:worker';", resolveDir: repo },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      logLevel: 'silent',
      plugins: [sourcePlugin(role)],
    });
    const nativeWorkerSource = worker.outputFiles[0].text;
    const fixture = await build({
      entryPoints: [path.join(repo, 'scripts/bench/engine-followup-telemetry.browser.mjs')],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'TelemetryMeasurement',
      target: 'es2022',
      logLevel: 'silent',
      plugins: [sourcePlugin(role, () => nativeWorkerSource)],
    });
    keepBundle('worker', `${role}-csv-memory-worker.bundle.js`, nativeWorkerSource);
    keepBundle('browser', `${role}-csv-memory-browser.bundle.js`, fixture.outputFiles[0].text);
  }
}
const changedSources = [];
for (const source of sources.values()) {
  if (source.role !== 'current') continue;
  const baseline = sources.get(`baseline:${source.path}`);
  assert.ok(baseline, `Missing baseline source ${source.path}`);
  if (source.sha256 !== baseline.sha256) changedSources.push(source.path);
}
assert.deepEqual(changedSources, ['src/storage/telemetry-schema.ts']);
report.changedProductionSources = changedSources;
save();

function runNode(role, kind, pair) {
  const prefix = `${kind}-${String(pair).padStart(2, '0')}-${role}`;
  const config = {
    role,
    kind,
    capacity: settings.capacity,
    warmups: settings.warmups,
    output: path.join(workDir, `${prefix}.json`),
  };
  const configFile = path.join(workDir, `${prefix}.config.json`);
  writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  const child = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=768',
      '--expose-gc',
      path.join(workDir, bundles[role].node.filename),
      configFile,
    ],
    { cwd: repo, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
  );
  writeFileSync(path.join(workDir, `${prefix}.stdout.log`), child.stdout ?? '');
  writeFileSync(path.join(workDir, `${prefix}.stderr.log`), child.stderr ?? '');
  assert.equal(child.status, 0, `${prefix} failed: ${child.error ?? child.stderr}`);
  process.stdout.write(child.stdout);
  return JSON.parse(readFileSync(config.output, 'utf8'));
}

if (args.mode !== 'browser') {
  for (let pair = 0; pair < settings.pairs; pair++) {
    const result = { pair, order: pair % 2 ? ['current', 'baseline'] : ['baseline', 'current'] };
    for (const role of result.order) result[role] = runNode(role, 'timing', pair);
    assert.deepEqual(result.baseline.input, result.current.input);
    assert.deepEqual(result.baseline.exact, result.current.exact);
    result.currentOverBaselineMs =
      result.current.uninstrumentedElapsedMs / result.baseline.uninstrumentedElapsedMs;
    report.nodePairs.push(result);
    save();
  }
  for (const role of ['baseline', 'current']) report.observed[role] = runNode(role, 'observe', 0);
  assert.deepEqual(report.observed.baseline.exact, report.observed.current.exact);
  report.nodeSummary = {};
  for (const role of ['baseline', 'current']) {
    report.nodeSummary[role] = {
      elapsedMs: statistics(report.nodePairs.map((pair) => pair[role].uninstrumentedElapsedMs)),
      processMaxRssKiBBeforeVerification: statistics(
        report.nodePairs.map((pair) => pair[role].immediatelyAfterExport.processMaxRssKiB),
      ),
      heapUsedImmediatelyAfterExport: statistics(
        report.nodePairs.map((pair) => pair[role].immediatelyAfterExport.heapUsed),
      ),
      afterGcWithRingInputAndBlob: {
        heapUsed: statistics(
          report.nodePairs.map((pair) => pair[role].afterGcWithRingInputAndBlob.heapUsed),
        ),
        arrayBuffers: statistics(
          report.nodePairs.map((pair) => pair[role].afterGcWithRingInputAndBlob.arrayBuffers),
        ),
      },
    };
  }
  report.nodeSummary.pairedCurrentOverBaselineMs = statistics(
    report.nodePairs.map((pair) => pair.currentOverBaselineMs),
  );
  save();
}

if (args.mode !== 'node') {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--js-flags=--max-old-space-size=768'],
  });
  report.browserEnvironment = { browserVersion: browser.version(), peakMemoryMeasured: false };
  try {
    for (let pair = 0; pair < settings.browserPairs; pair++) {
      const result = { pair, order: pair % 2 ? ['current', 'baseline'] : ['baseline', 'current'] };
      for (const role of result.order) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.route('http://telemetry.invalid/measurement', (route) =>
            route.fulfill({
              contentType: 'text/html',
              body: '<!doctype html><title>CSV memory validation</title>',
            }),
          );
          await page.goto('http://telemetry.invalid/measurement');
          await page.addScriptTag({
            content: readFileSync(path.join(workDir, bundles[role].browser.filename), 'utf8'),
          });
          let timeout;
          try {
            result[role] = await Promise.race([
              page.evaluate(() => globalThis.TelemetryMeasurement.run(54000)),
              new Promise((_, reject) => {
                timeout = setTimeout(
                  () => reject(new Error('Native CSV measurement exceeded 90 seconds')),
                  90000,
                );
              }),
            ]);
          } finally {
            clearTimeout(timeout);
          }
          // The shared fixture describes its own single cold run; pairing is here.
          result[role].limits = result[role].limits.filter(
            (limit) => !limit.startsWith('One cold native worker export'),
          );
          result[role].pageErrors = errors;
          assert.deepEqual(errors, []);
          process.stdout.write(
            JSON.stringify({
              role,
              pair,
              browserExportMs: result[role].exportCompletionMs,
              bytes: result[role].csvBytes,
            }) + '\n',
          );
        } finally {
          await context.close();
        }
      }
      assert.deepEqual(result.baseline.exact, result.current.exact);
      result.currentOverBaselineMs =
        result.current.exportCompletionMs / result.baseline.exportCompletionMs;
      report.browserPairs.push(result);
      save();
    }
  } finally {
    await browser.close();
  }
  report.browserSummary = {
    baselineMs: statistics(report.browserPairs.map((pair) => pair.baseline.exportCompletionMs)),
    currentMs: statistics(report.browserPairs.map((pair) => pair.current.exportCompletionMs)),
    pairedCurrentOverBaselineMs: statistics(
      report.browserPairs.map((pair) => pair.currentOverBaselineMs),
    ),
    peakBrowserMemoryMeasured: false,
  };
}
report.completedAt = new Date().toISOString();
save();
process.stdout.write(`CSV memory evidence written: ${output}\n`);
