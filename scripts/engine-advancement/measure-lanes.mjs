/** Actual original/current Track workloads. Timing requires an explicit reservation. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
    cases: { type: 'string' },
    measure: { type: 'boolean', default: false },
    exclusive: { type: 'boolean', default: false },
    lock: { type: 'string' },
  },
});
for (const key of ['baseline', 'current', 'output'])
  assert(values[key] && isAbsolute(values[key]), `Required: --${key} /absolute/path`);
if (values.measure) {
  assert(values.exclusive, 'Use --exclusive only after the coordinator grants exclusive compute');
  assert(values.lock && isAbsolute(values.lock), 'A measurement needs an explicit shared --lock');
} else assert(!values.exclusive, 'A smoke run must not claim an exclusive timing reservation');

const workloadFile = fileURLToPath(import.meta.url);
const POINT_FIELDS = [
  's',
  'x',
  'y',
  'z',
  'tx',
  'tz',
  'nx',
  'nz',
  'curvature',
  'width',
  'bank',
  'gradient',
];
const OUTPUT_FIELDS = ['lateral', ...POINT_FIELDS];
const SURFACE_FIELDS = [
  'water',
  'rubber',
  'marbles',
  'frozen',
  'temperature',
  'substrateTemperature',
  'drainage',
  'sheltered',
];
const TRACK_SCALARS = [
  'length',
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
  'surfaceClock',
];
const PAVED = ['aurel', 'vellamar', 'speedbowl', 'figure-eight'];
const CONTROLS = ['poggio-alto', 'valley-ridge-mx', 'kestrel-rx', 'pinewood-stage'];
const specifications = [
  ...[...PAVED, ...CONTROLS].map((venue) => ({
    name: `warm:${venue}`,
    kind: 'warm',
    venue,
    queries: 256,
    iterations: 256,
  })),
  ...PAVED.map((venue) => ({
    name: `cold-stream:${venue}`,
    kind: 'cold-stream',
    venue,
    queries: 4096,
    iterations: 8,
  })),
  { name: 'outside-hash:aurel', kind: 'outside-hash', venue: 'aurel', queries: 128, iterations: 8 },
  {
    name: 'unproved-height:figure-eight',
    kind: 'unproved-height',
    venue: 'figure-eight',
    queries: 256,
    iterations: 128,
  },
  ...PAVED.map((venue) => ({
    name: `construction:${venue}`,
    kind: 'construction',
    venue,
    queries: 0,
    iterations: 8,
  })),
];
const selection = values.cases?.split(',');
if (selection) {
  assert(new Set(selection).size === selection.length, 'Do not repeat case names');
  for (const name of selection)
    assert(
      specifications.some((item) => item.name === name),
      `Unknown case: ${name}`,
    );
}
const selected = specifications.filter((item) => !selection || selection.includes(item.name));

function copyPoint(output, offset, point) {
  output[offset++] = point.s;
  output[offset++] = point.x;
  output[offset++] = point.y;
  output[offset++] = point.z;
  output[offset++] = point.tx;
  output[offset++] = point.tz;
  output[offset++] = point.nx;
  output[offset++] = point.nz;
  output[offset++] = point.curvature;
  output[offset++] = point.width;
  output[offset++] = point.bank;
  output[offset++] = point.gradient;
  return offset;
}
function bytes(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}
function definition(api, venue) {
  return venue === 'figure-eight' ? api.figureEight : api.circuitDefinition(venue);
}
function newTrack(api, venue) {
  return new api.Track('clear', false, undefined, definition(api, venue));
}
function queryData(track, spec, random) {
  const queries = new Float64Array(spec.queries * 3);
  if (spec.kind === 'outside-hash') {
    for (let i = 0; i < spec.queries; i++) {
      queries[i * 3] = 100000 + random() * 1000;
      queries[i * 3 + 1] = -100000 - random() * 1000;
      queries[i * 3 + 2] = i % 2 ? 0.5 : NaN;
      assert(
        !track.hash.has(
          `${Math.floor(queries[i * 3] / 32)},${Math.floor(queries[i * 3 + 1] / 32)}`,
        ),
      );
    }
    return queries;
  }
  if (spec.kind === 'cold-stream') {
    // All 4 m cells are inside the actual coarse hash. First select distinct
    // cells, then choose a point strictly inside each selected cell.
    const cells = [];
    for (const key of track.hash.keys()) {
      const [hx, hz] = key.split(',').map(Number);
      for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) cells.push([hx * 8 + x, hz * 8 + z]);
    }
    assert(cells.length >= spec.queries, 'Coarse hash does not cover the cold stream');
    for (let i = 0; i < spec.queries; i++) {
      const next = i + Math.floor(random() * (cells.length - i));
      [cells[i], cells[next]] = [cells[next], cells[i]];
      queries[i * 3] = cells[i][0] * 4 + 0.25 + random() * 3.5;
      queries[i * 3 + 1] = cells[i][1] * 4 + 0.25 + random() * 3.5;
      queries[i * 3 + 2] = NaN; // The public no-height path, not a nonfinite height.
    }
    assert.equal(
      new Set(
        Array.from(
          { length: spec.queries },
          (_, i) => `${Math.floor(queries[i * 3] / 4)},${Math.floor(queries[i * 3 + 1] / 4)}`,
        ),
      ).size,
      spec.queries,
    );
    return queries;
  }
  const stations = spec.queries / 4;
  assert(Number.isInteger(stations));
  const pointCount = track.points.length - 1;
  const offset = Math.floor(random() * pointCount);
  for (let i = 0; i < stations; i++) {
    const point = track.points[(offset + Math.floor((i * pointCount) / stations)) % pointCount];
    const lateralOffsets = [-point.width * 0.7, -1, 1, point.width * 0.7];
    for (let lane = 0; lane < 4; lane++) {
      const lateral = lateralOffsets[lane] + (random() - 0.5) * 0.1;
      const index = (i * 4 + lane) * 3;
      queries[index] = point.x + point.nx * lateral;
      queries[index + 1] = point.z + point.nz * lateral;
      queries[index + 2] =
        spec.kind === 'unproved-height'
          ? 10000
          : i % 16 === 0
            ? NaN
            : point.y + point.bank * lateral + 0.5;
    }
  }
  return queries;
}
function nearest(track, queries, index, point) {
  const height = queries[index + 2];
  return track.nearest(
    queries[index],
    queries[index + 1],
    point,
    Number.isNaN(height) ? undefined : height,
  );
}
function prime(track, queries, point) {
  for (let i = 0; i < queries.length; i += 3) nearest(track, queries, i, point);
}
function indexSummary(track) {
  const index = track.laneIndex;
  if (!index)
    return {
      enabled: false,
      capacity: null,
      residentCells: 0,
      residentSegmentSlots: 0,
      maximumCellSegments: 0,
    };
  let slots = 0,
    maximum = 0;
  for (const cell of index.cells.values()) {
    slots += cell.segments.length;
    maximum = Math.max(maximum, cell.segments.length);
  }
  return {
    enabled: true,
    capacity: Number.isFinite(index.capacity) ? index.capacity : 'unbounded-existing-policy',
    residentCells: index.cells.size,
    residentSegmentSlots: slots,
    maximumCellSegments: maximum,
  };
}
function constructionValues(tracks) {
  const count = tracks.reduce(
    (sum, track) =>
      sum +
      TRACK_SCALARS.length +
      track.points.length * POINT_FIELDS.length +
      SURFACE_FIELDS.reduce((total, field) => total + track[field].length, 0),
    0,
  );
  const output = new Float64Array(count);
  let offset = 0;
  for (const track of tracks) {
    for (const field of TRACK_SCALARS) output[offset++] = track[field];
    for (const point of track.points) offset = copyPoint(output, offset, point);
    for (const field of SURFACE_FIELDS) for (const value of track[field]) output[offset++] = value;
  }
  assert.equal(offset, output.length);
  return output;
}
function observeNumbers(output, input, cache) {
  let nonfinite = 0;
  for (const value of output) if (!Number.isFinite(value)) nonfinite++;
  return {
    output,
    input,
    nonfinite,
    checksum: sha256(bytes(output)),
    inputChecksum: sha256(bytes(input)),
    cache,
  };
}
function compareNumbers(baseline, current) {
  const inputEqual = bytes(baseline.input).equals(bytes(current.input));
  let differences = 0,
    firstDifference = null;
  if (baseline.output.length !== current.output.length)
    firstDifference = {
      field: 'outputLength',
      baseline: baseline.output.length,
      current: current.output.length,
    };
  const count = Math.min(baseline.output.length, current.output.length);
  for (let i = 0; i < count; i++) {
    if (!Object.is(baseline.output[i], current.output[i])) {
      differences++;
      firstDifference ??= { offset: i, baseline: baseline.output[i], current: current.output[i] };
    }
  }
  const equal =
    inputEqual &&
    !firstDifference &&
    !differences &&
    baseline.nonfinite === 0 &&
    current.nonfinite === 0;
  return {
    equal,
    checksums: { baseline: baseline.checksum, current: current.checksum },
    inputChecksums: { baseline: baseline.inputChecksum, current: current.inputChecksum },
    identicalInputBytes: inputEqual,
    comparedInputBytes: baseline.input.byteLength,
    comparedOutputBytes: baseline.output.byteLength,
    objectIsComparisons: count,
    differences,
    firstDifference,
    nonfiniteOutputs: { baseline: baseline.nonfinite, current: current.nonfinite },
    finalCache: { baseline: baseline.cache, current: current.cache },
  };
}

function scopeOf(spec) {
  if (spec.kind === 'construction')
    return {
      timedWork:
        'Construct eight independent actual Tracks and retain them until observation (one in smoke mode). Modules/JIT are warmed by the paired warmup phase; this is not cold-process startup.',
      setupWork:
        'Resolve the actual unchanged circuit definition and allocate the reference array before timing. Observe all sampled ribbon numbers and public initial climate grids afterward.',
      allocationScope:
        'Every allocation and initialization performed by the actual Track constructor is timed. Geometry/observation serialization and release of fixture references are outside timing.',
      limitations:
        'Integrated Track creation includes the new surface coefficient/depression storage as well as the empty lane index. It cannot isolate lane-index constructor cost or establish process startup, peak heap, GPU time, or game FPS.',
    };
  const detail =
    spec.kind === 'warm'
      ? 'Prime the complete bounded 256-query road/shoulder working set, then repeatedly visit it.'
      : spec.kind === 'cold-stream'
        ? 'Begin with an empty newly selected paved index, then visit 4096 distinct in-hash 4 m cells in the same order on every pass. The 2048-cell cap makes later passes evicting misses too; heights are omitted.'
        : spec.kind === 'outside-hash'
          ? 'Visit 128 positions outside the existing coarse hash; the original all-segment fallback remains in use.'
          : 'Prime 256 in-hash locations at an unproved height of 10000 m; candidate selection must retain the original coarse bucket.';
  return {
    timedWork: `Actual Track.nearest calls plus copying lateral and every TrackPoint number into a preallocated Float64 output. ${detail}`,
    setupWork:
      'Construct the actual Track, generate seeded queries from its unchanged geometry, allocate input/output buffers, and perform declared priming before timing. Compare every output with Object.is afterward.',
    allocationScope:
      'No fixture allocation occurs in run(). Actual nearest/index allocations, including cold candidate arrays, Map insertion/eviction and normal VM collection, remain timed.',
    limitations:
      'CPU query workload with output-copy overhead, not an entire physics update, native browser, heap profile, GPU or FPS measurement. The cold stream deliberately exceeds the cache cap and is not representative of a bounded live-car working set.',
  };
}

/** Untimed observation of the real candidate method on a separate Track. */
function structuralProbe(api, spec, seed) {
  const track = newTrack(api, spec.venue);
  if (spec.kind === 'construction')
    return { kind: 'construction', points: track.points.length, index: indexSummary(track) };
  const queries = queryData(track, spec, seeded(seed));
  const point = api.trackPoint();
  if (spec.kind === 'warm' || spec.kind === 'unproved-height') prime(track, queries, point);
  const stats = {
    queries: 0,
    coarseCandidateChecks: 0,
    actualCandidateChecks: 0,
    indexCalls: 0,
    hits: 0,
    builds: 0,
    layerFallbacks: 0,
    outsideHashQueries: 0,
    peakCells: track.laneIndex?.cells.size ?? 0,
  };
  const index = track.laneIndex;
  let selectedLength = 0;
  const original = index?.candidates;
  if (index)
    index.candidates = function (x, z, coarse, height, gap) {
      const hit = this.cells.has(`${Math.floor(x / 4)},${Math.floor(z / 4)}`);
      const selected = original.call(this, x, z, coarse, height, gap);
      stats.indexCalls++;
      if (hit) stats.hits++;
      else stats.builds++;
      if (selected === coarse) stats.layerFallbacks++;
      selectedLength = selected.length;
      stats.peakCells = Math.max(stats.peakCells, this.cells.size);
      return selected;
    };
  try {
    const passes = spec.kind === 'cold-stream' ? 2 : 1;
    for (let pass = 0; pass < passes; pass++)
      for (let i = 0; i < queries.length; i += 3) {
        const coarse = track.hash.get(
          `${Math.floor(queries[i] / 32)},${Math.floor(queries[i + 1] / 32)}`,
        );
        selectedLength = coarse?.length ?? track.points.length - 1;
        if (!coarse) stats.outsideHashQueries++;
        stats.coarseCandidateChecks += selectedLength;
        nearest(track, queries, i, point);
        stats.actualCandidateChecks += selectedLength;
        stats.queries++;
      }
  } finally {
    if (index) delete index.candidates;
  }
  return { ...stats, index: indexSummary(track), querySha256: sha256(bytes(queries)) };
}

