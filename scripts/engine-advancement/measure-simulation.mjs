/** Actual original/current Simulation execution; timing requires a reservation. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
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
    mode: { type: 'string', default: 'smoke' },
    exclusive: { type: 'boolean', default: false },
    lock: { type: 'string' },
    cases: { type: 'string' },
    steps: { type: 'string' },
    samples: { type: 'string' },
    warmups: { type: 'string' },
  },
});
for (const key of ['baseline', 'current', 'output'])
  assert(values[key] && isAbsolute(values[key]), `Required: --${key} /absolute/path`);
assert(!existsSync(values.output), 'Refusing to overwrite output evidence');
assert(['smoke', 'measure'].includes(values.mode), 'Use --mode smoke or --mode measure');
const measured = values.mode === 'measure';
if (measured) {
  assert(values.exclusive, 'Coordinate exclusive compute before using --exclusive');
  assert(values.lock && isAbsolute(values.lock), 'Measurement requires an explicit shared lock');
} else assert(!values.exclusive, 'Untimed smoke must not claim exclusive timing');
const count = (key, fallback, minimum = 1) => {
  const n = values[key] === undefined ? fallback : Number(values[key]);
  assert(Number.isSafeInteger(n) && n >= minimum, `Invalid --${key}`);
  return n;
};
const STEPS = count('steps', measured ? 480 : 120);
assert(STEPS % 2 === 0 && STEPS <= 12000, 'Use an even step count, at most 12000');
const SAMPLE_PAIRS = count('samples', measured ? 9 : 1);
const WARMUP_PAIRS = count('warmups', measured ? 3 : 0, 0);
const DT = 1 / 120;
const AUDIT_STEPS = 240;
const PRIME_STEPS = 240;
const workloadFile = fileURLToPath(import.meta.url);
const sides = ['baseline', 'current'];
const supplementalImports = ['src/simulation/config.ts', 'src/simulation/protocol.ts'];
const cases = [
  { id: 'aurel-clear-four', circuit: 'aurel', weather: 'clear', cars: 4 },
  { id: 'aurel-rain-four', circuit: 'aurel', weather: 'rain', cars: 4 },
  { id: 'aurel-storm-four', circuit: 'aurel', weather: 'storm', cars: 4 },
  { id: 'vellamar-first-steps-four', circuit: 'vellamar', weather: 'clear', cars: 4, first: true },
  { id: 'gp-clear-control', circuit: 'poggio-alto', weather: 'clear', cars: 2, vehicle: 'gpr1' },
  {
    id: 'mx-clear-control',
    circuit: 'valley-ridge-mx',
    weather: 'clear',
    cars: 2,
    vehicle: 'mx450',
  },
];
const selected = values.cases?.split(',') ?? cases.map((item) => item.id);
assert(selected.length && selected.length === new Set(selected).size, 'Invalid case selection');
for (const id of selected)
  assert(
    cases.some((item) => item.id === id),
    `Unknown case: ${id}`,
  );

// These are the explicitly omitted Track implementation/immutable geometry
// fields, not arbitrary numeric differences found by the comparison. The full
// actual geometry source graph is hashed. Other own Track fields are included.
const TRACK_OMISSIONS = new Set([
  'circuit',
  'points',
  'hash',
  'stationIntervals',
  'gpEdges',
  'laneIndex',
  'pit',
  'contactMesh',
]);

/** Preserve observable own state, classes, aliasing, and collection order.
 * Numbers are compared using Object.is in addition to their Float64 bytes.
 * Private #fields and closure captures are inaccessible and are not claimed.
 */
