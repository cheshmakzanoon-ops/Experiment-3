import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [rootArg, outputArg, observerArg, variant, originalGuardArg] = process.argv.slice(2);
const root = resolve(rootArg), output = resolve(outputArg), observerRoot = resolve(observerArg);
const load = (base, path) => import(pathToFileURL(resolve(base, path)).href);
const { Simulation } = await load(root, 'src/simulation/world.ts');
const { DEFAULT_OPTIONS } = await load(root, 'src/simulation/config.ts');
const { PHASE } = await load(root, 'src/simulation/race.ts');
const { Bike, GP_ASSIST } = await load(root, 'src/simulation/bike.ts');
const { MotoGPChassis: Observer } = await load(observerRoot, 'src/simulation/motogp-physics.ts');
const { gpHangOffAngle } = await load(root, 'src/simulation/motogp-physics.ts');
const { clamp, G, mod } = await load(root, 'src/core/math.ts');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const own = object => Object.fromEntries(Object.entries(object).filter(([key, value]) => key !== 'motoGP' && typeof value !== 'function'));
const sourceFiles = ['src/simulation/bike.ts', 'src/simulation/motogp-physics.ts', 'src/simulation/bike-ai.ts', 'src/simulation/bike-vehicle.ts', 'src/simulation/ai.ts', 'src/simulation/traffic.ts', 'src/simulation/world.ts'];
const observerFiles = ['src/simulation/motogp-physics.ts', 'src/simulation/tyre-force.ts', 'src/simulation/motorcycle-thermal.ts', 'src/core/math.ts'];
const sourceHashes = () => ({ main: Object.fromEntries(sourceFiles.map(p => [p, hash(readFileSync(resolve(root, p)))])), observer: Object.fromEntries(observerFiles.map(p => [p, hash(readFileSync(resolve(observerRoot, p)))])) });
const sourcesBefore = sourceHashes(), scriptHash = hash(readFileSync(fileURLToPath(import.meta.url)));
const originalGuardPath = resolve(originalGuardArg), originalGuardBytes = readFileSync(originalGuardPath), originalGuard = JSON.parse(originalGuardBytes);
const originalLogPath = originalGuardPath.replace(/\.json$/, '.log'), originalLogBytes = readFileSync(originalLogPath);
if (originalGuard.phase !== 'complete' || !originalGuard.sourceStable || originalGuard.passed || hash(originalLogBytes) !== originalGuard.logSha256) throw new Error('Expected the exact stable original mixed pace-failure receipt');
const originalPair = originalLogBytes.toString('utf8').match(/expected ([\d.]+) to be less than ([\d.]+)/);
if (!originalPair) throw new Error('Original fastest-valid class-lap assertion is missing');
const expectedGP = Number(originalPair[1]), expectedSBK = Number(originalPair[2]);
const originalRun = { receiptPath: originalGuardPath, receiptSha256: hash(originalGuardBytes), logPath: originalLogPath, logSha256: hash(originalLogBytes), sourceManifestSha256: originalGuard.sourceManifestSha256, expectedFastestValidGP: expectedGP, expectedFastestValidSuperbike: expectedSBK, originalAssertion: 'GP fastest valid lap must be less than Superbike fastest valid lap', subsequentPoint15AssertionReached: false };

