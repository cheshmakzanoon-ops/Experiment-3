import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// External recording-only observer. It never changes simulation inputs, return
// values, parameters, random state, source files, test assertions or deadlines.
// Every replaced method invokes the saved native method exactly once.
const [sourceArg, outputArg, whitelistArg] = process.argv.slice(2);
if (!sourceArg || !outputArg || !whitelistArg) throw new Error('source output whitelist required');
const root = resolve(sourceArg), output = resolve(outputArg), whitelistPath = resolve(whitelistArg);
if (output.startsWith(`${root}/`)) throw new Error('Evidence must be external');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const whitelistBytes = readFileSync(whitelistPath), whitelist = JSON.parse(whitelistBytes);
const expectedFiles = {
  ...whitelist.sourceSha256,
  ...whitelist.originalTests,
  'tests/gp-steering-throttle-ownership.test.ts': whitelist.focusedTestSha256,
};
const enumerate = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const name = `${prefix}${entry.name}`;
  return entry.isDirectory() ? enumerate(resolve(dir, entry.name), `${name}/`) : [name];
});
function verifySource() {
  const srcFiles = enumerate(resolve(root, 'src')).map(name => `src/${name}`).sort();
  const expectedSrc = Object.keys(whitelist.sourceSha256).sort();
  if (JSON.stringify(srcFiles) !== JSON.stringify(expectedSrc)) throw new Error('Source file set differs');
  const checked = Object.fromEntries(Object.entries(expectedFiles).map(([path, expected]) => {
    const actual = sha(readFileSync(resolve(root, path)));
    if (actual !== expected) throw new Error(`Source identity mismatch: ${path}`);
    return [path, actual];
  }));
  return { sourceFiles: srcFiles.length, checkedFiles: Object.keys(checked).length,
    checkedSha256: sha(JSON.stringify(checked)), keyHashes: Object.fromEntries(Object.entries(checked).filter(([p]) => p.startsWith('src/simulation/') || p.startsWith('tests/'))) };
}
const before = verifySource();
const load = path => import(pathToFileURL(resolve(root, path)).href);
const { Simulation } = await load('src/simulation/world.ts');
const { DEFAULT_OPTIONS } = await load('src/simulation/config.ts');
const { PHASE } = await load('src/simulation/race.ts');
const { GP_AI_HANDS } = await load('src/simulation/bike-ai.ts');
const { GP_ASSIST } = await load('src/simulation/bike.ts');
const { G } = await load('src/core/math.ts');
const vehicles = ['gpr1', 'sbk1000', 'gpr1', 'sbk1000', 'gpr1', 'sbk1000'];
const options = { ...DEFAULT_OPTIONS, circuit: 'vellamar', mode: 'race', ruleset: 'gp-motorcycle',
  laps: 2, opponents: vehicles.length - 1, vehicles, seed: 3303 };
const sim = new Simulation(options);
sim.autoPlayer = true;
const samples = [], planning = [], timing = [], incidents = [], phaseEvents = [];
const latestAI = [], latestPhysics = [], aggregates = new Map();
const counts = sim.cars.map(() => ({ update: 0, limitSpeed: 0, gpPedals: 0, steeringThrottle: 0,
  evaluate: 0, physicsStep: 0, gpSteer: 0, gpLateralCapacity: 0, frontSteerFor: 0, rearForceFor: 0 }));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const plannerKeys = ['blocker','slower','passTarget','passes','aborts','lastAbort','limitedBy','paced',
  'classTop','runway','needDecel','scale','passSide','settleUntil','easeFrom','passPaced','clearSince',
  'clearGap','retryAfter','retryCost','passSince','notClosingSince','holdUntil','heldOffset','preferred','bypass','waiting'];
const pick = (obj, keys) => Object.fromEntries(keys.map(key => [key, obj[key]]));
const plannerState = p => pick(p, plannerKeys);
const pose = c => ({ id: c.id, definition: c.definition.id, s: c.s, lateral: c.lateral,
  speed: c.speed, aiTarget: c.aiTarget, aiOffset: c.aiOffset, gLong: c.gLong,
  inPit: c.inPit, retired: c.retired, finishTime: c.finishTime,
  completed: sim.race.laps[c.id].completed, width: c.trackPosition.width, topSpeed: c.definition.ai.topSpeed });