function captureState(simulation) {
  const seen = new Map();
  const shape = [],
    numbers = [],
    numberPaths = [],
    arrays = [];
  let functions = 0;
  const visit = (value, path) => {
    if (typeof value === 'number') {
      shape.push(['number', numbers.length]);
      numbers.push(value);
      numberPaths.push(path);
      return;
    }
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      assert(
        ['string', 'boolean', 'undefined', 'object'].includes(typeof value),
        `Unexpected leaf at ${path}`,
      );
      shape.push([typeof value, value ?? null]);
      return;
    }
    if (seen.has(value)) {
      shape.push(['reference', seen.get(value)]);
      return;
    }
    const id = seen.size;
    seen.set(value, id);
    if (typeof value === 'function') {
      functions++;
      shape.push([
        'function',
        id,
        value.name,
        value.length,
        sha256(Function.prototype.toString.call(value)),
      ]);
      return;
    }
    if (ArrayBuffer.isView(value)) {
      shape.push([
        'view',
        id,
        value.constructor.name,
        value.byteLength,
        'length' in value ? value.length : null,
      ]);
      arrays.push({
        path,
        type: value.constructor.name,
        bytes: Buffer.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
      });
      return;
    }
    if (value instanceof ArrayBuffer) {
      shape.push(['buffer', id, value.byteLength]);
      arrays.push({ path, type: 'ArrayBuffer', bytes: Buffer.from(new Uint8Array(value)) });
      return;
    }
    if (value instanceof Set) {
      shape.push(['set', id, value.size]);
      let index = 0;
      for (const item of value) visit(item, `${path}.set[${index++}]`);
      return;
    }
    if (value instanceof Map) {
      shape.push(['map', id, value.size]);
      let index = 0;
      for (const [key, item] of value) {
        visit(key, `${path}.map[${index}].key`);
        visit(item, `${path}.map[${index++}].value`);
      }
      return;
    }
    assert.equal(
      Object.getOwnPropertySymbols(value).length,
      0,
      `Unobserved symbol state at ${path}`,
    );
    const keys = Object.keys(value).filter(
      (key) => value !== simulation.track || !TRACK_OMISSIONS.has(key),
    );
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys)
      assert('value' in descriptors[key], `Unexpected own getter at ${path}.${key}`);
    shape.push([
      Array.isArray(value) ? 'array' : 'object',
      id,
      value.constructor?.name ?? null,
      Array.isArray(value) ? value.length : null,
      keys,
    ]);
    for (const key of keys) visit(value[key], `${path}.${key}`);
  };
  visit(simulation, 'simulation');
  const shapeText = JSON.stringify(shape);
  const scalarBytes = Buffer.from(Float64Array.from(numbers).buffer);
  const bytes = Buffer.concat([
    Buffer.from(shapeText),
    scalarBytes,
    ...arrays.map((item) => item.bytes),
  ]);
  return {
    shapeText,
    numbers,
    numberPaths,
    arrays,
    bytes,
    checksum: sha256(bytes),
    counts: {
      objects: seen.size,
      numbers: numbers.length,
      functions,
      typedArrays: arrays.length,
      typedArrayBytes: arrays.reduce((sum, item) => sum + item.bytes.length, 0),
      float64ArrayValues: arrays
        .filter((item) => item.type === 'Float64Array')
        .reduce((sum, item) => sum + item.bytes.length / 8, 0),
      nonfiniteNumericSentinels: numbers.filter((value) => !Number.isFinite(value)).length,
      bytes: bytes.length,
    },
  };
}

