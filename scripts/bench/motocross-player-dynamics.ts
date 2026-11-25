/** Deterministic CPU acceptance of the PLAYER MX solver, including its approach.
 * Run: node --experimental-transform-types scripts/bench/motocross-player-dynamics.ts
 * The feedback driver issues ordinary controls. It is neither AI ownership nor
 * a human/visual riding evaluation. Only initial placement, road speed and gear
 * are supplied; no flight pose, load, contact, rotor or recovery state is set. */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { clamp, G } from '../../src/core/math.ts';
import { circuitDefinition } from '../../src/simulation/circuits.ts';
import { controls, DEFAULT_SETUP, type Assist } from '../../src/simulation/config.ts';
import { MOTORCYCLE_THERMAL } from '../../src/simulation/motorcycle-thermal.ts';
import { MX_250, MX_450 } from '../../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle, type LandingRecord } from '../../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine } from '../../src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '../../src/simulation/offroad/venues.ts';
import { Track } from '../../src/simulation/track.ts';

export interface PlayerCase {
  machine: 'mx250' | 'mx450';
  venue: 'valley-ridge-mx' | 'arena-nord-sx';
  assist: Assist;
  hz?: number;
  weather?: 'clear' | 'rain';
}
export const PLAYER_CASES: PlayerCase[] = ['valley-ridge-mx', 'arena-nord-sx'].flatMap(venue =>
  ['mx250', 'mx450'].flatMap(machine => ['raw', 'sport'].map(assist =>
    ({ venue, machine, assist } as PlayerCase))));
export const AIR_SCENARIOS = [
  'feedback', 'front-lock', 'rear-tap', 'body-reversal', 'whip-early', 'held-whip',
] as const;
export type AirScenario = typeof AIR_SCENARIOS[number];
export type GroundBrake = 'coast' | 'front' | 'rear';

// A bike step only reads these tracks; no terrain deformation or weather
// advancement occurs during a run. Rain uses the existing weather timeline,
// including the real roof policy, with no patch or material injection.
const tracks = new Map<string, Track>();
function makeRun(config: PlayerCase, s: number, speed: number) {
  const weather = config.weather ?? 'clear', key = `${config.venue}/${weather}`;
  let track = tracks.get(key);
  if (!track) {
    track = new Track(weather, false, undefined, circuitDefinition(config.venue));
    if (weather === 'rain') track.evolve(60, 60);
    tracks.set(key, track);
  }
  const definition = config.machine === 'mx250' ? MX_250 : MX_450;
  const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, config.assist, definition);
  bike.place(track, s);
  bike.dynamics.speed = speed;
  bike.gear = 3;
  return { bike, track, dt: 1 / (config.hz ?? 240) };
}

function snapshot(bike: DirtBikeVehicle) {
  const d = bike.dynamics;
  return {
    x: d.x, z: d.z, heading: d.heading, speed: d.speed, slide: bike.slide,
    planarSpeed: bike.body.velocity.x * Math.sin(d.heading) + bike.body.velocity.z * Math.cos(d.heading),
    y: bike.cgY, vy: bike.vy, pitch: bike.pitch, pitchRate: bike.pitchRate,
    frontSpin: bike.frontSpin, rearSpin: bike.rearSpin,
    body: bike.riderBody, yaw: bike.airYaw, fork: bike.fork, shock: bike.shock,
    airborne: bike.airborne, airTime: bike.airTime, riding: bike.riding,
    frontLoad: bike.forceFront, rearLoad: bike.forceRear,
    discs: [bike.tires[0].discTemp, bike.tires[2].discTemp],
    mud: bike.mud,
  };
}

/** Reconstruct rotor source work from stored heat and the independently
 * observed endpoint losses of the implicit thermal balance. Count one real
 * reservoir per axle; the four-slot telemetry duplicates each motorcycle end. */