let tick = 0;
for (const c of sim.cars) {
  const id = c.id, d = c.dynamics, a = sim.ai[id], p = a.planner, g = d.motoGP;
  let activeAI = null, activePhysics = null;
  const update = a.update;
  a.update = function (...args) {
    counts[id].update++;
    activeAI = { tick, raceTime: sim.race.raceTime, time: sim.race.time, s: c.s,
      completed: sim.race.laps[id].completed, speed: c.speed, oldAiOffset: c.aiOffset };
    const result = update.apply(this, args);
    activeAI.final = { target: c.aiTarget, offset: c.aiOffset, currentOffset: a.offset,
      desiredOffset: a.desiredOffset, tactical: a.tactical, launch: a.launch,
      trafficSpeed: a.trafficSpeed, freeSpeed: a.freeSpeed, planLimit: a.planLimit,
      planNext: a.planNext, planDistance: a.planDistance, planRunway: a.planRunway,
      planRecovery: a.planRecovery, planBrake: a.planBrake, heldBack: a.heldBack,
      steeringCorrection: a.steeringCorrection, steeringTarget: a.steeringTarget,
      steering: c.input.steer, throttle: c.input.throttle, brake: c.input.brake,
      trafficRefreshed: a.trafficRefreshed, decision: a.decision };
    latestAI[id] = activeAI;
    activeAI = null;
    return result;
  };
  const limitSpeed = a.limitSpeed;
  a.limitSpeed = function (...args) {
    counts[id].limitSpeed++;
    const receipt = { desired: args[0], oldAiOffset: c.aiOffset, speed: c.speed,
      freeSpeed: a.freeSpeed, trafficSpeed: a.trafficSpeed };
    const result = limitSpeed.apply(this, args);
    Object.assign(receipt, { result, planLimit: a.planLimit, planNext: a.planNext,
      planDistance: a.planDistance, planRecovery: a.planRecovery, planRunway: a.planRunway });
    if (activeAI) activeAI.limit = receipt;
    return result;
  };
  const evaluate = p.evaluate;
  p.evaluate = function (...args) {
    counts[id].evaluate++;
    const capture = !!g && sim.race.phase === PHASE.RACING && c.finishTime === 0;
    const record = capture ? { tick, id, raceTime: sim.race.raceTime, time: args[3],
      rider: pose(c), braking: args[4], yellow: args[6], preferredOffset: args[7],
      approachingPit: args[8], lateralScale: args[10], trackingMargin: args[11],
      pace: args[12] ? { ...args[12] } : null, before: plannerState(p),
      others: sim.cars.filter(other => other !== c).map(pose) } : null;
    const result = evaluate.apply(this, args);
    if (record) {
      Object.assign(record, { result: { ...result }, after: plannerState(p),
        rawCandidates: Array.from(p.candidates), rawLaneSafe: Array.from(p.laneSafe),
        rawLaneScore: Array.from(p.laneScore), rawStalled: Array.from(p.stalled) });
      // Fixed-size candidate arrays can retain unused tail entries; analysis
      // must not infer that those tails were evaluated on this call.
      planning.push(record);
    }
    return result;
  };
  if (g) {
    const steeringThrottle = a.steeringThrottle;
    a.steeringThrottle = function (...args) {
      counts[id].steeringThrottle++;
      const result = steeringThrottle.apply(this, args);
      if (activeAI) activeAI.steeringThrottle = { result, speed: d.speed, lean: d.lean,
        leanLimit: d.leanLimit, leanRate: d.leanRate, intent: c.input.steer,
        frontLoad: d.frontLoad, rearLoad: d.rearLoad, mass: d.mass,
        frontGrip: d.frontGrip, rearGrip: d.rearGrip, correction: a.steeringCorrection,
        gear: c.gear, rpm: c.rpm };
      return result;
    };
    const gpPedals = a.gpPedals;
    a.gpPedals = function (...args) {
      counts[id].gpPedals++;
      const dt = args[0], commandThrottle = c.input.throttle, commandBrake = c.input.brake;
      const slip = Math.abs(Math.atan2(g.lateralSpeed, Math.max(5, d.speed)));
      const launch = d.speed < GP_AI_HANDS.launchSpeed;
      const receipt = { commandThrottle, commandBrake, lastThrottle: a.lastThrottle,
        lastBrake: a.lastBrake, slip, launch, heldBack: a.heldBack,
        openingLimit: a.lastThrottle + (launch ? GP_AI_HANDS.launchRate : GP_AI_HANDS.throttleOpen) * dt,
        slipLimit: 1 - clamp((slip - 0.035) / 0.05, 0, 0.85) };
      const result = gpPedals.apply(this, args);
      Object.assign(receipt, { actualThrottle: c.input.throttle, actualBrake: c.input.brake,
        leverThrottleLimit: c.input.brake > 0.05 ? 0.05 : 1 });
      if (activeAI) activeAI.pedals = receipt;
      return result;
    };
    const capacity = d.gpLateralCapacity;
    d.gpLateralCapacity = function (...args) {
      counts[id].gpLateralCapacity++;
      const result = capacity.apply(this, args);
      if (activePhysics) activePhysics.capacity = result;
      return result;
    };
    const gpSteer = d.gpSteer;
    d.gpSteer = function (...args) {
      counts[id].gpSteer++;
      const receipt = { stick: args[0], frontMu: args[1], rearMu: args[2], dt: args[3],
        leanLimit: d.leanLimit, lean: d.lean, leanRate: d.leanRate,
        riderOffset: d.riderOffset, speed: d.speed, frontLoad: d.frontLoad, rearLoad: d.rearLoad,
        previousDrive: d.driveForce, previousFrontBrake: d.frontBrakeForce,
        previousRearBrake: d.rearBrakeForce, measuredLateralAcceleration: g.lateralAcceleration };
      const result = gpSteer.apply(this, args);
      Object.assign(receipt, { steerTarget: result, leanTarget: g.leanTarget,
        lateralDemand: g.lateralDemand, steerTrim: g.steerTrim });
      if (activePhysics) activePhysics.steer = receipt;
      return result;
    };
    const frontSteerFor = g.frontSteerFor, rearForceFor = g.rearForceFor;
    g.frontSteerFor = function (...args) {
      counts[id].frontSteerFor++;
      const result = frontSteerFor.apply(this, args);
      if (activePhysics) activePhysics.frontInverse = { args: [...args], result };
      return result;
    };
    g.rearForceFor = function (...args) {
      counts[id].rearForceFor++;
      const result = rearForceFor.apply(this, args);
      if (activePhysics) activePhysics.rearPreview = { args: [...args], result };
      return result;
    };
  }
  const step = d.step;
  d.step = function (...args) {
    counts[id].physicsStep++;
    const h = args[1], lap = sim.race.laps[id];
    activePhysics = { tick, raceTime: sim.race.raceTime, s: c.s, completed: lap.completed,
      mass: d.mass, input: { ...args[0] }, beforeSpeed: d.speed, beforeLean: d.lean,
      beforeLeanRate: d.leanRate, contactLoads: d.contactLoads ? { ...d.contactLoads } : null };
    const result = step.apply(this, args);
    activePhysics.after = { speed: d.speed, lean: d.lean, leanRate: d.leanRate,
      frontLoad: d.frontLoad, rearLoad: d.rearLoad, frontUse: d.frontUse, rearUse: d.rearUse,
      frontGrip: d.frontGrip, rearGrip: d.rearGrip, grip: d.grip, drive: d.driveForce,
      frontBrake: d.frontBrakeForce, rearBrake: d.rearBrakeForce, intervention: d.intervention,
      rearSlip: d.rearSlip, pitch: d.pitch, slope: d.slope, state: d.state,
      lateralAcceleration: g?.lateralAcceleration, lateralSpeed: g?.lateralSpeed,
      lateralDemand: g?.lateralDemand, leanTarget: g?.leanTarget, frontFy: g?.frontFy,
      rearFy: g?.rearFy, yawRate: g?.yawRate, groundSteer: g?.groundSteer };
    latestPhysics[id] = activePhysics;
    if (sim.race.phase === PHASE.RACING && c.finishTime === 0) {
      const key = `${id}:${lap.completed}:${Math.floor(c.s / 100)}`;
      let z = aggregates.get(key);
      if (!z) aggregates.set(key, z = { id, lapIndex: lap.completed, stationBin: Math.floor(c.s / 100),
        seconds: 0, steps: 0, speedIntegral: 0, throttleIntegral: 0, brakeIntegral: 0,
        driveIntegral: 0, requestedDriveIntegral: 0, trafficBindingSeconds: 0, planBindingSeconds: 0,
        highDemandSeconds: 0, driveCutSeconds: 0, steeringClipSeconds: 0, lowFrontSeconds: 0,
        slipThrottleSeconds: 0, steeringThrottleSeconds: 0, leverThrottleSeconds: 0,
        lateralErrorIntegral: 0, reactionIntegral: 0, frontUseIntegral: 0, rearUseIntegral: 0 });
      z.seconds += h; z.steps++;
      z.speedIntegral += h * d.speed; z.throttleIntegral += h * c.input.throttle;
      z.brakeIntegral += h * c.input.brake; z.driveIntegral += h * d.driveForce;
      z.requestedDriveIntegral += h * (args[0].drive ?? 0);
      z.trafficBindingSeconds += a.trafficSpeed < Math.min(a.freeSpeed, a.planLimit) - 1 ? h : 0;
      z.planBindingSeconds += a.planLimit < Math.min(a.freeSpeed, a.trafficSpeed) - 1 ? h : 0;
      z.highDemandSeconds += g && g.lateralDemand >= 2 * G - 1e-9 ? h : 0;
      z.driveCutSeconds += (args[0].drive ?? 0) > d.driveForce + 100 ? h : 0;
      const control = activePhysics.steer;
      z.steeringClipSeconds += control && Math.abs(control.stick) * control.leanLimit - Math.abs(control.leanTarget) > 0.02 ? h : 0;
      z.lowFrontSeconds += d.frontLoad < 0.25 * d.mass * G * d.p.cgToRear / d.p.wheelbase ? h : 0;
      const ai = latestAI[id], pedals = ai?.pedals, steering = ai?.steeringThrottle;
      if (pedals && steering) {
        const raw = Math.min(pedals.commandThrottle, pedals.openingLimit);
        z.slipThrottleSeconds += pedals.slipLimit < raw - 0.05 ? h : 0;
        z.steeringThrottleSeconds += steering.result < Math.min(raw, pedals.slipLimit) - 0.05 ? h : 0;
        z.leverThrottleSeconds += pedals.actualBrake > 0.05 && Math.min(raw, pedals.slipLimit, steering.result) > 0.1 ? h : 0;
      }
      z.lateralErrorIntegral += h * Math.abs(c.lateral - a.steeringTarget);
      z.reactionIntegral += h * (d.frontLoad + d.rearLoad) / d.mass;
      z.frontUseIntegral += h * d.frontUse; z.rearUseIntegral += h * d.rearUse;
    }
    activePhysics = null;
    return result;
  };
  for (const [obj, name] of [[c, 'impactAt'], [d, 'fall']]) {
    const original = obj[name];
    if (typeof original !== 'function') continue;
    obj[name] = function (...args) {
      incidents.push({ tick, id, method: name, args: [...args], raceTime: sim.race.raceTime,
        s: c.s, completed: sim.race.laps[id].completed, finishTime: c.finishTime,
        stateBefore: d.state, speed: d.speed });
      return original.apply(this, args);
    };
  }
}
const riderConstants = sim.cars.map(c => ({ id: c.id, definition: c.definition.id,
  bike: { ...c.dynamics.p }, assists: { ...c.dynamics.assists }, skill: sim.ai[c.id].skill,
  personality: { ...sim.ai[c.id].personality } }));
