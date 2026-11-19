import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [rootArg, inputArg, outputArg] = process.argv.slice(2), root = resolve(rootArg);
const load = p => import(pathToFileURL(resolve(root, p)).href);
const { Bike } = await load('src/simulation/bike.ts');
const { MotoGPChassis } = await load('src/simulation/motogp-physics.ts');
const revive = (_, value) => {
  if (value && typeof value === 'object' && value.typedArray === 'Float64Array') return new Float64Array(value.values);
  if (value === 'Infinity') return Infinity;
  if (value === '-Infinity') return -Infinity;
  if (value === 'NaN') return NaN;
  return value;
};
const data = JSON.parse(readFileSync(inputArg, 'utf8'), revive), id = data.falls[0].id,
  rows = data.history[id].rows.filter(r => r.entryState && r.frontInverse && r.plant?.preState);
function restore(row) {
  const state = structuredClone(row.entryState);
  const bike = Object.assign(new Bike(state.bike.assists, state.bike.p), state.bike);
  bike.motoGP = Object.assign(new MotoGPChassis(state.gp.geometry), state.gp);
  return bike;
}
const fields = [['speed', 'speed'], ['lean', 'lean'], ['leanRate', 'leanRate'], ['steer', 'steer'],
  ['driveForce', 'drive'], ['frontBrakeForce', 'frontBrake'], ['rearBrakeForce', 'rearBrake'], ['state', 'state'], ['crashes', 'crashes']];
const records = [];
let comparisons = 0;
for (const row of rows) {
  const original = restore(row);
  original.step(row.input, row.dt);
  for (const [key, expected] of fields) {
    comparisons++;
    if (original[key] !== row.after[expected]) throw new Error(`Native replay mismatch at ${row.before.tick}/${row.before.substep}: ${key}, ${original[key]} != ${row.after[expected]}`);
  }
  const variants = {};
  for (const mode of ['front Fx only', 'both Fx', 'both Fx and speed']) {
    const control = restore(row), gp = control.motoGP,
      front = gp.frontSteerFor, rear = gp.rearForceFor, q = row.plant.q;
    gp.frontSteerFor = function (force, lean, speed, _fx, load, mu) {
      return front.call(this, force, lean, mode.endsWith('speed') ? q.speed : speed, q.frontFx, load, mu);
    };
    if (mode !== 'front Fx only') gp.rearForceFor = function (load, mu, lean, speed, _fx, dt) {
      return rear.call(this, load, mu, lean, mode.endsWith('speed') ? q.speed : speed, q.rearFx, dt);
    };
    control.step(row.input, row.dt);
    // These controlled observations change only the force-inverse phase.
    // Prove that substituting the recorded final pair leaves the allocator's
    // pair unchanged, instead of assuming that the counterfactual is valid.
    for (const key of ['driveForce', 'frontBrakeForce', 'rearBrakeForce']) {
      comparisons++;
      if (control[key] !== original[key]) throw new Error(`Allocator changed in ${mode} at ${row.before.tick}: ${key}`);
    }
    variants[mode] = { steer: control.steer, lean: control.lean, leanRate: control.leanRate,
      acceleration: gp.lateralAcceleration, yawRate: gp.yawRate, state: control.state,
      barDelta: control.steer - original.steer, rateDelta: control.leanRate - original.leanRate };
  }
  records.push({ tick: row.before.tick, substep: row.before.substep, s: row.before.s,
    before: { lean: row.before.lean, rate: row.before.leanRate, steer: row.before.steer, speed: row.before.speed },
    early: { frontFx: row.frontInverse.args[3], rearFx: row.rearPreview.args[4], speed: row.frontInverse.args[2], frontForce: row.frontInverse.args[0] },
    final: { frontFx: row.plant.q.frontFx, rearFx: row.plant.q.rearFx, speed: row.plant.q.speed },
    actual: { steer: original.steer, lean: original.lean, leanRate: original.leanRate,
      acceleration: original.motoGP.lateralAcceleration, yawRate: original.motoGP.yawRate, state: original.state }, variants });
}
const byChange = [...records].sort((a, b) => Math.abs(b.variants['both Fx and speed'].barDelta) - Math.abs(a.variants['both Fx and speed'].barDelta));
const summary = { scope: 'Offline native one-step causal controls; no race acceptance or closed-loop remedy claim.',
  originalInputs: inputArg, originalNativeStates: rows.length, strictComparisons: comparisons,
  nativeReplaysExact: true, allCounterfactualForcePairsUnchanged: true,
  maxBarDelta: Math.max(...byChange.map(r => Math.abs(r.variants['both Fx and speed'].barDelta))),
  greatestChanges: byChange.slice(0, 12), records };
writeFileSync(outputArg, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ ...summary, records: undefined }, null, 2));