function rotorWork(bike: DirtBikeVehicle, track: Track, discs: number[], dt: number) {
  return [0, 2].map((i, end) => {
    const tire = bike.tires[i], p = end ? MOTORCYCLE_THERMAL.rear : MOTORCYCLE_THERMAL.front;
    const loss = (p.brake.airBase + p.brake.airSpeed * Math.hypot(bike.dynamics.speed, bike.slide)) *
      (tire.discTemp - track.ambient) + p.tyre.discToCore * (tire.discTemp - tire.coreTemp);
    return p.brake.capacity * (tire.discTemp - discs[end]) + loss * dt;
  });
}

function heat(bike: DirtBikeVehicle) {
  return [0, 2].reduce((sum, i) => {
    const tire = bike.tires[i], p = i ? MOTORCYCLE_THERMAL.rear : MOTORCYCLE_THERMAL.front;
    return sum + p.tyre.surfaceCapacity * (1 - p.tyre.wearCapacityLoss * tire.wear) * tire.surfaceTemp +
      p.tyre.carcassCapacity * tire.carcassTemp + p.tyre.coreCapacity * tire.coreTemp +
      p.brake.capacity * tire.discTemp;
  }, 0);
}

function observer(bike: DirtBikeVehicle, track: Track, dt: number) {
  const hash = createHash('sha256'), issues = new Set<string>();
  const spec = bike.definition.bike!;
  const metrics = {
    steps: 0, playerSteps: 0, freeSteps: 0, recoverySteps: 0, oneAxleSteps: 0,
    maxFreeForce: 0, maxFreeSlipPower: 0, maxFreeMudPickup: 0,
    maxBallisticPositionError: 0, maxBallisticSpeedError: 0, maxFrontRotorError: 0,
    maxFrontAirWorkErrorJ: 0, maxRearAirWorkErrorJ: 0, rearAirWorkChecks: 0,
    minRotorSourceJ: 0, maxPassiveHeatGainJ: 0,
    totalRotorWorkJ: [0, 0], freeRotorWorkJ: [0, 0], slipWorkJ: 0,
    minFrontSpin: Infinity, minRearSpin: Infinity, maxFork: 0, maxShock: 0,
    maxTemperatureC: 0, maxContactWaterMm: 0, minBody: 1, maxBody: -1, maxYaw: 0,
    maxBodyRate: 0,
  };
  function step() {
    const before = snapshot(bike), previousHeat = heat(bike);
    bike.step(dt, track);
    const d = bike.dynamics, after = snapshot(bike), work = rotorWork(bike, track, before.discs, dt);
    metrics.steps++;
    if (d.p.independentRearBrake) metrics.playerSteps++;
    else issues.add('player control ownership was lost');
    metrics.oneAxleSteps += Number((bike.forceFront > 0) !== (bike.forceRear > 0));
    metrics.minFrontSpin = Math.min(metrics.minFrontSpin, bike.frontSpin);
    metrics.minRearSpin = Math.min(metrics.minRearSpin, bike.rearSpin);
    metrics.maxFork = Math.max(metrics.maxFork, bike.fork);
    metrics.maxShock = Math.max(metrics.maxShock, bike.shock);
    metrics.minBody = Math.min(metrics.minBody, bike.riderBody);
    metrics.maxBody = Math.max(metrics.maxBody, bike.riderBody);
    metrics.maxBodyRate = Math.max(metrics.maxBodyRate, Math.abs(bike.riderBodyRate));
    metrics.maxYaw = Math.max(metrics.maxYaw, Math.abs(bike.airYaw));
    const values = [
      d.x, d.z, d.speed, d.heading, d.lean, d.leanRate, bike.slide,
      bike.cgY, bike.vy, bike.pitch, bike.pitchRate, bike.airYaw, bike.airYawRate,
      bike.forceFront, bike.forceRear, bike.fork, bike.shock, bike.frontSpin, bike.rearSpin,
      bike.riderBody, bike.riderBodyRate, bike.standing, bike.mud, bike.fuel,
      ...Object.values(bike.body.position), ...Object.values(bike.body.velocity),
      ...Object.values(bike.body.orientation),
    ];
    if (!values.every(Number.isFinite)) issues.add('non-finite physical state');
    if (bike.fork < 0 || bike.fork > spec.forkTravel || bike.shock < 0 || bike.shock > spec.shockTravel)
      issues.add('mechanical suspension travel exceeded');
    if (bike.frontSpin < 0 || bike.rearSpin < 0) issues.add('negative wheel spin');
    if (Math.abs(bike.riderBody) > 1 + 1e-12) issues.add('rider body exceeded its stroke');
    for (let i = 0; i < bike.tires.length; i++) {
      const tire = bike.tires[i];
      const tyreValues = [tire.omega, tire.load, tire.fx, tire.fy, tire.energy, tire.slip,
        tire.surfaceTemp, tire.carcassTemp, tire.coreTemp, tire.discTemp, tire.wear, tire.compression];
      if (!tyreValues.every(Number.isFinite)) issues.add('non-finite tyre state');
      if (tire.energy < 0 || tire.load < 0 || tire.wear < 0 || tire.wear > 1)
        issues.add('invalid tyre energy, support or wear');
      values.push(...tyreValues);
      metrics.slipWorkJ += tire.energy * dt;
      metrics.maxTemperatureC = Math.max(metrics.maxTemperatureC,
        tire.surfaceTemp, tire.carcassTemp, tire.coreTemp, tire.discTemp);
      metrics.maxContactWaterMm = Math.max(metrics.maxContactWaterMm, bike.contacts[i].water);
      if (i % 2 === 1) {
        const real = bike.tires[i - 1];
        if (tire.energy !== real.energy || tire.discTemp !== real.discTemp ||
          tire.surfaceTemp !== real.surfaceTemp || tire.wear !== real.wear)
          issues.add('wheel thermal aliases diverged');
      }
    }
    work.forEach((joules, i) => {
      metrics.totalRotorWorkJ[i] += joules;
      metrics.minRotorSourceJ = Math.min(metrics.minRotorSourceJ, joules);
    });
    if (before.airborne && after.airborne && before.riding && after.riding) {
      metrics.freeSteps++;
      // At departure the public road-speed scalar still describes the
      // sloped approach. The published world velocity already carries the
      // actual horizontal launch component and avoids conflating the two.
      const drag = d.p.drag / d.mass, speed = before.planarSpeed / (1 + drag * before.planarSpeed * dt);
      const distance = Math.log1p(drag * before.planarSpeed * dt) / drag;
      const x = before.x + Math.sin(before.heading) * distance + Math.cos(before.heading) * before.slide * dt;
      const z = before.z + Math.cos(before.heading) * distance - Math.sin(before.heading) * before.slide * dt;
      const y = before.y + before.vy * dt - 0.5 * G * dt * dt;
      metrics.maxBallisticPositionError = Math.max(metrics.maxBallisticPositionError,
        Math.abs(bike.cgY - y), Math.abs(d.x - x), Math.abs(d.z - z));
      metrics.maxBallisticSpeedError = Math.max(metrics.maxBallisticSpeedError, Math.abs(d.speed - speed));
      const coastingFront = before.frontSpin * Math.exp(-0.4 * dt);
      const front = Math.max(0, coastingFront - bike.brake * bike.air.spinBrake * 0.7 * dt);
      metrics.maxFrontRotorError = Math.max(metrics.maxFrontRotorError, Math.abs(bike.frontSpin - front));
      const frontWork = 0.5 * bike.definition.spec.wheelInertia *
        (coastingFront ** 2 - bike.frontSpin ** 2);
      metrics.maxFrontAirWorkErrorJ = Math.max(metrics.maxFrontAirWorkErrorJ, Math.abs(work[0] - frontWork));
      // Every script uses mutually exclusive rear drive/brake commands.
      // With drive released, friction receives its share of the actual
      // rotor kinetic-energy loss; bearing resistance receives the rest.
      if (bike.rearBrake === 0 || bike.throttle === 0) {
        const brakeDeceleration = bike.rearBrake * bike.air.spinBrake;
        const rearWork = brakeDeceleration === 0 ? 0 :
          0.5 * bike.air.spinInertia * (before.rearSpin ** 2 - bike.rearSpin ** 2) *
          brakeDeceleration / (brakeDeceleration + 2);
        metrics.rearAirWorkChecks++;
        metrics.maxRearAirWorkErrorJ = Math.max(metrics.maxRearAirWorkErrorJ, Math.abs(work[1] - rearWork));
      }
      metrics.maxFreeForce = Math.max(metrics.maxFreeForce, bike.forceFront, bike.forceRear,
        Math.abs(d.driveForce), Math.abs(d.frontBrakeForce), Math.abs(d.rearBrakeForce),
        ...bike.tires.flatMap(tire => [Math.abs(tire.fx), Math.abs(tire.fy), tire.load]));
      metrics.maxFreeSlipPower = Math.max(metrics.maxFreeSlipPower, ...bike.tires.map(tire => tire.energy));
      metrics.maxFreeMudPickup = Math.max(metrics.maxFreeMudPickup, bike.mud - before.mud);
      work.forEach((joules, i) => { metrics.freeRotorWorkJ[i] += joules; });
    }
    if (!before.riding && !after.riding) {
      metrics.recoverySteps++;
      metrics.maxPassiveHeatGainJ = Math.max(metrics.maxPassiveHeatGainJ, heat(bike) - previousHeat);
      if (bike.tires.some(tire => tire.fx !== 0 || tire.fy !== 0 || tire.energy !== 0))
        issues.add('recovery invented tyre contact work');
    }
    hash.update(new Uint8Array(new Float64Array(values).buffer));
    hash.update(`${d.state}/${Number(bike.airborne)}/${bike.landings}/${d.crashes}`);
    return { before, after, work };
  }
  function finish() {
    if (metrics.maxFreeForce !== 0 || metrics.maxFreeSlipPower !== 0 || metrics.maxFreeMudPickup > 0)
      issues.add('contact force, slip heat or soil pickup preceded contact');
    if (metrics.maxBallisticPositionError > 1e-8 || metrics.maxBallisticSpeedError > 1e-10)
      issues.add('free translation was not ballistic');
    if (metrics.maxFrontRotorError > 1e-9) issues.add('front rotor changed without its air torque');
    if (metrics.maxFrontAirWorkErrorJ > 1e-7 || metrics.maxRearAirWorkErrorJ > 1e-7 ||
        metrics.minRotorSourceJ < -1e-7)
      issues.add('rotor work did not balance its finite thermal reservoir');
    if (metrics.maxPassiveHeatGainJ > 1e-6) issues.add('unsupported recovery created heat');
    return { ...metrics, violations: [...issues], traceSha256: hash.digest('hex') };
  }
  return { step, finish };
}

