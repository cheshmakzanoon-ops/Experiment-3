import { createHash } from 'node:crypto';
import { assert, BASELINE, variants } from './support.mjs';

const { baseline, candidate, provenance } = await variants(
  [
    "export { Simulation } from './src/simulation/world.ts';",
    "export { DEFAULT_OPTIONS, controls } from './src/simulation/config.ts';",
    "export { HEADER, CAR_STRIDE, H } from './src/simulation/protocol.ts';",
    "export { TrackLaneIndex } from './src/simulation/track-lane-index.ts';",
    "export { SURFACE } from './src/simulation/track.ts';",
  ].join('\n'),
  ['src/simulation/track-lane-index.ts', 'src/simulation/surface-thermal.ts'],
);

const TICKS = 120;
const DT = 1 / 120;
const CARS = 3;
const CHECKPOINTS = new Set([0, 1, 29, 59, 60, 61, 89, 119, 120]);
const SURFACE_ARRAYS = [
  'water',
  'rubber',
  'marbles',
  'frozen',
  'temperature',
  'substrateTemperature',
  'drainage',
  'sheltered',
];
const CASES = [
  { name: 'clear-human-ai', weather: 'clear', compound: 'medium', seed: 73021 },
  { name: 'rain-human-ai', weather: 'rain', compound: 'intermediate', seed: 2505 },
  { name: 'storm-human-ai', weather: 'storm', compound: 'wet', seed: 9173 },
];
const hash = () => createHash('sha256');
const bytes = (view) => Buffer.from(view.buffer, view.byteOffset, view.byteLength);

// Tagged values preserve Float64 bits, including signed zero, in the transcript.
// This only encodes a digest: no simulation output is rewritten or omitted.
function addExact(digest, value) {
  if (typeof value === 'number') {
    const word = Buffer.allocUnsafe(8);
    word.writeDoubleLE(value);
    digest.update('number:').update(word);
  } else if (typeof value === 'string') {
    digest.update('string:' + Buffer.byteLength(value) + ':').update(value);
  } else if (typeof value === 'boolean') {
    digest.update(value ? 'true;' : 'false;');
  } else if (value === null) {
    digest.update('null;');
  } else if (Array.isArray(value)) {
    digest.update('array:' + value.length + ':');
    for (const child of value) addExact(digest, child);
  } else {
    assert.ok(value && typeof value === 'object', 'unsupported transcript value');
    const keys = Object.keys(value).sort();
    digest.update('object:' + keys.length + ':');
    for (const key of keys) {
      addExact(digest, key);
      addExact(digest, value[key]);
    }
  }
}

function pick(owner, fields) {
  return Object.fromEntries(
    fields.map((field) => {
      assert.ok(field in owner, 'missing production state field: ' + field);
      return [field, owner[field]];
    }),
  );
}

function equalViews(expected, actual, label) {
  assert.ok(ArrayBuffer.isView(expected) && ArrayBuffer.isView(actual), label + ': typed arrays');
  assert.equal(actual.constructor.name, expected.constructor.name, label + ': array type');
  assert.equal(actual.length, expected.length, label + ': array length');
  if (expected instanceof Float32Array || expected instanceof Float64Array) {
    assert.ok(expected.every(Number.isFinite) && actual.every(Number.isFinite), label + ': finite values');
  }
  const a = bytes(expected);
  const b = bytes(actual);
  if (a.equals(b)) return;
  let offset = 0;
  while (offset < a.length && a[offset] === b[offset]) offset++;
  const index = Math.floor(offset / expected.BYTES_PER_ELEMENT);
  assert.fail(
    label +
      ': first differing byte ' +
      offset +
      ', element ' +
      index +
      ', baseline value ' +
      expected[index] +
      ', candidate value ' +
      actual[index] +
      ', baseline byte 0x' +
      a[offset].toString(16) +
      ', candidate byte 0x' +
      b[offset].toString(16),
  );
}

