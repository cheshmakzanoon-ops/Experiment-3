/** Physical practice acceptance. The external route driver supplies ordinary
 * controls; no car positions, checkpoint state or timing values are injected.
 * This is a scripted controls check, not a human handling review. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { RouteDriver } from '../src/simulation/open-world/route-driver.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';

const root = process.cwd();
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
function fingerprint() {
  const hash = createHash('sha256');
  for (const path of [
    ...files(join(root, 'src/core')),
    ...files(join(root, 'src/simulation')),
    ...['package-lock.json', 'scripts/horizon-practice-validation.ts'].map((name) =>
      join(root, name),
    ),
  ].sort()) {
    hash.update(relative(root, path).replaceAll('\\', '/') + '\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}
const sourceBefore = fingerprint();
const sim = new OpenWorldSimulation({ vehicle: 'rh3', traffic: false, weather: 'clear' });
sim.command({ type: 'start', event: 'saltmarsh-practice' });
const event = sim.events.find((candidate) => candidate.spec.id === 'saltmarsh-practice')!;
const stress = process.argv.includes('--stress');
const skill = stress ? 0.82 : 0.68;
const speedCap = stress ? Infinity : 24;
const driver = new RouteDriver(sim.player, event.path, skill, 0, speedCap);
const splits: unknown[] = [];
let previousSectors = 0;
let departureRequested = false;
let observedOffRoad: { at: number; x: number; z: number } | null = null;
for (let tick = 0; tick < 120 * 360 && sim.mode !== 'finished'; tick++) {
  if (sim.mode === 'running') {
    driver.update(1 / 120, sim.cars, false, false);
    // Exercise rejection with a real steering departure. A fast route driver
    // may complete cleanly as physics improves, so speed alone is not a
    // reliable off-road stimulus. Resume the normal driver once soil is hit.
    if (stress && sim.time > 12 && !observedOffRoad) {
      departureRequested = true;
      sim.player.input.steer = 0.65;
      sim.player.input.throttle = 0.3;
      sim.player.input.brake = 0;
    }
  }
  sim.step(1 / 120);
  if (departureRequested && !observedOffRoad && !sim.track.query.onRoad)
    observedOffRoad = {
      at: sim.time,
      x: sim.player.body.position.x,
      z: sim.player.body.position.z,
    };
  if (tick % 12 === 0) {
    const state = sim.status().event?.practice;
    if (state && state.splits.length > previousSectors) {
      splits.push(state);
      previousSectors = state.splits.length;
    }
  }
}
const result = sim.takeResult();
const beforeRetry = sim.status();
const completedPosition = { ...sim.player.body.position };
sim.command({ type: 'start', event: 'saltmarsh-practice' });
const retry = sim.status().event?.practice;
sim.command({ type: 'autopilot', value: true });
const assisted = sim.status().event?.practice;
sim.command({ type: 'vehicle', id: 'sc7' });
sim.command({ type: 'autopilot', value: false });
sim.command({ type: 'start', event: 'saltmarsh-practice' });
const otherCar = sim.status().event?.practice;
const sourceAfter = fingerprint();
const benchmarkAccepted =
  result?.practice?.valid === true &&
  result.practice.newBest &&
  retry?.referenceTime === result.time;
const offRoadRejected =
  observedOffRoad !== null &&
  result?.practice?.valid === false &&
  result.practice.reason === 'off-road' &&
  !result.practice.newBest &&
  retry?.referenceTime === null;
const passed =
  sourceBefore === sourceAfter &&
  result?.completed === true &&
  result.practice?.splits.length === 3 &&
  (stress ? offRoadRejected : benchmarkAccepted) &&
  assisted?.reason === 'autopilot' &&
  otherCar?.referenceTime === null;
const report = {
  kind: 'horizon-practice-physical-controls-validation',
  method: `External RouteDriver at skill ${skill}, speed cap ${speedCap} m/s, supplies controls to production 120 Hz simulation.`,
  limits: 'Scripted controls; no human input, rendered-frame or hardware-performance claim.',
  generatedAt: new Date().toISOString(),
  expected: stress ? 'Reject the off-road stress lap' : 'Accept a clean same-car benchmark',
  sourceScope: 'src/core, src/simulation, package-lock.json and this validation runner',
  sourceBefore,
  sourceAfter,
  observedOffRoad,
  passed,
  result,
  splits,
  retry,
  assisted,
  otherCar,
  completedPosition,
  postSwitchPosition: sim.player.body.position,
  beforeRetry: { mode: beforeRetry.mode, event: beforeRetry.event },
};
const output = resolve(
  process.argv.slice(2).find((argument) => !argument.startsWith('--')) ??
    'test-results/horizon-practice-physics.json',
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, passed, time: result?.time, practice: result?.practice }));
assert(passed, 'Physical practice/retry/same-car benchmark acceptance failed; inspect report.');
