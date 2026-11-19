import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [rootArg, dataArg, outputArg] = process.argv.slice(2);
const root = resolve(rootArg), dataPath = resolve(dataArg), output = resolve(outputArg);
const raw = readFileSync(dataPath);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const arrayTypes = { Float64Array, Float32Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Int8Array, Uint8Array, Uint8ClampedArray };
function revive(_key, value) {
  if (value && typeof value === 'object' && arrayTypes[value.typedArray] && Array.isArray(value.values))
    return new arrayTypes[value.typedArray](value.values);
  if (value === 'Infinity') return Infinity;
  if (value === '-Infinity') return -Infinity;
  if (value === 'NaN') return NaN;
  return value;
}
const data = JSON.parse(raw, revive);
const sourceHashes = Object.fromEntries(Object.keys(data.sourceHashes).map(file => [file, sha256(readFileSync(resolve(root, file)))]));
if (JSON.stringify(sourceHashes) !== JSON.stringify(data.sourceHashes)) throw new Error('Recorded source hashes do not match the replay source');
const { Bike } = await import(pathToFileURL(resolve(root, 'src/simulation/bike.ts')).href);
const { MotoGPChassis } = await import(pathToFileURL(resolve(root, 'src/simulation/motogp-physics.ts')).href);
const fall = data.falls[0], rows = data.history.find(h => h.id === fall.id).rows;
const observed = rows.filter(r => r.observation && r.entryState);
const maximum = (list, score) => list.reduce((best, row) => score(row) > score(best) ? row : best);
const selected = [
  ['largestStoredCurrentDifference', maximum(observed, r => Math.abs(r.observation.difference))],
  ['largestForecastAheadDifference', maximum(observed, r => Math.abs(r.observation.storedForecast.ahead - r.observation.currentForecast.ahead))],
  ['largestFrontForcePhaseDifference', maximum(observed.filter(r => r.frontInverse && r.plant), r => Math.abs(r.frontInverse.args[3] - r.plant.q.frontFx))],
  ['largestRearForcePhaseDifference', maximum(observed.filter(r => r.rearPreview && r.plant), r => Math.abs(r.rearPreview.args[4] - r.plant.q.rearFx))],
  ['firstFall', observed.find(r => r.before.tick === fall.at.tick && r.before.substep === fall.at.substep)],
];
const equality = (a, b) => Object.is(a, b) || (typeof a === 'number' && a === b);
function compare(actual, expected, path, differences, counter) {
  if (expected && typeof expected === 'object') {
    for (const key of Object.keys(expected)) compare(actual?.[key], expected[key], `${path}.${key}`, differences, counter);
    return;
  }
  counter.value++;
  if (!equality(actual, expected)) differences.push({ path, actual, expected, difference: typeof actual === 'number' && typeof expected === 'number' ? actual - expected : null });
}
function body(b) {
  return { speed:b.speed, heading:b.heading, lean:b.lean, leanRate:b.leanRate, riderOffset:b.riderOffset,
    steer:b.steer, state:b.state, crashes:b.crashes, mass:b.mass, grip:b.grip, frontGrip:b.frontGrip,
    rearGrip:b.rearGrip, frontLoad:b.frontLoad, rearLoad:b.rearLoad, contacts:b.contactLoads,
    drive:b.driveForce, frontBrake:b.frontBrakeForce, rearBrake:b.rearBrakeForce, longitudinal:b.longitudinal,
    intervention:b.intervention, frontUse:b.frontUse, rearUse:b.rearUse,
    gp:{storedAcceleration:b.motoGP.lateralAcceleration, demand:b.motoGP.lateralDemand, target:b.motoGP.leanTarget,
      frontFy:b.motoGP.frontFy, rearFy:b.motoGP.rearFy, yawRate:b.motoGP.yawRate, lateralSpeed:b.motoGP.lateralSpeed,
      frontElasticStiffness:b.motoGP.frontElasticStiffness, rearElasticStiffness:b.motoGP.rearElasticStiffness,
      steerTrim:b.motoGP.steerTrim, frontOmega:b.motoGP.frontOmega, rearOmega:b.motoGP.rearOmega} };
}
function restore(state) {
  const b = new Bike(structuredClone(state.bike.assists), structuredClone(state.bike.p));
  Object.assign(b, structuredClone(state.bike));
  b.motoGP = Object.assign(new MotoGPChassis(structuredClone(state.gp.geometry)), structuredClone(state.gp));
  return b;
}
const results = selected.map(([label, row]) => {
  if (!row) throw new Error(`Missing retained incoming state for ${label}`);
  const b = restore(row.entryState), actualCalls = {};
  const nativePlant = b.motoGP.step, nativeInverse = b.motoGP.frontSteerFor, nativeRear = b.motoGP.rearForceFor;
  b.motoGP.step = function(q) {
    actualCalls.plant = { ...q };
    const result = nativePlant.call(this,q);
    actualCalls.plantAfter = {frontFy:this.frontFy,rearFy:this.rearFy,acceleration:this.lateralAcceleration,
      yawRate:this.yawRate,lateralSpeed:this.lateralSpeed,frontOmega:this.frontOmega,rearOmega:this.rearOmega,forwardSpeed:this.forwardSpeed};
    return result;
  };
  b.motoGP.frontSteerFor = function(...args) { const result = nativeInverse.apply(this,args); actualCalls.front = { args, result }; return result; };
  b.motoGP.rearForceFor = function(...args) { const result = nativeRear.apply(this,args); actualCalls.rear = { args, result }; return result; };
  Bike.prototype.step.call(b, structuredClone(row.input), row.dt);
  const got = body(b), expected = Object.fromEntries(Object.keys(got).map(key => [key,row.after[key]]));
  const differences=[], counter={value:0};
  compare(got, expected, 'after', differences, counter);
  compare(actualCalls.plant, row.plant.q, 'plantInput', differences, counter);
  compare(actualCalls.plantAfter, row.plant.after, 'plantAfter', differences, counter);
  compare(actualCalls.front, { args:row.frontInverse.args, result:row.frontInverse.result }, 'frontInverse', differences, counter);
  compare(actualCalls.rear, { args:row.rearPreview.args, result:row.rearPreview.result }, 'rearPreview', differences, counter);
  const probe = Object.assign(new MotoGPChassis(structuredClone(row.entryState.gp.geometry)), structuredClone(row.entryState.gp));
  probe.step(structuredClone(row.observation.q));
  compare(probe.lateralAcceleration, row.observation.current, 'nativeCurrentProbe', differences, counter);
  return { label, tick:row.before.tick, substep:row.before.substep, time:row.before.time, s:row.before.s,
    comparisons:counter.value, exactlyReproduced:differences.length===0, differences,
    rawPath:row.observation.rawPath, decodedPath:row.observation.decodedPath,
    reaction:row.observation.reaction, storedAcceleration:row.observation.stored,
    currentPreparationAcceleration:probe.lateralAcceleration, actualNextPlantAcceleration:actualCalls.plantAfter.acceleration,
    endOfStepStoredAcceleration:b.motoGP.lateralAcceleration,
    probeFrontFy:probe.frontFy, probeRearFy:probe.rearFy,
    incomingFrontFy:row.entryState.gp.frontFy, incomingRearFy:row.entryState.gp.rearFy,
    incomingFrontStiffness:row.entryState.gp.frontElasticStiffness, incomingRearStiffness:row.entryState.gp.rearElasticStiffness,
    currentFrontStiffness:probe.frontElasticStiffness, currentRearStiffness:probe.rearElasticStiffness,
    storedForecast:row.observation.storedForecast, currentForecast:row.observation.currentForecast,
    input:row.input, controllerQ:row.observation.q, actualPlantQ:actualCalls.plant,
    incomingLean:row.before.lean, incomingLeanRate:row.before.leanRate,
    nextLean:b.lean, nextLeanRate:b.leanRate, nextState:b.state,
    sourcePath:dataPath,
  };
});
const result = { scope:'Offline native one-step replay of retained incoming Bike and MotoGP state. No race rerun, source mutation, controller substitution, or acceptance claim.',
  sourceRoot:root, sourceHashes, recordingSha256:sha256(raw), recordingBytes:raw.length,
  exactNumberComparison:'Object.is, treating JSON-serialized signed zero as numerically equal.',
  allExactlyReproduced:results.every(r=>r.exactlyReproduced), results };
writeFileSync(output, JSON.stringify(result, (_key,value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2)+'\n');
console.log(JSON.stringify({ allExactlyReproduced:result.allExactlyReproduced, selected:results.map(r=>({label:r.label,comparisons:r.comparisons,differences:r.differences})) }));
if (!result.allExactlyReproduced) process.exitCode = 1;
