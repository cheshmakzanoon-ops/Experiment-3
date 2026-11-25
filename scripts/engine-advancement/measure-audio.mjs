/** Actual original/current audio arithmetic; smoke, operation counts, or reserved timing. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { cpus, hostname, release } from 'node:os';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ORIGINAL_BASELINE,
  prepareModule,
  runPaired,
  seeded,
  sha256,
  withTimingLock,
  writeReport,
} from './benchmark-support.mjs';

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    current: { type: 'string' },
    output: { type: 'string' },
    'current-commit': { type: 'string' },
    mode: { type: 'string', default: 'smoke' },
    exclusive: { type: 'boolean', default: false },
    lock: { type: 'string', default: '/tmp/aeebac160835-engine-wave7.lock' },
    samples: { type: 'string' },
    warmups: { type: 'string' },
    'hot-iterations': { type: 'string' },
    'zero-iterations': { type: 'string' },
    'fresh-profiles': { type: 'string' },
    cases: { type: 'string' },
  },
});
for (const key of ['baseline', 'current', 'output'])
  assert(values[key] && isAbsolute(values[key]), `Required: --${key} /absolute/path`);
assert(!existsSync(values.output), 'Refusing to overwrite the output report');
assert(
  ['smoke', 'counts', 'measure'].includes(values.mode),
  'Use --mode smoke, counts, or measure',
);
const measured = values.mode === 'measure';
assert(!measured || values.exclusive, 'Reserve exclusive compute before using --exclusive');
assert(
  !measured || /^[a-f0-9]{40}$/.test(values['current-commit'] ?? ''),
  'Measurement requires the coordinator-reserved --current-commit full hash',
);
assert(!values.exclusive || measured, '--exclusive is only valid for measured execution');
const count = (key, fallback, minimum = 1, maximum = 10_000_000) => {
  const value = values[key] === undefined ? fallback : Number(values[key]);
  assert(Number.isSafeInteger(value) && value >= minimum && value <= maximum, `Invalid --${key}`);
  return value;
};
const samplePairs = count('samples', measured ? 8 : 2, 1, 20);
const warmupPairs = count('warmups', measured ? 2 : 0, 0, 5);
const hotIterations = count('hot-iterations', measured ? 8192 : 96);
const zeroIterations = count('zero-iterations', measured ? 4_000_000 : 2048);
const freshProfiles = count('fresh-profiles', measured ? 32 : 4, 1, 128);
const workloadFile = fileURLToPath(import.meta.url);
const helperFile = fileURLToPath(new URL('./benchmark-support.mjs', import.meta.url));
const sides = ['baseline', 'current'];
const bandHz = [100, 200, 400];
const familiesExpected = 24;
const bandsExpected = 72;
const basisPayloadBytes = 2048 * 40 * Float64Array.BYTES_PER_ELEMENT;
const scenarios = [
  { id: 'cold-first-waveform', kind: 'wave', fresh: true },
  { id: 'cold-first-family', kind: 'family', fresh: true },
  { id: 'warm-basis-first-family', kind: 'family', fresh: true, primeBasis: true },
  { id: 'warm-basis-fresh-profiles', kind: 'fresh', primeBasis: true },
  { id: 'all-72-waveforms-cold', kind: 'waves', fresh: true },
  { id: 'all-72-waveforms-warm', kind: 'waves', primeBasis: true },
  { id: 'cached-117-harmonic-updates', kind: 'hot' },
  { id: 'cached-zero-gain-control', kind: 'zero' },
];
const selected = values.cases ? values.cases.split(',') : scenarios.map(({ id }) => id);
assert(selected.length > 0 && new Set(selected).size === selected.length, 'Invalid case selection');
for (const id of selected)
  assert(
    scenarios.some((scenario) => scenario.id === id),
    `Unknown case: ${id}`,
  );

function bytesOf(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

// NaN payloads are not distinguished by Object.is; checksum encoding follows
// that policy. IEEE signed zeros and every finite double remain unchanged.
function outputDigest(array) {
  let canonical = array;
  for (let i = 0; i < array.length; i++)
    if (Number.isNaN(array[i])) {
      if (canonical === array) canonical = array.slice();
      canonical[i] = NaN;
    }
  return sha256(bytesOf(canonical));
}

function compareNumbers(baseline, current) {
  let mismatches = Math.abs(baseline.length - current.length);
  let maxFiniteDifference = 0;
  let firstMismatch = null;
  let matchedNaNs = 0;
  let matchedNegativeZeros = 0;
  for (let i = 0; i < Math.min(baseline.length, current.length); i++) {
    const a = baseline[i];
    const b = current[i];
    if (!Object.is(a, b)) {
      mismatches++;
      firstMismatch ??= i;
    } else {
      if (Number.isNaN(a)) matchedNaNs++;
      if (Object.is(a, -0)) matchedNegativeZeros++;
    }
    if (Number.isFinite(a) && Number.isFinite(b))
      maxFiniteDifference = Math.max(maxFiniteDifference, Math.abs(a - b));
  }
  return {
    equal: mismatches === 0,
    comparedNumbers: baseline.length,
    mismatches,
    firstMismatch,
    maxFiniteDifference,
    matchedNaNs,
    matchedNegativeZeros,
    checksums: { baseline: outputDigest(baseline), current: outputDigest(current) },
  };
}

function numericLeaves(value) {
  if (typeof value === 'number') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(numericLeaves);
  return [];
}

// V8 serialization can encode equal numeric fields differently after an
// internal representation transition. Canonical value encoding makes this
// mutation check independent of hidden classes and small-integer tagging.
function fixtureBytes(value) {
  return Buffer.from(
    JSON.stringify(value, (_key, item) => {
      if (typeof item === 'number') {
        if (Number.isNaN(item)) return { $number: 'NaN' };
        if (Object.is(item, -0)) return { $number: '-0' };
        if (!Number.isFinite(item)) return { $number: item > 0 ? 'Infinity' : '-Infinity' };
      }
      if (ArrayBuffer.isView(item))
        return { $typedArray: item.constructor.name, values: Array.from(item) };
      return item;
    }),
  );
}

function inputBytes(state) {
  return fixtureBytes({ waves: state.waves, calls: state.calls });
}

function observe(output, state) {
  assert.equal(output, state.output, 'Observe the complete production output trace');
  const after = inputBytes(state);
  assert(state.inputBefore.equals(after), 'Production arithmetic mutated a workload input');
  return { output, inputs: after, inputSha256: sha256(after) };
}

function compare(a, b) {
  const numeric = compareNumbers(a.output, b.output);
  const inputsEqual = a.inputs.equals(b.inputs);
  return {
    ...numeric,
    equal: numeric.equal && inputsEqual,
    inputsEqual,
    inputsUnchanged: true,
    inputBytes: a.inputs.length,
    inputChecksums: { baseline: a.inputSha256, current: b.inputSha256 },
  };
}

function makeCall(profile, random, zero = false) {
  const frequency = 100 + random() * 150;
  return {
    profile,
    hz: [frequency * 0.5, frequency, frequency * 2],
    gains: zero ? [0, 0, 0] : profile.bandGain,
    cutoff: 600 + random() * 17_400,
    target: 0.15 + random() * 0.65,
  };
}

function prepareState(api, profiles, scenario, random, configuration) {
  assert.equal(api.BAND_HARMONICS, 40);
  const authored = Object.values(profiles);
  const active = authored.filter((profile) => profile.bandGain.every((gain) => gain > 0));
  assert.equal(active.length, 22, 'Two authored electric families have inactive combustion bands');
  const first = profiles['v6-turbo-hybrid'];
  if (scenario.primeBasis) api.normalisedWavePower(api.bandHarmonics(first, 0));
  const state = { api, waves: [], calls: [], output: null, inputBefore: null };
  if (scenario.kind === 'wave') {
    state.waves = [api.bandHarmonics(first, 0)];
  } else if (scenario.kind === 'waves') {
    for (const profile of authored)
      for (let band = 0; band < 3; band++) state.waves.push(api.bandHarmonics(profile, band));
    assert.equal(state.waves.length, bandsExpected);
  } else if (scenario.kind === 'family') {
    state.calls = [
      { profile: first, hz: bandHz, gains: first.bandGain, cutoff: 6500, target: 0.5 },
    ];
  } else if (scenario.kind === 'fresh') {
    const offset = Math.floor(random() * active.length);
    for (let i = 0; i < configuration.freshProfiles; i++) {
      const authoredProfile = active[(i + offset) % active.length];
      const profile = structuredClone(authoredProfile);
      assert.deepEqual(profile, authoredProfile, 'A fresh identity must preserve authored values');
      state.calls.push(makeCall(profile, random));
    }
    assert.equal(new Set(state.calls.map((call) => call.profile)).size, state.calls.length);
  } else {
    const zero = scenario.kind === 'zero';
    const offset = Math.floor(random() * active.length);
    for (let i = 0; i < 64; i++)
      state.calls.push(makeCall(zero ? first : active[(i + offset) % active.length], random, zero));
    // Keep actual profile objects throughout warmups/samples. Priming is setup,
    // including the active prime for the otherwise inactive zero-gain control.
    for (const profile of new Set(state.calls.map((call) => call.profile)))
      api.loudnessScale(profile, bandHz, profile.bandGain, 6500, 0.5);
  }
  for (const call of state.calls)
    for (let band = 0; band < 3; band++)
      if (call.gains[band] > 0)
        assert(call.hz[band] * 39 <= 20_000, 'The active workload must evaluate 117 harmonics');
  state.output = new Float64Array(
    state.waves.length ? state.waves.length * 2 : configuration.iterations * configuration.units,
  );
  state.inputBefore = inputBytes(state);
  return state;
}

function runWaves(state) {
  const { api, waves, output } = state;
  for (let i = 0; i < waves.length; i++) {
    const value = api.normalisedWavePower(waves[i]);
    output[i * 2] = value.peak;
    output[i * 2 + 1] = value.power;
  }
  return output;
}

function runFamilies(state) {
  const { api, calls, output } = state;
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    output[i] = api.loudnessScale(call.profile, call.hz, call.gains, call.cutoff, call.target);
  }
  return output;
}

function runHot(state, { iterations }) {
  const { api, calls, output } = state;
  for (let i = 0; i < iterations; i++) {
    const call = calls[i % calls.length];
    output[i] = api.loudnessScale(call.profile, call.hz, call.gains, call.cutoff, call.target);
  }
  return output;
}

function configurationFor(scenario, operationCounts = false) {
  const hot = scenario.kind === 'hot' || scenario.kind === 'zero';
  return {
    iterations: hot
      ? operationCounts
        ? 1
        : scenario.kind === 'hot'
          ? hotIterations
          : zeroIterations
      : 1,
    units:
      scenario.kind === 'waves'
        ? 72
        : scenario.kind === 'fresh'
          ? operationCounts
            ? 2
            : freshProfiles
          : 1,
    freshProfiles: operationCounts ? 2 : freshProfiles,
    unit:
      scenario.kind === 'wave' || scenario.kind === 'waves'
        ? 'waveform normalization'
        : 'loudnessScale call',
    run:
      scenario.kind === 'wave' || scenario.kind === 'waves' ? runWaves : hot ? runHot : runFamilies,
  };
}

function scopeFor(scenario) {
  const cold = scenario.fresh && !scenario.primeBasis;
  const waves = scenario.kind === 'wave' || scenario.kind === 'waves';
  return {
    timedWork: waves
      ? `Actual normalisedWavePower calls and stores of both returned numbers. ${scenario.kind === 'wave' ? 'One first full waveform only; initial lazy basis creation stays inside.' : 'One complete 72-pair authored sweep; its aggregate is not first-waveform latency.'}`
      : `Actual loudnessScale calls and stores of every returned double. ${scenario.kind === 'family' ? 'Exactly one first-family call; no averaging with cache hits.' : scenario.kind === 'fresh' ? 'Every call has a distinct fresh profile identity with unchanged authored values.' : scenario.kind === 'zero' ? 'All gains are zero; loop, dispatch, and trace-store overhead can dominate.' : 'Each call evaluates 39 harmonics in each of three active bands (117 total).'}`,
    setupWork: `Actual modules and profile graphs load outside timing. Harmonic inputs, deterministic argument schedules, fresh profile clones where needed, and output traces allocate outside timing. ${cold ? 'No basis or waveform-cache priming.' : scenario.primeBasis ? 'One direct full waveform primes the basis outside timing, without creating a profile cache entry.' : 'All referenced profiles are actively primed outside timing, including the zero-gain control profile.'}`,
    allocationScope: `${cold ? 'Initial candidate basis payload allocation and population are inside run.' : 'Candidate basis initialization is outside run.'} ${waves ? 'Returned peak/power objects are inside run.' : 'Production coefficient objects/arrays and any fresh waveform/cache entries are inside run.'} Trace buffers allocate outside run; their writes stay inside. The 655360-byte retained basis payload is source-derived/structurally observed, not a heap measurement.`,
    limitations:
      'Local synchronous bundled JavaScript arithmetic. Cold means module cache state, not process, JIT, CPU cache, or allocator state. No native Web Audio, PCM, physical device, browser timing, acoustic quality, or FPS claim. Fresh ESM modules remain retained until this bounded process exits. All raw pairs, including slower/no-gain cases, are retained.',
  };
}

async function edgeProof(sources, profiles) {
  const output = {};
  for (const side of sides) {
    const api = await sources[side].load({ fresh: true });
    const spectra = [
      new Float32Array(),
      Float32Array.of(-0),
      Float32Array.of(NaN, 0),
      Float32Array.of(0, NaN),
      Float32Array.of(0, Infinity),
      Float32Array.of(0, -Infinity),
      new Float32Array(40),
      new Float32Array(41).fill(-0),
    ];
    const numbers = [];
    for (const spectrum of spectra) {
      const before = Buffer.from(bytesOf(spectrum));
      const result = api.normalisedWavePower(spectrum);
      numbers.push(result.peak, result.power);
      assert(before.equals(bytesOf(spectrum)), 'Edge spectrum mutated');
    }
    for (const hz of [0, -0, NaN, Infinity]) numbers.push(api.kWeightPower(hz));
    for (const [hz, cutoff] of [
      [0, 10],
      [NaN, NaN],
      [Infinity, 10],
    ])
      numbers.push(api.lowpassPower(hz, cutoff));
    numbers.push(api.loudnessScale(profiles[side]['v6-turbo-hybrid'], bandHz, [0, 0, 0], NaN, NaN));
    output[side] = Float64Array.from(numbers);
  }
  const result = compareNumbers(output.baseline, output.current);
  assert(result.equal, 'Untimed nonfinite/empty/signed-zero input equivalence failed');
  assert(!compareNumbers(Float64Array.of(0), Float64Array.of(-0)).equal);
  assert(compareNumbers(Float64Array.of(NaN), Float64Array.of(NaN)).equal);
  return {
    ...result,
    timing: null,
    spectra: 8,
    description:
      'Complete waveform returns plus K-weight/low-pass edge calls and inactive gains. Includes NaN, infinities, empty/silent input, signed-zero input and a long fallback. Comparator explicitly rejects opposite zero signs and accepts matching NaNs.',
  };
}

function countOperations(action) {
  const originalSin = Math.sin;
  const originalCos = Math.cos;
  const OriginalFloat64Array = globalThis.Float64Array;
  const counts = { sin: 0, cos: 0, float64Allocations: 0, float64PayloadBytes: 0 };
  Math.sin = (value) => {
    counts.sin++;
    return originalSin(value);
  };
  Math.cos = (value) => {
    counts.cos++;
    return originalCos(value);
  };
  globalThis.Float64Array = new Proxy(OriginalFloat64Array, {
    construct(target, argumentsList, newTarget) {
      const array = Reflect.construct(target, argumentsList, newTarget);
      counts.float64Allocations++;
      counts.float64PayloadBytes += array.byteLength;
      return array;
    },
  });
  try {
    return { output: action(), counts };
  } finally {
    Math.sin = originalSin;
    Math.cos = originalCos;
    globalThis.Float64Array = OriginalFloat64Array;
  }
}

async function operationProof(sources, profiles) {
  const rows = [];
  for (const scenario of scenarios.filter(({ id }) => selected.includes(id))) {
    const configuration = configurationFor(scenario, true);
    const observations = {};
    const operations = {};
    for (const side of sides) {
      const api = await sources[side].load({ fresh: true });
      const state = prepareState(api, profiles[side], scenario, seeded(0x407a), configuration);
      const result = countOperations(() => configuration.run(state, configuration));
      observations[side] = observe(result.output, state);
      operations[side] = result.counts;
    }
    const equivalence = compare(observations.baseline, observations.current);
    assert(equivalence.equal, `Instrumented outputs differ: ${scenario.id}`);
    if (scenario.id === 'cached-117-harmonic-updates') {
      assert.deepEqual(operations.baseline, {
        sin: 117,
        cos: 819,
        float64Allocations: 0,
        float64PayloadBytes: 0,
      });
      assert.deepEqual(operations.current, {
        sin: 1,
        cos: 235,
        float64Allocations: 0,
        float64PayloadBytes: 0,
      });
    }
    if (scenario.fresh && !scenario.primeBasis) {
      assert.equal(operations.current.float64Allocations, 1);
      assert.equal(operations.current.float64PayloadBytes, basisPayloadBytes);
    }
    rows.push({
      name: scenario.id,
      calls: configuration.iterations * configuration.units,
      operations,
      equivalence,
      elapsedMs: null,
    });
  }
  // Unlike the measured warm zero-gain control, this explicitly observes a
  // fresh module with no waveform priming. Profile access must remain lazy.
  const lazy = {};
  for (const side of sides) {
    const api = await sources[side].load({ fresh: true });
    const profile = new Proxy(
      {},
      {
        get() {
          throw new Error('Inactive gains inspected the profile');
        },
      },
    );
    const result = countOperations(() =>
      api.loudnessScale(profile, bandHz, [0, -0, NaN], NaN, NaN),
    );
    assert.equal(result.output, 1);
    assert.deepEqual(result.counts, {
      sin: 0,
      cos: 0,
      float64Allocations: 0,
      float64PayloadBytes: 0,
    });
    lazy[side] = result.counts;
  }
  return {
    mode: 'separate-untimed-instrumentation-process',
    timingsCollected: false,
    rows,
    inactiveModuleCold: lazy,
    limitation:
      'Math.sin/Math.cos and Float64Array construction are wrapped only in --mode counts. This mode never performs timing. Counts do not measure heap, GC, coefficient-array allocations, PCM, or device work.',
  };
}

async function execute(lock = null) {
  const evidenceFiles = Object.fromEntries(
    [workloadFile, helperFile].map((path) => [path, sha256(readFileSync(path))]),
  );
  const sources = {};
  const fixtureSources = {};
  const profiles = {};
  const fixtureBefore = {};
  for (const side of sides) {
    const common = {
      root: values[side],
      expectedCommit: side === 'baseline' ? ORIGINAL_BASELINE : values['current-commit'],
      mode: 'bundle',
    };
    sources[side] = await prepareModule({ ...common, entry: 'src/audio/engine-loudness.ts' });
    fixtureSources[side] = await prepareModule({ ...common, entry: 'src/audio/sound-profiles.ts' });
    profiles[side] = (await fixtureSources[side].load()).SOUND_PROFILES;
    fixtureBefore[side] = fixtureBytes(profiles[side]);
    assert.equal(Object.keys(profiles[side]).length, familiesExpected);
  }
  assert.deepEqual(
    Object.keys(fixtureSources.baseline.identity.files),
    Object.keys(fixtureSources.current.identity.files),
  );
  for (const [name, original] of Object.entries(fixtureSources.baseline.identity.files))
    assert.equal(
      fixtureSources.current.identity.files[name].sha256,
      original.sha256,
      `Authored profile graph changed: ${name}`,
    );
  assert.deepEqual(
    profiles.baseline,
    profiles.current,
    'All authored profile values must remain exact',
  );
  const profileValues = compareNumbers(
    Float64Array.from(numericLeaves(profiles.baseline)),
    Float64Array.from(numericLeaves(profiles.current)),
  );
  assert(profileValues.equal);
  const edges = await edgeProof(sources, profiles);
  const reports = [];
  let operations = null;
  if (values.mode === 'counts') {
    operations = await operationProof(sources, profiles);
  } else {
    for (const scenario of scenarios.filter(({ id }) => selected.includes(id))) {
      const configuration = configurationFor(scenario);
      for (const side of sides) fixtureSources[side].assertStable();
      reports.push(
        await runPaired({
          name: scenario.id,
          sources,
          workloadFile,
          seed: 0x407a,
          warmupPairs,
          samplePairs,
          iterations: configuration.iterations,
          unitsPerIteration: configuration.units,
          unit: configuration.unit,
          moduleLifetime: scenario.fresh ? 'fresh-per-sample' : 'reuse',
          purpose: measured ? 'measurement' : 'smoke',
          exclusiveCompute: measured && values.exclusive,
          lock,
          scope: scopeFor(scenario),
          prepare: ({ api, side, random }) =>
            prepareState(api, profiles[side], scenario, random, configuration),
          run: configuration.run,
          observe,
          compare,
        }),
      );
    }
  }
  for (const side of sides) {
    sources[side].assertStable();
    fixtureSources[side].assertStable();
    assert(fixtureBefore[side].equals(fixtureBytes(profiles[side])), 'Authored profiles mutated');
  }
  for (const [path, hash] of Object.entries(evidenceFiles))
    assert.equal(sha256(readFileSync(path)), hash, `Evidence code changed: ${path}`);
  const report = {
    schema: 'engine-advancement-audio/1',
    createdAt: new Date().toISOString(),
    mode: values.mode,
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
    concurrency: { exclusiveCompute: measured && values.exclusive, cooperativeLock: lock },
    sourceGraphs: Object.fromEntries(sides.map((side) => [side, sources[side].identity])),
    authoredProfileGraphs: Object.fromEntries(
      sides.map((side) => [side, fixtureSources[side].identity]),
    ),
    evidenceFiles,
    stableSources: true,
    authoredProfiles: {
      families: Object.keys(profiles.baseline),
      familyCount: familiesExpected,
      familyBandPairs: bandsExpected,
      graphByteIdentical: true,
      values: profileValues,
      inputsUnchanged: true,
      serializedSha256: sha256(fixtureBefore.baseline),
    },
    equalityPolicy:
      'Direct Object.is for every returned double: matching NaNs are equal, opposite zero signs differ, all finite values and infinities must match exactly. Checksums canonicalize NaN payloads only and supplement direct comparison. Complete fixture bytes are compared and checked for mutation.',
    cacheAccounting: {
      candidateLogicalPayloadBytes: basisPayloadBytes,
      candidateLogicalPayloadKiB: basisPayloadBytes / 1024,
      baselineBasisPayloadBytes: 0,
      heapMeasured: false,
      note: 'One lazy Float64Array(2048 * 40) per initialized candidate module, including unused column zero. Typed-array headers, existing WeakMap profile entries, allocator/GC behavior, and ESM instance retention are additional, unmeasured costs.',
    },
    untimedEdgeProof: edges,
    operations,
    reports,
    equivalence: {
      passed: edges.equal && profileValues.equal && reports.every((row) => row.equivalence.passed),
      comparedWorkloadNumbers: reports.reduce(
        (sum, row) =>
          sum +
          [...row.warmups, ...row.samples].reduce(
            (n, pair) => n + pair.equivalence.comparedNumbers,
            0,
          ),
        0,
      ),
      checkedPairs: reports.reduce((sum, row) => sum + row.equivalence.checkedPairs, 0),
    },
    timing: {
      validForComparison: measured && reports.every((row) => row.timing.validForComparison),
      limitation: measured
        ? 'Only the raw local arithmetic workload timings are measured. Inspect all cases, including first-use cost and no-gain controls. No PCM/device/FPS inference.'
        : 'Untimed preparation only. Every workload duration is null; setup/import diagnostics are not performance evidence.',
    },
  };
  writeReport(values.output, report);
  assert(report.equivalence.passed, 'Saved audio evidence contains a comparison failure');
  process.stdout.write(
    JSON.stringify({
      output: values.output,
      mode: report.mode,
      cases: reports.length,
      pairs: report.equivalence.checkedPairs,
      comparedWorkloadNumbers: report.equivalence.comparedWorkloadNumbers,
      profileNumbers: profileValues.comparedNumbers,
      edgeNumbers: edges.comparedNumbers,
      operationCases: operations?.rows.length ?? 0,
      passed: report.equivalence.passed,
      timingValid: report.timing.validForComparison,
    }) + '\n',
  );
}

if (measured) await withTimingLock(values.lock, execute);
else await execute();
