/** Reproduce the R7 Festival racecraft force controls and physical pass.
 * Run: node --experimental-transform-types scripts/horizon-r7-racecraft-review.mjs
 * HORIZON_R7_RACECRAFT_OUTPUT overrides the output directory (relative to the
 * repository root, or absolute). Default: test-results/horizon-r7-racecraft.
 * Initial fixture placement is followed by actual OpenWorldSimulation.step.
 * Scripted RouteDriver inputs are assistance, not a human driving assessment.
 * No production coefficients are overridden; the pass is bounded to 20 seconds.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { controls } from '../src/simulation/config.ts';
import { RouteDriver } from '../src/simulation/open-world/route-driver.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { RouteProgress } from '../src/simulation/route-graph.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(
  root,
  process.env.HORIZON_R7_RACECRAFT_OUTPUT ?? 'test-results/horizon-r7-racecraft',
);
const dt = 1 / 120;
const maximumPassSeconds = 20;
const round = (n) => Math.round(n * 1000000) / 1000000;

function raceSession(lane = 0, deck = 0, reverse = false) {
  const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 12 });
  sim.command({ type: 'start', event: 'runway-showcase' });
  sim.time = 3.01;
  sim.step(dt);
  const event = sim.events.find((e) => e.spec.id === 'runway-showcase');
  assert(event && sim.run, 'Runway Showcase must be an active race');
  assert.equal(sim.cars.length, 2, 'This matched fixture requires two entrants');
  for (let i = 0; i < sim.cars.length; i++) {
    const car = sim.cars[i];
    const p = event.path.at(200 + i * 25, pathPoint());
    sim.placeAt(
      car,
      p.x + p.nx * lane * i,
      p.z + p.nz * lane * i,
      Math.atan2(p.tx, p.tz) + (i && reverse ? Math.PI : 0),
      p.y + 0.5,
    );
    const direction = i && reverse ? -1 : 1;
    car.body.position.y += i * deck;
    car.forward.set(p.tx * direction, 0, p.tz * direction);
    car.localVelocity.set(0, 0, 45);
    car.body.velocity.set(p.tx * 45 * direction, 0, p.tz * 45 * direction);
    car.speed = 45;
    car.gear = 4;
    for (const tyre of car.tires) tyre.omega = 45 / tyre.radius;
  }
  sim.setInput({ ...controls(), throttle: 0.15 });
  return sim;
}

function aeroRead(sim) {
  sim.step(dt);
  return {
    player: sim.player.definition.id,
    leader: sim.cars[1].definition.id,
    dragN: round(sim.player.aero.drag),
    slipstreamFraction: round(sim.player.slipstream),
    wakeFraction: round(sim.player.wake),
    speedKmh: round(sim.player.speed * 3.6),
  };
}

const towed = aeroRead(raceSession());
const clear = aeroRead(raceSession(12));
const overpass = aeroRead(raceSession(0, 8));
const opposite = aeroRead(raceSession(0, 0, true));
const finishedSim = raceSession();
// Isolate race-control eligibility while retaining the leader's physical car.
finishedSim.run.participants[1].finishTime = finishedSim.time;
const finished = aeroRead(finishedSim);

const sim = raceSession();
const event = sim.events.find((e) => e.spec.id === 'runway-showcase');
const path = event.path;
const craft = sim.run.racecraft;
const cars = sim.cars;
const participants = sim.run.participants;
assert(craft, 'The active car race must have a racecraft detector');
for (let i = 0; i < cars.length; i++) {
  const car = cars[i];
  const p = path.at(200 + i * 26, pathPoint());
  sim.placeAt(car, p.x, p.z, Math.atan2(p.tx, p.tz), p.y + 0.5);
  car.body.velocity.set(p.tx * 30, 0, p.tz * 30);
  car.forward.set(p.tx, 0, p.tz);
  car.speed = 30;
  car.localVelocity.set(0, 0, 30);
  car.gear = 4;
  for (const tyre of car.tires) tyre.omega = 30 / tyre.radius;
  // Fixture setup only: preserve the actual initial grid offset in legal progress.
  const progress = new RouteProgress(event.graph);
  progress.update(car.body.position, 300);
  participants[i].progress = progress;
}
const driver = new RouteDriver(cars[0], path, 0.92, 0, 43);
const lead = new RouteDriver(cars[1], path, 0.9, 0, 29);
driver.overtake = lead.overtake = false;
sim.run.drivers[1] = lead;
let carContacts = 0,
  allContacts = 0,
  maxTow = 0,
  lastPhase = null;
const originalImpulse = sim.collisions.impulse.bind(sim.collisions);
sim.collisions.impulse = (a, b, at, normal, penetration) => {
  allContacts++;
  if (b) carContacts++;
  originalImpulse(a, b, at, normal, penetration);
};
const timeline = [];
for (let tick = 0; tick < maximumPassSeconds * 120; tick++) {
  if (craft.status()?.phase === 'ready') driver.overtake = true;
  driver.update(dt, cars);
  sim.setInput({ ...cars[0].input });
  sim.step(dt);
  maxTow = Math.max(maxTow, cars[0].slipstream);
  const status = sim.status().event?.racecraft;
  const phase = status?.phase ?? null;
  if (phase !== lastPhase) {
    timeline.push({
      seconds: round((tick + 1) / 120),
      phase,
      gapMetres: round(participants[1].progress.distance - participants[0].progress.distance),
      speedKmh: round(cars[0].speed * 3.6),
      tow: round(cars[0].slipstream),
      progress: round(status?.progress ?? 0),
    });
    lastPhase = phase;
  }
  if (phase === 'complete') break;
}

const finalStatus = sim.status();
const physicalPass = {
  procedure:
    'Actual OpenWorldSimulation.step on the authored Runway Showcase; scripted RouteDriver inputs are applied through setInput with session autopilot disabled. Initial speed 30 m/s and separation 26 m. Rival uses its normal driver with a 29 m/s cap; the player follows until prepared then uses its normal lane planner to pass. Timeline is read from public sim.status().event.racecraft after real vehicle/aero/tyre, car/road/static collision and legal progress integration.',
  maximumSimulationSeconds: maximumPassSeconds,
  timeline,
  maxTow: round(maxTow),
  carContacts,
  allContacts,
  resetsRequested: driver.wantsReset || lead.wantsReset,
  final: finalStatus.event?.racecraft ?? null,
  mode: finalStatus.mode,
  assisted: finalStatus.autopilot,
};
const samples = [towed, clear, overpass, opposite, finished];
const noTow = (sample) => sample.slipstreamFraction === 0 && sample.wakeFraction === 0;
const checks = {
  finiteForceSamples: samples.every((sample) =>
    [sample.dragN, sample.slipstreamFraction, sample.wakeFraction, sample.speedKmh].every(
      Number.isFinite,
    ),
  ),
  physicalTowPresent: towed.slipstreamFraction > 0.15 && towed.wakeFraction > 0,
  dragReduced: towed.dragN > 0 && towed.dragN < clear.dragN * 0.97,
  clearAirHasNoTow: noTow(clear),
  separateDeckHasNoTow: noTow(overpass),
  oppositeTravelHasNoTow: noTow(opposite),
  finishedLeaderHasNoTow: noTow(finished),
  passHasPhysicalTow: maxTow > 0.08,
  passSequenceComplete:
    timeline.map((entry) => entry.phase).join(',') === 'following,ready,passing,complete',
  onePassWithinBound:
    physicalPass.final?.phase === 'complete' &&
    physicalPass.final.passes === 1 &&
    physicalPass.final.sequence === 1 &&
    timeline.at(-1)?.seconds <= maximumPassSeconds,
  noContacts: carContacts === 0 && allContacts === 0,
  noResetRequested: !physicalPass.resetsRequested,
  activeRaceWithGameAutopilotDisabled: physicalPass.mode === 'running' && !physicalPass.assisted,
};

const sourceFiles = [
  'src/simulation/open-world/racecraft.ts',
  'src/simulation/open-world/session.ts',
  'src/simulation/aero.ts',
  'src/simulation/vehicle.ts',
  'src/simulation/vehicles.ts',
  'src/simulation/open-world/route-driver.ts',
  'tests/festival-racecraft.test.ts',
  'tests/festival-racecraft-bikes.test.ts',
  'scripts/horizon-r7-racecraft-review.mjs',
];
const sourceSha256 = {};
for (const file of sourceFiles)
  sourceSha256[file] = createHash('sha256')
    .update(await readFile(resolve(root, file)))
    .digest('hex');

const result = {
  version: 1,
  recordedAt: new Date().toISOString(),
  command: 'node --experimental-transform-types scripts/horizon-r7-racecraft-review.mjs',
  sourceSha256,
  forceControl: {
    procedure:
      'Actual OpenWorldSimulation.step at 120 Hz with two 240 Hz substeps, same 45 m/s player/leader initial speed and 25 m runway separation; clear-air control offsets leader laterally by 12 m.',
    towed,
    clear,
    measuredDragReductionPercent: round((1 - towed.dragN / clear.dragN) * 100),
    controls: {
      eightMetreDeckSeparation: overpass,
      oppositeFacingLeader: opposite,
      finishedLeader: finished,
    },
  },
  physicalPass,
  limits: [
    'Scripted controls validate physical reachability; this does not claim a human playtest or subjective handling evaluation.',
    'The assisted field records the game autopilot flag only. External RouteDriver inputs remain scripted assistance, not a human or unassisted record.',
    'Aerodynamic volumes are the existing gameplay model, not CFD or measured vehicle validation.',
    'Fixture poses, velocities and legal progress are set before measurement; subsequent pass motion comes from the ordinary input and simulation APIs.',
  ],
  checks,
  passed: Object.values(checks).every(Boolean),
};
await mkdir(output, { recursive: true });
const destination = resolve(output, 'review.json');
await writeFile(destination, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      destination,
      passed: result.passed,
      measuredDragReductionPercent: result.forceControl.measuredDragReductionPercent,
      physicalPass,
      checks,
    },
    null,
    2,
  ),
);
for (const [check, passed] of Object.entries(checks)) assert(passed, check);