function compareState(a, b) {
  const shapeEqual = a.shapeText === b.shapeText;
  let unequalNumbers = Math.abs(a.numbers.length - b.numbers.length),
    unequalArrayBytes = 0,
    firstMismatch = shapeEqual ? null : { kind: 'shape' };
  for (let i = 0; i < Math.min(a.numbers.length, b.numbers.length); i++)
    if (!Object.is(a.numbers[i], b.numbers[i])) {
      unequalNumbers++;
      firstMismatch ??= {
        kind: 'number',
        path: a.numberPaths[i],
        baseline: String(a.numbers[i]),
        current: String(b.numbers[i]),
      };
    }
  let comparedArrayBytes = 0;
  for (let i = 0; i < Math.min(a.arrays.length, b.arrays.length); i++) {
    const left = a.arrays[i],
      right = b.arrays[i];
    if (left.path !== right.path || left.type !== right.type)
      firstMismatch ??= { kind: 'array shape', path: left.path };
    unequalArrayBytes += Math.abs(left.bytes.length - right.bytes.length);
    const length = Math.min(left.bytes.length, right.bytes.length);
    comparedArrayBytes += length;
    for (let j = 0; j < length; j++)
      if (left.bytes[j] !== right.bytes[j]) {
        unequalArrayBytes++;
        firstMismatch ??= {
          kind: 'array byte',
          path: left.path,
          byte: j,
          baseline: left.bytes[j],
          current: right.bytes[j],
        };
      }
  }
  return {
    equal:
      shapeEqual &&
      unequalNumbers === 0 &&
      unequalArrayBytes === 0 &&
      a.arrays.length === b.arrays.length &&
      a.bytes.equals(b.bytes),
    checksums: { baseline: a.checksum, current: b.checksum },
    shapeEqual,
    comparedNumbers: Math.min(a.numbers.length, b.numbers.length),
    comparedArrayBytes,
    unequalNumbers,
    unequalArrayBytes,
    firstMismatch,
    counts: { baseline: a.counts, current: b.counts },
  };
}

function finitePhysics(simulation, frame) {
  assert(frame.every(Number.isFinite), 'Non-finite packed physics frame');
  for (const car of simulation.cars) {
    for (const field of [
      'position',
      'velocity',
      'omega',
      'acceleration',
      'angularAcceleration',
      'orientation',
    ])
      for (const value of Object.values(car.body[field]))
        assert(Number.isFinite(value), `Non-finite body.${field}`);
    for (const field of ['speed', 's', 'lateral', 'rpm', 'fuel', 'battery'])
      assert(Number.isFinite(car[field]), `Non-finite car.${field}`);
  }
  for (const field of [
    'water',
    'rubber',
    'marbles',
    'frozen',
    'temperature',
    'substrateTemperature',
    'drainage',
  ])
    assert(simulation.track[field].every(Number.isFinite), `Non-finite Track.${field}`);
}

function commands(config, length, seed) {
  const random = seeded(seed);
  return Array.from({ length }, (_, tick) => ({
    ...config.controls(),
    throttle: 0.55 + random() * 0.3,
    brake: tick % 120 >= 100 ? 0.08 + random() * 0.1 : 0,
    steer: (random() - 0.5) * 0.025,
    riderLean: (random() - 0.5) * 0.08,
    shift: tick > 0 && tick % 120 === 0 ? 1 : 0,
    ers: tick % 180 < 60 ? 2 : 1,
    drs: tick % 120 === 30,
    overtake: tick % 240 === 60,
  }));
}

function applyCommand(simulation, command, tick, events) {
  simulation.setInput(command);
  // Real owner changes and a pit-request edge exercise application ordering.
  if (tick === 90) {
    simulation.autoPlayer = true;
    events.push([tick, 'autopilot', true]);
  }
  if (tick === 150) {
    simulation.autoPlayer = false;
    events.push([tick, 'autopilot', false]);
  }
  if (tick === 210) {
    simulation.requestPit('intermediate');
    events.push([tick, 'pit', 'intermediate']);
  }
  if (tick === 270) {
    simulation.requestPit('medium');
    events.push([tick, 'pit', 'medium']);
  }
}