function airControls(bike: DirtBikeVehicle, scenario: AirScenario) {
  // Feedback uses the public landing forecast, exactly as a repeatable
  // instrumented driver may. The simulation's AI flag is never enabled.
  const wanted = (bike.landingTarget + 0.1 - bike.pitch - bike.riderBody * 0.06) /
    Math.max(0.12, bike.landingIn) - bike.pitchRate;
  Object.assign(bike.input, controls(), {
    throttle: clamp(wanted * 1.2, 0, 1), clutch: clamp(-wanted * 1.2, 0, 1),
  });
  const t = bike.airTime;
  if (scenario === 'front-lock') bike.input.brake = Number(t > 0.15 && t < 0.6);
  if (scenario === 'rear-tap' && t > 0.15 && t < 0.35) {
    bike.input.throttle = 0;
    bike.input.clutch = 1;
  }
  if (scenario === 'body-reversal') bike.input.riderLean = t < 0.3 ? 1 : t < 0.6 ? -1 : 0;
  if (scenario === 'whip-early') bike.input.steer = t > 0.12 && t < 0.4 ? 0.8 : 0;
  if (scenario === 'held-whip') bike.input.steer = 1;
}

function incomingRecord(landing: LandingRecord) {
  const { bottomSpeed: _bottom, outcome: _outcome, ...incoming } = landing;
  return incoming;
}

