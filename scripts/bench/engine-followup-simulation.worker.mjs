/** One committed source variant and one workload per fresh process.
 * Bundled only by engine-followup-simulation.mjs; no native TS transform.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { Quat, Vec3 } from 'simulation-followup:math';
import { Vehicle } from 'simulation-followup:vehicle';
import { RoadContactFrame } from 'simulation-followup:frame';
import { DynamicsTrack } from 'simulation-followup:fixtures';
import { CATALOGUE } from 'simulation-followup:catalogue';
import { DEFAULT_OPTIONS, DEFAULT_SETUP, controls } from 'simulation-followup:config';
import { Simulation } from 'simulation-followup:world';
import { H, HEADER, CAR_STRIDE, PROTOCOL_VERSION } from 'simulation-followup:protocol';

const request = JSON.parse(process.argv[2]);
const DT = 1 / 240;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytesOf = (view) => Buffer.from(view.buffer, view.byteOffset, view.byteLength);

/** Preserve Float64 bits, signed zero, nonfinite values, keys, and graph links.
 * JavaScript #private fields are inaccessible and are not claimed as captured.
 */
function canonical(value, external = new Map()) {
  const parts = [],
    seen = new Map();
  function visit(item) {
    if (typeof item === 'number') {
      const b = Buffer.allocUnsafe(9);
      b[0] = 110;
      b.writeDoubleLE(item, 1);
      parts.push(b);
    } else if (item === null) parts.push(Buffer.from('z'));
    else if (item === undefined) parts.push(Buffer.from('u'));
    else if (typeof item === 'boolean') parts.push(Buffer.from(item ? 't' : 'f'));
    else if (typeof item === 'string')
      parts.push(Buffer.from(`s${Buffer.byteLength(item)}:${item}`));
    else if (external.has(item)) visit(`external:${external.get(item)}`);
    else if (seen.has(item)) parts.push(Buffer.from(`r${seen.get(item)}:`));
    else {
      seen.set(item, seen.size);
      if (ArrayBuffer.isView(item)) {
        parts.push(Buffer.from(`v${item.constructor.name}:${item.byteLength}:`), bytesOf(item));
      } else if (item instanceof Set || item instanceof Map) {
        parts.push(Buffer.from(`${item instanceof Set ? 's' : 'm'}${item.size}:`));
        for (const entry of item) visit(entry);
      } else if (Array.isArray(item)) {
        parts.push(Buffer.from(`a${item.length}:`));
        for (const entry of item) visit(entry);
      } else {
        const keys = Object.keys(item)
          .filter((key) => typeof item[key] !== 'function')
          .sort();
        parts.push(Buffer.from(`o${keys.length}:`));
        for (const key of keys) {
          visit(key);
          visit(item[key]);
        }
      }
    }
  }
  visit(value);
  return Buffer.concat(parts);
}

function omit(object, keys) {
  const skip = new Set(keys);
  return Object.fromEntries(
    Object.entries(object).filter(([key, value]) => !skip.has(key) && typeof value !== 'function'),
  );
}
const CAR_STATIC = ['definition', 'spec', 'physics', 'setup', 'wheelPositions', 'bikeSpec', 'air'];
const carState = (car) => omit(car, CAR_STATIC);

function recordWriter(path) {
  const fd = openSync(path, 'w'),
    digest = createHash('sha256');
  let bytes = 0,
    records = 0;
  return {
    put(value) {
      const size = Buffer.allocUnsafe(4);
      size.writeUInt32LE(value.length);
      writeSync(fd, size);
      writeSync(fd, value);
      digest.update(size).update(value);
      bytes += size.length + value.length;
      records++;
    },
    finish() {
      closeSync(fd);
      return { path, bytes, records, sha256: digest.digest('hex') };
    },
  };
}

