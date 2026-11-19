import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import assert from 'node:assert/strict';

const [rootArg, inputArg, outputArg] = process.argv.slice(2);
const root = resolve(rootArg), inputPath = resolve(inputArg), outputPath = resolve(outputArg);
const load = path => import(pathToFileURL(resolve(root, path)).href);
const { Bike, GP_ASSIST } = await load('src/simulation/bike.ts');
const { MotoGPChassis, GP_RAKE, gpBarSteer, gpCamberFriction, gpHangOffAngle, gpRollInertia, gpRollRateLimit, gpSpinPerSpeed } = await load('src/simulation/motogp-physics.ts');
const { gpFrontSteeringContact } = await load('src/simulation/gp-front-contact.ts');
const { clamp, G } = await load('src/core/math.ts');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const raw = readFileSync(inputPath), input = JSON.parse(raw);
const scriptPath = fileURLToPath(import.meta.url), scriptBefore = hash(readFileSync(scriptPath));
const files = ['src/simulation/bike.ts', 'src/simulation/motogp-physics.ts', 'src/simulation/tyre-force.ts', 'src/simulation/gp-front-contact.ts', 'src/core/math.ts'];
const hashes = () => Object.fromEntries(files.map(p => [p, hash(readFileSync(resolve(root, p)))]));
const sourceBefore = hashes();

const bikeSource = readFileSync(resolve(root, 'src/simulation/bike.ts'), 'utf8');
const start = bikeSource.indexOf('  private gpSteer('), end = bikeSource.indexOf('\n  private roadLateralDemand', start);
assert(start >= 0 && end > start);
const originalFunction = bikeSource.slice(start, end);
const functionJS = stripTypeScriptTypes(originalFunction.replace('  private gpSteer(', 'function gpSteer('));
const admissionLine = 'const lateral = clamp(demand, -recovery, recovery);';
const saturationLine = 'const saturated = Math.abs(lateral) >= recovery * 0.999;';
assert.equal(functionJS.split(admissionLine).length, 2);
assert.equal(functionJS.split(saturationLine).length, 2);
const tracedJS = functionJS.replace(saturationLine, saturationLine + `
    trace('beforeTrim', { speed: this.speed, frontFx: -this.frontBrakeForce, rearFx: this.driveForce - this.rearBrakeForce, reaction, capacity, recovery, requestedTarget, supportCapacity, supportedLimit, target, measured, currentLateral, rolling, rateAhead, ahead, error, direction, stopping, effort, rate, demand, reserve: gp.lateralDemand, lateral, saturated, trim: gp.steerTrim });`)
  .replace('return gpBarSteer(ground, this.lean);', `trace('afterTrim', { trim: gp.steerTrim, rearForce, yawError, frontForce, contact, inverse, ground, bar: gpBarSteer(ground, this.lean) });
    return gpBarSteer(ground, this.lean);`);
const diagnosticJS = tracedJS.replace(admissionLine, 'const lateral = admit(this, { demand, recovery, frontMu, rearMu, dt, v, m });');
const functionFactory = source => new Function('clamp', 'G', 'GP_ASSIST', 'gpRollInertia', 'gpHangOffAngle', 'gpSpinPerSpeed', 'gpCamberFriction', 'gpRollRateLimit', 'gpFrontSteeringContact', 'gpBarSteer', 'admit', 'trace', `return (${source});`);
const makeFunction = (source, admit, trace) => functionFactory(source)(clamp, G, GP_ASSIST, gpRollInertia, gpHangOffAngle, gpSpinPerSpeed, gpCamberFriction, gpRollRateLimit, gpFrontSteeringContact, gpBarSteer, admit, trace);
const originalTrimStart = functionJS.indexOf(saturationLine), originalTrimEnd = functionJS.indexOf('// The front tyre supplies', originalTrimStart);
const diagnosticTrimStart = diagnosticJS.indexOf(saturationLine), diagnosticTrimEnd = diagnosticJS.indexOf('// The front tyre supplies', diagnosticTrimStart);
// Remove only the observational trace before comparing the literal control law.
const stripTrace = text => text.replace(/\n    trace\('beforeTrim', \{[^\n]*\}\);/, '');
assert.equal(stripTrace(diagnosticJS.slice(diagnosticTrimStart, diagnosticTrimEnd)), functionJS.slice(originalTrimStart, originalTrimEnd));