const DT = 1 / 120, BIN_METRES = 50, TRIAL_TICKS = 12;
const vehicles = ['gpr1', 'sbk1000', 'gpr1', 'sbk1000', 'gpr1', 'sbk1000'];
const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit: 'vellamar', mode: 'race', ruleset: 'gp-motorcycle', laps: 2, opponents: 5, vehicles, seed: 3303 });
sim.autoPlayer = true;
let tick = 0, observations = 0, trialPairs = 0, baselineTrialExact = 0;
const bins = new Map(), lapEvents = [], trialRecords = [], fixtureMap = new Map(), current = Array(6).fill(null);
const counts = Array.from({ length: 6 }, () => ({ realBikeSteps: 0, realControlCalls: 0, realPlantCalls: 0 }));
function bucket(id, lap, station) {
  const start = Math.floor(mod(station, sim.track.length) / BIN_METRES) * BIN_METRES;
  const key = `${id}/${lap}/${start}`;
  if (!bins.has(key)) bins.set(key, { id, lap, stationStart: start, timeSeconds: 0, trajectorySamples: 0, speedSum: 0, speedMin: Infinity, speedMax: 0, targetSum: 0, freeSum: 0, trafficSum: 0, planSum: 0, planNextSum: 0, trafficLimited: 0, planLimited: 0, throttleBelowHalf: 0, braking: 0, tractionCut: 0, passActive: 0, trafficReasons: {}, controlSamples: 0, driveRequestedImpulse: 0, driveAppliedImpulse: 0, frontBrakeImpulse: 0, rearBrakeImpulse: 0, historicalWins: 0, extraCurrentSamples: 0, sampledCurrentWouldWin: 0, currentHistoryLarger: 0, currentHistorySmaller: 0, historicalSum: 0, poseSum: 0, demandSum: 0, currentHistorySum: 0, reserveDeltaSum: 0, historicalWinningMarginSum: 0, trialSamples: 0, trialPedalChanged: 0, trialReleasedNetForce: 0, trialReducedNetForce: 0, trialNetForceDeltaSum: 0, trialNetForceDeltaMin: 0, trialNetForceDeltaMax: 0 });
  return bins.get(key);
}
function saveExtreme(key, score, fixture) {
  const old = fixtureMap.get(key);
  if (!old || score > old.score) fixtureMap.set(key, { score, fixture });
}
function cloneBike(fixture, lateral) {
  const b = new Bike(structuredClone(fixture.bike.assists), structuredClone(fixture.bike.p));
  Object.assign(b, structuredClone(fixture.bike));
  b.enableMotoGPPhysics(structuredClone(fixture.gp.geometry));
  Object.assign(b.motoGP, structuredClone(fixture.gp));
  // Re-enter the original native step immediately before its contact/rider/bar
  // work, while freezing the already resolved controller result and memory.
  b.riderOffset = fixture.riderOffsetBefore;
  b.steer = fixture.steerBefore;
  let phasePending = false, reserveValue = lateral, boundaryExact = false;
  b.gpSteer = () => { phasePending = true; return fixture.barRequest; };
  Object.defineProperty(b.motoGP, 'lateralAcceleration', {
    configurable: true, enumerable: true,
    get() {
      if (phasePending) {
        phasePending = false;
        boundaryExact = JSON.stringify(own(b)) === JSON.stringify(fixture.bike)
          && b.motoGP.leanTarget === fixture.gp.leanTarget
          && b.motoGP.lateralDemand === fixture.gp.lateralDemand
          && b.motoGP.steerTrim === fixture.gp.steerTrim;
        if (!boundaryExact) throw new Error('Allocation replay failed the exact post-bar/pre-pedal boundary');
      }
      return reserveValue;
    },
    set(value) { reserveValue = value; },
  });
  let plantInput = null;
  const plant = b.motoGP.step;
  b.motoGP.step = function (q) { plantInput = { ...q }; return plant.call(this, q); };
  b.step(structuredClone(fixture.input), fixture.dt);
  if (!plantInput || plantInput.steer !== fixture.committedBar) throw new Error('Allocation replay changed the committed bar');
  return { plantInput, boundaryExact, postStep: { speed: b.speed, lean: b.lean, leanRate: b.leanRate, state: b.state, crashes: b.crashes }, finalDemand: b.motoGP.lateralDemand };
}

