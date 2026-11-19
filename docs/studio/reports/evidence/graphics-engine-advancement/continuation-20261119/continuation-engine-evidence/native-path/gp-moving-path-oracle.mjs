import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const [root, output] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(resolve(root, path)).href);
const { BikeAIDriver, BIKE_AI } = await load('src/simulation/bike-ai.ts');
const { BikeVehicle } = await load('src/simulation/bike-vehicle.ts');
const { GP_R1 } = await load('src/simulation/bike-definitions.ts');
const { DEFAULT_SETUP } = await load('src/simulation/config.ts');
const { Track, trackPoint } = await load('src/simulation/track.ts');
const { CIRCUITS } = await load('src/simulation/circuits.ts');
const { racingLineFor, RACING_LINE } = await load('src/simulation/racing-line.ts');

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function bikeAt(station, lateral, speed, heading) {
  const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', GP_R1);
  bike.s = station;
  bike.lateral = lateral;
  bike.speed = bike.dynamics.speed = speed;
  bike.dynamics.heading = heading;
  bike.dynamics.motoGP.reset(speed);
  bike.dynamics.motoGP.lateralSpeed = 0;
  return bike;
}
function straight() {
  const track = new Track('clear', true);
  // Cache the actual Track's authored line before installing independent
  // analytic geometry. The driver override below owns the fixture's lane.
  racingLineFor(track);
  track.at = function (s, out = trackPoint()) {
      return Object.assign(out, { s, x: 0, y: 0, z: s, tx: 0, tz: 1, nx: 1, nz: 0,
        curvature: 0, width: 8, bank: 0, gradient: 0 });
  };
  return track;
}
class AnalyticDriver extends BikeAIDriver {
  constructor(bike, profile) { super(bike); this.profile = profile; }
  lineOffset(_track, station, _authored) { return this.profile(station); }
  steeringLineOffset(_track, station) { return this.profile(station); }
  steeringLineCurvature() { return 0; }
}
function select(driver, lane, rate, dt = 1 / 120) {
  Object.assign(driver.selectedRoadPath ??= {}, { valid: true, width: 1, lane,
    previousLane: lane - rate * dt, dt });
}

// World path x(s,t)=a(s-s0)+u*t, z(s,t)=s. Prescribe its actual world
// velocity directly; no controller formula defines the expected zero error.
const analytic = [];
for (const slope of [0, .25, -.25]) for (const rate of [-1.6, 0, 1.6]) {
  const station = 100, along = 30;
  const vx = slope * along + rate, vz = along;
  const speed = Math.hypot(vx, vz), heading = Math.atan2(vx, vz);
  const bike = bikeAt(station, 0, speed, heading), track = straight();
  const driver = new AnalyticDriver(bike, (s) => slope * (s - station));
  select(driver, 0, rate);
  const acceleration = driver.pathCorrection(track, 0, false) * speed * speed;
  const desiredHeading = Math.atan(slope) + Math.asin(rate / (speed * Math.hypot(1, slope)));
  analytic.push({ slope, rate, worldVelocity: { x: vx, z: vz }, speed, heading,
    nativeTarget: driver.steeringTarget, positionError: driver.steeringTarget - bike.lateral,
    nativeAcceleration: acceleration, movingReferenceHeading: desiredHeading,
    movingReferenceError: desiredHeading - heading,
    steadyLagAtThisCourse: -acceleration / BIKE_AI.bandwidth ** 2 });
}