function hydrate(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (ArrayBuffer.isView(target[key])) for (let i = 0; i < target[key].length; i++) target[key][i] = value[i];
    else target[key] = structuredClone(value);
  }
  return target;
}
const own = object => Object.fromEntries(Object.entries(object).filter(([key, value]) => key !== 'motoGP' && typeof value !== 'function'));
// The native curve evaluator also writes the reusable force-result scratch.
const scratchKeys = new Set(['inverseFront', 'inverseForces', 'previewFront', 'previewRear', 'force']);
const physicalGP = gp => Object.fromEntries(Object.entries(own(gp)).filter(([key]) => !scratchKeys.has(key)));
const allState = b => ({ bike: structuredClone(own(b)), gp: structuredClone(own(b.motoGP)) });
const physicalStates = states => states.map(state => ({ bike: state.bike, gp: Object.fromEntries(Object.entries(state.gp).filter(([key]) => !scratchKeys.has(key))) }));
const behavioralRecords = records => records.map(r => ({ controlCalls: r.controlCalls, plantCalls: r.plantCalls, controlBoundary: r.controlBoundary, barRequest: r.barRequest, target: r.target, reserve: r.reserve, trim: r.trim, inverse: r.inverse, rear: r.rear, plantInput: r.plantInput, plantOutput: r.plantOutput, after: r.after }));
function bikeClone(f, standalone) {
  const b = hydrate(new Bike(structuredClone(f.bike.assists), structuredClone(f.bike.p)), f.bike);
  b.motoGP = hydrate(new MotoGPChassis(structuredClone(f.gp.geometry)), f.gp);
  b.riderOffset = f.stepEntry.riderOffset;
  if (standalone) b.contactLoads = undefined;
  return b;
}
const plantOutput = gp => ({ frontFy: gp.frontFy, rearFy: gp.rearFy, lateralAcceleration: gp.lateralAcceleration, frontOmega: gp.frontOmega, rearOmega: gp.rearOmega, yawRate: gp.yawRate, lateralSpeed: gp.lateralSpeed });
const selectedAfter = b => ({ speed: b.speed, lean: b.lean, leanRate: b.leanRate, riderOffset: b.riderOffset, steer: b.steer, frontLoad: b.frontLoad, rearLoad: b.rearLoad, drive: b.driveForce, frontBrake: b.frontBrakeForce, rearBrake: b.rearBrakeForce, state: b.state, crashes: b.crashes });

function earlyAdmission(b, q, chooseNative, record) {
  const legacy = clamp(q.demand, -q.recovery, q.recovery);
  const entry = { phase: 'inside the original early gpSteer, before trim, bar commit and pedal allocation', legacy, demand: q.demand, recovery: q.recovery };
  record.admission = entry;
  if (!b.contactLoads) { Object.assign(entry, { fallback: 'standalone has no road-contact boundary', selected: legacy }); return legacy; }
  const gp = b.motoGP, p = b.p;
  const staticFront = (q.m * G * p.cgToRear) / p.wheelbase + (p.downforce ?? 0) * b.speed * b.speed * (p.downforceFront ?? 0.6);
  const contact = clamp(b.frontLoad / Math.max(1, 0.05 * staticFront), 0, 1);
  const early = { speed: b.speed, v: q.v, mass: q.m, lean: b.lean, frontLoad: b.frontLoad, rearLoad: b.rearLoad, frontMu: q.frontMu, rearMu: q.rearMu, frontFx: -b.frontBrakeForce, rearFx: b.driveForce - b.rearBrakeForce, frontContact: contact, effectiveFrontLoad: b.frontLoad * contact, yawRate: gp.yawRate, dt: q.dt };
  entry.early = early;
  if (!Object.values(early).every(Number.isFinite)) { Object.assign(entry, { fallback: 'nonfinite native preparation input', selected: legacy }); return legacy; }
  const physicalBefore = structuredClone(physicalGP(gp));
  const probe = gp.frontSteerFor(0, early.lean, early.speed, early.frontFx, early.effectiveFrontLoad, early.frontMu);
  if (probe === null) {
    assert.deepEqual(physicalGP(gp), physicalBefore);
    Object.assign(entry, { fallback: 'no loaded rolling front inverse', nativeProbe: probe, selected: legacy, physicalStateUnchanged: true });
    return legacy;
  }
  const samples = Array.from(gp.inverseForces), neutral = samples[8];
  const frontLow = neutral + 0.97 * (Math.min(...samples) - neutral), frontHigh = neutral + 0.97 * (Math.max(...samples) - neutral);
  const rearArgs = [early.rearLoad, early.rearMu, early.lean, early.speed, early.rearFx, early.dt];
  const rear = gp.rearForceFor(...rearArgs);
  const K = GP_ASSIST.yawDamping * gp.geometry.yawInertia / gp.geometry.frontArm, denominator = q.m + K / q.v;
  const low = (frontLow + rear + K * gp.yawRate) / denominator, high = (frontHigh + rear + K * gp.yawRate) / denominator;
  assert.deepEqual(physicalGP(gp), physicalBefore);
  Object.assign(entry, { nativeProbe: probe, nativeProjectedSamples: samples, neutralFrontForce: neutral, reservedFrontForceInterval: [frontLow, frontHigh], rearArgs, heldRearPreview: rear, K, denominator, requestInterval: [low, high], conditionalFrontWithHeldRearAccelerationInterval: [(frontLow + rear) / q.m, (frontHigh + rear) / q.m], physicalStateBeforeSha256: hash(JSON.stringify(physicalBefore)), physicalStateAfterSha256: hash(JSON.stringify(physicalGP(gp))), physicalStateUnchanged: true });
  if (![low, high].every(Number.isFinite) || low > high) { Object.assign(entry, { fallback: 'invalid native signed request interval', selected: legacy }); return legacy; }
  const admitted = clamp(q.demand, low, high);
  Object.assign(entry, { nativeAdmitted: admitted, selected: chooseNative ? admitted : legacy, control: chooseNative ? 'native signed admission diagnostic' : 'scratch query with unchanged legacy admission' });
  return entry.selected;
}