export function runPlayerFlight(config: PlayerCase, scenario: AirScenario) {
  const course = offroadCourse(circuitDefinition(config.venue))!;
  const jump = course.jumps.find(item => item.name ===
    (config.venue === 'valley-ridge-mx' ? 'RIDGE TABLE' : 'TABLETOP'))!;
  const speed = (config.venue === 'valley-ridge-mx' ? 13.5 : 13) * (scenario === 'whip-early' ? 0.85 : 1);
  const { bike, track, dt } = makeRun(config, jump.start - 12, speed);
  const observed = observer(bike, track, dt), states = new Set<string>();
  let departed = false, takeoffAt = 0, touchdownAt = 0, crashedAt = 0, remountedAt = 0;
  let record: LandingRecord | null = null, incoming: ReturnType<typeof incomingRecord> | null = null;
  let incomingStable = true, touchdown: ReturnType<typeof snapshot> | null = null;
  let after300ms: ReturnType<typeof snapshot> | null = null, remount: ReturnType<typeof snapshot> | null = null;
  let firstPickupSeconds: number | null = null, rollingSeconds: number | null = null;
  let stoppedFrontAirSteps = 0, stoppedRearAirSteps = 0, unloadedFrontAfterLanding = 0;
  const samples: { airTime: number; pitch: number; body: number; yaw: number; front: number; rear: number }[] = [];
  const sampleTimes = [0.28, 0.38, 0.58, 0.85];
  const rebound = [false, false], bottomed = [false, false];
  for (let tick = 0; tick < Math.ceil(18 / dt); tick++) {
    if (!bike.riding || record) Object.assign(bike.input, controls());
    else if (bike.airborne && departed) airControls(bike, scenario);
    else if (!bike.airborne) rideLine(bike, track,
      bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1 ? Math.max(speed, bike.dynamics.speed) : speed);
    const { before } = observed.step();
    states.add(bike.dynamics.state);
    if (!before.airborne && bike.airborne && !departed &&
      bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 3) {
      departed = true;
      takeoffAt = bike.clock;
    }
    if (departed && bike.airborne && !record) {
      stoppedFrontAirSteps += Number(bike.frontSpin === 0);
      stoppedRearAirSteps += Number(bike.rearSpin === 0);
      if (samples.length < sampleTimes.length && bike.airTime >= sampleTimes[samples.length])
        samples.push({ airTime: bike.airTime, pitch: bike.pitch, body: bike.riderBody,
          yaw: bike.airYaw, front: bike.frontSpin, rear: bike.rearSpin });
    }
    if (departed && before.airborne && !bike.airborne && !record) {
      record = bike.lastLanding;
      if (record) incoming = incomingRecord(record);
      touchdown = snapshot(bike);
      touchdownAt = bike.clock;
    }
    if (record) {
      incomingStable &&= JSON.stringify(incomingRecord(record)) === JSON.stringify(incoming);
      const travel = [bike.fork, bike.shock], limits = [bike.definition.bike!.forkTravel, bike.definition.bike!.shockTravel];
      for (let i = 0; i < 2; i++) {
        bottomed[i] ||= travel[i] === limits[i];
        rebound[i] ||= bottomed[i] && travel[i] < limits[i] / 2;
      }
      if (bike.riding && !bike.airborne && before.frontLoad === 0 && !before.airborne)
        unloadedFrontAfterLanding++;
      if (!crashedAt && bike.riding && !bike.airborne && before.frontLoad > 0 &&
          bike.frontSpin > before.frontSpin + 0.1 && firstPickupSeconds === null)
        firstPickupSeconds = bike.clock - touchdownAt;
      if (!crashedAt && bike.riding && !bike.airborne && bike.forceFront > 0 &&
          Math.abs(bike.frontSpin * bike.tires[0].radius - bike.speed) < 0.01 && rollingSeconds === null)
        rollingSeconds = bike.clock - touchdownAt;
      if (!after300ms && bike.clock - touchdownAt >= 0.3) after300ms = snapshot(bike);
    }
    if (bike.dynamics.crashes > 0 && !crashedAt) crashedAt = bike.clock;
    if (crashedAt && !before.riding && bike.riding) {
      remountedAt = bike.clock;
      remount = snapshot(bike);
    }
    if (record && !crashedAt && bike.clock - touchdownAt >= 0.6) break;
    if (remountedAt && bike.clock - remountedAt >= 0.3) break;
  }
  const checks = observed.finish();
  if (!departed || !record) checks.violations.push('the surveyed player flight did not land');
  if (!incomingStable) checks.violations.push('incoming landing severity changed during settlement');
  if (crashedAt && !remountedAt) checks.violations.push('the actual crash did not recover');
  return {
    config, scenario, approach: { initialS: jump.start - 12, initialSpeed: speed, gear: 3 },
    departed, takeoffAt, touchdownAt, incomingStable, landing: record ? { ...record } : null,
    touchdown, after300ms, remount, samples, stoppedFrontAirSteps, stoppedRearAirSteps,
    firstPickupSeconds, rollingSeconds, unloadedFrontAfterLanding, bottomed, rebound,
    crashes: bike.dynamics.crashes, crashCauses: bike.crashCauses.slice(), states: [...states],
    recoverySeconds: remountedAt ? remountedAt - crashedAt : null,
    final: snapshot(bike), historicalLandingRetained: bike.lastLanding === record,
    ...checks,
  };
}