function raceState(simulation) {
  const race = simulation.race;
  return {
    tick: simulation.tick,
    ...pick(race, [
      'time',
      'raceTime',
      'greenAt',
      'phase',
      'lights',
      'finishStartedAt',
      'finishGrace',
      'flag',
      'message',
      'hazard',
      'drsActive',
    ]),
    order: [...race.order],
    sectorStatus: Array.from(race.sectorStatus),
    stintStart: Array.from(race.stintStart),
    control: {
      sequence: race.control.sequence,
      flags: Array.from(race.control.flags),
      penalties: Array.from(race.control.penaltyCount),
    },
    safetyCar: pick(race.safetyCar, ['phase', 's', 'speed', 'suspended']),
    laps: race.laps.map((lap) => ({
      ...pick(lap, [
        'completed',
        'active',
        'valid',
        'nextGate',
        'lastS',
        'distance',
        'lapStart',
        'lapTime',
        'best',
        'last',
        'penalty',
        'warnings',
        'outsideTime',
        'outsideEpisode',
        'jumped',
        'sector',
        'sectorStart',
        'lastTime',
        'lastCrossingTime',
        'crossedFinish',
        'lastValid',
        'assisted',
        'lastAssisted',
        'lastPenalty',
      ]),
      sectors: [...lap.sectors],
      lastSectors: [...lap.lastSectors],
    })),
    entrants: simulation.cars.map((car) =>
      pick(car, ['id', 's', 'finishTime', 'retired', 'pitStops', 'pitPhase', 'inPit', 'pitClock']),
    ),
    recoveries: Array.from(simulation.recoveries),
  };
}

function surfaceState(track) {
  return pick(track, [
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
    'cold',
  ]);
}

function surfaceDigest(simulation) {
  const digest = hash();
  addExact(digest, { tick: simulation.tick, state: surfaceState(simulation.track) });
  for (const name of SURFACE_ARRAYS) {
    const view = simulation.track[name];
    addExact(digest, { name, type: view.constructor.name, length: view.length });
    digest.update(bytes(view));
  }
  return digest.digest('hex');
}

function inputAt(tick) {
  const pedals = [
    { throttle: 1, brake: 0, steer: 0 },
    { throttle: 0.75, brake: 0, steer: 0.045 },
    { throttle: 0, brake: 0.35, steer: -0.06 },
    { throttle: 0.9, brake: 0, steer: 0.025 },
    { throttle: 0.6, brake: 0.1, steer: -0.035 },
    { throttle: 1, brake: 0, steer: 0 },
  ];
  return {
    ...baseline.controls(),
    ...pedals[Math.floor(tick / 20)],
    manualClutch: tick >= 34 && tick < 37,
    clutch: tick >= 34 && tick < 37 ? 0.15 : 0,
    shift: tick === 70 ? 1 : tick === 105 ? -1 : 0,
    ers: Math.floor(tick / 20) % 3,
    drs: tick === 24 || tick === 100,
    overtake: tick === 12 || tick === 104,
  };
}

function options(api, scenario) {
  return {
    ...api.DEFAULT_OPTIONS,
    setup: { ...api.DEFAULT_OPTIONS.setup },
    circuit: 'aurel',
    mode: 'practice',
    opponents: CARS - 1,
    weather: scenario.weather,
    compound: scenario.compound,
    seed: scenario.seed,
  };
}

function roadWork(simulation, api) {
  return simulation.cars.some((car) =>
    car.tires.some((tire, wheel) => {
      const surface = car.contacts[wheel].surface;
      return (
        tire.load > 1 &&
        tire.energy > 0 &&
        (surface === api.SURFACE.ASPHALT ||
          surface === api.SURFACE.PAINT ||
          surface === api.SURFACE.KERB)
      );
    }),
  );
}

function residentCells(simulation, api) {
  // Read the existing cache only; never replace its policy or its candidates.
  const index = simulation.track.laneIndex;
  assert.ok(index instanceof api.TrackLaneIndex, 'real paved lane index must be installed');
  assert.ok(index.cells instanceof Map, 'lane index must expose its existing resident map');
  assert.ok(index.cells.size > 0 && index.cells.size <= 2048, 'bounded lane cache was exercised');
  return index.cells.size;
}