class ContactTrack extends DynamicsTrack {
  supported = true;
  castTire(...args) {
    return this.supported ? super.castTire(...args) : Infinity;
  }
}
function prepareCar(id) {
  const track = new ContactTrack();
  const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'raw', CATALOGUE[id]);
  car.place(track, 0);
  car.body.position.y -= 0.01;
  car.gear = 1;
  car.autoShift = false;
  car.input.manualClutch = true;
  car.input.clutch = 0;
  return { car, track };
}
function inputsForStep(car, track, step) {
  track.supported = !(step % 240 >= 80 && step % 240 < 88);
  car.input.throttle = step % 240 < 160 ? 0.35 : 0.08;
  car.input.brake = step % 240 < 160 ? 0 : 0.1;
  car.input.steer = Math.sin(step * 0.01) * 0.025;
}
function stepEpisode(car, track, steps) {
  for (let step = 0; step < steps; step++) {
    inputsForStep(car, track, step);
    car.step(DT, track);
  }
}
function time(run) {
  const cpu = process.cpuUsage(),
    begin = performance.now();
  const result = run();
  const elapsedMs = performance.now() - begin,
    used = process.cpuUsage(cpu);
  return { elapsedMs, cpuUserMs: used.user / 1000, cpuSystemMs: used.system / 1000, result };
}
function sums(samples) {
  const sorted = samples.map((s) => s.elapsedMs).sort((a, b) => a - b);
  return {
    elapsedMs: samples.reduce((sum, s) => sum + s.elapsedMs, 0),
    cpuUserMs: samples.reduce((sum, s) => sum + s.cpuUserMs, 0),
    cpuSystemMs: samples.reduce((sum, s) => sum + s.cpuSystemMs, 0),
    episodeMinimumMs: sorted[0],
    episodeMedianMs:
      (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) /
      2,
    episodeMaximumMs: sorted.at(-1),
  };
}

function vehicleTiming() {
  assert(['rl2', 'sk125'].includes(request.vehicle));
  const output = recordWriter(request.trace),
    phases = {};
  for (const [phase, count] of [
    ['warmup', request.warmupEpisodes],
    ['measured', request.measuredEpisodes],
  ]) {
    const samples = [];
    for (let episode = 0; episode < count; episode++) {
      global.gc();
      const { car, track } = prepareCar(request.vehicle);
      const measured = time(() => stepEpisode(car, track, request.episodeSteps));
      const state = canonical(carState(car));
      output.put(state);
      samples.push({
        episode,
        elapsedMs: measured.elapsedMs,
        cpuUserMs: measured.cpuUserMs,
        cpuSystemMs: measured.cpuSystemMs,
        stateSHA256: sha(state),
      });
      assert.equal(track.contactMesh, null, 'analytic fixture must not build a contact mesh');
    }
    phases[phase] = {
      episodes: count,
      substeps: count * request.episodeSteps,
      samples,
      totals: sums(samples),
    };
  }
  return {
    vehicle: request.vehicle,
    fixture:
      'W07B DynamicsTrack analytic runway and support-loss schedule; production Vehicle unchanged',
    authoredClutchCoupling: CATALOGUE[request.vehicle].spec.engine?.clutchCoupling ?? null,
    episodeSteps: request.episodeSteps,
    timestepSeconds: DT,
    phases,
    output: output.finish(),
  };
}

function captureFlatInputs() {
  const { car, track } = prepareCar('rl2'),
    values = [],
    selectedCalls = [],
    normalPatterns = new Map();
  const set = RoadContactFrame.prototype.set,
    couple = car.coupleClutch;
  let frameCalls = 0,
    couplingCalls = 0;
  RoadContactFrame.prototype.set = function (orientation, steering, normal, camber = 0) {
    assert.equal(normal.length(), 1, 'runway input normal must be unit length');
    assert.equal(normal.y, 1, 'runway input normal must point up');
    const normalBits = bytesOf(Float64Array.of(normal.x, normal.y, normal.z)).toString('hex');
    normalPatterns.set(normalBits, (normalPatterns.get(normalBits) ?? 0) + 1);
    if (frameCalls % 37 === 0 && selectedCalls.length < 128) {
      selectedCalls.push(frameCalls);
      values.push(
        orientation.x,
        orientation.y,
        orientation.z,
        orientation.w,
        steering,
        normal.x,
        normal.y,
        normal.z,
        camber,
      );
    }
    frameCalls++;
    return set.call(this, orientation, steering, normal, camber);
  };
  car.coupleClutch = function (share) {
    couplingCalls++;
    return couple.call(this, share);
  };
  try {
    stepEpisode(car, track, 1200);
  } finally {
    RoadContactFrame.prototype.set = set;
    car.coupleClutch = couple;
  }
  assert.equal(frameCalls, 4800);
  assert.equal(couplingCalls, 0);
  assert.equal(selectedCalls.length, 128);
  assert.equal(track.contactMesh, null);
  const bytes = bytesOf(Float64Array.from(values));
  writeFileSync(request.inputs, bytes);
  return {
    vehicle: 'rl2',
    substeps: 1200,
    frameCalls,
    couplingCalls,
    inputCount: 128,
    rowFloat64s: 9,
    inputSHA256: sha(bytes),
    selectedCalls,
    normalPatterns: Object.fromEntries(normalPatterns),
    instrumentationOutsideAllTimings: true,
  };
}

