import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS, VEHICLE } from '../src/simulation/config.ts';
import { clamp, Vec3 } from '../src/core/math.ts';
import { trackPoint, SURFACE } from '../src/simulation/track.ts';
import { PHASE } from '../src/simulation/race.ts';
import { peakGrip, makeTire } from '../src/simulation/tire.ts';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { aero } from '../src/simulation/aero.ts';
import { F, H, W, WHEEL_BASE, carBase } from '../src/simulation/protocol.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';
import {
  CHANNELS,
  packTelemetry,
  TELEMETRY_STRIDE,
  telemetryCsv,
} from '../src/storage/telemetry-schema.ts';

// A continuous production-physics/input fixture for part of section 146, NOT a
// substitute for a human's integrated audiovisual, camera and UI acceptance.
// No pose/force/health/lap/fuel mutation, teleport, service shortcut or tire reset.
// The replay store is in-memory here; real IndexedDB is covered by browser tests.
class Pages implements ReplayPageStore {
  pages = new Map<number, ReplayPage>();
  async put(p: ReplayPage) {
    this.pages.set(p.id, structuredClone(p));
  }
  async get(id: number) {
    const p = this.pages.get(id);
    if (!p) throw new Error('Missing page');
    return structuredClone(p);
  }
  async dispose() {
    this.pages.clear();
  }
}
const sourceHash = createHash('sha256'),
  physicsHash = createHash('sha256');
function fingerprint(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) fingerprint(path);
    else {
      const name = path.replaceAll('\\', '/'),
        hash = createHash('sha256').update(readFileSync(path)).digest('hex');
      sourceHash.update(name + '\0' + hash + '\n');
      if (name.startsWith('src/simulation/') || name.startsWith('src/core/'))
        physicsHash.update(name + '\0' + hash + '\n');
    }
  }
}
fingerprint('src');
const sourceSHA256 = sourceHash.digest('hex'),
  simulationSHA256 = physicsHash.digest('hex');
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  mode: 'race',
  laps: 8,
  opponents: 5,
  assist: 'raw',
  weather: 'changeable',
  setup: { ...DEFAULT_OPTIONS.setup, brakeBias: 0.66 },
  seed: 4417,
});
const c = sim.cars[0],
  dt = 1 / 120,
  point = trackPoint(),
  delta = new Vec3(),
  local = new Vec3();
let phase = 'start',
  phaseTime = 0,
  lastLog = -1,
  pathOffset = 0;
const replay = new SessionReplay(sim.cars.length, new Pages());
const frame = sim.makeFrame(),
  packed = new Float32Array(TELEMETRY_STRIDE),
  base = carBase(0);
const checkpoints: {
  time: number;
  tick: number;
  health: number;
  dirt: number;
  surface: number[];
}[] = [];
const telemetrySamples: Float32Array[] = [];
let telemetryRows = 0,
  previousTelemetryTick = -1,
  maxReplayBytes = 0,
  unlockedSeconds = 0,
  damageFrontLoss = 0,
  damageBalanceLoss = 0;
const cleanAero = { front: 0, rear: 0, floor: 0, drag: 0, wake: 0 },
  damagedAero = { ...cleanAero };
const failures: string[] = [];
replay.recordSurface(sim.track.water, sim.track.rubber, frame[H.TIME], sim.track.marbles);

