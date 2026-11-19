import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [rootArg, circuit = 'parco-reale', seedArg = '5074', outputArg] = process.argv.slice(2);
const root = resolve(rootArg), output = resolve(outputArg);
const load = p => import(pathToFileURL(resolve(root, p)).href);
const { Simulation } = await load('src/simulation/world.ts');
const { DEFAULT_OPTIONS } = await load('src/simulation/config.ts');
const { PHASE } = await load('src/simulation/race.ts');
const { G, clamp } = await load('src/core/math.ts');
const { GP_ASSIST } = await load('src/simulation/bike.ts');
const { MotoGPChassis, gpHangOffAngle, gpRollInertia, gpSpinPerSpeed } = await load('src/simulation/motogp-physics.ts');

const vehicles = ['gpr1', 'sbk1000', 'gpr1', 'sbk1000', 'gpr1', 'sbk1000'];
const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit, mode: 'race', ruleset: 'gp-motorcycle', laps: 2, opponents: 5, vehicles, seed: Number(seedArg) });
sim.autoPlayer = true;
let tick = 0;
const substeps = Array(6).fill(0), falls = [], histories = Array.from({ length: 6 }, () => ({ rows: Array(960), cursor: 0, count: 0 }));
const current = Array(6).fill(null), encodings = Array(6).fill(null), nativeProofs = Array(6).fill(null);
const nativeCallCounts = Array.from({ length: 6 }, () => ({ bikeSteps: 0, rollCalls: 0, plantSteps: 0, observations: 0 }));
function body(id) {
  const c = sim.cars[id], d = c.dynamics, a = sim.ai[id], gp = d.motoGP;
  return { id, tick, substep: substeps[id], time: sim.race.time, s: c.s, lateral: c.lateral,
    speed: d.speed, heading: d.heading, lean: d.lean, leanRate: d.leanRate, riderOffset: d.riderOffset, steer: d.steer,
    state: d.state, crashes: d.crashes, impact: c.impact, input: { ...c.input },
    mass: d.mass, grip: d.grip, frontGrip: d.frontGrip, rearGrip: d.rearGrip, frontLoad: d.frontLoad, rearLoad: d.rearLoad,
    contacts: d.contactLoads ? { ...d.contactLoads } : null,
    drive: d.driveForce, frontBrake: d.frontBrakeForce, rearBrake: d.rearBrakeForce,
    longitudinal: d.longitudinal, intervention: d.intervention, frontUse: d.frontUse, rearUse: d.rearUse,
    target: c.aiTarget, offset: c.aiOffset, decision: a.decision, trafficRule: a.planner.limitedBy,
    blocker: a.planner.blocker, passTarget: a.planner.passTarget, finishTime: c.finishTime,
    lap: sim.race.laps[id].completed, planRunway: a.planRunway, planLimit: a.planLimit,
    planNext: a.planNext, planDistance: a.planDistance, planRecovery: a.planRecovery, correction: a.steeringCorrection,
    rawPath: a.gpPathAcceleration, leanLimit: d.leanLimit, encoding: encodings[id],
    gpAdmission: gp ? { admittedSupportRatio: d.gpAdmittedSupportRatio, reserveTarget: d.gpReserveTarget } : null,
    gp: gp ? { storedAcceleration: gp.lateralAcceleration, demand: gp.lateralDemand, target: gp.leanTarget,
      frontFy: gp.frontFy, rearFy: gp.rearFy, yawRate: gp.yawRate, lateralSpeed: gp.lateralSpeed,
      frontElasticStiffness: gp.frontElasticStiffness, rearElasticStiffness: gp.rearElasticStiffness,
      steerTrim: gp.steerTrim, frontOmega: gp.frontOmega, rearOmega: gp.rearOmega } : null,
    road: { airborne: c.roadSuspension.airborne, pitch: c.roadSuspension.pitch, roadPitch: c.roadPitch, contactCrash: c.contactCrash } };
}
function store(id, row) {
  const ring = histories[id];
  ring.rows[ring.cursor] = row;
  ring.cursor = (ring.cursor + 1) % ring.rows.length;
  ring.count = Math.min(ring.count + 1, ring.rows.length);
}
function chronological(id) {
  const ring = histories[id], first = (ring.cursor - ring.count + ring.rows.length) % ring.rows.length;
  return Array.from({ length: ring.count }, (_, i) => ring.rows[(first + i) % ring.rows.length]);
}
function serialState(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v !== 'function'));
}
function bikeState(d) {
  return structuredClone(Object.fromEntries(Object.entries(d).filter(([key, value]) => key !== 'motoGP' && typeof value !== 'function')));
}
for (const c of sim.cars) {
  const id = c.id, d = c.dynamics, a = sim.ai[id], gp = d.motoGP;
  const steerIntent = a.steerIntent;
  a.steerIntent = function (...args) {
    const before = { speed: d.speed, reaction: (d.frontLoad + d.rearLoad) / d.mass, leanLimit: d.leanLimit };
    const result = steerIntent.apply(this, args);
    encodings[id] = { ...before, intent: result, rawPath: this.gpPathAcceleration,
      decoded: before.reaction * Math.tan(result * before.leanLimit) };
    return result;
  };
  if (gp) {
    const probe = new MotoGPChassis(gp.geometry), nativeRoll = d.gpSteer, nativePlant = gp.step,
      nativeInverse = gp.frontSteerFor, nativeRear = gp.rearForceFor;
    const nativeHistory = gp.currentLateralAcceleration;
    if (typeof nativeHistory !== 'function') throw new Error('Current-history source required');
    gp.currentLateralAcceleration = function (q) {
      const result = nativeHistory.call(this, q);
      if (current[id]) current[id].nativeCurrentHistory = { q: { ...q }, result };
      return result;
    };
    gp.frontSteerFor = function (...args) {
      const result = nativeInverse.apply(this, args);
      if (current[id]) current[id].frontInverse = { args, result, steerTrim: this.steerTrim, lateralSpeed: this.lateralSpeed, yawRate: this.yawRate };
      return result;
    };
    gp.rearForceFor = function (...args) {
      const result = nativeRear.apply(this, args);
      if (current[id]) current[id].rearPreview = { args, result };
      return result;
    };
    gp.step = function (q) {
      nativeCallCounts[id].plantSteps++;
      const row = current[id];
      if (row) {
        const inverse = row.frontInverse;
        row.plant = { q: { ...q }, preState: null };
        if ((inverse && Math.abs(inverse.args[3] - q.frontFx) > 100) || Math.abs(row.observation?.difference ?? 0) > 1 || Math.abs(d.leanRate) > 0.6 || Math.abs(d.gpReserveTarget - gp.leanTarget) > 0.01)
          row.plant.preState = structuredClone(serialState(this));
        else delete row.entryState;
      }
      const result = nativePlant.call(this, q);
      if (row) row.plant.after = { frontFy: this.frontFy, rearFy: this.rearFy, acceleration: this.lateralAcceleration,
        yawRate: this.yawRate, lateralSpeed: this.lateralSpeed, frontOmega: this.frontOmega, rearOmega: this.rearOmega, forwardSpeed: this.forwardSpeed };
      return result;
    };
    d.gpSteer = function (stick, frontMu, rearMu, dt) {
      nativeCallCounts[id].rollCalls++;
      // Copy state into a separate native plant. A positive subnormal dt
      // gives exactly zero representable relaxation increment, so this is
      // native current preparation of stored strain, never a controller edit.
      Object.assign(probe, structuredClone(serialState(gp)));
      const p = this.p, m = this.mass, v = this.speed,
        staticFront = m * G * p.cgToRear / p.wheelbase + (p.downforce ?? 0) * v * v * (p.downforceFront ?? 0.6);
      const q = { dt: Number.MIN_VALUE, speed: v, mass: m, lean: this.lean, steer: this.steer,
        frontLoad: this.frontLoad, rearLoad: this.rearLoad, frontMu, rearMu,
        frontFx: -this.frontBrakeForce, rearFx: this.driveForce - this.rearBrakeForce,
        frontContact: clamp(this.frontLoad / Math.max(1, 0.05 * staticFront), 0, 1),
        frontBrakeExcess: 0, rearDriveExcess: 0, rearBrakeExcess: 0, inertialContacts: true };
      const saved = structuredClone(serialState(gp));
      probe.step(q);
      nativeCallCounts[id].observations++;
      const reaction = (this.frontLoad + this.rearLoad) / m,
        psi = this.lean + gpHangOffAngle(this.riderOffset, p.cgHeight),
        inertia = gpRollInertia(gp.geometry, m, p.cgHeight),
        gyro = gpSpinPerSpeed(gp.geometry) * v * gp.yawRate * Math.cos(this.lean),
        forecast = acceleration => {
          const rolling = (m * p.cgHeight * (reaction * Math.sin(psi) - acceleration * Math.cos(psi)) - gyro) / inertia;
          return { rolling, rateAhead: this.leanRate + GP_ASSIST.lead * rolling,
            ahead: psi + GP_ASSIST.lead * this.leanRate + 0.5 * GP_ASSIST.lead ** 2 * rolling };
        };
      const observation = { tick, substep: substeps[id], s: c.s, reaction, stick,
        speedReset: Math.abs(v - saved.lastSpeed) > 5,
        decodedPath: reaction * Math.tan(stick * this.leanLimit), rawPath: a.gpPathAcceleration,
        q, stored: gp.lateralAcceleration, current: probe.lateralAcceleration, difference: probe.lateralAcceleration - gp.lateralAcceleration,
        psi, storedForecast: forecast(gp.lateralAcceleration), currentForecast: forecast(probe.lateralAcceleration) };
      if (current[id]) current[id].observation = observation;
      const result = nativeRoll.call(this, stick, frontMu, rearMu, dt);
      observation.nativeCurrent = current[id]?.nativeCurrentHistory?.result;
      observation.activeForecast = forecast(observation.nativeCurrent);
      observation.currentProbeEqualsNative = Object.is(observation.current, observation.nativeCurrent);
      observation.actualAdmittedSupportRatio = this.gpAdmittedSupportRatio;
      observation.actualReserveTarget = this.gpReserveTarget;
      observation.actualTarget = gp.leanTarget;
      if (current[id]) current[id].rollResult = { steer: result, target: gp.leanTarget, demand: gp.lateralDemand, trim: gp.steerTrim };
      // Last complete native inputs support offline replay at the onset.
      nativeProofs[id] = { q, gp: saved, current: probe.lateralAcceleration, nativeCurrentHistory: current[id]?.nativeCurrentHistory, parameters: { ...p }, observation };
      return result;
    };
  }
  const nativeStep = d.step, nativeFall = d.fall;
  d.step = function (input, dt) {
    substeps[id]++;
    nativeCallCounts[id].bikeSteps++;
    const row = { before: body(id), input: { ...input }, dt };
    if (gp) row.entryState = { bike: bikeState(this), gp: structuredClone(serialState(gp)) };
    current[id] = row;
    store(id, row);
    const result = nativeStep.call(this, input, dt);
    row.after = body(id);
    current[id] = null;
    return result;
  };
  d.fall = function (reason) {
    if (this.state !== 'riding') return nativeFall.call(this, reason);
    const at = body(id), priorCrashes = this.crashes, proof = nativeProofs[id], callSite = new Error().stack,
      proofIsCurrent = !!current[id]?.observation && proof?.observation.tick === tick && proof?.observation.substep === substeps[id],
      cars = sim.cars.map((_, other) => body(other));
    const result = nativeFall.call(this, reason);
    if (this.crashes > priorCrashes)
      falls.push({ id, reason, at, after: body(id), callSite, nativeProof: proof, proofIsCurrent, cars });
    return result;
  };
}
for (; tick < 120 * 400 && sim.race.phase !== PHASE.FINISHED; tick++) {
  substeps.fill(0);
  sim.step(1 / 120);
  if (falls.length) break;
}
const files = ['src/simulation/bike-ai.ts', 'src/simulation/bike-vehicle.ts', 'src/simulation/bike.ts', 'src/simulation/motogp-physics.ts'];
const result = { scope: 'Recording-only, stopped after first original-race fall; not a completed race gate.',
  controllerForecast: 'Native current-strain observation and target-only ratio admission are active; storedForecast is the baseline counterfactual. Native reserve target is the pre-admission clamp.',
  serializationNote: 'JSON numeric zero does not retain its sign; all nonfinite numbers and typed arrays are tagged. No production outputs are replaced.',
  root, sourceHashes: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(resolve(root, f))).digest('hex')])),
  options: sim.options, tick, phase: sim.race.phase, falls, nativeCallCounts,
  history: sim.cars.map(c => ({ id: c.id, rows: chronological(c.id) })) };
writeFileSync(output, JSON.stringify(result, (_, value) => {
  if (ArrayBuffer.isView(value)) return { typedArray: value.constructor.name, values: Array.from(value) };
  return typeof value === 'number' && !Number.isFinite(value) ? String(value) : value;
}) + '\n');
console.log(JSON.stringify({ tick, phase: sim.race.phase, fallCount: falls.length,
  falls: falls.map(f => ({ id: f.id, reason: f.reason, s: f.at.s, time: f.at.time, lean: f.at.lean, speed: f.at.speed, observer: f.nativeProof?.observation })),
  nativeCallCounts }));
