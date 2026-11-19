import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const [rootArg, inputArg, outputArg] = process.argv.slice(2);
const root = resolve(rootArg), inputPath = resolve(inputArg), outputPath = resolve(outputArg);
const load = path => import(pathToFileURL(resolve(root, path)).href);
const { Bike, GP_ASSIST } = await load('src/simulation/bike.ts');
const { MotoGPChassis, GP_RAKE, gpHangOffAngle, gpRollInertia, gpRollRateLimit, gpSpinPerSpeed, gpBarSteer, gpGroundSteer } = await load('src/simulation/motogp-physics.ts');
const { clamp, G } = await load('src/core/math.ts');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const raw = readFileSync(inputPath), data = JSON.parse(raw);
const files = ['src/simulation/bike.ts', 'src/simulation/motogp-physics.ts', 'src/simulation/tyre-force.ts', 'src/core/math.ts'];
const hashes = () => Object.fromEntries(files.map(p => [p, hash(readFileSync(resolve(root, p)))]));
const sourceBefore = hashes(), scriptBefore = hash(readFileSync(fileURLToPath(import.meta.url)));
function hydrate(target, source) {
  for (const [k, value] of Object.entries(source)) {
    if (ArrayBuffer.isView(target[k])) for (let i = 0; i < target[k].length; i++) target[k][i] = value[i];
    else target[k] = structuredClone(value);
  }
  return target;
}
const own = object => Object.fromEntries(Object.entries(object).filter(([key, value]) => key !== 'motoGP' && typeof value !== 'function'));
function gpClone(f) { return hydrate(new MotoGPChassis(structuredClone(f.gp.geometry)), f.gp); }
function bikeClone(f) {
  const b = hydrate(new Bike(structuredClone(f.bike.assists), structuredClone(f.bike.p)), f.bike);
  b.motoGP = gpClone(f);
  b.riderOffset = f.stepEntry.riderOffset;
  return b;
}
function plantOutput(gp) { return { frontFy: gp.frontFy, rearFy: gp.rearFy, lateralAcceleration: gp.lateralAcceleration, frontOmega: gp.frontOmega, rearOmega: gp.rearOmega, yawRate: gp.yawRate, lateralSpeed: gp.lateralSpeed }; }
function torque(f, q, output) {
  const m = f.bike.mass, h = f.bike.p.cgHeight, geometry = f.gp.geometry;
  const reaction = (q.frontLoad + q.rearLoad) / m;
  const psi = f.bike.lean + gpHangOffAngle(f.stepEntry.riderOffset, h);
  const inertia = gpRollInertia(geometry, m, h);
  const frontSpin = geometry.frontWheelInertia * output.frontOmega;
  const spin = frontSpin + geometry.rearWheelInertia * output.rearOmega;
  const steerRate = (q.steer - f.stepEntry.steer) / f.dt;
  const components = { reaction: m * h * reaction * Math.sin(psi), lateral: -m * h * output.lateralAcceleration * Math.cos(psi), yawGyro: -spin * output.yawRate * Math.cos(f.bike.lean), steerGyro: -frontSpin * steerRate * Math.cos(GP_RAKE) };
  // Preserve the exact native arithmetic order for the replay identity.
  const acceleration = (m * h * (reaction * Math.sin(psi) - output.lateralAcceleration * Math.cos(psi)) - spin * output.yawRate * Math.cos(f.bike.lean) - frontSpin * steerRate * Math.cos(GP_RAKE)) / inertia;
  const support = f.bike.assists.lean ? 1 - clamp((q.speed - 1) / 4, 0, 1) : 0;
  const rate = (f.bike.leanRate + (acceleration - support * (psi * 40 + f.bike.leanRate * 10)) * f.dt) * Math.exp(-(f.bike.p.rollDamping ?? 1.2) * f.dt);
  const lean = psi + rate * f.dt - gpHangOffAngle(f.bike.riderOffset, h);
  return { psi, reaction, inertia, steerRate, componentsNm: components, rollAcceleration: acceleration, predictedRate: rate, predictedLean: lean };
}
function phase(f, native) {
  const b = f.bike, g = f.gp.geometry, m = b.mass, h = b.p.cgHeight, v = Math.max(b.speed, 3);
  const reaction = (b.frontLoad + b.rearLoad) / m, inertia = gpRollInertia(g, m, h), k = m * h / inertia;
  const psi = b.lean + gpHangOffAngle(b.riderOffset, h), gyro = gpSpinPerSpeed(g) * b.speed * f.gp.yawRate * Math.cos(b.lean);
  const current = native.observation;
  const rolling = (m * h * (reaction * Math.sin(psi) - current * Math.cos(psi)) - gyro) / inertia;
  const rateAhead = b.leanRate + GP_ASSIST.lead * rolling;
  const ahead = psi + GP_ASSIST.lead * b.leanRate + 0.5 * GP_ASSIST.lead * GP_ASSIST.lead * rolling;
  const target = native.target, error = target - ahead, direction = Math.sign(error), recovery = native.recovery;
  const stopping = k * (recovery * direction * (Math.sin(target) - Math.sin(ahead)) + reaction * (Math.cos(target) - Math.cos(ahead)));
  const effort = direction * Math.min(gpRollRateLimit(b.speed, g), GP_ASSIST.rollGain * Math.abs(error));
  const rate = direction * Math.min(Math.abs(effort), Math.sqrt(2 * GP_ASSIST.stopShare * Math.max(0, stopping)));
  const rollAcceleration = GP_ASSIST.rateGain * (rate - rateAhead);
  const demand = (m * h * reaction * Math.sin(psi) - gyro - inertia * rollAcceleration) / (m * h * Math.max(0.3, Math.cos(psi)));
  const capped = clamp(demand, -recovery, recovery), K = GP_ASSIST.yawDamping * g.yawInertia / g.frontArm;
  const decoded = (native.inverse.args[0] + native.rear.returned + K * f.gp.yawRate) / (m + K / v);
  if (Math.abs(capped - decoded) > 1e-11) throw new Error('Controller phase does not match native front force');
  return { reaction, psi, measuredStored: f.gp.lateralAcceleration, currentObservation: current, rolling, rateAhead, ahead, target, effort, stopping, rate, desiredRollAcceleration: rollAcceleration, uncappedLateralDemand: demand, capacity: native.capacity, recovery, lateralAfterRecoveryClamp: capped, lateralDecodedFromNativeFrontForce: decoded, nativeControllerReserve: native.demand, frontForceRequested: native.inverse.args[0], rearForcePreview: native.rear.returned, rawBarRequest: native.barRequest, committedBar: native.plantInput.steer, steerTrim: native.trim };
}
function nativeStep(f, row) {
  const b = bikeClone(f), gp = b.motoGP, record = { controls: 0, plants: 0 };
  const observer = gp.currentLateralAcceleration;
  gp.currentLateralAcceleration = function (q) { const value = observer.call(this, q); record.observation = value; return value; };
  const rear = gp.rearForceFor;
  gp.rearForceFor = function (...args) { const value = rear.apply(this, args); record.rear = { args, returned: value }; return value; };
  const inverse = gp.frontSteerFor;
  gp.frontSteerFor = function (...args) { const value = inverse.apply(this, args); record.inverse = { args, returned: value }; return value; };
  const control = b.gpSteer;
  b.gpSteer = function (...args) {
    record.controls++;
    if (JSON.stringify(own(this)) !== JSON.stringify(f.bike)) throw new Error('Original full step did not restore captured control boundary');
    record.capacity = this.gpLateralCapacity(f.frontMu, f.rearMu); record.recovery = GP_ASSIST.recovery * record.capacity;
    const result = control.apply(this, args);
    record.barRequest = result; record.target = gp.leanTarget; record.demand = gp.lateralDemand; record.trim = gp.steerTrim;
    return result;
  };
  const plant = gp.step;
  gp.step = function (q) { record.plants++; record.plantInput = { ...q }; const value = plant.call(this, q); record.plantOutput = plantOutput(this); return value; };
  b.step(structuredClone(row.input), f.dt);
  record.after = { speed: b.speed, lean: b.lean, leanRate: b.leanRate, riderOffset: b.riderOffset, steer: b.steer, frontLoad: b.frontLoad, rearLoad: b.rearLoad, drive: b.driveForce, frontBrake: b.frontBrakeForce, rearBrake: b.rearBrakeForce, state: b.state, crashes: b.crashes };
  const proof = { once: record.controls === 1 && record.plants === 1, target: record.target === row.supportedTarget, reserve: record.demand === row.lateralDemand, barRequest: record.barRequest === row.steerRequest, inverse: JSON.stringify(record.inverse) === JSON.stringify(row.inverse), rear: JSON.stringify(record.rear) === JSON.stringify(row.rearPreview), plantInput: JSON.stringify(record.plantInput) === JSON.stringify(row.plantInput), plantOutput: JSON.stringify(record.plantOutput) === JSON.stringify(row.plantOutput), after: Object.entries(record.after).every(([key, value]) => row.after[key] === value) };
  if (!Object.values(proof).every(Boolean)) throw new Error(`Original replay mismatch at${f.tick}/${f.substep}: ${JSON.stringify(proof)}`);
  const physical = torque(f, record.plantInput, record.plantOutput);
  if (physical.predictedRate !== b.leanRate || physical.predictedLean !== b.lean) throw new Error('Native physical roll torque reconstruction mismatch');
  return { ...record, proof, physical, controller: phase(f, record) };
}
function atBar(f, q, bar, label) {
  const gp = gpClone(f), input = { ...q, steer: bar };
  gp.step(input);
  const output = plantOutput(gp), physical = torque(f, input, output);
  const ground = gpGroundSteer(bar, q.lean);
  return { label, bar, ground, frontChassisForce: output.frontFy * Math.cos(ground) + q.frontFx * Math.sin(ground), rearForce: output.rearFy, deliveredLateral: output.lateralAcceleration, output, physical };
}
function reachable(f, native) {
  const q = native.plantInput, gp = gpClone(f), p = f.bike.p;
  const actual = atBar(f, q, q.steer, 'actual native command');
  if (JSON.stringify(actual.output) !== JSON.stringify(native.plantOutput)) throw new Error('Held-state plant clone does not match recorded actual plant');
  const radius = p.steerRate * f.dt, low = Math.max(-p.maxSteer, f.stepEntry.steer - radius), high = Math.min(p.maxSteer, f.stepEntry.steer + radius);
  const zero = gp.frontSteerFor(0, q.lean, q.speed, q.frontFx, q.frontLoad * q.frontContact, q.frontMu);
  if (zero === null) return { scope: 'No loaded rolling front inverse; no front-force authority advertised.', barInterval: [low, high], actual, nativeRange: null, samples: [actual] };
  const forces = Array.from(gp.inverseForces), neutralForce = forces[8];
  const reservedMin = neutralForce + 0.97 * (Math.min(...forces) - neutralForce), reservedMax = neutralForce + 0.97 * (Math.max(...forces) - neutralForce);
  const rear = gp.rearForceFor(q.rearLoad, q.rearMu, q.lean, q.speed, q.rearFx, q.dt);
  if (rear !== native.plantOutput.rearFy) throw new Error('Actual-phase rear preview does not match native rear output');
  const K = GP_ASSIST.yawDamping * f.gp.geometry.yawInertia / f.gp.geometry.frontArm;
  const denominator = q.mass + K / Math.max(3, q.speed);
  const nativeRange = { sampledProjectedMin: Math.min(...forces), sampledProjectedMax: Math.max(...forces), neutralForce, reservedProjectedMin: reservedMin, reservedProjectedMax: reservedMax, rearPreview: rear, heldYawRate: f.gp.yawRate, K, requestInterval: [(reservedMin + rear + K * f.gp.yawRate) / denominator, (reservedMax + rear + K * f.gp.yawRate) / denominator], steadyDeliveredInterval: [(reservedMin + rear) / q.mass, (reservedMax + rear) / q.mass] };
  const samples = [actual], seen = new Set([q.steer]);
  for (let i = 0; i <= 32; i++) {
    const force = reservedMin + (reservedMax - reservedMin) * i / 32;
    const trial = gpClone(f);
    const inverse = trial.frontSteerFor(force, q.lean, q.speed, q.frontFx, q.frontLoad * q.frontContact, q.frontMu);
    if (inverse === null) throw new Error('Loaded native front inverse unexpectedly absent');
    const requested = clamp(gpBarSteer(inverse + native.trim, q.lean), -p.maxSteer, p.maxSteer);
    const bar = f.stepEntry.steer + clamp(requested - f.stepEntry.steer, -radius, radius);
    if (bar < low - 1e-15 || bar > high + 1e-15) throw new Error('Trial exceeds actual actuator reach');
    if (seen.has(bar)) continue;
    seen.add(bar);
    samples.push({ ...atBar(f, q, bar, 'native97percent inverse, frozen trim and actual actuator limits'), inverseProjectedForce: force, inverseGround: inverse, requestedBar: requested });
  }
  const minRoll = samples.reduce((best, x) => x.physical.rollAcceleration < best.physical.rollAcceleration ? x : best, samples[0]);
  const maxRoll = samples.reduce((best, x) => x.physical.rollAcceleration > best.physical.rollAcceleration ? x : best, samples[0]);
  return { scope: 'Actual allocated Fx, speed, contacts and saved tyre history held fixed. Native inverse includes projected combined-slip and97percent reserve. Existing trim held; each alternative passes max-bar and one-substep rate limits, then one real native plant relaxation step. Sampled attainable lower bound, not an optimum or future support guarantee.', barInterval: [low, high], actual, nativeRange, minRoll, maxRoll, samples };
}
const results = [], seen = new Set(), omitted = [];
for (const f of data.fixtures) {
  const key = `${f.tick}/${f.substep}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const row = data.rows.find(r => r.tick === f.tick && r.substep === f.substep);
  if (!row) { omitted.push({ label: f.label, tick: f.tick, substep: f.substep, reason: 'No retained original row for exact full-step comparison' }); continue; }
  const native = nativeStep(f, row);
  results.push({ label: f.label, tick: f.tick, substep: f.substep, s: f.s, input: row.input, state: { lean: f.bike.lean, leanRate: f.bike.leanRate, riderOffsetBefore: f.stepEntry.riderOffset, riderOffsetAtControl: f.bike.riderOffset, speed: f.bike.speed, frontLoad: f.bike.frontLoad, rearLoad: f.bike.rearLoad }, native, reachable: reachable(f, native) });
}
if (JSON.stringify(hashes()) !== JSON.stringify(sourceBefore) || !readFileSync(inputPath).equals(raw) || scriptBefore !== hash(readFileSync(fileURLToPath(import.meta.url)))) throw new Error('Frozen analysis inputs changed');
const result = { scope: 'Read-only exact source3e saved-state native replays and one-substep actuator-reachable force/torque samples. No production/capacity/reserve change.', sourceCommit: '3e58984936a9e1ba2821580688a723fb93053fa4', sourceBefore, scriptSha256: scriptBefore, inputSha256: hash(raw), sourceStable: true, results, omitted, limitations: ['Requested lateral interval includes the existing yaw correction; it differs from delivered acceleration.', 'Native steady inverse endpoints do not claim immediately available force; each retained sample also runs the actual finite-dt tyre relaxation and body force projection.', 'Thirty-three inverse-force samples give demonstrated reachable examples, not a proven global optimum.', 'Original trim, requested support reserve, longitudinal forces and current contacts are held fixed; no future force allocation, suspension trajectory or arrest adequacy is established.', 'The original full Bike step is reproduced before interpreting a counterfactual. JSON serialization caveats are limited to unused non-GP fields; recorded commands, plant outputs and selected after-state values match exactly.'] };
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(results.map(r => ({ label: r.label, tick: r.tick, substep: r.substep, s: r.s, proof: r.native.proof, state: r.state, controller: r.native.controller, actualTorque: r.native.physical, reachable: { interval: r.reachable.barInterval, nativeRange: r.reachable.nativeRange, sampleCount: r.reachable.samples.length, minimumRoll: r.reachable.minRoll && { bar: r.reachable.minRoll.bar, lateral: r.reachable.minRoll.deliveredLateral, roll: r.reachable.minRoll.physical, label: r.reachable.minRoll.label }, maximumRoll: r.reachable.maxRoll && { bar: r.reachable.maxRoll.bar, lateral: r.reachable.maxRoll.deliveredLateral, rollAcceleration: r.reachable.maxRoll.physical.rollAcceleration } } })), null, 2));