function makeFixture(api, extras, specification, seed, steps) {
  const options = {
    ...extras.config.DEFAULT_OPTIONS,
    setup: { ...extras.config.DEFAULT_OPTIONS.setup },
    mode: 'practice',
    circuit: specification.circuit,
    weather: specification.weather,
    opponents: specification.cars - 1,
    seed,
    ...(specification.vehicle
      ? { vehicles: Array(specification.cars).fill(specification.vehicle) }
      : {}),
  };
  const simulation = new api.Simulation(options);
  const initial = simulation.cars.map((car) => [
    car.body.position.x,
    car.body.position.y,
    car.body.position.z,
  ]);
  if (!specification.first) {
    const prime = commands(extras.config, PRIME_STEPS, (seed ^ 0xa11ce) >>> 0);
    for (let tick = 0; tick < PRIME_STEPS; tick++) {
      simulation.setInput(prime[tick]);
      simulation.step(DT);
    }
  }
  const frameLength = extras.protocol.HEADER + simulation.cars.length * extras.protocol.CAR_STRIDE;
  const frames = new Float32Array((frameLength * steps) / 2);
  const views = Array.from({ length: steps / 2 }, (_, frame) =>
    frames.subarray(frame * frameLength, (frame + 1) * frameLength),
  );
  const inputs = commands(extras.config, steps, seed);
  return {
    simulation,
    frames,
    views,
    inputs,
    inputDigest: sha256(JSON.stringify(inputs)),
    start: simulation.cars.map((car) => [
      car.body.position.x,
      car.body.position.y,
      car.body.position.z,
    ]),
    initial,
    events: [],
    steps,
    specification,
    startTick: simulation.tick,
  };
}

function advanceRange(state, start, end) {
  for (let tick = start; tick < end; tick++) {
    applyCommand(state.simulation, state.inputs[tick], tick, state.events);
    state.simulation.step(DT);
    if (tick % 2 === 1) state.simulation.writeFrame(state.views[tick >> 1], 0, 0);
  }
}

function observeState(state) {
  const simulation = state.simulation;
  assert.equal(simulation.tick, state.startTick + state.steps);
  finitePhysics(simulation, state.frames);
  const raw = captureState(simulation);
  const frameBytes = Buffer.from(
    state.frames.buffer,
    state.frames.byteOffset,
    state.frames.byteLength,
  );
  const displacement = simulation.cars.map((car, i) =>
    Math.hypot(
      car.body.position.x - state.start[i][0],
      car.body.position.y - state.start[i][1],
      car.body.position.z - state.start[i][2],
    ),
  );
  assert(Math.max(...displacement) > 0.05, 'The combined fixture must move its vehicles');
  const summary = {
    tick: simulation.tick,
    time: simulation.race.time,
    order: [...simulation.race.order],
    playerOwner: simulation.autoPlayer ? 'autopilot' : 'input',
    events: state.events,
    raceEvents: simulation.race.control.events,
    terrainEvents: simulation.offroad?.log ?? [],
    terrainSequence: simulation.offroad?.terrain.sequence ?? null,
    displacementsMetres: displacement,
    speedsMetresPerSecond: simulation.cars.map((car) => car.speed),
    frameCount: state.views.length,
    frameFloats: state.frames.length,
    inputDigest: state.inputDigest,
  };
  return {
    raw,
    frameBytes,
    frameDigest: sha256(frameBytes),
    summary,
    checksum: sha256(Buffer.concat([raw.bytes, frameBytes, Buffer.from(JSON.stringify(summary))])),
  };
}

function compareObservations(a, b) {
  const state = compareState(a.raw, b.raw);
  let unequalFrameBytes = Math.abs(a.frameBytes.length - b.frameBytes.length),
    firstFrameMismatch = null;
  for (let i = 0; i < Math.min(a.frameBytes.length, b.frameBytes.length); i++)
    if (a.frameBytes[i] !== b.frameBytes[i]) {
      unequalFrameBytes++;
      firstFrameMismatch ??= i;
    }
  const summariesEqual = JSON.stringify(a.summary) === JSON.stringify(b.summary);
  return {
    equal: state.equal && unequalFrameBytes === 0 && summariesEqual,
    checksums: { baseline: a.checksum, current: b.checksum },
    state,
    frame: {
      comparedBytes: Math.min(a.frameBytes.length, b.frameBytes.length),
      unequalBytes: unequalFrameBytes,
      firstMismatchByte: firstFrameMismatch,
      checksums: { baseline: a.frameDigest, current: b.frameDigest },
    },
    summariesEqual,
    summary: a.summary,
  };
}

