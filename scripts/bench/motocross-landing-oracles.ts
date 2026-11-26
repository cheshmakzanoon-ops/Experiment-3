/** Read-only landing-oracle audit. Ordinary controls and unchanged surveyed terrain.
 * Run: node --experimental-transform-types scripts/bench/motocross-landing-oracles.ts
 * Optional --adapter-ref=<git commit> loads that adapter's methods in memory only;
 * all other engine modules remain current and are identified in the evidence.
 * The source constructor must be unchanged at that reference. No files are switched.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { CAR_STRIDE, HEADER } from '../../src/simulation/protocol.ts';
import { DirtBikeAIDriver, jumpHoldSpeed } from '../../src/simulation/offroad/ai.ts';
import { DirtBikeVehicle, type LandingRecord } from '../../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_250, MX_450 } from '../../src/simulation/offroad/dirt-bikes.ts';
import { LANDING_RULES } from '../../src/simulation/offroad/riding-feedback.ts';
import { offroadCourse } from '../../src/simulation/offroad/venues.ts';
import { trackPoint } from '../../src/simulation/track.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { PLAYER_CASES, runPlayerFlight } from './motocross-player-dynamics.ts';

const root = new URL('../../', import.meta.url);
const adapterPath = 'src/simulation/offroad/dirt-bike-vehicle.ts';
const sourcePaths = [adapterPath, 'src/simulation/offroad/ai.ts',
  'src/simulation/offroad/mx-ground-physics.ts', 'src/simulation/offroad/contact-impulse.ts',
  'src/simulation/offroad/rider-weight.ts', 'src/simulation/bike.ts',
  'src/simulation/bike-vehicle.ts', 'src/simulation/offroad/profile.ts',
  'src/simulation/offroad/venues.ts', 'scripts/bench/motocross-player-dynamics.ts'];
const digest = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const fingerprints = () => Object.fromEntries(sourcePaths.map(path =>
  [path, digest(readFileSync(new URL(path, root)))]));

type Boundary = { front: boolean; rear: boolean; time: number };
// Observe TS-private values through a diagnostic-only structural view.
type InternalObservation = {
  vertical(dt: number, boundary?: Boundary): void;
  referenceSag: { fork: number; shock: number };
};

function corridor(side: -1 | 1, ridden: boolean, observe = true) {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', weather: 'clear',
    circuit: 'arena-nord-sx', opponents: 0, vehicles: ['mx450'], seed: 41003 });
  const bike = sim.cars[0] as DirtBikeVehicle;
  const internal = bike as unknown as InternalObservation;
  const course = offroadCourse(sim.track.circuit)!;
  const jump = course.jumps.find(item => item.name === 'FINISH TRIPLE')!;
  for (let tick = 0; tick < 720; tick++) sim.step(1 / 120);
  bike.place(sim.track, jump.start - 24, side * 5.5);
  bike.dynamics.speed = jumpHoldSpeed(jump);
  bike.gear = 2;
  sim.autoPlayer = true;
  const ai = sim.ai[0] as DirtBikeAIDriver;
  if (ridden) {
    bike.aiControlled = () => {};
    const update = ai.update.bind(ai);
    ai.update = (...args) => {
      update(...args);
      if (bike.airborne) {
        bike.input.steer = 0;
        bike.input.brake = 0;
      }
    };
  }
  const axle = (front: boolean) => {
    const spec = bike.definition.bike!, arm = front ? spec.cgToFront : -spec.cgToRear;
    const heading = bike.dynamics.heading + bike.airYaw;
    const x = bike.dynamics.x + Math.sin(heading) * arm;
    const z = bike.dynamics.z + Math.cos(heading) * arm;
    const freeY = bike.cgY + arm * Math.sin(bike.pitch) -
      (spec.cgHeight + (front ? internal.referenceSag.fork : internal.referenceSag.shock)) * Math.cos(bike.pitch);
    const point = trackPoint();
    const lateral = sim.track.nearest(x, z, point, freeY);
    const patch = bike.contacts[front ? 0 : 2];
    const along = -(patch.normal.x * Math.sin(heading) + patch.normal.z * Math.cos(heading)) /
      Math.max(0.1, patch.normal.y);
    return { s: point.s, lateral, x, z, freeY, terrainY: patch.height,
      gap: freeY - patch.height, slope: Math.atan(along) };
  };
  const contacts: { boundary: Boundary | null; s: number; time: number;
    front: ReturnType<typeof axle>; rear: ReturnType<typeof axle>; landing: LandingRecord }[] = [];
  const vertical = internal.vertical;
  if (observe) internal.vertical = function(dt, boundary) {
    const wasAirborne = bike.airborne, previous = bike.lastLanding;
    const before = { boundary: boundary ?? null, s: bike.s, time: bike.clock,
      front: axle(true), rear: axle(false) };
    vertical.call(this, dt, boundary);
    // For swept player contact, the nested boundary call is the actual tyre
    // event. Its enclosing full-flight call must not duplicate that event.
    if (wasAirborne && !bike.airborne && bike.lastLanding !== previous && bike.lastLanding &&
        (boundary || !ridden) && bike.lastLanding.s > jump.takeoff)
      contacts.push({ ...before, landing: { ...bike.lastLanding } });
  };
  let departureLateral: number | null = null;
  const frame = new Float32Array(HEADER + sim.cars.length * CAR_STRIDE);
  const snapshotHash = createHash('sha256'), physicalHash = createHash('sha256');
  for (let tick = 0; tick < 8 * 120 && bike.s < jump.end + 4; tick++) {
    sim.step(1 / 120);
    sim.writeFrame(frame);
    snapshotHash.update(new Uint8Array(frame.buffer));
    physicalHash.update(new Uint8Array(new Float64Array([
      bike.clock, bike.s, bike.dynamics.x, bike.dynamics.z, bike.dynamics.heading,
      bike.dynamics.speed, bike.slide, bike.cgY, bike.vy, bike.pitch, bike.pitchRate,
      bike.airYaw, bike.airYawRate, bike.forceFront, bike.forceRear, bike.fork, bike.shock,
      bike.frontSpin, bike.rearSpin, bike.riderBody, bike.riderBodyRate, bike.standing,
      bike.fuel, bike.airTime, ...bike.tires.flatMap(tire => [tire.discTemp, tire.surfaceTemp,
        tire.carcassTemp, tire.coreTemp, tire.fx, tire.fy, tire.energy]),
    ]).buffer));
    if (departureLateral === null && bike.airborne && bike.s > jump.start)
      departureLateral = bike.lateral;
  }
  const first = contacts.find(item => item.landing.airTime > 1) ?? contacts[0] ?? null;
  return { side, ridden, jump, lower: jump.landing - jump.landingLength / 2,
    upper: jump.landing + jump.landingLength / 2, departureLateral, first, contacts,
    snapshotSha256: snapshotHash.digest('hex'), physicalSha256: physicalHash.digest('hex'),
    final: { s: bike.s, lateral: bike.lateral, speed: bike.speed, riding: bike.riding },
    crashes: bike.crashCauses.slice(), aborts: ai.decisions.aborts };
}

/** Independent threshold classification of the frozen incoming record plus
 * its observed shaft maximum. This does not predict a physical trajectory. */
