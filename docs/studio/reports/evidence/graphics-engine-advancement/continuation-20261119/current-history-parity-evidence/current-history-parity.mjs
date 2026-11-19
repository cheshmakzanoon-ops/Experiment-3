import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [baseline, candidate, output] = process.argv.slice(2);
if (!baseline || !candidate || !output) throw new Error('Expected baseline, candidate, and fresh external output path');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const identity = (root) => {
  const entries = [];
  const visit = (relative) => {
    const path = join(root, relative);
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(`${relative}/${name}`);
    } else entries.push([relative, hash(readFileSync(path))]);
  };
  visit('src');
  return {
    root, sourceFiles: entries.length, sourceSha256: hash(JSON.stringify(entries)),
    critical: Object.fromEntries(['bike.ts', 'motogp-physics.ts', 'bike-ai.ts', 'bike-vehicle.ts'].map(name => {
      const relative = `src/simulation/${name}`;
      return [relative, hash(readFileSync(join(root, relative)))];
    })),
  };
};
const beforeSource = { baseline: identity(baseline), candidate: identity(candidate) };
const { Bike: Before, BIKE, NOVICE } = await import(pathToFileURL(join(baseline, 'src/simulation/bike.ts')));
const { Bike: After } = await import(pathToFileURL(join(candidate, 'src/simulation/bike.ts')));
const geometry = {
  frontArm: BIKE.cgToFront, rearArm: BIKE.cgToRear, yawInertia: 55,
  frontRadius: .3, rearRadius: .32, frontWheelInertia: .6, rearWheelInertia: .9,
};
const historicalHarness = '/workspace/scratch/d611aefdb08c/w27-gp-history-parity.mjs';
const startedAt = new Date().toISOString();
let firstDifference = null, steps = 0;
const cases = [];
for (const mode of ['standalone-gp', 'non-gp-road', 'non-gp-standalone']) {
  for (const sign of [-1, 1]) {
    const a = new Before(NOVICE, BIKE), b = new After(NOVICE, BIKE);
    a.speed = b.speed = 30;
    if (mode === 'standalone-gp') { a.enableMotoGPPhysics(geometry); b.enableMotoGPPhysics(geometry); }
    const record = { mode, sign, steps: 0, identical: true };
    for (let i = 0; i < 960; i++) {
      if (mode === 'non-gp-road') {
        const loads = { front: 1200 + 500 * Math.sin(i * .09), rear: 1200 + 400 * Math.cos(i * .05) };
        a.contactLoads = { ...loads }; b.contactLoads = { ...loads };
      }
      const q = {
        lean: sign * .3 * Math.sin(i * .013), rider: sign * .6 * Math.sin(i * .009),
        throttle: .4 + .3 * Math.sin(i * .017), frontBrake: i % 100 < 15 ? .25 : 0,
        rearBrake: i % 113 < 8 ? .1 : 0, drive: 1200 + 600 * Math.sin(i * .007),
      }, dt = i % 2 ? 1 / 240 : 1 / 120;
      a.step(q, dt); b.step(q, dt); steps++; record.steps++;
      const aState = JSON.stringify(a),
        bState = JSON.stringify(b, (key, value) => key === 'previewFront' ? undefined : value);
      if (aState !== bState) {
        record.identical = false;
        record.firstDifferenceStep = i;
        if (!firstDifference) firstDifference = { mode, sign, i, input: q, dt, before: JSON.parse(aState), after: JSON.parse(bState) };
        break;
      }
    }
    cases.push(record);
  }
}
const afterSource = { baseline: identity(baseline), candidate: identity(candidate) };
const sourceStable = JSON.stringify(beforeSource) === JSON.stringify(afterSource);
const result = {
  scope: 'Fresh exact-source parity comparison; does not reuse historical d98e success and is not race acceptance.',
  historicalHarness, historicalHarnessSha256: hash(readFileSync(historicalHarness)),
  adaptation: 'Same constructor preset, geometry, three modes, two signs, 960 steps per case, loads, control inputs, alternating timestep and JSON comparator. Imports/output are parameterized; source attribution and per-case result bookkeeping added.',
  excludedNewScratch: 'After-state JSON properties named previewFront only, matching the historical comparator. No other fields excluded.',
  comparison: 'Exact JSON-serialized enumerable state strings after each step. Not a comparison of non-enumerable fields, methods or IEEE representations erased by JSON.',
  modes: ['standalone-gp', 'non-gp-road', 'non-gp-standalone'],
  exclusionsFromScope: ['Road-contact GP control is intentionally changed and is not exercised by these modes.', 'No rider traffic, AI planner, race acceptance or GPU behavior is tested.'],
  startedAt, completedAt: new Date().toISOString(), requestedSteps: 5760, steps, cases,
  firstDifference, identical: firstDifference === null, beforeSource, afterSource, sourceStable,
};
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ steps, requestedSteps: 5760, identical: result.identical, sourceStable, cases,
  firstDifference: firstDifference ? { mode: firstDifference.mode, sign: firstDifference.sign, i: firstDifference.i } : null }));
if (!result.identical || !sourceStable) process.exitCode = 1;