export function runPlayerGround(config: PlayerCase, brake: GroundBrake, lean: -1 | 1) {
  const { bike, track, dt } = makeRun(config, 35, 12), observed = observer(bike, track, dt);
  const settleSteps = Math.round(1 / dt), brakeSteps = Math.round(0.35 / dt);
  let beforeBraking: ReturnType<typeof snapshot> | null = null;
  let peakFrontBrake = 0, peakRearBrake = 0, peakFrontSupport = 0;
  for (let tick = 0; tick < settleSteps + brakeSteps; tick++) {
    if (tick < settleSteps) {
      rideLine(bike, track, 12);
      bike.input.riderLean = lean;
    } else {
      beforeBraking ??= snapshot(bike);
      Object.assign(bike.input, controls(), { riderLean: lean,
        brake: brake === 'front' ? 0.55 : 0, clutch: brake === 'rear' ? 0.55 : 0 });
    }
    observed.step();
    if (tick >= settleSteps) {
      peakFrontBrake = Math.max(peakFrontBrake, bike.dynamics.frontBrakeForce);
      peakRearBrake = Math.max(peakRearBrake, bike.dynamics.rearBrakeForce);
      peakFrontSupport = Math.max(peakFrontSupport, bike.forceFront);
    }
  }
  return { config, brake, lean, beforeBraking: beforeBraking!, final: snapshot(bike),
    peakFrontBrake, peakRearBrake, peakFrontSupport, crashes: bike.dynamics.crashes,
    ...observed.finish() };
}