function torque(bBefore, q, output, dt) {
  const { bike: b, gp } = bBefore, m = q.mass, h = b.p.cgHeight;
  const psi = b.lean + gpHangOffAngle(b.riderOffset, h), reaction = (q.frontLoad + q.rearLoad) / m;
  const inertia = gpRollInertia(gp.geometry, m, h), frontSpin = gp.geometry.frontWheelInertia * output.frontOmega;
  const spin = frontSpin + gp.geometry.rearWheelInertia * output.rearOmega, steerRate = (q.steer - b.steer) / dt;
  const componentsNm = { reaction: m * h * reaction * Math.sin(psi), lateral: -m * h * output.lateralAcceleration * Math.cos(psi), yawGyro: -spin * output.yawRate * Math.cos(b.lean), steerGyro: -frontSpin * steerRate * Math.cos(GP_RAKE) };
  const acceleration = (m * h * (reaction * Math.sin(psi) - output.lateralAcceleration * Math.cos(psi)) - spin * output.yawRate * Math.cos(b.lean) - frontSpin * steerRate * Math.cos(GP_RAKE)) / inertia;
  return { reaction, psi, steerRate, componentsNm, rollAcceleration: acceleration };
}

function run(f, row, mode, standalone = false) {
  const b = bikeClone(f, standalone), gp = b.motoGP;
  const nativeControl = b.gpSteer, nativeInverse = gp.frontSteerFor, nativeRear = gp.rearForceFor, nativePlant = gp.step;
  const records = [], states = []; let active;
  const trace = (phase, values) => { active[phase] = values; };
  const mirror = mode === 'native' ? nativeControl : makeFunction(mode === 'mirror' ? tracedJS : diagnosticJS, (bike, q) => earlyAdmission(bike, q, mode === 'signed', active), trace);
  gp.frontSteerFor = function (...args) { const returned = nativeInverse.apply(this, args); active.inverseCalls.push({ args, returned }); return returned; };
  gp.rearForceFor = function (...args) { const returned = nativeRear.apply(this, args); active.rearCalls.push({ args, returned }); return returned; };
  b.gpSteer = function (...args) {
    active.controlCalls++;
    active.controlBoundary = hash(JSON.stringify(own(this)));
    if (records.length === 0 && !standalone) assert.deepEqual(own(this), f.bike);
    const returned = mirror.apply(this, args);
    active.barRequest = returned; active.target = gp.leanTarget; active.reserve = gp.lateralDemand; active.trim = gp.steerTrim;
    return returned;
  };
  gp.step = function (q) { active.plantCalls++; active.plantInput = { ...q }; const returned = nativePlant.call(this, q); active.plantOutput = plantOutput(this); return returned; };
  for (let index = 0; index < 2; index++) {
    active = { controlCalls: 0, plantCalls: 0, inverseCalls: [], rearCalls: [] };
    const before = allState(b);
    b.step(structuredClone(row.input), f.dt);
    active.after = selectedAfter(b);
    active.inverse = active.inverseCalls.at(-1); active.rear = active.rearCalls.at(-1);
    if (active.plantInput) active.physical = torque(before, active.plantInput, active.plantOutput, f.dt);
    const state = allState(b); active.stateSha256 = hash(JSON.stringify(state));
    records.push(active); states.push(state);
  }
  return { records, states };
}