async function execute(lock = null) {
  const sources = {},
    extras = {},
    apis = {};
  for (const side of sides) {
    sources[side] = await prepareModule({
      root: values[side],
      entry: 'src/simulation/world.ts',
      expectedCommit: side === 'baseline' ? ORIGINAL_BASELINE : undefined,
    });
    apis[side] = await sources[side].load();
    extras[side] = {};
    for (const entry of supplementalImports) {
      assert(
        sources[side].identity.files[entry],
        `Supplemental import is absent from recorded graph: ${entry}`,
      );
      extras[side][entry.includes('config') ? 'config' : 'protocol'] = await import(
        pathToFileURL(join(values[side], entry)).href
      );
    }
  }
  for (const entry of [
    'src/simulation/world.ts',
    'src/simulation/config.ts',
    'src/simulation/protocol.ts',
    'src/simulation/vehicle.ts',
    'src/simulation/race.ts',
  ])
    assert.equal(
      sources.baseline.identity.files[entry].sha256,
      sources.current.identity.files[entry].sha256,
      `The integrated fixture expects unchanged dynamics/order implementation: ${entry}`,
    );

  const audits = [],
    reports = [];
  for (const specification of cases.filter((item) => selected.includes(item.id))) {
    const seed = (0x7f051a ^ Math.imul(cases.indexOf(specification) + 1, 0x9e3779b9)) >>> 0;
    const state = Object.fromEntries(
      sides.map((side) => [
        side,
        makeFixture(apis[side], extras[side], specification, seed, AUDIT_STEPS),
      ]),
    );
    const boundaries = [];
    let prior = 0;
    for (const tick of [0, 60, 120, AUDIT_STEPS]) {
      for (const side of sides) advanceRange(state[side], prior, tick);
      // Exercise nonempty event ordering through the unchanged public engine
      // APIs only in the audit. Timed normal-driving fixtures omit these
      // controlled reports, so artificial yellow flags do not bias their CPU.
      for (const side of sides) {
        const simulation = state[side].simulation;
        const car = simulation.cars.length - 1;
        if (tick === 60) {
          simulation.race.control.report(
            car,
            simulation.cars[car].s,
            'BENCHMARK_INCIDENT',
            simulation.race.raceTime,
          );
          state[side].events.push([tick, 'audit-incident', car]);
        }
        if (tick === 120) {
          simulation.race.penalize(car, 1, 'BENCHMARK_PENALTY');
          state[side].events.push([tick, 'audit-penalty', car]);
        }
      }
      const comparison = compareState(
        captureState(state.baseline.simulation),
        captureState(state.current.simulation),
      );
      boundaries.push({ completedSteps: tick, comparison });
      assert(
        comparison.equal,
        `Raw Simulation state mismatch in ${specification.id} at ${tick}: ${JSON.stringify(comparison.firstMismatch)}`,
      );
      prior = tick;
    }
    const complete = compareObservations(observeState(state.baseline), observeState(state.current));
    assert(complete.equal, `Combined audit mismatch in ${specification.id}`);
    for (const code of ['BENCHMARK_INCIDENT', 'BENCHMARK_PENALTY'])
      assert(
        complete.summary.raceEvents.some((event) => event.code === code),
        `Missing actual audit event: ${code}`,
      );
    audits.push({ case: specification.id, seed, steps: AUDIT_STEPS, boundaries, complete });

    const report = await runPaired({
      name: `simulation/${specification.id}`,
      sources,
      workloadFile,
      seed,
      purpose: measured ? 'measurement' : 'smoke',
      exclusiveCompute: measured,
      lock,
      warmupPairs: WARMUP_PAIRS,
      samplePairs: SAMPLE_PAIRS,
      iterations: STEPS,
      unitsPerIteration: 1,
      unit: '1/120 s physics step with one packed frame per two steps',
      scope: {
        timedWork:
          'For each step: apply the precomputed control, execute declared owner/pit edges, call actual Simulation.step(1/120), and write the actual complete Float32 frame every second step with metric arguments (0,0).',
        setupWork: `Construct the actual ${specification.cars}-vehicle practice Simulation, ${specification.first ? 'do not prime any physics step' : `prime ${PRIME_STEPS} actual physics steps`}, allocate input objects and every frame view, then retain exact output observations after execution.`,
        allocationScope:
          'Fixture construction, input/frame allocation, reflection, copies, hashing and comparison are outside run. All allocations from actual step/writeFrame and the small identical declared event log remain inside. No forced GC or heap saving claim.',
        limitations: `Local combined Simulation CPU; ${STEPS / 120} measured simulated seconds. ${specification.first ? 'First steps include lazy contact geometry and cold lane/surface work, not cold process startup.' : 'Priming advances the actual world; moving vehicles still enter new cells.'} This is not game FPS, a browser/worker/GPU result, a whole lap or a long-session proof.`,
      },
      prepare({ api, side, seed: pairSeed }) {
        return makeFixture(api, extras[side], specification, pairSeed, STEPS);
      },
      run(state, { iterations }) {
        advanceRange(state, 0, iterations);
        return state;
      },
      observe: observeState,
      compare: compareObservations,
    });
    console.log(
      JSON.stringify({
        case: specification.id,
        equivalent: report.equivalence.passed,
        purpose: report.purpose,
        medianMs: report.timing.medianMs,
      }),
    );
    reports.push(report);
  }
  for (const side of sides) sources[side].assertStable();
  const sharedSources = reports[0].sources,
    runtime = reports[0].runtime;
  for (const report of reports) {
    delete report.sources;
    delete report.runtime;
    report.sourcesRef = 'sources';
    report.runtimeRef = 'runtime';
  }
  const report = {
    schema: 'engine-advancement-simulation/1',
    createdAt: new Date().toISOString(),
    purpose: measured ? 'measurement' : 'smoke',
    sources: sharedSources,
    runtime,
    supplementalImports,
    configuration: {
      dt: DT,
      measuredSteps: STEPS,
      packedFrameEverySteps: 2,
      primeStepsExceptFirstCase: PRIME_STEPS,
      auditSteps: AUDIT_STEPS,
      auditEvents:
        'Only the untimed audit reports one incident after60 steps and one one-second penalty after120 steps through actual public APIs, then continues real stepping. Normal timed cases do not inject these reports.',
      warmupPairs: WARMUP_PAIRS,
      samplePairs: SAMPLE_PAIRS,
    },
    stateOracle: {
      method:
        'Actual own-object graph: Object.is numeric leaves, exact typed-array bytes, class names, object/array keys, references, Map/Set insertion order, function-source identities, race/terrain events and packed frames.',
      trackOmissions: [...TRACK_OMISSIONS],
      inaccessible:
        'ECMAScript #fields and closure-captured storage are not reflected. The Track heat accumulator and thermal cache are not directly inspected. Actual continuation and surface arrays are compared; W07B separately observes raw thermal call inputs/outputs.',
      metricPolicy:
        'No frame masking: both actual writeFrame calls receive stepMs=0 and dropped=0.',
      nonfinitePolicy:
        'Packed frames, physical body state and public surface grids must be finite. Identical internal sentinels such as uninitialised aero NaN and AI time -Infinity are retained and counted, not removed.',
      immutableGeometry:
        'Track geometry/index acceleration data are omitted explicitly; source identities and prior actual Track equivalence probes cover their inputs. Other own graph state remains present.',
    },
    audit: {
      passed: audits.every(
        (item) => item.complete.equal && item.boundaries.every((row) => row.comparison.equal),
      ),
      cases: audits,
    },
    cases: reports,
  };
  writeReport(values.output, report);
  assert(
    report.audit.passed && reports.every((item) => item.equivalence.passed),
    'Do not interpret unequal combined workloads',
  );
  console.log(
    JSON.stringify({
      output: values.output,
      cases: reports.length,
      auditBoundaries: audits.reduce((sum, item) => sum + item.boundaries.length, 0),
      purpose: report.purpose,
      allEquivalent: true,
    }),
  );
}

if (measured) await withTimingLock(values.lock, execute);
else await execute();