function thresholdVerdict(record: LandingRecord, config: typeof PLAYER_CASES[number]) {
  const spec = (config.machine === 'mx250' ? MX_250 : MX_450).bike!.offroad!;
  const real = record.takeoffSpeed > LANDING_RULES.rollingHopSpeed &&
    record.airTime > LANDING_RULES.minimumAirTime;
  if (real && Math.abs(record.yawError) > 1e-9 &&
      Math.abs(record.lateralSpeed) > LANDING_RULES.crossedCrashSpeed) return 'crash-side';
  if (real && record.pitchError < -spec.noseDownLimit &&
      record.normalSpeed > LANDING_RULES.noseDownNormalSpeed) return 'crash-front';
  if (real && record.pitchError > spec.noseUpLimit &&
      record.normalSpeed > LANDING_RULES.noseUpNormalSpeed) return 'crash-rear';
  if (record.bottomSpeed > spec.bottomOutSpeed) return 'crash-flat';
  return record.bottomSpeed > LANDING_RULES.bottomedShaftSpeed ? 'bottomed' : 'clean';
}

async function main() {
  const before = fingerprints();
  const ref = process.argv.find(arg => arg.startsWith('--adapter-ref='))?.slice('--adapter-ref='.length);
  let adapterSource = readFileSync(new URL(adapterPath, root), 'utf8');
  if (ref) {
    adapterSource = execFileSync('git', ['show', `${ref}:${adapterPath}`],
      { cwd: fileURLToPath(root), encoding: 'utf8' });
    const sourceUrl = new URL(adapterPath, root);
    const js = stripTypeScriptTypes(adapterSource, { mode: 'transform' })
      .replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote, path: string) =>
        `from '${new URL(path, sourceUrl).href}'`);
    const frozen = (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`))
      .DirtBikeVehicle.prototype as object;
    for (const key of Object.getOwnPropertyNames(frozen))
      if (key !== 'constructor')
        Object.defineProperty(DirtBikeVehicle.prototype, key, Object.getOwnPropertyDescriptor(frozen, key)!);
  }
  const corridorRows = ([-1, 1] as const).flatMap(side =>
    [false, true].map(ridden => {
      const observed = corridor(side, ridden), unobserved = corridor(side, ridden, false);
      return { ...observed, observationPreservesTrace:
        observed.snapshotSha256 === unobserved.snapshotSha256 &&
        observed.physicalSha256 === unobserved.physicalSha256,
      acceptedByExistingContract: observed.first !== null &&
        observed.first.landing.s > observed.lower && observed.first.landing.s < observed.upper &&
        observed.crashes.length === 0 && observed.final.s > observed.jump.end && observed.aborts === 0 };
    }));
  const flights = PLAYER_CASES.flatMap(config =>
    (['front-lock', 'held-whip'] as const).flatMap(scenario => {
      const rates = config.assist === 'raw' && scenario === 'front-lock' ? [240, 480, 960, 1920] : [240, 480];
      return rates.map(hz => {
        const run = runPlayerFlight({ ...config, hz }, scenario);
        return { config: run.config, scenario, landing: run.landing,
          expectedFromThresholds: run.landing ? thresholdVerdict(run.landing, config) : null,
          crashes: run.crashes, crashCauses: run.crashCauses, violations: run.violations,
          incomingStable: run.incomingStable, recovered: run.final.riding,
          traceSha256: run.traceSha256 };
      });
    }));
  const after = fingerprints();
  const adapterSha256 = digest(adapterSource);
  const effectiveBefore = ref ? { ...before, [adapterPath]: adapterSha256 } : before;
  const effectiveAfter = ref ? { ...after, [adapterPath]: adapterSha256 } : after;
  const evidence = { method: 'Actual first-contact footprint, public CG-zone contract, and independently checked landing thresholds; ordinary controls only.',
    adapterRef: ref ?? null, adapterSha256, before, after, effectiveBefore, effectiveAfter,
    sourceStable: JSON.stringify(effectiveBefore) === JSON.stringify(effectiveAfter), corridor: corridorRows, flights };
  console.log(JSON.stringify(evidence, null, 2));
  // Exit status describes the audit's integrity, not whether the known
  // corridor acceptance blockers have disappeared. They are explicit above.
  if (!evidence.sourceStable || corridorRows.some(row => !row.observationPreservesTrace) ||
      flights.some(row => row.violations.length || !row.incomingStable ||
      !row.recovered || row.landing?.outcome !== row.expectedFromThresholds)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
