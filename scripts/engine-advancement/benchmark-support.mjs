/** Small, synchronous-workload benchmark support; see w04f-benchmark-harness.md. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { cpus, hostname, release } from 'node:os';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

export const ORIGINAL_BASELINE = '350119e8ec0606e8c5de5b3ab80df41104025679';
const helperFile = fileURLToPath(import.meta.url);
const sides = ['baseline', 'current'];
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const loaders = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',
  '.json': 'json',
};

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function median(values) {
  assert(values.length > 0 && values.every(Number.isFinite), 'Median needs finite samples');
  const sorted = values.slice().sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Mulberry32; an independent stream per side/pair, including seed zero. */
export function seeded(seed) {
  assert(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'Use a uint32 seed');
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function git(root, ...args) {
  return execFileSync('git', ['--no-optional-locks', '--literal-pathspecs', '-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }).trimEnd();
}
function within(root, path) {
  const part = relative(root, path);
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}
function fileIdentity(path) {
  const bytes = readFileSync(path);
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

/**
 * Build once without writing, recording the exact bytes handed to esbuild.
 * Native mode uses that static import graph as its manifest, then imports the
 * actual entry from the requested tree. Bundle mode imports the unminified
 * result, with all non-builtin dependencies included, for fresh module graphs.
 */
export async function prepareModule({
  root,
  entry,
  expectedCommit,
  allowDirty = false,
  mode = 'native',
  extraFiles = [],
}) {
  assert(isAbsolute(root), 'Provide an absolute source root');
  assert(['native', 'bundle'].includes(mode), 'Mode must be native or bundle');
  root = realpathSync(root);
  const entryPath = realpathSync(resolve(root, entry));
  assert(within(root, entryPath), 'Entry must belong to its source root');
  const dependencyRoot = realpathSync(resolve(root, 'node_modules'));
  const commit = git(root, 'rev-parse', 'HEAD');
  if (expectedCommit) assert.equal(commit, expectedCommit, 'Unexpected source commit');
  const inputs = new Map();
  const remember = (path, bytes = readFileSync(path)) => {
    path = realpathSync(path);
    assert(
      within(root, path) || within(dependencyRoot, path),
      `Input escapes source/dependency roots: ${path}`,
    );
    const key = within(root, path)
      ? relative(root, path)
      : `node_modules/${relative(dependencyRoot, path)}`;
    const record = { path, bytes: bytes.length, sha256: sha256(bytes) };
    if (inputs.has(key))
      assert.deepEqual(record, inputs.get(key), `Input changed during build: ${key}`);
    inputs.set(key, record);
    return bytes;
  };
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', ...extraFiles]) {
    const path = realpathSync(resolve(root, name));
    assert(within(root, path), `Extra input must belong to its source root: ${name}`);
    remember(path);
  }
  const options = {
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'esnext',
    minify: false,
    treeShaking: false,
    sourcemap: false,
    // Match Node package entry selection, without esbuild's extra "module"
    // condition/main-field preference. The repo uses explicit .ts imports.
    conditions: [],
    mainFields: ['main'],
  };
  const started = performance.now();
  const result = await build({
    ...options,
    absWorkingDir: root,
    entryPoints: [entryPath],
    tsconfig: resolve(root, 'tsconfig.json'),
    metafile: true,
    logLevel: 'silent',
    plugins: [
      {
        name: 'record-exact-inputs',
        setup(builder) {
          builder.onLoad({ filter: /\.(?:[cm]?[jt]s|[jt]sx|json)$/ }, ({ path }) => ({
            contents: remember(path),
            loader: loaders[extname(path)],
          }));
        },
      },
    ],
  });
  const buildMs = performance.now() - started;
  assert.equal(result.outputFiles.length, 1, 'Only a self-contained JS bundle is supported');
  for (const path of Object.keys(result.metafile.inputs)) {
    const physical = realpathSync(resolve(root, path));
    assert(
      [...inputs.values()].some((input) => input.path === physical),
      `Unrecorded build input: ${path}`,
    );
  }
  const externalImports = [
    ...new Set(
      Object.values(result.metafile.outputs).flatMap((output) =>
        output.imports.filter((item) => item.external).map((item) => item.path),
      ),
    ),
  ];
  assert(
    externalImports.every((name) => builtins.has(name)),
    `Unsupported external imports: ${externalImports.join(', ')}`,
  );
  const files = Object.fromEntries([...inputs].sort(([a], [b]) => a.localeCompare(b)));
  const projectFiles = Object.entries(files)
    .filter(([, input]) => within(root, input.path) && !within(dependencyRoot, input.path))
    .map(([name]) => name);
  const status = () =>
    git(root, 'status', '--porcelain=v1', '--untracked-files=all', '--', ...projectFiles);
  const relevantStatus = status();
  assert(
    allowDirty || !relevantStatus,
    `Source inputs are dirty; explicitly use allowDirty: true to record them.\n${relevantStatus}`,
  );
  const identity = {
    root,
    entry: relative(root, entryPath),
    commit,
    expectedCommit: expectedCommit ?? null,
    allowDirty,
    relevantStatus,
    files,
    dependencyRoot,
    mode,
    build: {
      tool: 'esbuild',
      version: esbuildVersion,
      options,
      buildMs,
      outputSha256: sha256(result.outputFiles[0].contents),
      externalImports,
      warnings: result.warnings.map((warning) => warning.text),
    },
  };
  const assertStable = () => {
    assert.equal(git(root, 'rev-parse', 'HEAD'), commit, 'Source HEAD changed during the run');
    for (const [name, input] of Object.entries(files)) {
      assert.deepEqual(
        fileIdentity(input.path),
        { bytes: input.bytes, sha256: input.sha256 },
        `Source input changed: ${root}/${name}`,
      );
    }
    assert.equal(status(), relevantStatus, 'Source input Git status changed during the run');
  };
  assertStable();
  const bundleURL = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}#${randomUUID()}`;
  let generation = 0;
  return {
    identity,
    assertStable,
    load({ fresh = false } = {}) {
      assert(
        !fresh || mode === 'bundle',
        'A fresh graph requires bundle mode; native entry queries do not reset dependencies',
      );
      return import(
        mode === 'native'
          ? pathToFileURL(entryPath).href
          : `${bundleURL}-${fresh ? ++generation : 'shared'}`
      );
    },
  };
}

/** Cooperative only: callers must also arrange exclusive local compute. */
export async function withTimingLock(path, action) {
  assert(isAbsolute(path), 'Choose an absolute lock path shared by all timing workers');
  mkdirSync(dirname(path), { recursive: true });
  const owner = {
    path,
    token: randomUUID(),
    pid: process.pid,
    host: hostname(),
    acquiredAt: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(owner, null, 2) + '\n', { flag: 'wx' });
  try {
    return await action(owner);
  } finally {
    assert.equal(
      JSON.parse(readFileSync(path, 'utf8')).token,
      owner.token,
      'Timing lock ownership changed; refusing to remove it',
    );
    unlinkSync(path);
  }
}

/** No default path and no overwrite. Reporting is outside all measured work. */
export function writeReport(path, report) {
  assert(isAbsolute(path), 'Choose an absolute scratch/evidence report path');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}

/**
 * prepare({api, seed, random, side, phase, pair}) -> state, outside timing.
 * run(state, {iterations, seed, side}) -> result, synchronous and timed once.
 * observe(result, state, context) -> workload evidence, outside timing.
 * compare(baselineEvidence, currentEvidence, context) must return
 *   { equal: boolean, checksums: { baseline: string, current: string }, ... }.
 * dispose(state, context) is optional, outside timing, and runs in finally.
 * Smoke purpose executes the same ordering/equivalence path without timings.
 */
export async function runPaired({
  name,
  sources,
  workloadFile,
  seed,
  warmupPairs = 3,
  samplePairs = 9,
  iterations = 1,
  unitsPerIteration = 1,
  unit = 'operation',
  moduleLifetime = 'reuse',
  purpose = 'measurement',
  exclusiveCompute = false,
  lock = null,
  scope,
  prepare,
  run,
  observe,
  compare,
  dispose = () => {},
}) {
  assert(name && isAbsolute(workloadFile), 'Name and absolute workloadFile are required');
  assert(['smoke', 'measurement'].includes(purpose), 'Unknown purpose');
  assert(
    purpose === 'smoke' || exclusiveCompute === true,
    'Timing requires exclusiveCompute: true after coordinating exclusive local compute',
  );
  assert(['reuse', 'fresh-per-sample'].includes(moduleLifetime), 'Unknown module lifetime');
  assert(Number.isSafeInteger(warmupPairs) && warmupPairs >= 0, 'Invalid warmup count');
  for (const count of [samplePairs, iterations, unitsPerIteration])
    assert(Number.isSafeInteger(count) && count > 0, 'Counts must be positive safe integers');
  assert(
    Number.isSafeInteger(iterations * unitsPerIteration),
    'Operation denominator is too large',
  );
  seeded(seed);
  for (const key of ['timedWork', 'setupWork', 'allocationScope', 'limitations'])
    assert(typeof scope?.[key] === 'string' && scope[key], `Describe scope.${key}`);
  for (const callback of [prepare, run, observe, compare, dispose])
    assert.equal(typeof callback, 'function');
  assert(sources.baseline.identity.expectedCommit, 'Pin the baseline with expectedCommit');
  assert.notEqual(
    sources.baseline.identity.root,
    sources.current.identity.root,
    'Use distinct explicit baseline/current roots',
  );
  assert.equal(
    sources.baseline.identity.mode,
    sources.current.identity.mode,
    'Both sides must use the same loader',
  );
  assert.equal(
    sources.baseline.identity.files['package-lock.json'].sha256,
    sources.current.identity.files['package-lock.json'].sha256,
    'Hold the locked dependencies unchanged',
  );
  if (moduleLifetime === 'fresh-per-sample')
    assert.equal(
      sources.baseline.identity.mode,
      'bundle',
      'Fresh samples need bundled module graphs',
    );
  const evidenceFiles = Object.fromEntries(
    [helperFile, realpathSync(workloadFile)].map((path) => [path, fileIdentity(path)]),
  );
  const stable = () => {
    for (const side of sides) sources[side].assertStable();
    for (const [path, identity] of Object.entries(evidenceFiles))
      assert.deepEqual(fileIdentity(path), identity, `Benchmark code changed: ${path}`);
  };
  stable();
  const api = {},
    initialImportMs = {},
    timed = purpose === 'measurement';
  if (moduleLifetime === 'reuse') {
    for (const side of sides) {
      const start = performance.now();
      api[side] = await sources[side].load();
      initialImportMs[side] = performance.now() - start;
    }
  }
  const warmups = [],
    samples = [];
  let equivalent = true;
  for (const [phase, count] of [
    ['warmup', warmupPairs],
    ['sample', samplePairs],
  ]) {
    for (let pair = 0; pair < count; pair++) {
      const order = pair % 2 ? ['current', 'baseline'] : ['baseline', 'current'];
      const pairSeed =
        (seed + Math.imul(0x9e3779b9, pair + (phase === 'sample' ? warmupPairs : 0) + 1)) >>> 0;
      const row = { pair, seed: pairSeed, order },
        observed = {};
      for (const side of order) {
        let mark = performance.now(),
          moduleLoadMs = 0;
        if (moduleLifetime === 'fresh-per-sample') {
          api[side] = await sources[side].load({ fresh: true });
          moduleLoadMs = performance.now() - mark;
        }
        const context = {
          api: api[side],
          side,
          phase,
          pair,
          seed: pairSeed,
          random: seeded(pairSeed),
        };
        mark = performance.now();
        const state = await prepare(context),
          fixtureSetupMs = performance.now() - mark;
        try {
          const start = timed ? performance.now() : 0;
          const result = run(state, { iterations, seed: pairSeed, side });
          const elapsedMs = timed ? performance.now() - start : null;
          assert(
            !result || typeof result.then !== 'function',
            'run must be synchronous; async work would escape the timer',
          );
          mark = performance.now();
          observed[side] = await observe(result, state, context);
          row[side] = {
            elapsedMs,
            msPerUnit: timed ? elapsedMs / (iterations * unitsPerIteration) : null,
            outsideTiming: {
              moduleLoadMs,
              fixtureSetupMs,
              observationMs: performance.now() - mark,
            },
          };
        } finally {
          mark = performance.now();
          await dispose(state, context);
          if (row[side]) row[side].outsideTiming.disposeMs = performance.now() - mark;
        }
      }
      const mark = performance.now();
      row.equivalence = await compare(observed.baseline, observed.current, {
        phase,
        pair,
        seed: pairSeed,
      });
      row.comparisonMs = performance.now() - mark;
      assert.equal(
        typeof row.equivalence?.equal,
        'boolean',
        'compare must return an explicit equality result',
      );
      for (const side of sides)
        assert(
          typeof row.equivalence.checksums?.[side] === 'string' && row.equivalence.checksums[side],
          `compare must supply ${side} checksum`,
        );
      equivalent &&= row.equivalence.equal;
      (phase === 'warmup' ? warmups : samples).push(row);
    }
  }
  stable();
  return {
    schema: 'engine-advancement-paired/1',
    name,
    createdAt: new Date().toISOString(),
    purpose,
    runtime: {
      node: process.version,
      versions: process.versions,
      execArgv: process.execArgv,
      platform: process.platform,
      arch: process.arch,
      osRelease: release(),
      cpu: cpus()[0]?.model ?? null,
      logicalCpus: cpus().length,
      host: hostname(),
      pid: process.pid,
    },
    concurrency: {
      exclusiveCompute,
      cooperativeLock: lock,
      limitation:
        'A cooperative lock cannot detect unrelated CPU/GPU work; the timing coordinator must arrange exclusivity.',
    },
    sources: Object.fromEntries(sides.map((side) => [side, sources[side].identity])),
    evidenceFiles,
    scope,
    configuration: {
      seed,
      generator: 'mulberry32',
      warmupPairs,
      samplePairs,
      iterations,
      unitsPerIteration,
      unit,
      moduleLifetime,
    },
    preparation: {
      initialImportMs,
      note: 'Build/import/fixture allocation/observation/comparison/disposal and report I/O are outside run(). Allocations performed by run() remain inside its timing.',
    },
    stableSources: true,
    equivalence: { passed: equivalent, checkedPairs: warmups.length + samples.length },
    timing: {
      validForComparison: timed && equivalent,
      reason: !timed
        ? 'Smoke only; no workload durations collected.'
        : !equivalent
          ? 'Equivalence failed; do not interpret durations as a compatible improvement.'
          : 'Local synchronous workload only; inspect raw pairs and scope before interpreting.',
      medianMs: timed
        ? Object.fromEntries(
            sides.map((side) => [side, median(samples.map((row) => row[side].elapsedMs))]),
          )
        : null,
      medianMsPerUnit: timed
        ? Object.fromEntries(
            sides.map((side) => [side, median(samples.map((row) => row[side].msPerUnit))]),
          )
        : null,
    },
    warmups,
    samples,
  };
}