export function runPlayerAcceptance() {
  const flights = PLAYER_CASES.flatMap(config => AIR_SCENARIOS.map(scenario => runPlayerFlight(config, scenario)));
  const ground = PLAYER_CASES.flatMap(config => (['coast', 'front', 'rear'] as const).flatMap(brake =>
    ([-1, 1] as const).map(lean => runPlayerGround(config, brake, lean))));
  const wet = (['mx250', 'mx450'] as const).map(machine => runPlayerGround({
    venue: 'valley-ridge-mx', machine, assist: 'sport', weather: 'rain',
  }, 'front', 1));
  const refinedAdverse = flights.filter(run => run.crashes > 0).map(run =>
    runPlayerFlight({ ...run.config, hz: 480 }, run.scenario));
  const repeatIdentical = flights.every(run => JSON.stringify(runPlayerFlight(run.config, run.scenario)) === JSON.stringify(run)) &&
    ground.every(run => JSON.stringify(runPlayerGround(run.config, run.brake, run.lean)) === JSON.stringify(run)) &&
    wet.every(run => JSON.stringify(runPlayerGround(run.config, run.brake, run.lean)) === JSON.stringify(run));
  return {
    method: 'Public player controls; scripted centreline/pitch feedback; initial placement/speed/gear only; no AI ownership.',
    hz: 240, repeatIdentical, flights, ground, wet, refinedAdverse,
    violations: [...flights, ...ground, ...wet, ...refinedAdverse].flatMap(run => run.violations),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runPlayerAcceptance();
  console.log(JSON.stringify(result, null, 2));
  if (result.violations.length || !result.repeatIdentical) process.exitCode = 1;
}
