import { assert, BASELINE, variants } from './support.mjs';

const entry = `
export { SurfaceThermalStep, SURFACE_THERMAL } from './src/simulation/surface-thermal.ts';
export { Track, CELL_ROWS, CELL_COLS } from './src/simulation/track.ts';
export { WaterStepCoefficients } from './src/simulation/weather.ts';
`;
const { baseline, candidate, provenance } = await variants(entry, [
  'src/simulation/surface-thermal.ts',
]);
assert.equal(provenance.baselineRef, BASELINE);
assert.notEqual(baseline.SurfaceThermalStep, candidate.SurfaceThermalStep);
assert.equal(Object.isFrozen(baseline.SURFACE_THERMAL), true);
assert.equal(Object.isFrozen(candidate.SURFACE_THERMAL), true);
assert.equal(candidate.CELL_ROWS, baseline.CELL_ROWS);
assert.equal(candidate.CELL_COLS, baseline.CELL_COLS);

const COLUMN_FIELDS = ['surface', 'substrate', 'water', 'evaporated'];
const SURFACE_ARRAYS = [
  'temperature',
  'substrateTemperature',
  'water',
  'rubber',
  'marbles',
  'frozen',
];
const WEATHER_CLOCK_FIELDS = [
  'ambient',
  'cloud',
  'rain',
  'windX',
  'windZ',
  'visibility',
  'dust',
  'gust',
  'moisture',
  'fogCover',
  'surfaceClock',
];
const PRESETS = ['clear', 'rain', 'storm'];
const MUTABLE_FIELDS = [
  'surfaceCapacity',
  'substrateCapacity',
  'conduction',
  'deepConductance',
];
const CELLS = 128;
const PREPARATIONS = 12;
const TRACK_UPDATES = 4;
const trackCells = candidate.CELL_ROWS * candidate.CELL_COLS;

function equalNumber(actual, expected, label) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected), label + ': non-finite');
  assert.ok(Object.is(actual, expected), label + ': exact scalar mismatch');
}

function equalColumn(steps, label) {
  for (const key of COLUMN_FIELDS) equalNumber(steps[1][key], steps[0][key], label + '.' + key);
}

function columnSnapshot(step) {
  return Object.fromEntries(COLUMN_FIELDS.map((key) => [key, step[key]]));
}

// Both sides use their own genuine frozen default and their own water bank.
// Repeated slot visits exercise cached wet matrices as well as the dry fast path.
function exerciseDefault(apis, compare) {
  const steps = apis.map((api) => new api.SurfaceThermalStep(api.SURFACE_THERMAL, CELLS));
  const waterBanks = apis.map((api) => new api.WaterStepCoefficients(CELLS));
  let columns = 0;
  let cachedWetRevisits = 0;
  for (let tick = 0; tick < PREPARATIONS; tick++) {
    const weather = {
      ambient: tick - 4,
      cloud: (tick % 4) / 4,
      rain: tick % 3 ? 24 : 0,
      windX: 3 + Math.floor(tick / 4),
      windZ: -2,
    };
    const dt = [0.5, 0.5, 0.25, 1, 0.125, 0.5][tick % 6];
    const sheltered = tick === 5 || tick === 6;
    for (const step of steps) step.prepare(dt, weather, sheltered);
    for (let pass = 0; pass < 2; pass++) {
      for (let cell = 0; cell < CELLS; cell++) {
        const rainfall = sheltered ? 0 : (weather.rain / 3600) * (0.65 + cell * 0.02);
        const surface = cell % 3 ? 24 + pass : 60;
        const water = cell % 4 ? 0.4 : 0;
        const drainage = cell % 2 ? 0.02 : 1e-15;
        if (pass === 1 && rainfall > 0) {
          // These TypeScript-private fields remain ordinary runtime properties.
          // Assert a populated slot is revisited with a different active rainfall,
          // so the revisit cannot merely take the same-rain early return.
          for (const step of steps) {
            assert.equal(step.cellRainfall[cell], rainfall, 'wet slot must already be cached');
            assert.notEqual(step.matrixRainfall, rainfall, 'wet revisit must select a slot');
          }
          cachedWetRevisits++;
        }
        for (let i = 0; i < steps.length; i++) {
          steps[i].advanceWet(
            surface, 26, water, rainfall, drainage, cell * 1.7, cell, waterBanks[i],
          );
        }
        compare(steps, 'default/' + tick + '/' + pass + '/' + cell);
        columns++;
      }
    }
    // The prior cell can select a local rainfall: advance() must restore prepare()'s.
    for (const step of steps) step.advance(29, 21, 57);
    compare(steps, 'default/' + tick + '/advance');
    columns++;
  }
  assert.equal(columns, 3084);
  assert.equal(cachedWetRevisits, 896);
  return {
    preparations: PREPARATIONS,
    cellSlots: CELLS,
    passesPerPreparation: 2,
    columns,
    scalarComparisons: columns * COLUMN_FIELDS.length,
    verifiedCachedWetRevisits: cachedWetRevisits,
    standaloneRainfallRestorations: PREPARATIONS,
  };
}