const seen = {
  spin: 0,
  wake: 0,
  speed: 0,
  gear: 0,
  lock: 0,
  kerb: 0,
  grass: 0,
  dirt: 0,
  cleanedDirt: 0,
  compression: 0,
  wear: 0,
  temp: 0,
  ers: 0,
  wet: 0,
  changedGrip: 0,
  frontDamage: 0,
  dirtyAirAfterPit: 0,
  maximumImpact: 0,
};
const events: { time: number; event: string; s: number; speed: number; lateral: number }[] = [];
function enter(p: string) {
  phase = p;
  phaseTime = sim.race.raceTime;
  events.push({ time: phaseTime, event: p, s: c.s, speed: c.speed, lateral: c.lateral });
  console.log('EVENT', JSON.stringify(events.at(-1)));
}
function drive(offset: number, target: number) {
  const rate = phase === 'contact' ? 6 : 2;
  pathOffset += clamp(offset - pathOffset, -rate * dt, rate * dt);
  offset = pathOffset;
  const look = clamp(12 + c.speed * 0.75, 14, 35);
  sim.track.at(c.s + look, point);
  delta.set(
    point.x + point.nx * offset - c.body.position.x,
    0,
    point.z + point.nz * offset - c.body.position.z,
  );
  c.body.orientation.inverseRotate(delta, local);
  const angle = Math.atan2(
    2 * VEHICLE.wheelbase * local.x,
    Math.max(10, local.x * local.x + local.z * local.z),
  );
  c.input.steer = clamp(angle / VEHICLE.maxSteer, -1, 1);
  c.input.throttle = clamp((target - c.speed) * 0.22, 0, 0.8);
  c.input.brake = clamp((c.speed - target) * 0.16, 0, 0.8);
}
for (let tick = 0; tick < 120 * 900; tick++) {
  const t = sim.race.raceTime;
  sim.ai[0].update(dt, sim.track, sim.cars, sim.race);
  if (t < 2.5) {
    c.input.throttle = 0;
    c.input.brake = 1;
  } else if (phase === 'start') {
    c.input.throttle = 1;
    c.input.brake = 0;
    c.input.ers = 2;
    if (c.speed > 22) enter('follow');
  } else if (
    phase === 'follow' &&
    t > 25 &&
    c.speed > 50 &&
    Math.abs(c.trackPosition.curvature) < 0.006
  )
    enter('brake');
  if (phase === 'brake') {
    c.input.brake = 1;
    c.input.throttle = 0;
    if (t - phaseTime > 0.45) enter('release');
  } else if (phase === 'release') {
    c.input.brake = 0;
    c.input.throttle = 0.25;
    if (t - phaseTime > 1) enter('prepare-excursion');
  } else if (phase === 'prepare-excursion' && t > 50 && c.s < 180) enter('decelerate');
  else if (phase === 'decelerate') {
    drive(0, 12);
    if (c.speed < 14) enter('grass');
  } else if (phase === 'grass') {
    drive(-14.5, 9);
    if (t - phaseTime > 14) enter('return');
  } else if (phase === 'return') {
    drive(0, 12);
    if (t - phaseTime > 10 && Math.abs(c.lateral) < 2) enter('weather');
  } else if (phase === 'weather') {
    c.input.ers = 2;
    if (c.pitStops > 0 && !c.inPit) enter('rejoined');
  } else if (phase === 'rejoined' && t - phaseTime > 18 && c.s < 200) enter('contact');
  else if (phase === 'contact') {
    drive(-22, 18);
    if (c.frontHealth < 0.97 || t - phaseTime > 22) enter('recover-contact');
  } else if (phase === 'recover-contact') {
    drive(0, 12);
    if (t - phaseTime > 14 && Math.abs(c.lateral) < 2) enter('finish');
  }
  sim.step(dt);
  seen.speed = Math.max(seen.speed, c.speed);
  seen.gear = Math.max(seen.gear, c.gear);
  seen.wake = Math.max(seen.wake, c.wake);
  seen.spin = Math.max(seen.spin, ...c.tires.slice(2).map((w) => w.slip));
  if (phase === 'brake' || phase === 'release')
    seen.lock = Math.max(seen.lock, ...c.tires.slice(0, 2).map((w) => -w.slip));
  seen.kerb += c.contacts.some((s) => s.surface === SURFACE.KERB) ? dt : 0;
  seen.grass += c.contacts.some((s) => s.surface === SURFACE.GRASS || s.surface === SURFACE.GRAVEL)
    ? dt
    : 0;
  seen.dirt = Math.max(seen.dirt, ...c.tires.map((w) => w.dirt));
  seen.compression = Math.max(seen.compression, ...c.tires.map((w) => w.compression));
  seen.wear = Math.max(seen.wear, ...c.tires.map((w) => w.wear));
  seen.temp = Math.max(seen.temp, ...c.tires.map((w) => w.surfaceTemp));
  seen.ers = Math.max(seen.ers, c.motorPower);
  seen.wet = Math.max(seen.wet, sim.track.meanWater());
  seen.frontDamage = Math.max(seen.frontDamage, 1 - c.frontHealth);
  seen.maximumImpact = Math.max(seen.maximumImpact, c.impact);
  if (phase === 'weather' && !c.inPit && c.pitStops === 0) seen.cleanedDirt = c.tires[0].dirt;
  if (c.pitStops && !c.inPit) {
    seen.dirtyAirAfterPit = Math.max(seen.dirtyAirAfterPit, c.wake);
    seen.changedGrip = Math.max(
      seen.changedGrip,
      peakGrip(c.tires[0], 2200, c.contacts[0], 40) /
        peakGrip(makeTire('medium'), 2200, c.contacts[0], 40),
    );
  }

  if (
    phase === 'prepare-excursion' &&
    c.speed > 10 &&
    c.tires.slice(0, 2).every((w) => Math.abs(w.slip) < 0.3)
  )
    unlockedSeconds += dt;
  if (phase === 'finish' && c.speed > 30) {
    // Read-only force comparison, not a second car or a changed simulation state.
    // Fixed shared clearance/yaw isolate the measured damage's aero consequence.
    aero(c.speed, c.setup, 0.07, 0.075, 1, c.rearHealth, c.floorHealth, c.wake, 0, cleanAero);
    aero(
      c.speed,
      c.setup,
      0.07,
      0.075,
      c.frontHealth,
      c.rearHealth,
      c.floorHealth,
      c.wake,
      0,
      damagedAero,
    );
    damageFrontLoss = Math.max(damageFrontLoss, 1 - damagedAero.front / cleanAero.front);
    const balance = (a: typeof cleanAero) => a.front / (a.front + a.rear + a.floor);
    damageBalanceLoss = Math.max(damageBalanceLoss, balance(cleanAero) - balance(damagedAero));
  }
  for (const car of sim.cars) {
    if (
      !car.body.position.finite() ||
      !car.body.velocity.finite() ||
      !car.body.omega.finite() ||
      car.battery < 0 ||
      car.battery > 4e6 ||
      car.fuel <= 0 ||
      car.retired
    ) {
      failures.push('Invalid, retired or exhausted car ' + car.id);
      break;
    }
  }
  if (failures.length) break;
  if (sim.tick % 2 === 0) {
    sim.writeFrame(frame, 0, 0);
    packTelemetry(frame, packed, 0);
    if (!packed.every(Number.isFinite)) {
      failures.push('Non-finite telemetry');
      break;
    }
    if (previousTelemetryTick >= 0 && frame[H.TICK] - previousTelemetryTick !== 2) {
      failures.push('Telemetry tick gap');
      break;
    }
    previousTelemetryTick = frame[H.TICK];
    telemetryRows++;
    if (sim.tick % 1800 === 0) telemetrySamples.push(packed.slice());
  }
  if (sim.tick % 60 === 0)
    replay.recordSurface(sim.track.water, sim.track.rubber, frame[H.TIME], sim.track.marbles);
  if (sim.tick % 8 === 0) {
    replay.append(frame);
    if (sim.tick % 1800 === 0)
      checkpoints.push({
        time: frame[H.TIME],
        tick: frame[H.TICK],
        health: frame[base + F.FRONT_HEALTH],
        dirt: frame[base + WHEEL_BASE + W.DIRT],
        surface: [sim.track.water[0], sim.track.rubber[0], sim.track.marbles[0]],
      });
  }
  if (sim.tick % 60 === 0) {
    await replay.settle();
    maxReplayBytes = Math.max(maxReplayBytes, replay.bytes);
  }
  if (replay.error) {
    failures.push(replay.error);
    break;
  }

  if (Math.floor(t / 30) !== lastLog) {
    lastLog = Math.floor(t / 30);
    console.log(
      'PROGRESS',
      JSON.stringify({
        t,
        phase,
        s: c.s,
        speed: c.speed,
        lateral: c.lateral,
        pit: c.pitPhase,
        laps: sim.race.laps[0].completed,
        health: c.frontHealth,
      }),
    );
  }
  if (sim.race.phase === PHASE.FINISHED) break;
}