// Add only observations to the sealed recorder: native fall attribution,
// marshal ordering and the previously slow GP2 second-lap window.
const nativeFallCalls = Array(6).fill(0), fallEvents = [], marshalTransitions = [], gp2Timeline = [];
let additionalObservationCount = 0, lastMarshalKey = null;
function physicalFrame() {
  return JSON.stringify(sim.cars.map(c => ({ bike: own(c.dynamics), gp: c.dynamics.motoGP ? own(c.dynamics.motoGP) : null })));
}
function carObservation(c) {
  const b = c.dynamics, a = sim.ai[c.id];
  return { id: c.id, lap: sim.race.laps[c.id].completed, s: c.s, speed: c.speed, coreSpeed: b.speed, state: b.state, crashes: b.crashes, impact: c.impact, contactCrash: c.contactCrash, lean: b.lean, leanRate: b.leanRate, bar: b.steer, frontLoad: b.frontLoad, rearLoad: b.rearLoad, target: c.aiTarget, free: a.freeSpeed, traffic: a.trafficSpeed, plan: a.planLimit, next: a.planNext, decision: a.decision, limitedBy: a.planner.limitedBy, input: { ...c.input } };
}
function observedRace() {
  const before = physicalFrame();
  const value = { tick, time: sim.race.time, raceTime: sim.race.raceTime, phase: sim.race.phase, flags: Array.from(sim.race.control.flags), cars: sim.cars.map(carObservation) };
  const after = physicalFrame();
  if (before !== after) throw new Error('Additional race observation changed physical state');
  additionalObservationCount++;
  return { ...value, liveBeforeSha256: hash(before), liveAfterSha256: hash(after) };
}
for (const car of sim.cars) {
  const bike = car.dynamics, nativeFall = bike.fall;
  bike.fall = function (...args) {
    const before = physicalFrame();
    const entry = { id: car.id, tick, substep: current[car.id]?.substep ?? null, arguments: structuredClone(args), before: carObservation(car), raceBefore: observedRace(), controllerPhase: current[car.id]?.phase ?? null, selectedControl: current[car.id] ? structuredClone(current[car.id]) : null, bikeBefore: structuredClone(own(this)), gpBefore: this.motoGP ? structuredClone(own(this.motoGP)) : null, callSite: new Error().stack };
    const afterObservation = physicalFrame();
    if (before !== afterObservation) throw new Error('Native fall observation changed physical state');
    entry.liveBeforeSha256 = hash(before); entry.liveAfterSha256 = hash(afterObservation);
    // Invoke the original once, preserving this, arguments, return and throws.
    nativeFallCalls[car.id]++;
    const returned = nativeFall.apply(this, args);
    entry.after = carObservation(car);
    entry.ridingToFallen = entry.before.state === 'riding' && entry.after.state !== 'riding';
    fallEvents.push(entry);
    return returned;
  };
}
function observeOuterStep() {
  const events = sim.race.control.events.slice(-24).map(e => ({ ...e }));
  const key = JSON.stringify({ flags: Array.from(sim.race.control.flags), events, nativeFallCalls });
  const changed = key !== lastMarshalKey;
  const focus = sim.race.laps[2].completed === 1 && sim.cars[2].s >= 1750 && sim.cars[2].s <= 2300;
  if (!changed && !focus) return;
  const row = observedRace();
  if (changed) { marshalTransitions.push({ ...row, events, nativeFallCalls: [...nativeFallCalls] }); lastMarshalKey = key; }
  if (focus) gp2Timeline.push({ ...row, marshalTransition: marshalTransitions.length - 1, nativeFallCalls: [...nativeFallCalls] });
}