const stopped = new Float64Array(vehicles.length);
let longestStop = 0, previousPhase = sim.race.phase;
const previousLap = sim.race.laps.map(lap => ({ completed: lap.completed, sector: lap.sector, active: lap.active }));
const start = performance.now();
for (; tick < 120 * 400 && sim.race.phase !== PHASE.FINISHED; tick++) {
  sim.step(1 / 120);
  if (sim.race.phase !== previousPhase) {
    phaseEvents.push({ tick, time: sim.race.time, raceTime: sim.race.raceTime,
      from: previousPhase, to: sim.race.phase });
    previousPhase = sim.race.phase;
  }
  for (const c of sim.cars) {
    const lap = sim.race.laps[c.id], prior = previousLap[c.id];
    if (lap.completed !== prior.completed || lap.sector !== prior.sector || lap.active !== prior.active) {
      timing.push({ tick, id: c.id, time: sim.race.time, raceTime: sim.race.raceTime,
        s: c.s, active: lap.active, completed: lap.completed, sector: lap.sector,
        lapStart: lap.lapStart, lapTime: lap.lapTime, sectorStart: lap.sectorStart,
        sectors: [...lap.sectors], best: lap.best, last: lap.last,
        lastCrossingTime: lap.lastCrossingTime, lastSectors: [...lap.lastSectors],
        lastValid: lap.lastValid, lastAssisted: lap.lastAssisted, lastPenalty: lap.lastPenalty,
        valid: lap.valid, finishTime: c.finishTime });
      Object.assign(prior, { completed: lap.completed, sector: lap.sector, active: lap.active });
    }
    if (tick % 12 === 0 && sim.race.phase === PHASE.RACING) {
      samples.push({ tick, time: sim.race.time, raceTime: sim.race.raceTime, ...pose(c),
        lapStart: lap.lapStart, lapTime: lap.lapTime, lapValid: lap.valid,
        sector: lap.sector, best: lap.best, lapDistance: lap.distance,
        input: { ...c.input }, gear: c.gear, rpm: c.rpm, fuel: c.fuel,
        frontHealth: c.frontHealth, floorHealth: c.floorHealth, wake: c.wake,
        ai: latestAI[c.id], planner: plannerState(sim.ai[c.id].planner), physics: latestPhysics[c.id] });
    }
  }
  if (sim.race.phase !== PHASE.RACING) continue;
  sim.cars.forEach((c, id) => {
    stopped[id] = c.speed < 1 && !c.finishTime && !c.inPit ? stopped[id] + 1 / 120 : 0;
    longestStop = Math.max(longestStop, stopped[id]);
  });
}
const wallSeconds = (performance.now() - start) / 1000;
const after = verifySource();
const best = sim.race.laps.map(lap => lap.best || Infinity);
const gpBest = Math.min(best[0], best[2], best[4]), sbkBest = Math.min(best[1], best[3], best[5]);
const riders = sim.cars.map(c => ({ ...pose(c), best: sim.race.laps[c.id].best,
  last: sim.race.laps[c.id].last, crashes: c.dynamics.crashes, planner: plannerState(sim.ai[c.id].planner) }));
