/** Actual-module surface equivalence and bounded paired measurement. No source rewrites. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ORIGINAL_BASELINE,
  median,
  prepareModule,
  runPaired,
  sha256,
  withTimingLock,
  writeReport,
} from './benchmark-support.mjs';

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    current: { type: 'string' },
    output: { type: 'string' },
    mode: { type: 'string', default: 'smoke' },
    exclusive: { type: 'boolean', default: false },
    lock: { type: 'string', default: '/tmp/aeebac160835-engine-wave7.lock' },
    iterations: { type: 'string' },
    samples: { type: 'string' },
    warmups: { type: 'string' },
    cases: { type: 'string' },
  },
});
for (const option of ['baseline', 'current', 'output'])
  assert(values[option] && isAbsolute(values[option]), `Required: --${option} /absolute/path`);
assert(!existsSync(values.output), 'Refusing to overwrite the output report');
assert(['smoke', 'measure'].includes(values.mode), 'Use --mode smoke or --mode measure');
const measured = values.mode === 'measure';
assert(!measured || values.exclusive, 'Coordinate exclusive compute before using --exclusive');
const count = (key, fallback, minimum = 1) => {
  const n = values[key] === undefined ? fallback : Number(values[key]);
  assert(Number.isSafeInteger(n) && n >= minimum, `Invalid --${key}`);
  return n;
};
const iterations = count('iterations', measured ? 16 : 1);
const samplePairs = count('samples', measured ? 9 : 1);
const warmupPairs = count('warmups', measured ? 3 : 0, 0);
const sides = ['baseline', 'current'];
const gridFields = [
  'water',
  'rubber',
  'marbles',
  'frozen',
  'temperature',
  'substrateTemperature',
  'drainage',
  'sheltered',
];
const scalarFields = [
  'surfaceClock',
  'rain',
  'cloud',
  'ambient',
  'windX',
  'windZ',
  'visibility',
  'dust',
  'gust',
  'moisture',
  'fogCover',
];
const supplementalImports = ['src/simulation/surface-thermal.ts', 'src/simulation/weather.ts'];
const fragmentDt = [0.1, 0.4, 0.3, 0.7, 1.5, 0.125, 0.375, 2];
const frame = (timeSec, rainRateMmHr, ambientTempC, cloudCover01 = 0.3, windSpeedMS = 3) => ({
  timeSec,
  rainRateMmHr,
  ambientTempC,
  cloudCover01,
  windSpeedMS,
  windDirection: 0.3,
});
const scenarios = [
  { id: 'clear-default', preset: 'clear', ticks: 8 },
  { id: 'rain-steady', preset: 'rain', ticks: 8 },
  { id: 'storm-exposed', preset: 'storm', ticks: 8 },
  {
    id: 'mutable-weather',
    preset: 'rain',
    mutable: true,
    ticks: 11,
    frames: [
      frame(0, 24, 20),
      frame(6, 0, 29, 0.1, 7),
      frame(12, 36, 17, 0.9, 1),
      frame(24, 12, 25, 0.5, 5),
    ],
  },
  {
    id: 'snow-thaw',
    preset: 'snow',
    ticks: 8,
    frames: [frame(0, 12, -5), frame(3, 24, 4), frame(6, 0, 12)],
  },
  { id: 'rain-first-tick', preset: 'rain', cold: true, ticks: 32 },
  { id: 'thermal-variable-dt', direct: true, ticks: 8 },
];
const selected = values.cases ? values.cases.split(',') : scenarios.map((s) => s.id);
assert(selected.length > 0 && new Set(selected).size === selected.length, 'Invalid case selection');
for (const id of selected)
  assert(
    scenarios.some((s) => s.id === id),
    `Unknown case: ${id}`,
  );

function snapshot(parts, scalars = []) {
  for (const [name, array] of parts)
    assert(array.every(Number.isFinite), `Non-finite observed array: ${name}`);
  const shapes = parts.map(([name, array]) => ({
    name,
    type: array.constructor.name,
    elements: array.length,
    bytes: array.byteLength,
  }));
  assert(scalars.every(Number.isFinite), 'Non-finite observed scalar');
  const numbers = Float64Array.from(scalars);
  const bytes = Buffer.concat([
    ...parts.map(([, array]) => Buffer.from(array.buffer, array.byteOffset, array.byteLength)),
    Buffer.from(numbers.buffer),
  ]);
  return { shapes, scalars, bytes, checksum: sha256(bytes) };
}

function compare(a, b) {
  const shapeEqual = JSON.stringify(a.shapes) === JSON.stringify(b.shapes);
  let unequalBytes = Math.abs(a.bytes.length - b.bytes.length);
  if (!a.bytes.equals(b.bytes))
    for (let i = 0; i < Math.min(a.bytes.length, b.bytes.length); i++)
      if (a.bytes[i] !== b.bytes[i]) unequalBytes++;
  let unequalScalars = Math.abs(a.scalars.length - b.scalars.length);
  for (let i = 0; i < Math.min(a.scalars.length, b.scalars.length); i++)
    if (!Object.is(a.scalars[i], b.scalars[i])) unequalScalars++;
  return {
    equal: shapeEqual && unequalBytes === 0 && unequalScalars === 0,
    checksums: { baseline: a.checksum, current: b.checksum },
    comparedBytes: a.bytes.length,
    comparedScalars: a.scalars.length,
    unequalBytes,
    unequalScalars,
    shapeEqual,
  };
}

function observeTracks(state) {
  const parts = [],
    scalars = [state.time, state.stage];
  for (let i = 0; i < state.tracks.length; i++) {
    const track = state.tracks[i];
    for (const field of gridFields) parts.push([`${i}/${field}`, track[field]]);
    for (const field of scalarFields) scalars.push(track[field]);
    scalars.push(Number(track.cold));
  }
  return snapshot(parts, scalars);
}

function makeTracks(api, scenario, warm = true) {
  const tracks = Array.from(
    { length: scenario.cold ? scenario.ticks : 1 },
    () =>
      new api.Track(
        scenario.preset,
        false,
        scenario.frames?.map((f) => ({ ...f })),
      ),
  );
  if (scenario.dryout) {
    for (const track of tracks) {
      track.water.fill(1e-7);
      track.temperature.fill(48);
      track.substrateTemperature.fill(37);
    }
  }
  const state = { tracks, time: 0, stage: 0, scenario };
  if (warm && !scenario.cold) {
    for (const track of tracks) track.evolve(0.5, 0.5);
    state.time = 0.5;
  }
  return state;
}

function stageMutable(track, stage, dt) {
  for (const row of [0, 19, 79, 511]) track.sheltered[row] = (stage + row) % 2;
  const rates = [0, 1e-14, 1e-12, 0.017, 0.1];
  for (let cell = 0; cell < 10; cell++) track.drainage[cell] = rates[(stage + cell) % rates.length];
  for (let j = 0; j < 8; j++) {
    const cell = (stage * 137 + j * 419) % track.water.length;
    track.interact(
      cell,
      j === 1 ? 0 : 3300,
      (j + 1) * 1375.125,
      j % 2 ? 0 : 41.25,
      dt / 3,
      j === 2 ? 3 : 0,
      0.001 * j,
    );
  }
}

function trackStep(state, dt) {
  state.time += dt;
  for (const track of state.tracks) {
    if (state.scenario.mutable) stageMutable(track, state.stage, dt);
    track.evolve(dt, state.time);
  }
  state.stage++;
}

function runTracks(state, { iterations: repeats }) {
  if (state.scenario.cold) {
    assert.equal(repeats, 1);
    trackStep(state, 0.5);
  } else {
    for (let cycle = 0; cycle < repeats; cycle++)
      for (let tick = 0; tick < 8; tick++)
        trackStep(state, state.scenario.mutable ? fragmentDt[tick] : 0.5);
  }
}

function makeColumns(api) {
  const cells = api.CELL_ROWS * api.CELL_COLS;
  const parameters = { ...api.SURFACE_THERMAL };
  const state = {
    api,
    parameters,
    step: new api.SurfaceThermalStep(parameters, cells),
    coefficients: api.WaterStepCoefficients ? new api.WaterStepCoefficients(cells) : undefined,
    stage: 0,
    surface: new Float64Array(cells),
    substrate: new Float64Array(cells),
    water: new Float64Array(cells),
    evaporated: new Float64Array(cells),
    drainage: new Float64Array(cells),
    rainfall: new Float64Array(cells),
  };
  for (let i = 0; i < cells; i++) {
    state.surface[i] = 27 + (i % 19) * 0.125;
    state.substrate[i] = 21 + (i % 7) * 0.125;
    state.water[i] = i % 13 ? 0.1 * (i % 7) : 1e-7;
    state.drainage[i] = [0, 1e-14, 1e-12, 0.02, 0.04][i % 5];
  }
  return state;
}

function columnStep(state) {
  const { api, parameters, step, surface, substrate, water, evaporated, drainage, rainfall } =
    state;
  const index = state.stage++;
  const dt = [0.5, 0.25, 1, 0.125, 0.5, 0.5, 0.25, 0.5][index % 8];
  for (const key of Object.keys(parameters))
    parameters[key] = api.SURFACE_THERMAL[key] * (index % 3 === 0 ? 1 : 1.125);
  const sheltered = index % 5 === 3;
  const weather = {
    ambient: index % 2 ? 19 : 27,
    cloud: index % 3 ? 0.9 : 0.1,
    rain: index % 4 ? 24 : 0,
    windX: index % 3 ? 3 : 5,
    windZ: -2,
  };
  step.prepare(dt, weather, sheltered);
  for (let cell = 0; cell < surface.length; cell++) {
    rainfall[cell] = sheltered ? 0 : (weather.rain / 3600) * (0.65 + (cell % 7) * 0.05);
    if (cell < 10) drainage[cell] = [0, 1e-14, 1e-12, 0.017, 0.1][(index + cell) % 5];
    step.advanceWet(
      surface[cell],
      substrate[cell],
      water[cell],
      rainfall[cell],
      drainage[cell],
      (cell % 11) * 123.456,
      cell,
      state.coefficients,
    );
    surface[cell] = step.surface;
    substrate[cell] = step.substrate;
    water[cell] = step.water;
    evaporated[cell] = step.evaporated;
  }
}

function observeColumns(state) {
  return snapshot(
    ['surface', 'substrate', 'water', 'evaporated', 'drainage', 'rainfall'].map((field) => [
      field,
      state[field],
    ]),
    [
      state.stage,
      state.step.surface,
      state.step.substrate,
      state.step.water,
      state.step.evaporated,
      ...Object.values(state.parameters),
    ],
  );
}

async function audit(api) {
  const results = [],
    originals = {},
    traces = {};
  for (const side of sides) {
    const prototype = api[side].SurfaceThermalStep.prototype;
    originals[side] = prototype.advanceWet;
    traces[side] = [];
    prototype.advanceWet = function (...args) {
      const result = originals[side].apply(this, args);
      const observed = [
        ...args.slice(0, 6),
        this.surface,
        this.substrate,
        this.water,
        this.evaporated,
      ];
      assert.equal(observed.length, 10);
      assert(observed.every(Number.isFinite), 'Non-finite raw thermal boundary value');
      for (const value of observed) traces[side].push(value);
      return result;
    };
  }
  try {
    const auditCases = scenarios
      .filter((s) => !s.direct && !s.cold)
      .concat({
        id: 'dry-out-audit',
        preset: 'clear',
        dryout: true,
      });
    for (const scenario of auditCases) {
      const states = Object.fromEntries(
        sides.map((side) => [side, makeTracks(api[side], scenario, false)]),
      );
      const boundaries = [];
      const check = (boundary, raw) => {
        const publicState = compare(observeTracks(states.baseline), observeTracks(states.current));
        assert(publicState.equal, `${scenario.id}/${boundary}: public surface mismatch`);
        const rawState = raw
          ? compare(
              snapshot([['raw-inputs-and-outputs', Float64Array.from(traces.baseline)]]),
              snapshot([['raw-inputs-and-outputs', Float64Array.from(traces.current)]]),
            )
          : null;
        if (rawState) assert(rawState.equal, `${scenario.id}/${boundary}: raw thermal mismatch`);
        boundaries.push({
          boundary,
          publicState,
          rawThermal: rawState,
          rawFloat64Values: raw ? traces.baseline.length : 0,
          surfaceTicks: raw
            ? traces.baseline.length / (10 * states.baseline.tracks[0].water.length)
            : 0,
        });
      };
      check('initial', false);
      for (let tick = 0; tick < fragmentDt.length; tick++) {
        for (const side of sides) {
          traces[side].length = 0;
          trackStep(states[side], fragmentDt[tick]);
        }
        check(`evolve-${tick}`, true);
      }
      // The final fragmented call consumes traffic heat accumulated by prior calls.
      assert.equal(states.baseline.tracks[0].surfaceClock, 0);
      if (scenario.dryout) assert.equal(states.baseline.tracks[0].meanWater(), 0);
      results.push({ scenario: scenario.id, boundaries });
    }
  } finally {
    for (const side of sides) api[side].SurfaceThermalStep.prototype.advanceWet = originals[side];
  }
  for (const side of sides)
    assert.equal(api[side].SurfaceThermalStep.prototype.advanceWet, originals[side]);
  const columns = Object.fromEntries(sides.map((side) => [side, makeColumns(api[side])]));
  const directBoundaries = [];
  for (let tick = 0; tick < 8; tick++) {
    for (const side of sides) columnStep(columns[side]);
    const result = compare(observeColumns(columns.baseline), observeColumns(columns.current));
    assert(result.equal, `Direct thermal boundary ${tick} differs`);
    directBoundaries.push({ boundary: tick, ...result });
  }
  return {
    passed: true,
    productionSourcesRewritten: false,
    instrumentationRestoredBeforePairs: true,
    trackCases: results,
    directBoundaries,
    scope:
      'Complete public Float32/Uint8 surface arrays and weather/clock scalars after every audit call; all six semantic advanceWet inputs and four raw Float64 outputs in cell order; complete direct Float64 column arrays after every solver step.',
    limitation:
      'Track #surfaceHeat, #cellArea and private caches are not read directly. Consumed heat flux is checked at advanceWet boundaries; equality of unobserved private state is not claimed. Timed pairs compare full public/direct arrays at each sample boundary, with raw per-cell tracing confined to this untimed audit.',
  };
}

function logicalStorage(api) {
  const cells = api.CELL_ROWS * api.CELL_COLS;
  const thermal = new api.SurfaceThermalStep(api.SURFACE_THERMAL, cells);
  const water = new api.WaterStepCoefficients(cells);
  const arrays = (object) =>
    Object.entries(object)
      .filter(([, value]) => value instanceof Float64Array)
      .map(([name, value]) => ({ name, elements: value.length, bytes: value.byteLength }));
  const thermalArrays = arrays(thermal),
    waterArrays = arrays(water);
  assert.equal(
    thermalArrays.reduce((sum, a) => sum + a.bytes, 0),
    cells * 8 * 7,
  );
  assert.equal(
    waterArrays.reduce((sum, a) => sum + a.bytes, 0),
    cells * 8 * 2,
  );
  return {
    cells,
    additionalBytesPerTrack: cells * 80,
    additionalKiBPerTrack: (cells * 80) / 1024,
    depression: {
      elements: cells,
      bytes: cells * 8,
      verification:
        'Private Track allocation expression in the recorded source graph; cell count from actual module exports.',
    },
    thermalArrays,
    waterArrays,
    limitation:
      'Logical added typed-array payload retained per Track, not a heap/RSS measurement. Excludes object/array headers and scalar cache keys. Actual standalone solver allocations verify cache shapes; Track private arrays are not exposed.',
  };
}

async function execute(lock = null) {
  const sources = {},
    api = {};
  for (const side of sides) {
    const source = await prepareModule({
      root: values[side],
      entry: 'src/simulation/track.ts',
      expectedCommit: side === 'baseline' ? ORIGINAL_BASELINE : undefined,
    });
    for (const file of supplementalImports)
      assert(source.identity.files[file], `Unrecorded import: ${file}`);
    sources[side] = {
      ...source,
      async load() {
        const track = await source.load();
        const [thermal, weather] = await Promise.all(
          supplementalImports.map(
            (file) => import(pathToFileURL(join(source.identity.root, file)).href),
          ),
        );
        return { ...track, ...thermal, ...weather };
      },
    };
    api[side] = await sources[side].load();
  }
  const correctness = await audit(api);
  for (const side of sides) sources[side].assertStable();
  const reports = [];
  for (const scenario of scenarios.filter((s) => selected.includes(s.id))) {
    const report = await runPaired({
      name: `surface/${scenario.id}`,
      sources,
      workloadFile: fileURLToPath(import.meta.url),
      seed: 0x38face,
      purpose: measured ? 'measurement' : 'smoke',
      exclusiveCompute: measured,
      lock,
      warmupPairs,
      samplePairs,
      iterations: scenario.cold ? 1 : iterations,
      unitsPerIteration: scenario.ticks,
      unit: scenario.direct ? '3584-column solver step' : '3584-cell fixed surface tick',
      scope: {
        timedWork: scenario.direct
          ? 'Eight actual SurfaceThermalStep.prepare/advanceWet grid sweeps per iteration with variable solver dt, local mutable parameter copies, air/rainfall/drainage and shelter changes. Fixture updates, actual outputs and existing-array writes remain inside run().'
          : scenario.cold
            ? 'The first actual Track.evolve(0.5, 0.5) for each of 32 separately constructed rainy Tracks. Cache initialization inside the first surface tick is timed.'
            : `Actual Track.evolve over ${scenario.ticks} fixed 0.5-second surface ticks per iteration.${scenario.mutable ? ' Caller dt is fragmented; identical shelter/drainage edits and eight traffic interactions per call are inside timing.' : ' Caller dt is 0.5 seconds.'}`,
        setupWork: scenario.direct
          ? 'Actual modules imported once; Float64 physical arrays, mutable parameter copies and bounded candidate caches allocated before run(). One eight-step cycle primes each fixture outside timing.'
          : 'Actual Track construction, weather fixture cloning and public arrays are outside timing. Warm cases receive one real 0.5-second tick outside timing; first-tick bank receives none. Setup diagnostics include other constructor changes such as the lane index and cannot isolate surface allocation cost.',
        allocationScope:
          'No checksum, copying, raw thermal tracing, source hashing or report I/O inside run(). Production allocations and explicitly described fixture staging within run() remain timed; no forced GC.',
        limitations:
          'Local synchronous Node workload only; no browser, rendering, FPS or whole-game inference. Full physical arrays/scalars compared at every paired boundary; private Track arrays are not directly accessible. Shared process/JIT and ambient host noise remain possible. Logical cache payload is reported separately.',
      },
      prepare({ api: module }) {
        if (!scenario.direct) return makeTracks(module, scenario);
        const state = makeColumns(module);
        for (let tick = 0; tick < 8; tick++) columnStep(state);
        return state;
      },
      run(state, context) {
        if (!scenario.direct) return runTracks(state, context);
        for (let cycle = 0; cycle < context.iterations; cycle++)
          for (let tick = 0; tick < 8; tick++) columnStep(state);
      },
      observe(_result, state) {
        return scenario.direct ? observeColumns(state) : observeTracks(state);
      },
      compare,
    });
    assert(report.equivalence.passed, `${scenario.id}: paired equivalence failed`);
    if (measured) {
      const ratios = report.samples.map((row) => row.baseline.elapsedMs / row.current.elapsedMs);
      report.pairedSpeedRatio = {
        definition:
          'baseline elapsed / current elapsed; >1 means less current time; all raw pairs retained',
        median: median(ratios),
        minimum: Math.min(...ratios),
        maximum: Math.max(...ratios),
        currentFasterPairs: ratios.filter((r) => r > 1).length,
        totalPairs: ratios.length,
        warning:
          'A ratio near one, overlapping/noisy raw samples, or mixed directions does not establish an improvement.',
      };
    }
    reports.push(report);
  }
  const report = {
    schema: 'engine-advancement-surfaces/1',
    createdAt: new Date().toISOString(),
    purpose: measured ? 'measurement' : 'smoke',
    sources: Object.fromEntries(sides.map((side) => [side, sources[side].identity])),
    supplementalImports,
    runtime: reports[0].runtime,
    correctness,
    logicalStorage: logicalStorage(api.current),
    pairedBoundaries:
      'Each warmup/sample pair compares complete public Track arrays or complete direct Float64 column arrays; raw Float64 Track thermal boundaries are audited separately outside timing.',
    cases: reports.map(({ sources: _sources, runtime: _runtime, ...report }) => ({
      ...report,
      sourcesReference: '/sources',
      runtimeReference: '/runtime',
    })),
  };
  for (const side of sides) sources[side].assertStable();
  writeReport(values.output, report);
  process.stdout.write(
    JSON.stringify({
      output: values.output,
      purpose: report.purpose,
      cases: reports.length,
      allEquivalent: true,
      auditBoundaries: correctness.trackCases.reduce(
        (sum, item) => sum + item.boundaries.length,
        0,
      ),
      rawFloat64Values: correctness.trackCases.reduce(
        (sum, item) => sum + item.boundaries.reduce((n, b) => n + b.rawFloat64Values, 0),
        0,
      ),
      additionalLogicalKiBPerTrack: report.logicalStorage.additionalKiBPerTrack,
      workloadTimingsCollected: measured,
    }) + '\n',
  );
}

if (measured) await withTimingLock(values.lock, execute);
else await execute();