function runCase(scenario) {
  // Each case retains only one pair of live worlds. Reports contain no world references.
  const a = new baseline.Simulation(options(baseline, scenario));
  const b = new candidate.Simulation(options(candidate, scenario));
  assert.notEqual(a.track, b.track, scenario.name + ': distinct tracks');
  assert.equal(a.cars.length, CARS);
  assert.equal(b.cars.length, CARS);
  for (const name of SURFACE_ARRAYS) {
    assert.notEqual(a.track[name].buffer, b.track[name].buffer, name + ': distinct backing stores');
  }

  const frameHashes = [hash(), hash()];
  const raceHashes = [hash(), hash()];
  const surfaceHashes = [hash(), hash()];
  const inputs = hash();
  const initialTemperatures = [a, b].map((sim) =>
    hash().update(bytes(sim.track.temperature)).digest('hex'),
  );
  const initialPositions = [a, b].map((sim) =>
    sim.cars.map((car) => [car.body.position.x, car.body.position.y, car.body.position.z]),
  );
  const counts = {
    frameComparisons: 0,
    frameWordsCompared: 0,
    frameBytesCompared: 0,
    raceComparisons: 0,
    surfaceComparisons: 0,
    surfaceValuesCompared: 0,
    surfaceBytesCompared: 0,
    humanTicks: 0,
    playerAiTicks: 0,
  };
  const surfaceSteps = [0, 0];
  const roadWorkTicks = [0, 0];
  const maximumSpeed = [0, 0];
  const checkpoints = [];
  let lastRace;

  function compare(tick) {
    const label = scenario.name + ' tick ' + tick;
    const af = a.makeFrame();
    const bf = b.makeFrame();
    assert.equal(af.length, baseline.HEADER + CARS * baseline.CAR_STRIDE, label);
    assert.equal(bf.length, candidate.HEADER + CARS * candidate.CAR_STRIDE, label);
    assert.equal(af[baseline.H.TICK], tick, label + ': baseline published tick');
    assert.equal(bf[candidate.H.TICK], tick, label + ': candidate published tick');
    equalViews(af, bf, label + ' full frame');
    frameHashes[0].update(bytes(af));
    frameHashes[1].update(bytes(bf));
    counts.frameComparisons++;
    counts.frameWordsCompared += af.length;
    counts.frameBytesCompared += af.byteLength;

    const ar = raceState(a);
    const br = raceState(b);
    assert.deepEqual(br, ar, label + ' exact race/classification state');
    addExact(raceHashes[0], ar);
    addExact(raceHashes[1], br);
    counts.raceComparisons++;
    lastRace = ar;

    if (!CHECKPOINTS.has(tick)) return;
    assert.deepEqual(surfaceState(b.track), surfaceState(a.track), label + ' surface/weather state');
    for (const name of SURFACE_ARRAYS) {
      equalViews(a.track[name], b.track[name], label + ' surface.' + name);
      counts.surfaceValuesCompared += a.track[name].length;
      counts.surfaceBytesCompared += a.track[name].byteLength;
    }
    const digests = [surfaceDigest(a), surfaceDigest(b)];
    assert.equal(digests[1], digests[0], label + ': surface digest');
    surfaceHashes[0].update(digests[0]);
    surfaceHashes[1].update(digests[1]);
    checkpoints.push({ tick, baselineSha256: digests[0], candidateSha256: digests[1] });
    counts.surfaceComparisons++;
  }

  compare(0);
  for (let tick = 0; tick < TICKS; tick++) {
    const input = inputAt(tick);
    const autoPlayer = tick >= 80 && tick < 96;
    addExact(inputs, { tick, autoPlayer, input });
    if (autoPlayer) counts.playerAiTicks++;
    else counts.humanTicks++;
    for (const [index, sim] of [a, b].entries()) {
      sim.autoPlayer = autoPlayer;
      sim.setInput(input);
      const previousSurfaceClock = sim.track.surfaceClock;
      sim.step(DT);
      if (sim.track.surfaceClock < previousSurfaceClock) surfaceSteps[index]++;
      if (roadWork(sim, index === 0 ? baseline : candidate)) roadWorkTicks[index]++;
      for (const car of sim.cars) maximumSpeed[index] = Math.max(maximumSpeed[index], car.speed);
    }
    compare(tick + 1);
  }

  for (const [index, sim] of [a, b].entries()) {
    assert.equal(sim.tick, TICKS, scenario.name + ': completed ticks');
    assert.equal(surfaceSteps[index], 2, scenario.name + ': two real thermal surface updates');
    assert.ok(roadWorkTicks[index] > 0, scenario.name + ': loaded paved contacts did slip work');
    assert.ok(sim.race.raceTime > 0, scenario.name + ': practice race clock advanced');
    assert.ok(sim.race.laps.slice(1).every((lap) => lap.assisted), 'real opponent AI updated');
    assert.notEqual(
      hash().update(bytes(sim.track.temperature)).digest('hex'),
      initialTemperatures[index],
      scenario.name + ': pavement temperatures evolved',
    );
    assert.ok(
      sim.cars.some((car, carIndex) => {
        const start = initialPositions[index][carIndex];
        return Math.hypot(
          car.body.position.x - start[0],
          car.body.position.y - start[1],
          car.body.position.z - start[2],
        ) > 0.01;
      }),
      scenario.name + ': real vehicle positions advanced',
    );
  }
  assert.deepEqual(surfaceSteps, [2, 2]);
  assert.equal(roadWorkTicks[1], roadWorkTicks[0]);
  assert.equal(maximumSpeed[1], maximumSpeed[0]);
  assert.equal(counts.frameComparisons, TICKS + 1);
  assert.equal(counts.raceComparisons, TICKS + 1);
  assert.equal(counts.surfaceComparisons, CHECKPOINTS.size);

  const pairDigest = (digests) => {
    const result = { baseline: digests[0].digest('hex'), candidate: digests[1].digest('hex') };
    assert.equal(result.candidate, result.baseline, scenario.name + ': transcript digest');
    return result;
  };
  return {
    ...scenario,
    circuit: 'aurel',
    mode: 'practice',
    cars: CARS,
    ticks: TICKS,
    dt: DT,
    inputSha256: inputs.digest('hex'),
    counts,
    frameSha256: pairDigest(frameHashes),
    raceSha256: pairDigest(raceHashes),
    orderedSurfaceCheckpointDigestsSha256: pairDigest(surfaceHashes),
    surfaceArrays: SURFACE_ARRAYS,
    surfaceCheckpoints: checkpoints,
    exercised: {
      surfaceSteps,
      loadedPavedSlipWorkTicks: roadWorkTicks,
      maximumSpeed,
      laneResidentCells: [residentCells(a, baseline), residentCells(b, candidate)],
      opponentAiUpdatesPerVariant: TICKS * (CARS - 1),
    },
    finalRace: {
      time: lastRace.time,
      raceTime: lastRace.raceTime,
      greenAt: lastRace.greenAt,
      phase: lastRace.phase,
      flag: lastRace.flag,
      order: lastRace.order,
      completedLaps: lastRace.laps.map((lap) => lap.completed),
    },
  };
}