function frameInputs(kind) {
  if (kind === 'flat-actual-rl2') {
    const bytes = readFileSync(request.inputs);
    assert.equal(bytes.length, 128 * 9 * 8);
    const input = new Float64Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    return Array.from({ length: 128 }, (_, i) => {
      const p = i * 9;
      return {
        orientation: new Quat(input[p], input[p + 1], input[p + 2], input[p + 3]),
        steering: input[p + 4],
        normal: new Vec3(input[p + 5], input[p + 6], input[p + 7]),
        camber: input[p + 8],
      };
    });
  }
  assert.equal(kind, 'diverse-normal');
  return Array.from({ length: 128 }, (_, i) => {
    const orientation = new Quat();
    orientation.integrateWorld(
      new Vec3(Math.sin(i * 0.17) * 0.5, Math.cos(i * 0.13), Math.sin(i * 0.11) * 0.4),
      0.8,
    );
    const scale = [1, 1e-8, 1e-6, 100, 1e120][i % 5];
    return {
      orientation,
      steering: Math.sin(i * 0.19) * 0.7,
      normal: new Vec3(Math.sin(i * 0.23) * scale * 0.4, scale, Math.cos(i * 0.29) * scale * 0.3),
      camber: Math.sin(i * 0.31) * 0.2,
    };
  });
}
function frameLoop(frame, inputs, count) {
  let checksum = 0;
  for (let i = 0; i < count; i++) {
    const input = inputs[i & 127];
    frame.set(input.orientation, input.steering, input.normal, input.camber);
    checksum += frame.forward.z + frame.inclination;
  }
  return checksum;
}
function frameTiming() {
  const inputs = frameInputs(request.kind),
    output = recordWriter(request.trace),
    phases = {};
  for (const [phase, episodes, calls] of [
    ['warmup', 4, request.frameWarmupCalls],
    ['measured', 4, request.frameMeasuredCalls],
  ]) {
    const samples = [];
    for (let episode = 0; episode < episodes; episode++) {
      global.gc();
      const frame = new RoadContactFrame();
      const measured = time(() => frameLoop(frame, inputs, calls));
      const state = canonical({ checksum: measured.result, frame });
      output.put(state);
      samples.push({
        episode,
        elapsedMs: measured.elapsedMs,
        cpuUserMs: measured.cpuUserMs,
        cpuSystemMs: measured.cpuSystemMs,
        stateSHA256: sha(state),
        checksum: measured.result,
      });
    }
    phases[phase] = {
      episodes,
      callsPerEpisode: calls,
      calls: episodes * calls,
      samples,
      totals: sums(samples),
    };
  }
  return {
    kind: request.kind,
    inputCount: inputs.length,
    inputSHA256: sha(canonical(inputs)),
    phases,
    output: output.finish(),
  };
}