await replay.settle();
const checks: Record<string, boolean> = {
  completeInputSequence:
    phase === 'finish' &&
    events.map((e) => e.event).join(',') ===
      'follow,brake,release,prepare-excursion,decelerate,grass,return,weather,rejoined,contact,recover-contact,finish',
  allCarsClassified:
    sim.race.phase === PHASE.FINISHED &&
    sim.cars.every((car) => Number.isFinite(car.finishTime) && car.finishTime > 0 && !car.retired),
  launchWheelspin: seen.spin > 0.15,
  highSpeedGears: seen.speed > 60 && seen.gear >= 6,
  // Safer wet pit release creates a larger post-stop gap. Keep a strong peak-wake
  // requirement and separately require measurable post-stop dirty air.
  genuineWake: seen.wake > 0.1 && seen.dirtyAirAfterPit > 0.03,
  lockAndRecovery: seen.lock > 0.8 && unlockedSeconds > 0.2,
  kerbGrassSuspension: seen.kerb > 0.5 && seen.grass > 2 && seen.compression > 0.04,
  retainedDirtThenCleaning: seen.dirt > 0.5 && seen.cleanedDirt < 0.05,
  thermalWearAndERS: seen.temp > 90 && seen.wear > 0.02 && seen.ers > 50000,
  wetCompoundTransition:
    seen.wet > 0.3 &&
    c.pitStops >= 1 &&
    c.tires[0].compound === 'intermediate' &&
    seen.changedGrip > 1.2,
  physicalFrontDamageAndAeroLoss:
    seen.frontDamage > 0.02 &&
    seen.frontDamage < 0.25 &&
    damageFrontLoss > 0.02 &&
    damageBalanceLoss > 0.001,
  telemetryClock: telemetryRows > 30000 && checkpoints.length > 20,
};
const a = replay.makeFrame(),
  b = replay.makeFrame();