async function execute(lock) {
  const sources = {};
  for (const side of ['baseline', 'current']) {
    const source = await prepareModule({
      root: values[side],
      entry: 'src/simulation/track.ts',
      expectedCommit: side === 'baseline' ? ORIGINAL_BASELINE : undefined,
      extraFiles: ['src/simulation/test-venues.ts'],
    });
    const originalLoad = source.load.bind(source);
    source.load = async () => {
      const api = await originalLoad();
      const circuits = await import(
        pathToFileURL(resolve(source.identity.root, 'src/simulation/circuits.ts')).href
      );
      const venues = await import(
        pathToFileURL(resolve(source.identity.root, 'src/simulation/test-venues.ts')).href
      );
      assert.deepEqual(
        Object.keys(api.trackPoint()),
        POINT_FIELDS,
        'TrackPoint result schema changed',
      );
      return {
        ...api,
        circuitDefinition: circuits.circuitDefinition,
        figureEight: venues.FIGURE_EIGHT_OVERPASS,
      };
    };
    sources[side] = source;
  }
  for (const name of [
    'src/simulation/circuits.ts',
    'src/simulation/test-venues.ts',
    'src/simulation/track-lane-index.ts',
  ])
    assert.equal(
      sources.baseline.identity.files[name].sha256,
      sources.current.identity.files[name].sha256,
      `Reference input changed: ${name}`,
    );

  const report = {
    schema: 'engine-advancement-lanes/1',
    purpose: values.measure ? 'measurement' : 'smoke',
    sourceManifest: { baseline: sources.baseline.identity, current: sources.current.identity },
    sourceUse:
      'Native imports execute the actual Track modules from each root. circuitDefinition is already in that static graph; the actual test-venues module is an explicit hashed extra input and imports only the already recorded circuits module.',
    outputFields: OUTPUT_FIELDS,
    constructionFields: { scalars: TRACK_SCALARS, point: POINT_FIELDS, surface: SURFACE_FIELDS },
    memoryLimits:
      'Resident cell/segment counts are structural observations, not V8 heap bytes. New surface banks add 286720 fixed payload bytes per Track as established by W02E/W05A; full Track construction includes that separate change.',
    cases: [],
  };
  for (let caseIndex = 0; caseIndex < selected.length; caseIndex++) {
    const spec = selected[caseIndex];
    const iterations = values.measure ? spec.iterations : 1;
    const seed = (0x7a110000 + specifications.indexOf(spec)) >>> 0;
    const paired = await runPaired({
      name: spec.name,
      sources,
      workloadFile,
      seed,
      purpose: values.measure ? 'measurement' : 'smoke',
      exclusiveCompute: values.measure && values.exclusive,
      lock,
      warmupPairs: values.measure ? 3 : 0,
      samplePairs: values.measure ? 9 : 1,
      iterations,
      unitsPerIteration: spec.kind === 'construction' ? 1 : spec.queries,
      unit: spec.kind === 'construction' ? 'Track construction' : 'nearest query',
      scope: scopeOf(spec),
      prepare({ api, random }) {
        if (spec.kind === 'construction') return { api, tracks: new Array(iterations) };
        const track = newTrack(api, spec.venue);
        const queries = queryData(track, spec, random);
        const point = api.trackPoint();
        if (spec.kind === 'cold-stream' && track.laneIndex)
          assert.equal(track.laneIndex.cells.size, 0);
        if (spec.kind === 'warm' || spec.kind === 'unproved-height') prime(track, queries, point);
        return {
          track,
          queries,
          point,
          output: new Float64Array(iterations * spec.queries * OUTPUT_FIELDS.length),
        };
      },
      run(state) {
        if (spec.kind === 'construction') {
          for (let i = 0; i < iterations; i++) state.tracks[i] = newTrack(state.api, spec.venue);
          return state.tracks;
        }
        const { track, queries, point, output } = state;
        let offset = 0;
        for (let pass = 0; pass < iterations; pass++)
          for (let i = 0; i < queries.length; i += 3) {
            output[offset++] = nearest(track, queries, i, point);
            offset = copyPoint(output, offset, point);
          }
        return output;
      },
      observe(result, state) {
        if (spec.kind === 'construction')
          return observeNumbers(
            constructionValues(result),
            new Float64Array(),
            result.map(indexSummary),
          );
        return observeNumbers(result, state.queries, indexSummary(state.track));
      },
      compare: compareNumbers,
      dispose(state) {
        if (state.tracks) state.tracks.length = 0;
      },
    });
    // All cases use the same exact source/runtime manifests; retain them once.
    report.runtime ??= paired.runtime;
    report.concurrency ??= paired.concurrency;
    report.evidenceFiles ??= paired.evidenceFiles;
    assert.deepEqual(
      paired.evidenceFiles,
      report.evidenceFiles,
      'Benchmark code changed between cases',
    );
    delete paired.sources;
    delete paired.runtime;
    delete paired.concurrency;
    delete paired.evidenceFiles;
    paired.sourceManifestRef = 'sourceManifest';
    paired.structuralProbe = {};
    for (const side of ['baseline', 'current'])
      paired.structuralProbe[side] = structuralProbe(await sources[side].load(), spec, seed);
    assert.equal(
      paired.structuralProbe.baseline.querySha256,
      paired.structuralProbe.current.querySha256,
      'Structural probe inputs differ',
    );
    if (spec.kind === 'cold-stream') {
      const current = paired.structuralProbe.current;
      assert.equal(current.hits, 0, 'Cold stream unexpectedly reused a resident cell');
      assert.equal(current.builds, spec.queries * 2);
      assert.equal(current.peakCells, 2048);
      assert.equal(current.index.residentCells, 2048);
    }
    if (spec.kind === 'warm' && paired.structuralProbe.current.index.enabled) {
      assert.equal(paired.structuralProbe.current.hits, spec.queries);
      assert.equal(paired.structuralProbe.current.builds, 0);
    }
    if (spec.kind === 'unproved-height') {
      assert.equal(paired.structuralProbe.current.layerFallbacks, spec.queries);
      assert.equal(
        paired.structuralProbe.current.actualCandidateChecks,
        paired.structuralProbe.baseline.actualCandidateChecks,
      );
    }
    if (spec.kind === 'outside-hash') {
      for (const probe of Object.values(paired.structuralProbe)) {
        assert.equal(probe.outsideHashQueries, spec.queries);
        assert.equal(probe.indexCalls, 0);
        assert.equal(probe.index.residentCells, 0);
      }
    }
    if (CONTROLS.includes(spec.venue))
      assert.deepEqual(
        paired.structuralProbe.current,
        paired.structuralProbe.baseline,
        'Unchanged lane control structure differs',
      );
    report.cases.push(paired);
    process.stdout.write(
      JSON.stringify({
        case: spec.name,
        purpose: report.purpose,
        equivalent: paired.equivalence.passed,
        medianMs: paired.timing.medianMs,
      }) + '\n',
    );
  }
  for (const source of Object.values(sources)) source.assertStable();
  for (const [path, identity] of Object.entries(report.evidenceFiles)) {
    const content = readFileSync(path);
    assert.deepEqual(
      { bytes: content.length, sha256: sha256(content) },
      identity,
      `Benchmark code changed: ${path}`,
    );
  }
  report.stableSources = true;
  report.equivalencePassed = report.cases.every((item) => item.equivalence.passed);
  report.summary = report.cases.map((item) => ({
    case: item.name,
    comparedPairs: item.equivalence.checkedPairs,
    objectIsComparisons: [...item.warmups, ...item.samples].reduce(
      (sum, row) => sum + row.equivalence.objectIsComparisons,
      0,
    ),
    medianMsPerUnit: item.timing.medianMsPerUnit,
    baselineOverCurrent: item.timing.medianMs
      ? item.timing.medianMs.baseline / item.timing.medianMs.current
      : null,
  }));
  writeReport(values.output, report);
  assert(
    report.equivalencePassed,
    'Observed an original/current output difference; timing is not accepted',
  );
}

if (values.measure) await withTimingLock(values.lock, execute);
else await execute(null);