for (const id of [0, 2, 4]) {
  const car = sim.cars[id], driver = sim.ai[id], bike = car.dynamics, gp = bike.motoGP;
  let lateral = gp.lateralAcceleration;
  Object.defineProperty(gp, 'lateralAcceleration', {
    configurable: true,
    enumerable: true,
    get() {
      const pending = current[id];
      if (pending?.phase === 'awaitReserve') {
        pending.phase = 'observingReserve';
        const pose = G * Math.tan(Math.min(1.3, Math.max(Math.abs(bike.lean + gpHangOffAngle(bike.riderOffset, bike.p.cgHeight)), Math.abs(gp.leanTarget))));
        const historical = Math.abs(lateral), demand = gp.lateralDemand;
        const winnerMargin = historical - Math.max(pose, demand);
        const reserve = { historical, pose, demand, winnerMargin, oldMaxTerm: Math.max(historical, pose, demand), historicalWins: winnerMargin > 0, committedBar: bike.steer, signedHistory: { total: lateral, frontFy: gp.frontFy, rearFy: gp.rearFy, frontStiffness: gp.frontElasticStiffness, rearStiffness: gp.rearElasticStiffness }, current: null };
        pending.reserve = reserve;
        if (reserve.historicalWins || tick % TRIAL_TICKS === 0 && pending.substep === 2) {
          const liveBefore = JSON.stringify(own(gp));
          const state = structuredClone(own(gp));
          const observer = Object.assign(new Observer(structuredClone(gp.geometry)), structuredClone(state));
          const staticFront = bike.mass * G * bike.p.cgToRear / bike.p.wheelbase + (bike.p.downforce ?? 0) * bike.speed * bike.speed * (bike.p.downforceFront ?? 0.6);
          const q = { speed: bike.speed, mass: bike.mass, lean: bike.lean, steer: bike.steer, frontLoad: bike.frontLoad, rearLoad: bike.rearLoad, frontMu: bike.p.mu * (bike.frontGrip ?? bike.grip), rearMu: bike.p.mu * (bike.rearGrip ?? bike.grip), frontFx: -bike.frontBrakeForce, rearFx: bike.driveForce - bike.rearBrakeForce, frontContact: clamp(bike.frontLoad / Math.max(1, 0.05 * staticFront), 0, 1) };
          const value = observer.currentLateralAcceleration(q);
          const liveAfter = JSON.stringify(own(gp));
          if (liveBefore !== liveAfter) throw new Error('Current-force query changed the live GP state');
          observations++;
          reserve.current = { value, magnitude: Math.abs(value), q, liveBeforeSha256: hash(liveBefore), liveAfterSha256: hash(liveAfter), prospectiveMaxTerm: Math.max(Math.abs(value), pose, demand), maxTermDelta: Math.max(Math.abs(value), pose, demand) - reserve.oldMaxTerm };
          if (tick % TRIAL_TICKS === 0 && pending.substep === 2 && (reserve.historicalWins || reserve.current.maxTermDelta > 0)) {
            const fixture = { id, tick, substep: pending.substep, time: sim.race.time, s: car.s, lap: sim.race.laps[id].completed, phase: 'actual committed bar, first native pre-pedal lateralNow read', dt: pending.dt, input: { ...pending.input }, riderOffsetBefore: pending.riderOffsetBefore, steerBefore: pending.steerBefore, committedBar: bike.steer, barRequest: pending.barRequest, reserve, bike: structuredClone(own(bike)), gp: state, plan: { target: car.aiTarget, free: driver.freeSpeed, traffic: driver.trafficSpeed, limit: driver.planLimit, next: driver.planNext, runway: driver.planRunway, recovery: driver.planRecovery, decision: car.aiDecision ?? driver.decision, trafficRule: driver.planner.limitedBy, blocker: driver.planner.blocker, passTarget: driver.planner.passTarget } };
            if (reserve.historicalWins) pending.fixture = fixture;
            else pending.currentWouldWinFixture = fixture;
          }
        }
        pending.phase = 'reserveObserved';
      }
      return lateral;
    },
    set(value) { lateral = value; },
  });
  const roll = bike.gpSteer;
  bike.gpSteer = function (...args) {
    counts[id].realControlCalls++;
    const result = roll.apply(this, args), pending = current[id];
    if (pending && pending.inRace) { pending.barRequest = result; pending.phase = 'awaitReserve'; }
    return result;
  };
  const plant = gp.step;
  gp.step = function (q) {
    counts[id].realPlantCalls++;
    if (current[id]) current[id].plantInput = { ...q };
    return plant.call(this, q);
  };
  const step = bike.step;
  bike.step = function (input, dt) {
    counts[id].realBikeSteps++;
    const substep = (current[id]?.tick === tick ? current[id].substep : 0) + 1;
    const pending = current[id] = { tick, substep, dt, input: { ...input }, riderOffsetBefore: this.riderOffset, steerBefore: this.steer, phase: 'beforeControl', inRace: sim.race.phase === PHASE.RACING && !car.finishTime, lap: sim.race.laps[id].completed, station: car.s };
    const value = step.call(this, input, dt);
    if (!pending.inRace || !pending.reserve || !pending.plantInput) return value;
    const b = bucket(id, pending.lap, pending.station), r = pending.reserve, q = pending.plantInput;
    b.controlSamples++;
    b.driveRequestedImpulse += Math.max(0, input.drive ?? 0) * dt;
    b.driveAppliedImpulse += Math.max(0, q.rearFx) * dt;
    b.frontBrakeImpulse += Math.max(0, -q.frontFx) * dt;
    b.rearBrakeImpulse += Math.max(0, -q.rearFx) * dt;
    b.historicalSum += r.historical; b.poseSum += r.pose; b.demandSum += r.demand;
    if (r.current && !r.historicalWins) {
      b.extraCurrentSamples++;
      if (r.current.magnitude > Math.max(r.historical, r.pose, r.demand)) b.sampledCurrentWouldWin++;
    }
    if (r.historicalWins) {
      b.historicalWins++;
      b.currentHistorySum += r.current.magnitude;
      b.historicalWinningMarginSum += r.winnerMargin;
      b.reserveDeltaSum += r.current.maxTermDelta;
      if (r.current.magnitude > r.historical) b.currentHistoryLarger++;
      if (r.current.magnitude < r.historical) b.currentHistorySmaller++;
    }
    if (pending.currentWouldWinFixture) saveExtreme(`${id}/largestNewCurrentWinner`, pending.currentWouldWinFixture.reserve.current.maxTermDelta, { ...pending.currentWouldWinFixture, originalPlantInput: q, allocationTrial: 'not performed; outside historical-winning trial scope' });
    if (pending.fixture) {
      const f = pending.fixture;
      const original = cloneBike(f, f.gp.lateralAcceleration);
      if (JSON.stringify(original.plantInput) !== JSON.stringify(q)) throw new Error(`Original allocation did not reproduce exact plant input at${id}/${tick}/${substep}`);
      baselineTrialExact++; trialPairs++;
      const observed = cloneBike(f, r.current.value);
      const delta = (observed.plantInput.frontFx + observed.plantInput.rearFx) - (q.frontFx + q.rearFx);
      const changed = observed.plantInput.frontFx !== q.frontFx || observed.plantInput.rearFx !== q.rearFx;
      b.trialSamples++; if (changed) b.trialPedalChanged++;
      if (delta > 0) b.trialReleasedNetForce++;
      if (delta < 0) b.trialReducedNetForce++;
      b.trialNetForceDeltaSum += delta;
      b.trialNetForceDeltaMin = Math.min(b.trialNetForceDeltaMin, delta);
      b.trialNetForceDeltaMax = Math.max(b.trialNetForceDeltaMax, delta);
      const result = { id, tick, substep, time: sim.race.time, lap: pending.lap, s: pending.station, historical: r.historical, current: r.current.magnitude, pose: r.pose, demand: r.demand, signedHistory: r.signedHistory, currentQuery: r.current.q, oldReserveTerm: r.oldMaxTerm, currentReserveTerm: r.current.prospectiveMaxTerm, originalFx: { front: q.frontFx, rear: q.rearFx }, currentHistoryFx: { front: observed.plantInput.frontFx, rear: observed.plantInput.rearFx }, netForceDelta: delta, pedalChanged: changed, barUnchanged: true, originalNativePlantInputExact: true, allocationBoundaryExact: original.boundaryExact && observed.boundaryExact };
      trialRecords.push(result);
      if (delta > 0) saveExtreme(`${id}/largestReleasedForce`, delta, { ...f, result });
      if (delta < 0) saveExtreme(`${id}/largestReducedForce`, -delta, { ...f, result });
      saveExtreme(`${id}/largestCurrentHistoryIncrease`, r.current.magnitude - r.historical, { ...f, result });
      if (changed && !fixtureMap.has(`${id}/firstUsablePedalDifference`)) fixtureMap.set(`${id}/firstUsablePedalDifference`, { score: Math.abs(delta), fixture: { ...f, result } });
    }
    return value;
  };
}
const priorLaps = Array(6).fill(0), stopped = new Float64Array(6);
let longestStop = 0;
for (tick = 0; tick < 120 * 400 && sim.race.phase !== PHASE.FINISHED; tick++) {
  sim.step(DT);
  observeOuterStep();
  if (sim.race.phase !== PHASE.RACING) continue;
  for (const car of sim.cars) {
    const id = car.id, driver = sim.ai[id], bike = car.dynamics, lap = sim.race.laps[id];
    stopped[id] = car.speed < 1 && !car.finishTime && !car.inPit ? stopped[id] + DT : 0;
    longestStop = Math.max(longestStop, stopped[id]);
    if (lap.completed !== priorLaps[id]) { lapEvents.push({ id, tick, time: sim.race.time, completed: lap.completed, last: lap.last, best: lap.best, sectors: [...lap.lastSectors], valid: lap.lastValid }); priorLaps[id] = lap.completed; }
    if (car.finishTime) continue;
    const b = bucket(id, lap.completed, car.s);
    b.timeSeconds += DT; b.trajectorySamples++; b.speedSum += car.speed; b.speedMin = Math.min(b.speedMin, car.speed); b.speedMax = Math.max(b.speedMax, car.speed);
    b.targetSum += car.aiTarget; b.freeSum += driver.freeSpeed; b.trafficSum += driver.trafficSpeed; b.planSum += driver.planLimit; b.planNextSum += driver.planNext;
    if (driver.trafficSpeed < Math.min(driver.freeSpeed, driver.planLimit) - 1e-6) b.trafficLimited++;
    if (driver.planLimit < driver.trafficSpeed && driver.planLimit < driver.freeSpeed) b.planLimited++;
    if (car.input.throttle < 0.5) b.throttleBelowHalf++;
    if (car.input.brake > 0.05) b.braking++;
    if (bike.intervention > 0.05) b.tractionCut++;
    if (driver.planner.blocker >= 0) b.passActive++;
    const reason = driver.planner.limitedBy ?? 'none'; b.trafficReasons[reason] = (b.trafficReasons[reason] ?? 0) + 1;
  }
}
const best = id => sim.race.laps[id].best || Infinity;
const gpBest = Math.min(best(0), best(2), best(4)), sbkBest = Math.min(best(1), best(3), best(5));
const crashes = sim.cars.reduce((n, c) => n + c.dynamics.crashes, 0);
const originalConditions = { finished: sim.race.phase === PHASE.FINISHED, incidentBound: crashes <= 3, allClassified: sim.cars.every(c => !c.retired && c.finishTime > 0 && sim.race.laps[c.id].completed === 2), noStuckRider: longestStop < 20, fasterGP: gpBest < sbkBest, paceMargin: sbkBest - gpBest > 0.15 };
if (!originalConditions.finished || !originalConditions.incidentBound || !originalConditions.allClassified || !originalConditions.noStuckRider) throw new Error('Recording changed original non-pace outcome');
if (variant === '3e58984' && (gpBest !== 92.15861774982307 || sbkBest !== 89.90506409359712)) throw new Error(`Candidate no longer reproduces original lap pair${gpBest}/${sbkBest}`);
if (variant === '7ac509f' && (!originalConditions.fasterGP || !originalConditions.paceMargin)) throw new Error('Baseline no longer reproduces original pace pass');
if (variant !== 'f79c088' || gpBest !== expectedGP || sbkBest !== expectedSBK) throw new Error(`Recording does not reproduce exact original fastest-valid class laps: ${gpBest}/${sbkBest}`);
if (!readFileSync(originalGuardPath).equals(originalGuardBytes) || !readFileSync(originalLogPath).equals(originalLogBytes)) throw new Error('Original comparison receipt changed');