function exerciseMutable(apis, compare) {
  let columns = 0;
  for (const key of MUTABLE_FIELDS) {
    const parameters = apis.map((api) => ({ ...api.SURFACE_THERMAL }));
    const weather = { ambient: 18, cloud: 0.3, rain: 24, windX: 3, windZ: -2 };
    const steps = apis.map((api, i) =>
      new api.SurfaceThermalStep(parameters[i], 2).prepare(0.5, weather),
    );
    const advance = (rainfall, cell, phase) => {
      for (const step of steps) step.advanceWet(42, 26, 0.4, rainfall, 0.02, 125, cell);
      compare(steps, 'mutable/' + key + '/' + phase);
      columns++;
    };
    advance(0.001, 0, 'populate-first-slot');
    advance(0.002, 1, 'populate-second-slot');
    const held = steps.map(columnSnapshot);
    for (const p of parameters) p[key] *= 1.5;

    advance(0.002, 1, 'same-rain-after-edit');
    for (let i = 0; i < steps.length; i++) {
      for (const field of COLUMN_FIELDS) {
        equalNumber(steps[i][field], held[i][field], key + ': same-rain keeps ' + field);
      }
    }
    advance(0.001, 0, 'changed-rain-first-slot');
    for (const step of steps) {
      assert.ok(Number.isNaN(step.cellRainfall[1]), key + ': invalidate other cached slot');
    }
    advance(0.002, 1, 'changed-rain-second-slot');
    for (let i = 0; i < steps.length; i++) {
      assert.notEqual(steps[i].surface, held[i].surface, key + ': changed-rain observes edit');
    }
  }
  assert.equal(columns, 20);
  return {
    matrixParameters: MUTABLE_FIELDS,
    columns,
    scalarComparisons: columns * COLUMN_FIELDS.length,
    editsAfterPreparation: MUTABLE_FIELDS.length,
  };
}

function equalTrack(actual, expected, label) {
  let bytesCompared = 0;
  for (const key of SURFACE_ARRAYS) {
    const a = actual[key];
    const b = expected[key];
    assert.ok(a instanceof Float32Array && b instanceof Float32Array, label + '.' + key);
    assert.equal(a.length, trackCells, label + '.' + key + ': candidate length');
    assert.equal(b.length, trackCells, label + '.' + key + ': baseline length');
    for (let i = 0; i < a.length; i++) {
      assert.ok(Number.isFinite(a[i]) && Number.isFinite(b[i]), label + '.' + key + ': non-finite');
    }
    const aBytes = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
    const bBytes = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
    assert.ok(aBytes.equals(bBytes), label + '.' + key + ': byte mismatch');
    bytesCompared += a.byteLength;
  }
  for (const key of WEATHER_CLOCK_FIELDS) equalNumber(actual[key], expected[key], label + '.' + key);
  return { bytesCompared, scalarComparisons: WEATHER_CLOCK_FIELDS.length };
}

// No prototype instrumentation is active during these output comparisons.
const directExactness = exerciseDefault([baseline, candidate], equalColumn);
const mutableExactness = exerciseMutable([baseline, candidate], equalColumn);
const trackExactness = [];
for (const preset of PRESETS) {
  const before = new baseline.Track(preset);
  const after = new candidate.Track(preset);
  equalTrack(after, before, preset + '/initial');
  let bytesCompared = 0;
  let scalarComparisons = 0;
  for (let tick = 1; tick <= TRACK_UPDATES; tick++) {
    before.evolve(0.5, tick * 0.5);
    after.evolve(0.5, tick * 0.5);
    const compared = equalTrack(after, before, preset + '/tick-' + tick);
    bytesCompared += compared.bytesCompared;
    scalarComparisons += compared.scalarComparisons;
  }
  trackExactness.push({
    preset,
    initialStateCompared: true,
    updates: TRACK_UPDATES,
    cellsPerUpdate: trackCells,
    arrayNames: SURFACE_ARRAYS,
    bytesCompared,
    weatherClockFields: WEATHER_CLOCK_FIELDS,
    scalarComparisons,
  });
}
const trackBytes = trackExactness.reduce((sum, row) => sum + row.bytesCompared, 0);
const trackScalars = trackExactness.reduce((sum, row) => sum + row.scalarComparisons, 0);
assert.equal(trackBytes, 1032192, 'four updates of three default Track presets');
assert.equal(trackScalars, 132, 'eleven weather/clock scalars after each update');