const results = [], omitted = [], seen = new Set();
for (const f of input.fixtures) {
  const key = `${f.tick}/${f.substep}`;
  if (seen.has(key)) continue; seen.add(key);
  const row = input.rows.find(r => r.tick === f.tick && r.substep === f.substep);
  if (!row) { omitted.push({ label: f.label, tick: f.tick, substep: f.substep, reason: 'No retained row for exact original full-step proof' }); continue; }
  const native = run(f, row, 'native'), mirror = run(f, row, 'mirror'), queried = run(f, row, 'query'), signed = run(f, row, 'signed');
  const n = native.records[0];
  const originalProof = { once: n.controlCalls === 1 && n.plantCalls === 1, target: n.target === row.supportedTarget, reserve: n.reserve === row.lateralDemand, barRequest: n.barRequest === row.steerRequest, inverse: JSON.stringify(n.inverse) === JSON.stringify(row.inverse), rear: JSON.stringify(n.rear) === JSON.stringify(row.rearPreview), plantInput: JSON.stringify(n.plantInput) === JSON.stringify(row.plantInput), plantOutput: JSON.stringify(n.plantOutput) === JSON.stringify(row.plantOutput), after: Object.entries(n.after).every(([key, value]) => row.after[key] === value) };
  assert(Object.values(originalProof).every(Boolean));
  assert.deepEqual(mirror.states, native.states);
  assert.deepEqual(physicalStates(queried.states), physicalStates(native.states)); assert.deepEqual(behavioralRecords(queried.records), behavioralRecords(native.records));
  const original = mirror.records[0], trial = signed.records[0];
  const invariantKeys = ['reaction', 'capacity', 'recovery', 'requestedTarget', 'supportCapacity', 'supportedLimit', 'target', 'measured', 'currentLateral', 'rolling', 'rateAhead', 'ahead', 'error', 'direction', 'stopping', 'effort', 'rate', 'demand', 'reserve'];
  const retainedController = Object.fromEntries(invariantKeys.map(key => [key, Object.is(original.beforeTrim[key], trial.beforeTrim[key])]));
  assert(Object.values(retainedController).every(Boolean));
  const pedalParity = ['frontFx', 'rearFx', 'speed', 'frontLoad', 'rearLoad', 'frontContact'].every(key => original.plantInput[key] === trial.plantInput[key]);
  assert(pedalParity);
  const radius = f.bike.p.steerRate * f.dt, barInterval = [Math.max(-f.bike.p.maxSteer, f.stepEntry.steer - radius), Math.min(f.bike.p.maxSteer, f.stepEntry.steer + radius)];
  assert(trial.plantInput.steer >= barInterval[0] - 1e-15 && trial.plantInput.steer <= barInterval[1] + 1e-15);
  const fallbackParity = trial.admission.fallback ? (() => { assert.deepEqual(signed.states, native.states); return true; })() : null;
  results.push({ label: f.label, tick: f.tick, substep: f.substep, s: f.s, originalProof, mirrorTwoStepExact: true, queryNoOpTwoStepDynamicsExact: true, retainedController, samePedalAllocationAndPlantSpeed: pedalParity, fallbackTwoStepExact: fallbackParity, barInterval, original, diagnostic: trial, nextStep: { original: mirror.records[1], diagnostic: signed.records[1] } });
}

