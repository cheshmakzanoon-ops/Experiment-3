/** Reproduce one clean beginner drift milestone using actual vehicle dynamics.
 * This is scripted assistance through normal controls, not a human playtest.
 * node --experimental-transform-types scripts/horizon-drift-validation.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { clamp } from '../src/core/math.ts';
import { controls } from '../src/simulation/config.ts';
import { RouteDriver } from '../src/simulation/open-world/route-driver.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { FESTIVAL_SKILLS } from '../src/simulation/open-world/skill-chain.ts';

const output = process.env.HORIZON_DRIFT_OUTPUT ?? 'docs/production/horizon-drift-validation.json';
const settings = {
  vehicle: 'rd2',
  assist: 'raw',
  weather: 'clear',
  seed: 73021,
  tileBudget: 12,
  traffic: false,
  session: 'scripted-drift-milestone',
} as const;
const sim = new OpenWorldSimulation(settings);
sim.command({ type: 'start', event: 'kestrel-drift' });
const car = sim.player;
const event = sim.events.find((candidate) => candidate.spec.id === 'kestrel-drift')!;
const driver = new RouteDriver(car, event.path, 0.9, 0, 22);
const input = controls();
const dt = 1 / 120;
const trace = [];
let waveStart = -1;
let maximumSpeedKmh = 0;
let maximumAngleDegrees = 0;
let candidateDriftSeconds = 0;
let groundedSeconds = 0;
let offRoadSeconds = 0;
let contactSamples = 0;
let replacements = 0;
let result = sim.takeResult();
for (let tick = 0; tick < 120 * 70 && !result; tick++) {
  driver.update(dt, [car]);
  Object.assign(input, car.input);
  // A smooth steering weave on the broad run-up and exit only. The ordinary
  // route driver's pedal envelope and hairpin steering stay authoritative.
  // Neither the physical pose/velocity nor any score is assigned by this script.
  if ((driver.d < 175 || driver.d > 410) && car.speed > 12) {
    if (waveStart < 0) waveStart = sim.time;
    input.steer = clamp(
      input.steer + 0.5 * Math.sin(((sim.time - waveStart) * 2 * Math.PI) / 3.5),
      -1,
      1,
    );
  } else waveStart = -1;
  sim.setInput(input);
  sim.step(dt);
  if (sim.player !== car) {
    replacements++;
    break;
  }
  const speed = Math.hypot(car.localVelocity.x, car.localVelocity.z);
  const angle = Math.atan2(Math.abs(car.localVelocity.x), Math.max(0.1, car.localVelocity.z));
  const grounded = car.up.y > 0.45 && car.tires.some((tire) => tire.load > 20);
  const onRoad = sim.track.query.onRoad;
  maximumSpeedKmh = Math.max(maximumSpeedKmh, speed * 3.6);
  maximumAngleDegrees = Math.max(maximumAngleDegrees, (angle * 180) / Math.PI);
  if (grounded) groundedSeconds += dt;
  if (!onRoad) offRoadSeconds += dt;
  if (car.impact > 0.25) contactSamples++;
  if (
    grounded &&
    onRoad &&
    car.impact <= 0.25 &&
    speed > FESTIVAL_SKILLS.minDriftSpeed &&
    car.localVelocity.z > 2 &&
    angle > FESTIVAL_SKILLS.minDriftAngle &&
    angle <= FESTIVAL_SKILLS.maxDriftAngle
  )
    candidateDriftSeconds += dt;
  if (tick % 24 === 0) {
    const status = sim.status();
    trace.push({
      time: Number(sim.time.toFixed(2)),
      routeStation: Number(driver.d.toFixed(2)),
      speedKmh: Number((speed * 3.6).toFixed(2)),
      angleDegrees: Number(((angle * 180) / Math.PI).toFixed(2)),
      grounded,
      onRoad,
      impact: Number(car.impact.toFixed(3)),
      liveScore: Number(status.event?.live?.value ?? 0),
      liveStars: status.event?.challenge?.stars ?? null,
      routeProgress: status.event?.progress ?? null,
      steer: Number(input.steer.toFixed(3)),
      throttle: Number(input.throttle.toFixed(3)),
      brake: Number(input.brake.toFixed(3)),
    });
  }
  result = sim.takeResult();
  if (sim.mode === 'free') break;
}
const finish = sim.status().event;
const previousTargets = [100, 300, 600];
const checks = {
  completed: result?.completed === true && !result.abandoned,
  positiveBankedDrift: (result?.driftScore ?? 0) > 0,
  firstMilestoneReached: (result?.stars ?? 0) >= 1,
  zeroOffRoadTime: offRoadSeconds === 0 && result?.offRouteSeconds === 0,
  noContacts: contactSamples === 0,
  noRecovery: replacements === 0,
  fullMeasuredProgress: finish?.progress === 1,
  finalLiveScoreMatchesResult: Number(finish?.live?.value) === result?.driftScore,
  firstGoalOnlyCalibrated:
    event.spec.stars?.[0] === 50 && event.spec.stars[1] === 300 && event.spec.stars[2] === 600,
};
const files = [
  'scripts/horizon-drift-validation.ts',
  'src/simulation/open-world/activity-progress.ts',
  'src/simulation/open-world/session.ts',
  'src/simulation/open-world/region-data.ts',
  'src/simulation/open-world/festival-events.ts',
  'src/simulation/open-world/route-driver.ts',
  'src/simulation/vehicle.ts',
];
const report = {
  kind: 'scripted-festival-drift-milestone',
  generatedAt: new Date().toISOString(),
  command: 'node --experimental-transform-types scripts/horizon-drift-validation.ts',
  settings,
  method: {
    normalControlsOnly: true,
    scriptedAssistance: true,
    inSessionAutopilot: false,
    explanation:
      'External scripted steering is assisted evidence even though the raw game result assisted flag is false. No human operator, renderer, forced physical state, injected score, career host or save persistence is used.',
  },
  goalCalibration: {
    eventId: event.spec.id,
    previousTargets,
    currentTargets: event.spec.stars,
    starsAtPreviousTargets: previousTargets.filter((target) => (result?.driftScore ?? 0) >= target)
      .length,
    rationale:
      'The beginner playground first milestone is 50 points. The 300/600 mastery goals, all other events and physics/scoring formulas are preserved. This run establishes the first milestone only, not mastery attainability or human usability.',
  },
  elapsedSimulationSeconds: sim.time,
  maximumSpeedKmh,
  maximumAngleDegrees,
  candidateDriftSeconds,
  groundedSeconds,
  offRoadSeconds,
  contactSamples,
  replacements,
  result,
  checks,
  passed: Object.values(checks).every(Boolean),
  sourceSha256: Object.fromEntries(
    files.map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
  ),
  trace,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, checks, result, passed: report.passed }, null, 2));
if (!report.passed) process.exitCode = 1;