const replayChecks = [];
// Deliberately seek backward across disk-page boundaries, not just the resident tail.
for (const index of [checkpoints.length - 1, 12, 0, 24]) {
  const expected = checkpoints[index];
  if (!expected) {
    replayChecks.push({ index, passed: false });
    continue;
  }
  let alpha: number | null = null;
  for (let attempt = 0; attempt < 4 && alpha === null; attempt++) {
    alpha = replay.sample(expected.time - replay.start, a, b);
    await replay.settle();
  }
  const surface = replay.surfaceState;
  const passed =
    alpha !== null &&
    a[H.TICK] === expected.tick &&
    a[base + F.FRONT_HEALTH] === expected.health &&
    a[base + WHEEL_BASE + W.DIRT] === expected.dirt &&
    Math.abs(surface.water[0] - expected.surface[0]) <= 0.000501 &&
    Math.abs(surface.rubber[0] - expected.surface[1]) <= 1 / 65535 &&
    Math.abs(surface.marbles[0] - expected.surface[2]) <= 1 / 65535;
  replayChecks.push({ index, time: expected.time, tick: expected.tick, passed });
}
checks.replayActualHistory =
  replayChecks.length === 4 && replayChecks.every((c) => c.passed) && !replay.error;
const values = new Float32Array(telemetrySamples.length * TELEMETRY_STRIDE);
telemetrySamples.forEach((sample, i) => values.set(sample, i * TELEMETRY_STRIDE));
const csv = (await telemetryCsv(values, telemetrySamples.length).text()).trim().split('\n');
checks.csvActualState =
  csv[0].split(',').length === 228 &&
  csv[0] === CHANNELS.join(',') &&
  csv.length === telemetrySamples.length + 1 &&
  csv
    .slice(1)
    .every((row, i) =>
      row.split(',').every((value, j) => Number(value) === telemetrySamples[i][j]),
    );
for (const [name, passed] of Object.entries(checks)) if (!passed) failures.push(name);
const report = {
  sourceSHA256,
  simulationSHA256,
  fingerprintVersion: 2,
  scriptSHA256: createHash('sha256')
    .update(readFileSync('scripts/integrated-driving.ts'))
    .digest('hex'),
  scope:
    'Continuous production-physics/input, numeric replay and CSV fixture. NOT the complete manual audiovisual section-146 acceptance.',
  fixture: {
    seed: 4417,
    laps: 8,
    cars: 6,
    weather: 'changeable',
    assist: 'raw',
    brakeBias: 0.66,
    dt,
    mutations:
      'Player control requests only; no poses, forces, health, fuel, lap counters or tire resets.',
    replayStore: 'in-memory page adapter; IndexedDB and GPU require browser tests',
  },
  passed: failures.length === 0,
  failures,
  checks,
  seen,
  events,
  unlockedSeconds,
  damageFrontLoss,
  damageBalanceLoss,
  telemetry: {
    rows: telemetryRows,
    channels: CHANNELS.length,
    verifiedCsvRows: telemetrySamples.length,
    intervalTicks: 2,
  },
  replay: {
    frames: replay.count,
    durationSeconds: replay.duration,
    maximumResidentBytes: maxReplayBytes,
    seeks: replayChecks,
  },
  raceTime: sim.race.raceTime,
  cars: sim.cars.map((car) => ({
    id: car.id,
    finishTime: car.finishTime,
    retired: car.retired,
    laps: sim.race.laps[car.id].completed,
    pitStops: car.pitStops,
    frontHealth: car.frontHealth,
  })),
};
writeFileSync('docs/integrated-driving.json', JSON.stringify(report, null, 2) + '\n');
await replay.dispose();
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