const standalone = [];
for (const f of input.fixtures.filter(f => f.label === 'firstRearUnloaded' || f.label === 'maximumRollForecastDifference')) {
  const row = input.rows.find(r => r.tick === f.tick && r.substep === f.substep);
  const native = run(f, row, 'native', true), mirror = run(f, row, 'mirror', true), queried = run(f, row, 'query', true), signed = run(f, row, 'signed', true);
  assert.deepEqual(mirror.states, native.states); assert.deepEqual(physicalStates(queried.states), physicalStates(native.states)); assert.deepEqual(behavioralRecords(queried.records), behavioralRecords(native.records)); assert.deepEqual(signed.states, native.states);
  standalone.push({ derivedFrom: { label: f.label, tick: f.tick, substep: f.substep }, modification: 'Only contactLoads set to undefined on each independent clone; synthetic legacy-boundary control, not a race state', exactTwoStepParity: true, original: native.records, diagnostic: signed.records });
}

assert.deepEqual(hashes(), sourceBefore); assert(readFileSync(inputPath).equals(raw)); assert.equal(hash(readFileSync(scriptPath)), scriptBefore);
const result = { scope: 'Offline diagnostic, exact original early control phase. Only final signed lateral-command admission is substituted; no production change or closed-loop race claim.', sourceCommit: '3e58984936a9e1ba2821580688a723fb93053fa4', sourceHashes: sourceBefore, scriptSha256: scriptBefore, inputSha256: hash(raw), extraction: { originalFunctionSha256: hash(originalFunction), strippedFunctionSha256: hash(functionJS), tracedOriginalSha256: hash(tracedJS), diagnosticFunctionSha256: hash(diagnosticJS), originalTrimLawSha256: hash(functionJS.slice(originalTrimStart, originalTrimEnd)), originalTrimLawLiteralUnchanged: true, alteration: 'Replace exactly one final clamp expression; inject observational traces. All support/energy/reserve/gain and anti-windup/trim expressions remain literal.' }, sourceStable: true, results, standalone, omitted, limitations: ['Native discovery adds only scratch preparation queries (inverseFront/inverseForces, previewFront/previewRear, reusable force-result object); extra preparation changes scratch cache stamps. One controller and one physical plant call occur per riding substep. The no-op control requires exact control outputs, plant inputs/outputs and all nonscratch physical state over both steps; it does not claim unchanged scratch stamps.', 'The native front interval uses the existing projected combined-slip 17 samples and its existing 97% margin; the held rear value is the original one-substep preview at early prior Fx.', 'Request interval includes yaw correction and differs from the conditional front-plus-held-rear force-to-acceleration interval. Neither is a solved steady two-axle equilibrium or an immediately delivered force guarantee.', 'Original trim anti-windup still compares admitted magnitude to the original recovery scalar; its literal law is retained, not redesigned for the signed interval.', 'Actual counterfactual commands pass the original inverse, trim, max bar, bar slew, pedal allocation and one finite-dt tyre/roll integration.', 'The second clone step repeats the saved input and contact values; it is a query-purity/control check, not a live suspension or AI continuation.', 'JSON fixture caveats remain limited to unused non-GP fields; recorded native commands/outputs and selected after-state values reproduce exactly.'] };
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ sourceCommit: result.sourceCommit, sourceStable: true, extraction: result.extraction, results: results.map(r => ({ label: r.label, tick: r.tick, substep: r.substep, originalProof: r.originalProof, mirrorTwoStepExact: r.mirrorTwoStepExact, queryNoOpTwoStepDynamicsExact: r.queryNoOpTwoStepDynamicsExact, fallbackTwoStepExact: r.fallbackTwoStepExact, retainedController: r.retainedController, samePedals: r.samePedalAllocationAndPlantSpeed, early: r.diagnostic.admission, original: { lateral: r.original.beforeTrim.lateral, trim: r.original.trim, bar: r.original.plantInput.steer, delivered: r.original.plantOutput.lateralAcceleration, physical: r.original.physical, after: r.original.after }, diagnostic: { lateral: r.diagnostic.beforeTrim.lateral, trim: r.diagnostic.trim, bar: r.diagnostic.plantInput.steer, delivered: r.diagnostic.plantOutput.lateralAcceleration, physical: r.diagnostic.physical, after: r.diagnostic.after }, barInterval: r.barInterval })), standalone: standalone.map(s => ({ derivedFrom: s.derivedFrom, exactTwoStepParity: s.exactTwoStepParity })), omitted }, null, 2));
