#!/usr/bin/env node
/** Compare committed TextureBudget registration paths without editing sources.
 * Run alone, with other benchmarks, browser suites and builds idle.
 * No package install, npm hook, native TypeScript transformer or browser starts.
 */
import assert from 'node:assert/strict';
import { execFileSync, fork, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, loadavg, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const worker = fileURLToPath(new URL('./engine-followup-texture.worker.mjs', import.meta.url));
const options = {
  repo: resolve(dirname(script), '../..'),
  baseline: '1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb',
  candidate: 'f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6',
  evidenceCommit: '0f7fecfda61ea7e669f04eebd138c52543144421',
  warmupPairs: 6,
  pairs: 12,
  repetitions: 16,
  heapMb: 384,
};
const numberOptions = new Map([
  ['--warmup-pairs', ['warmupPairs', 2, 30]],
  ['--pairs', ['pairs', 4, 40]],
  ['--repetitions', ['repetitions', 1, 64]],
  ['--heap-mb', ['heapMb', 192, 768]],
]);
const stringOptions = new Map([
  ['--repo', 'repo'],
  ['--baseline', 'baseline'],
  ['--candidate', 'candidate'],
  ['--evidence-commit', 'evidenceCommit'],
  ['--output', 'output'],
  ['--scratch', 'scratch'],
]);
for (let index = 2; index < process.argv.length; index++) {
  const name = process.argv[index];
  if (name === '--help') {
    process.stdout
      .write(`Usage: node scripts/bench/engine-followup-texture.mjs --output REPORT.json [options]
  --repo PATH              Repository containing installed Three.js and esbuild
  --baseline REF           Actual committed baseline (default 1c609bfa...)
  --candidate REF          Actual committed engine candidate (default f4d41b0c...)
  --evidence-commit REF     Commit retaining native evidence (default 0f7fecfd...)
  --warmup-pairs N          Alternating warmup pairs, default 6
  --pairs N                Even number of measured pairs, default 12
  --repetitions N          Fresh registrations per sample, default 16
  --heap-mb N               Heap cap for each isolated child, default 384
  --scratch PATH           Temporary bundles, default new /tmp directory

Only TextureBudget.register(root) is timed. Separate processes own baseline and
candidate code. The Node canvas double propagates scalar paint, not real pixels.
Native pixel/storage/teardown results are explicitly reused, not rerun or timed.
`);
    process.exit(0);
  }
  const value = process.argv[++index];
  assert.ok(value !== undefined, `Missing value for ${name}`);
  if (numberOptions.has(name)) {
    const [key, min, max] = numberOptions.get(name);
    const number = Number(value);
    assert.ok(
      Number.isInteger(number) && number >= min && number <= max,
      `${name}: ${min}..${max}`,
    );
    options[key] = number;
  } else if (stringOptions.has(name)) options[stringOptions.get(name)] = value;
  else throw new Error(`Unknown option ${name}`);
}
assert.ok(options.output, '--output REPORT.json is required');
assert.equal(options.pairs % 2, 0, 'Measured pairs must balance execution order');
options.repo = resolve(options.repo);
options.output = resolve(options.output);
options.scratch = options.scratch
  ? resolve(options.scratch)
  : mkdtempSync(resolve(tmpdir(), 'texture-followup-'));
mkdirSync(options.scratch, { recursive: true });
mkdirSync(dirname(options.output), { recursive: true });
const git = (...args) =>
  execFileSync('git', ['-C', options.repo, ...args], { maxBuffer: 32 * 1024 * 1024 });
for (const key of ['baseline', 'candidate', 'evidenceCommit'])
  options[key] = git('rev-parse', '--verify', `${options[key]}^{commit}`).toString().trim();
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = (bytes) =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const requireFromRepo = createRequire(resolve(options.repo, 'package.json'));
const esbuild = requireFromRepo('esbuild');
const threePackage = JSON.parse(
  readFileSync(resolve(options.repo, 'node_modules/three/package.json'), 'utf8'),
);
const threeModule = resolve(options.repo, 'node_modules/three/build/three.module.js');
for (const key of ['baseline', 'candidate', 'evidenceCommit']) {
  const packageJson = JSON.parse(git('show', `${options[key]}:package.json`).toString());
  assert.equal(packageJson.dependencies.three, threePackage.version);
}

const sourceGraph = [];
const bundles = {};
for (const variant of ['baseline', 'candidate']) {
  const commit = options[variant];
  const bundle = resolve(options.scratch, `texture-${variant}.bundle.mjs`);
  await esbuild.build({
    entryPoints: [worker],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    minify: false,
    sourcemap: false,
    logLevel: 'warning',
    define: { __TEXTURE_VARIANT__: JSON.stringify(variant) },
    plugins: [
      {
        name: 'actual-committed-texture-modules',
        setup(builder) {
          builder.onResolve({ filter: /^three$/ }, () => ({ path: threeModule }));
          builder.onResolve({ filter: /^engine-followup:texture-budget$/ }, () => ({
            path: 'src/rendering/texture-budget.ts',
            namespace: 'committed-texture',
          }));
          builder.onResolve({ filter: /.*/, namespace: 'committed-texture' }, (args) => {
            assert.ok(args.path.startsWith('.'), `Unexpected committed import ${args.path}`);
            const path = posix.normalize(posix.join(posix.dirname(args.importer), args.path));
            assert.ok(path.startsWith('src/rendering/'), `Import leaves rendering source: ${path}`);
            return { path, namespace: 'committed-texture' };
          });
          builder.onLoad({ filter: /.*/, namespace: 'committed-texture' }, (args) => {
            const bytes = git('show', `${commit}:${args.path}`);
            sourceGraph.push({
              variant,
              commit,
              path: args.path,
              gitBlob: blob(bytes),
              sha256: sha(bytes),
              bytes: bytes.length,
            });
            return { contents: bytes.toString(), loader: 'ts' };
          });
        },
      },
    ],
  });
  bundles[variant] = { path: bundle, sha256: sha(readFileSync(bundle)) };
}

const nativePath = 'docs/engine/runtime-followup-2026-11-24/validation/w06d-metrics.json';
const nativeBytes = git('show', `${options.evidenceCommit}:${nativePath}`);
const nativeData = JSON.parse(nativeBytes.toString());
const nativeTexture = nativeData['native-texture-registration.json'];
assert.equal(nativeTexture.registration.wrappers, 1025);
assert.equal(nativeTexture.registration.drawCalls, 3);
assert.equal(nativeTexture.registration.versionIncrements, 1025);
assert.equal(nativeTexture.afterUpload.textures - nativeTexture.beforeUpload.textures, 3);
assert.ok(nativeTexture.originalImages && nativeTexture.restored && nativeTexture.lateRestored);
assert.deepEqual(nativeTexture.refreshedCenter, [255, 255, 0, 255]);
assert.deepEqual(nativeTexture.afterCleanup, {
  textures: 0,
  geometries: 0,
  programs: 0,
  programUses: 0,
});
assert.equal(nativeTexture.glError, 0);
assert.equal(nativeTexture.lost, false);
for (const pixels of nativeTexture.pixels) {
  assert.equal(pixels.canvasDifferences, 0);
  assert.equal(pixels.gpuDifferences, 0);
  assert.equal(pixels.canvasHash, pixels.referenceCanvasHash);
  assert.equal(pixels.gpuHash, pixels.referenceGpuHash);
}
const nativeSourceChecks = sourceGraph
  .filter((entry) => entry.variant === 'candidate')
  .map((entry) => {
    const bytes = git('show', `${options.evidenceCommit}:${entry.path}`);
    assert.equal(sha(bytes), entry.sha256, `Native evidence module differs: ${entry.path}`);
    return {
      path: entry.path,
      candidateBlob: entry.gitBlob,
      evidenceCommitBlob: blob(bytes),
      identical: true,
    };
  });
const nativeFixtures = [
  'e2e/engine-native-resources.spec.ts',
  'e2e/fixtures/engine-native-resources.ts',
].map((path) => {
  const bytes = git('show', `${options.evidenceCommit}:${path}`);
  return { path, commit: options.evidenceCommit, gitBlob: blob(bytes), sha256: sha(bytes) };
});
const nativeFailures = Object.fromEntries(
  ['imported', 'generated'].map((kind) => {
    const result = nativeData[`native-circuit-${kind}-failure.json`];
    assert.ok(
      result.threw && result.firstWasUndefined && result.restored && result.foliageRestored,
    );
    assert.equal(result.released.textures, 0);
    assert.equal(result.glError, 0);
    assert.equal(result.contextLost, false);
    return [
      kind,
      {
        backend: result.backend,
        everySourceRestored: result.restored,
        foliageRestored: result.foliageRestored,
        firstThrownUndefinedRetained: result.firstWasUndefined,
        downstreamOwnerSourceSnapshots: result.snapshots,
        releasedTextures: result.released.textures,
        glError: result.glError,
        contextLost: result.contextLost,
      },
    ];
  }),
);

const report = {
  schema: 'engine-followup-texture/v1',
  worker: 'worker42 / wave7 assignment f',
  status: 'running',
  startedAt: new Date().toISOString(),
  invocation: [process.execPath, script, ...process.argv.slice(2)],
  options,
  environment: {
    node: process.version,
    v8: process.versions.v8,
    esbuild: esbuild.version,
    three: threePackage.version,
    platform: platform(),
    architecture: arch(),
    kernel: release(),
    cpu: cpus()[0]?.model,
    logicalCPUs: cpus().length,
    totalMemoryBytes: totalmem(),
    loadAverageAtStart: loadavg(),
    childOldSpaceMiB: options.heapMb,
  },
  sources: {
    baselineCommit: options.baseline,
    candidateCommit: options.candidate,
    repositoryHeadAtRun: git('rev-parse', 'HEAD').toString().trim(),
    sourceGraph: sourceGraph.sort((a, b) =>
      `${a.variant}:${a.path}`.localeCompare(`${b.variant}:${b.path}`),
    ),
    orchestratorSHA256: sha(readFileSync(script)),
    workerSHA256: sha(readFileSync(worker)),
    bundles,
    dependencyFiles: [
      'node_modules/three/package.json',
      'node_modules/three/build/three.module.js',
      'node_modules/three/build/three.core.js',
    ].map((path) => ({ path, sha256: sha(readFileSync(resolve(options.repo, path))) })),
  },
  methodology: {
    source:
      'Actual git show bytes from each pinned commit, bundled with its own imported-texture-budget and foliage-mipmaps dependencies; no reconstructed baseline algorithm.',
    fixtures:
      'Every authored fixture image is a 1024x512 scalar canvas double. Generated cases use real Three.js CanvasTexture wrappers; imported cases use real Texture wrappers with flipY=false and immutableAssetTexture=true. The budget is configured to 128 pixels and anisotropy 2. Each wrapper appears in both map and alphaMap material slots. The mixed case has four authored sources and six budget groups, including a scale-2 claim and a separate CPU-readback claim.',
    operations:
      'Untimed separate proof processes use instrumented scalar canvas doubles, real Three.js 0.180.0 classes, duplicate map/alphaMap material slots and actual engine traversal. Counts are logical calls/version increments, not physical allocation or GPU work.',
    timing:
      'Separate fresh Node child per variant per case. Only one child executes each sample; pair order alternates. Six default warmup pairs (96 fresh registrations per variant per case) precede twelve measured pairs (192 registrations per variant per case). All raw per-registration durations are retained.',
    timedBoundary:
      'Only TextureBudget.register(root), including traversal, source/group ownership, stub canvas calls, wrapper disposal dispatch and version updates. The uninstrumented scalar canvas double does no rasterization, pixel copying or WebGL work.',
    outsideTiming: [
      'module/process startup',
      'canvas/texture/material/mesh fixture construction',
      'budget construction/configuration',
      'explicit GC before each multi-registration sample',
      'assertions and checksum',
      'budget/geometry/material cleanup',
      'IPC and JSON serialization',
    ],
    nativeEvidence:
      'Reuses committed w06d native results after validating target source hashes against candidate. This run does not rerun browser tests or compare baseline native pixels directly.',
    caveats: [
      'Both implementations already share budget Source storage. No GPU-allocation reduction is claimed.',
      'Imported immutable images already drew once in the baseline; their measured improvement is repeated wrapper-update/traversal work.',
      'Initial resize disposal-event counts increase when every acquired wrapper is invalidated together; these events are reported separately and do not count allocated GPU objects.',
      'Registration microbenchmark on one Node/runtime/host. No browser/GPU duration, end-to-end frame time/FPS or GC/allocation-rate claim.',
      'Elapsed timings include any incidental runtime pauses within register. CPU affinity, frequency and JIT tier are not controlled.',
    ],
  },
  nativeEvidence: {
    reused: true,
    artifactCommit: options.evidenceCommit,
    path: nativePath,
    sha256: sha(nativeBytes),
    sourceChecks: nativeSourceChecks,
    fixtures: nativeFixtures,
    texture: nativeTexture,
    teardownFailures: nativeFailures,
  },
  operations: {},
  timings: [],
};
const save = () => writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
save();
for (const variant of ['baseline', 'candidate']) {
  process.stdout.write(`Checking ${variant} operation counts and source lifecycle\n`);
  const child = spawnSync(
    process.execPath,
    [`--max-old-space-size=${options.heapMb}`, bundles[variant].path, '--proof'],
    {
      cwd: options.repo,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 60000,
    },
  );
  assert.equal(child.status, 0, child.stderr || String(child.error));
  report.operations[variant] = JSON.parse(child.stdout);
  save();
}

function timingWorker(bundle) {
  const child = fork(bundle, ['--serve'], {
    cwd: options.repo,
    execArgv: ['--expose-gc', `--max-old-space-size=${options.heapMb}`],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let nextId = 0;
  let errorText = '';
  const pending = new Map();
  let isReady = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const startupTimeout = setTimeout(() => {
    child.kill();
    rejectReady(new Error(`Timing child startup timed out: ${errorText}`));
  }, 60000);
  child.stderr.on('data', (data) => {
    errorText = (errorText + data.toString()).slice(-8000);
  });
  child.on('message', (message) => {
    if (message.ready) {
      isReady = true;
      clearTimeout(startupTimeout);
      return resolveReady();
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(message.error));
  });
  const fail = (error) => {
    clearTimeout(startupTimeout);
    rejectReady(error);
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  };
  child.on('error', fail);
  child.on('exit', (code, signal) => {
    if (!isReady || pending.size || code)
      fail(new Error(`Timing child exited ${code}/${signal}: ${errorText}`));
  });
  return {
    ready,
    request(command, extra = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          child.kill();
          reject(new Error(`Timing child request ${command} timed out`));
        }, 60000);
        pending.set(id, { resolve, reject, timeout });
        child.send({ id, command, ...extra });
      });
    },
    kill: () => child.kill(),
  };
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function summarize(samples) {
  const baseline = samples.map((sample) => sample.baseline.perRegistrationMs);
  const candidate = samples.map((sample) => sample.candidate.perRegistrationMs);
  const pairedChanges = samples.map(
    (sample) => (sample.candidate.registrationMs / sample.baseline.registrationMs - 1) * 100,
  );
  const orderGroups = Object.fromEntries(
    ['baseline', 'candidate'].map((first) => [
      first,
      {
        count: samples.filter((sample) => sample.order[0] === first).length,
        medianPairedChangePercent: median(
          samples
            .filter((sample) => sample.order[0] === first)
            .map((sample) => sample.pairedChangePercent),
        ),
      },
    ]),
  );
  return {
    medianBaselineMsPerRegistration: median(baseline),
    medianCandidateMsPerRegistration: median(candidate),
    ratioOfMedians: median(candidate) / median(baseline),
    medianPairedChangePercent: median(pairedChanges),
    candidateFasterPairs: pairedChanges.filter((value) => value < 0).length,
    pairCount: samples.length,
    baselineRangeMsPerRegistration: [Math.min(...baseline), Math.max(...baseline)],
    candidateRangeMsPerRegistration: [Math.min(...candidate), Math.max(...candidate)],
    orderGroups,
  };
}