// Operation counts use fresh solvers/Tracks in a separate pass. The wrappers
// count calls to the real methods and restore every descriptor even on failure.
function countCalls(api, exercise) {
  const prototype = api.SurfaceThermalStep.prototype;
  const names = ['prepare', 'prepareMatrix', 'refreshMatrixInputs', 'advanceWet', 'advance'];
  const descriptors = names.map((name) => [name, Object.getOwnPropertyDescriptor(prototype, name)]);
  for (const [name, descriptor] of descriptors) {
    assert.equal(typeof descriptor?.value, 'function', 'missing thermal method: ' + name);
  }
  const counts = Object.fromEntries(names.map((name) => [name, 0]));
  try {
    for (const [name, descriptor] of descriptors) {
      Object.defineProperty(prototype, name, {
        ...descriptor,
        value: function (...args) {
          counts[name]++;
          return Reflect.apply(descriptor.value, this, args);
        },
      });
    }
    exercise();
  } finally {
    for (const [name, descriptor] of descriptors) Object.defineProperty(prototype, name, descriptor);
  }
  return counts;
}

const ignoreColumns = () => {};
const directCounts = {
  baseline: countCalls(baseline, () => exerciseDefault([baseline], ignoreColumns)),
  candidate: countCalls(candidate, () => exerciseDefault([candidate], ignoreColumns)),
};
assert.equal(directCounts.candidate.refreshMatrixInputs, PREPARATIONS);
assert.ok(directCounts.baseline.refreshMatrixInputs > directCounts.candidate.refreshMatrixInputs);
for (const counts of Object.values(directCounts)) {
  assert.equal(counts.prepare, PREPARATIONS);
  assert.equal(counts.advanceWet, 3072);
  assert.equal(counts.advance, PREPARATIONS);
  assert.equal(counts.prepareMatrix, 3096);
}
const mutableCounts = {
  baseline: countCalls(baseline, () => exerciseMutable([baseline], ignoreColumns)),
  candidate: countCalls(candidate, () => exerciseMutable([candidate], ignoreColumns)),
};
assert.deepEqual(mutableCounts.candidate, mutableCounts.baseline);
assert.equal(mutableCounts.candidate.refreshMatrixInputs, 24);
assert.equal(mutableCounts.candidate.prepare, 4);
assert.equal(mutableCounts.candidate.advanceWet, 20);
assert.equal(mutableCounts.candidate.prepareMatrix, 24);

const trackSignatureCounts = [];
for (const preset of PRESETS) {
  const countTrack = (api) => {
    const track = new api.Track(preset);
    return countCalls(api, () => {
      for (let tick = 1; tick <= TRACK_UPDATES; tick++) track.evolve(0.5, tick * 0.5);
    });
  };
  const before = countTrack(baseline);
  const after = countTrack(candidate);
  for (const counts of [before, after]) {
    assert.equal(counts.prepare, 8, preset + ': two exposure preparations per tick');
    assert.equal(counts.advanceWet, 14336, preset + ': every cell updated');
    assert.equal(counts.prepareMatrix, 14344, preset + ': matrix requests');
    assert.equal(counts.advance, 0, preset + ': Track uses coupled wet advancement');
  }
  assert.equal(before.refreshMatrixInputs, preset === 'clear' ? 10 : 14349, preset + ': baseline');
  assert.equal(after.refreshMatrixInputs, 8, preset + ': candidate');
  trackSignatureCounts.push({
    preset,
    updates: TRACK_UPDATES,
    baseline: before,
    candidate: after,
  });
}

console.log(JSON.stringify({
  probe: 'surface-thermal',
  baseline: BASELINE,
  provenance,
  status: 'passed',
  comparison: {
    directScalars: 'finite and Object.is exact',
    trackSurfaceArrays: 'finite Float32 values and all bytes equal',
    weatherAndClock: 'finite and Object.is exact',
    operationCounts: 'separate fresh-instance pass; real method wrappers restored in finally',
  },
  exactness: {
    defaultColumns: directExactness,
    mutableParameters: mutableExactness,
    track: {
      presets: trackExactness,
      postUpdateBytesCompared: trackBytes,
      postUpdateWeatherClockScalarComparisons: trackScalars,
    },
  },
  operations: {
    method: 'SurfaceThermalStep.prototype.refreshMatrixInputs',
    defaultColumns: directCounts,
    mutableParameters: mutableCounts,
    track: trackSignatureCounts,
  },
  limits: [
    'Only the thermal module is historical; all other dependencies are the candidate checkout.',
    'Track coverage is four half-second updates for each of clear, rain and storm.',
    'Variable timestep and mutable-parameter cases are direct-solver coverage.',
    'Counts are operation evidence; no elapsed-time, Simulation, browser, native or FPS claim.',
  ],
}));