if (JSON.stringify(sourceHashes()) !== JSON.stringify(sourcesBefore) || scriptHash !== hash(readFileSync(fileURLToPath(import.meta.url)))) throw new Error('Recording inputs changed');
const result = { variant, sourceCommit: 'f79c088bba9d407be8273d03f36721b67e7308d3', recorderBaseSha256: '9293a79a0515be29576fbdf97e2f4dae1fa4bfe7d15ae77add21e104694e2ca2', originalRun: { ...originalRun, exactFastestValidClassLapReproduction: true }, additionalObservationCount, allAdditionalLiveHashesEqual: true, nativeFallCalls, fallEvents, marshalTransitions, gp2Timeline, root, observerRoot, sourcesBefore, scriptSha256: scriptHash, sourceStable: true, options: sim.options, sampling: { outerStep: DT, nativeStep: DT / 2, stationBinMetres: BIN_METRES, nativeAllocationTrialEveryOuterTicks: TRIAL_TICKS, trialSubstep: 2, queryScope: 'Every active historical-winning actual pre-pedal reserve read, plus fixed10Hz nonwinning samples to detect current-history becoming the winning max term; deep pure observer clone at committed bar, current loads and prior Fx.', trialScope: 'Fixed10Hz historical-winning subset only; actual controller target, demand, trim and bar request frozen; only historical lateralNow substituted on separate native allocation clone. This is a diagnostic counterfactual, not an accepted allocation policy.' }, gpBest, sbkBest, margin: sbkBest - gpBest, crashes, longestStop, originalConditions, ticks: tick, observations, allLiveQueryHashesEqual: true, trialPairs, originalAllocationReplaysExact: baselineTrialExact, counts, laps: lapEvents, final: sim.cars.map(c => ({ id: c.id, s: c.s, speed: c.speed, state: c.dynamics.state, crashes: c.dynamics.crashes, finishTime: c.finishTime, best: sim.race.laps[c.id].best, completed: sim.race.laps[c.id].completed })), bins: [...bins.values()].sort((a, b) => a.id - b.id || a.lap - b.lap || a.stationStart - b.stationStart), trialRecords, fixtures: [...fixtureMap].map(([label, value]) => ({ label, ...value })) };
writeFileSync(output, JSON.stringify(result) + '\n');
console.log(JSON.stringify({ variant, originalRun: result.originalRun, additionalObservationCount, nativeFallCalls, fallEvents: fallEvents.map(f => ({ id: f.id, tick: f.tick, substep: f.substep, arguments: f.arguments, before: f.before, after: f.after, ridingToFallen: f.ridingToFallen })), marshalTransitions: marshalTransitions.length, gp2Timeline: gp2Timeline.length, gpBest, sbkBest, margin: result.margin, crashes, longestStop, originalConditions, observations, trialPairs, originalAllocationReplaysExact: baselineTrialExact, counts, laps: lapEvents, bins: bins.size, fixtures: result.fixtures.map(f => ({ label: f.label, tick: f.fixture.tick, substep: f.fixture.substep, s: f.fixture.s, result: f.fixture.result })) }, null, 2));