for (const caseId of ['generated-shared-1024', 'imported-shared-1024', 'mixed-six-groups-1024']) {
  process.stdout.write(`Timing ${caseId} with isolated implementation processes\n`);
  const children = {
    baseline: timingWorker(bundles.baseline.path),
    candidate: timingWorker(bundles.candidate.path),
  };
  const result = { caseId, warmups: [], samples: [] };
  report.timings.push(result);
  try {
    // Startup can overlap; actual warmup and samples below are strictly sequential.
    await Promise.all([children.baseline.ready, children.candidate.ready]);
    for (const [phase, count] of [
      ['warmups', options.warmupPairs],
      ['samples', options.pairs],
    ]) {
      for (let pair = 0; pair < count; pair++) {
        const order = pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
        const sample = { pair, order };
        for (const variant of order)
          sample[variant] = await children[variant].request('sample', {
            caseId,
            repetitions: options.repetitions,
          });
        sample.pairedChangePercent =
          (sample.candidate.registrationMs / sample.baseline.registrationMs - 1) * 100;
        result[phase].push(sample);
        save();
      }
    }
    result.summary = summarize(result.samples);
    result.resources = {};
    for (const variant of ['baseline', 'candidate'])
      result.resources[variant] = await children[variant].request('stop');
    process.stdout.write(
      `${caseId}: ${result.summary.medianBaselineMsPerRegistration.toFixed(6)} -> ${result.summary.medianCandidateMsPerRegistration.toFixed(6)} ms/registration; paired median ${result.summary.medianPairedChangePercent.toFixed(2)}%\n`,
    );
  } finally {
    for (const child of Object.values(children)) child.kill();
  }
  save();
}
report.status = 'passed';
report.completedAt = new Date().toISOString();
report.environment.loadAverageAtEnd = loadavg();
save();
process.stdout.write(`Saved ${options.output}\n`);