const results = CASES.map(runCase);
console.log(
  JSON.stringify(
    {
      probe: 'whole-simulation-composition',
      status: 'pass',
      baselineRef: BASELINE,
      scope: 'Two historical modules composed inside the current real Simulation dependency graph.',
      provenance,
      workload: {
        cases: CASES.length,
        carsPerVariant: CARS,
        ticksPerVariantPerCase: TICKS,
        simulatedSecondsPerVariantPerCase: TICKS * DT,
        frameComparisons: results.reduce((sum, result) => sum + result.counts.frameComparisons, 0),
        frameWordsCompared: results.reduce((sum, result) => sum + result.counts.frameWordsCompared, 0),
        surfaceComparisons: results.reduce((sum, result) => sum + result.counts.surfaceComparisons, 0),
        raceComparisons: results.reduce((sum, result) => sum + result.counts.raceComparisons, 0),
      },
      comparison: {
        frames: 'Every Float32 frame byte, including header, all car blocks and diagnostic defaults.',
        surfaces: 'Every byte of all eight public surface arrays at each selected checkpoint.',
        race: 'Exact unrounded race clocks, lap timing/progress, order and classification state.',
        diagnosticArguments: { stepMs: 0, dropped: 0 },
        outputNormalization: 'none',
      },
      cases: results,
    },
    null,
    2,
  ),
);