const SCENARIOS = {
  formula: { mode: 'practice', circuit: 'aurel', vehicles: ['apx01', 'apx01', 'apx01', 'apx01'] },
  'motorcycle-wet': {
    mode: 'practice',
    circuit: 'aurel',
    weather: 'rain',
    vehicles: ['gpr1', 'gpr2', 'sbk1000', 'gpr1'],
  },
  motocross: {
    mode: 'race',
    circuit: 'valley-ridge-mx',
    ruleset: 'motocross-moto',
    vehicles: ['mx450', 'mx250', 'mx450', 'mx250'],
  },
};
function driver(tick) {
  let seed = (0x50d37e11 ^ Math.floor(tick / 60)) >>> 0;
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  const random = (seed >>> 0) / 0x100000000;
  return {
    ...controls(),
    throttle: tick % 480 < 360 ? 0.68 + random * 0.3 : 0.15,
    brake: tick % 480 >= 360 ? 0.28 : 0,
    steer: (random - 0.5) * 0.075,
    rearBrake: tick % 600 >= 540 ? 0.18 : 0,
    riderLean: (random - 0.5) * 0.5,
    ers: tick % 600 < 120 ? 2 : 1,
    overtake: tick % 600 === 0,
    drs: tick % 480 < 180,
  };
}
function worldState(sim, withSurface) {
  const external = new Map([
    [sim.track, 'track'],
    [sim.cars, 'cars'],
    [sim.race, 'race'],
    [sim.options, 'options'],
  ]);
  sim.cars.forEach((car, i) => {
    external.set(car, `car${i}`);
    for (const key of CAR_STATIC)
      if (car[key] && typeof car[key] === 'object') external.set(car[key], `car${i}.${key}`);
  });
  const state = {
    tick: sim.tick,
    autoPlayer: sim.autoPlayer,
    recoveries: sim.recoveries,
    strandClock: sim.strandClock,
    strandS: sim.strandS,
    cars: sim.cars.map(carState),
    ai: sim.ai,
    race: omit(sim.race, ['cars', 'track', 'options', 'ruleset']),
    offroad: sim.offroad
      ? omit(sim.offroad, [
          'track',
          'cars',
          'race',
          'options',
          'course',
          'format',
          'route',
          'surface',
          'terrain',
        ])
      : null,
  };
  if (withSurface) {
    state.track = omit(sim.track, [
      'points',
      'hash',
      'stationIntervals',
      'gpEdges',
      'laneIndex',
      'contactMesh',
      'circuit',
      'pit',
    ]);
    if (sim.offroad)
      state.terrain = {
        checkpoint: sim.offroad.terrain.checkpoint(),
        wetness: sim.offroad.terrain.wetness,
        changed: sim.offroad.terrain.changed,
      };
  }
  return canonical(state, external);
}
function simulationProof() {
  const scenario = SCENARIOS[request.scenario];
  assert(scenario, 'unknown production-world scenario');
  const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 3, seed: 73021, ...scenario });
  const frame = new Float32Array(HEADER + CAR_STRIDE * sim.cars.length);
  const output = recordWriter(request.trace),
    frameDigest = createHash('sha256'),
    stateDigest = createHash('sha256');
  let frameBytes = 0,
    stateBytes = 0,
    maximumSpeed = 0,
    surfaceSnapshots = 0;
  const observations = [];
  for (let tick = 0; tick <= request.ticks; tick++) {
    if (tick > 0) {
      if (tick % 60 === 1) sim.setInput(driver(tick - 1));
      sim.autoPlayer =
        tick >= Math.floor(request.ticks * 0.45) && tick < Math.floor(request.ticks * 0.7);
      sim.step(1 / 120);
    }
    assert.equal(sim.tick, tick);
    sim.writeFrame(frame, 0, 0);
    for (const value of frame)
      assert(Number.isFinite(value), `nonfinite ${request.scenario} packed frame at ${tick}`);
    assert.equal(frame[H.STEP_MS], 0);
    assert.equal(frame[H.DROPPED], 0);
    const packed = bytesOf(frame),
      withSurface = tick % 120 === 0 || tick === request.ticks;
    const state = worldState(sim, withSurface);
    output.put(packed);
    output.put(state);
    frameDigest.update(packed);
    stateDigest.update(state);
    frameBytes += packed.length;
    stateBytes += state.length;
    if (withSurface) surfaceSnapshots++;
    maximumSpeed = Math.max(maximumSpeed, ...sim.cars.map((car) => car.speed));
    if (tick % 240 === 0 || tick === request.ticks)
      observations.push({
        tick,
        phase: sim.race.phase,
        playerSpeed: sim.cars[0].speed,
        allSpeeds: sim.cars.map((car) => car.speed),
        terrainSequence: sim.offroad?.terrain.sequence ?? null,
      });
  }
  return {
    scenario: request.scenario,
    options: sim.options,
    ticks: request.ticks,
    simulatedSeconds: request.ticks / 120,
    observations: request.ticks + 1,
    frameBytes,
    stateBytes,
    surfaceSnapshots,
    maximumSpeedMps: maximumSpeed,
    frameSHA256: frameDigest.digest('hex'),
    stateSHA256: stateDigest.digest('hex'),
    checkpoints: observations,
    productionContactMeshBuilt: sim.track.contactMesh !== null,
    productionOffroadSurface: Boolean(sim.offroad),
    protocol: { version: PROTOCOL_VERSION, header: HEADER, carStride: CAR_STRIDE },
    output: output.finish(),
  };
}

const startedAt = new Date().toISOString();
let result;
if (request.task === 'capture-flat') result = captureFlatInputs();
else if (request.task === 'vehicle') result = vehicleTiming();
else if (request.task === 'frame') result = frameTiming();
else if (request.task === 'proof') result = simulationProof();
else throw new Error(`Unknown task ${request.task}`);
process.stdout.write(
  `${JSON.stringify({ ...result, startedAt, completedAt: new Date().toISOString(), process: { pid: process.pid, node: process.version, execArgv: process.execArgv, heapLimitBytes: getHeapStatistics().heap_size_limit, resources: process.resourceUsage(), memory: process.memoryUsage() } })}\n`,
);