const checks = { finished: sim.race.phase === PHASE.FINISHED,
  incidentsAtMostThree: riders.reduce((n, c) => n + c.crashes, 0) <= 3,
  allClassified: riders.every(c => !c.retired && c.finishTime > 0 && c.completed === 2),
  longestStopUnderTwenty: longestStop < 20, gpFaster: gpBest < sbkBest,
  gpMarginAbovePoint15: sbkBest - gpBest > 0.15 };
const numericReproduced = Object.is(gpBest, 91.4372396579149) && Object.is(sbkBest, 90.3703801553851);
const sourceStable = before.checkedSha256 === after.checkedSha256;
const result = {
  schema: 'gp-throttle-mixed3303-recording-only-v1', root, scope: 'One original mixed3303 race; observation only',
  source: { whitelistPath, whitelistSha256: sha(whitelistBytes), before, after, sourceStable },
  limits: { dt: 1 / 120, maxTicks: 120 * 400, maxSimulatedSeconds: 400, sampleEveryTicks: 12,
    plannerRecords: 'all GP native evaluations while racing and unfinished',
    physicalAggregates: 'all native substeps while racing and unfinished; bins are 100 m station spans',
    candidateArrayCaution: 'raw planner array tails can be stale; no valid-count inference',
    thresholds: { capGap: 1, driveDifference: 100, clipAngle: 0.02, throttleDifference: 0.05 },
    thresholdPurpose: 'offline classification only; none changes simulation behavior' },
  observerSha256: sha(readFileSync(new URL(import.meta.url))), options, trackLength: sim.track.length,
  constants: { G, GP_ASSIST, GP_AI_HANDS, riders: riderConstants },
  outcome: { ticks: tick, raceSeconds: sim.race.raceTime, time: sim.race.time, wallSeconds,
    best, gpBest, sbkBest, gpAdvantage: sbkBest - gpBest, longestStop, checks,
    originalRaceAccepted: Object.values(checks).every(Boolean), numericReproduced,
    expected: { gpBest: 91.4372396579149, sbkBest: 90.3703801553851 }, riders },
  counts, phaseEvents, timing, incidents, aggregates: [...aggregates.values()], planning, samples,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, (_key, value) =>
  typeof value === 'number' && !Number.isFinite(value) ? String(value) : value) + '\n');
console.log(JSON.stringify({ output, sourceStable, numericReproduced, checks,
  originalRaceAccepted: result.outcome.originalRaceAccepted, gpBest, sbkBest,
  gpAdvantage: result.outcome.gpAdvantage, longestStop, wallSeconds,
  samples: samples.length, planning: planning.length, timing: timing.length, counts }));
process.exitCode = sourceStable && numericReproduced ? 0 : 1;