// The exact unmocked authored Montejaral geometry at the recorded onset.
const track = new Track('clear', false, undefined, CIRCUITS.montejaral);
const line = racingLineFor(track);
const station = 932.8985149457721, lane = -6.002900499820026, wantedSpeed = 25.704114393955035;
const world = (s, t, rate) => {
  const p = track.at(s, trackPoint());
  const reach = Math.max(1, p.width - RACING_LINE.edgeMargin);
  const offset = clamp(line.offsetAt(s) + lane + rate * t, -reach, reach);
  return { x: p.x + p.nx * offset, z: p.z + p.nz * offset, offset, p };
};
const observed = [];
for (const rate of [-1.6, 0, 1.6]) {
  const h = 1e-4;
  const velocity = (stationRate) => {
    const before = world(station - stationRate * h, -h, rate);
    const after = world(station + stationRate * h, h, rate);
    return { x: (after.x - before.x) / (2 * h), z: (after.z - before.z) / (2 * h) };
  };
  let lo = 0, hi = 4 * wantedSpeed;
  for (let i = 0; i < 55; i++) {
    const mid = (lo + hi) / 2, v = velocity(mid);
    if (Math.hypot(v.x, v.z) < wantedSpeed) lo = mid; else hi = mid;
  }
  const stationRate = (lo + hi) / 2, v = velocity(stationRate), here = world(station, 0, rate);
  const speed = Math.hypot(v.x, v.z), heading = Math.atan2(v.x, v.z);
  const bike = bikeAt(station, here.offset, speed, heading);
  const driver = new BikeAIDriver(bike);
  select(driver, lane, rate);
  const acceleration = driver.pathCorrection(track, lane, false) * speed * speed;
  const spatialSlope = (line.offsetAt(station + 3) - line.offsetAt(station - 3)) / 6;
  const slope = spatialSlope / Math.max(.5, 1 - here.p.curvature * here.offset);
  const relative = Math.atan2(Math.sin(heading - Math.atan2(here.p.tx, here.p.tz)),
    Math.cos(heading - Math.atan2(here.p.tx, here.p.tz)));
  const desired = Math.atan(slope) + Math.asin(rate / (speed * Math.hypot(1, slope)));
  observed.push({ station, lane, rate, wantedSpeed, stationRate, worldVelocity: v,
    speed, heading, relativeCourse: relative, spatialSlope, slope,
    target: driver.steeringTarget, worldTarget: here.offset,
    positionError: driver.steeringTarget - here.offset, nativeAcceleration: acceleration,
    movingReferenceResidualAcceleration: 2 * BIKE_AI.damping * BIKE_AI.bandwidth * speed * (desired - relative) });
}

// A clamped near point does not determine the selected lane at the present
// station. Both world-space points below belong to the same raw lane.
const preview = (() => {
  const track = straight(), station = 100, speed = 30, lane = 3, slope = .2;
  const near = 6 + .48 * speed, reach = 8 - RACING_LINE.edgeMargin;
  const profile = (s) => slope * (s - station);
  const here = clamp(profile(station) + lane, -reach, reach);
  const ahead = clamp(profile(station + near) + lane, -reach, reach);
  const bike = bikeAt(station, here, speed, Math.atan(slope));
  bike.aiOffset = ahead;
  const driver = new AnalyticDriver(bike, profile);
  select(driver, lane, 0);
  driver.steerIntent(track, 0);
  return { station, speed, lane, slope, near, reach, selectedHere: here, selectedAhead: ahead,
    actualTarget: driver.steeringTarget, falsePositionError: driver.steeringTarget - here,
    nativeAcceleration: driver.steeringCorrection };
})();

const clampRates = [];
for (const dt of [1 / 120, 1 / 240]) {
  const reach = 8 - RACING_LINE.edgeMargin;
  for (const [label, oldLane, requestedRate] of [
    ['free slew', 3, 1.6], ['fully edge-clipped', reach + .1, 1.6],
    ['arriving at edge', reach - .004, 1.6], ['leaving edge', reach, -1.6],
  ]) {
    const nextLane = oldLane + requestedRate * dt;
    const before = clamp(oldLane, -reach, reach), after = clamp(nextLane, -reach, reach);
    clampRates.push({ label, dt, oldLane, nextLane, before, after, requestedRate,
      realizedRate: (after - before) / dt });
  }
}
const evidence = { root, analytic, observed, preview, clampRates };
writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
