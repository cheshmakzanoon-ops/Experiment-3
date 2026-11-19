// Read-only diagnostic for the frozen road-contact / momentum / thermal checkpoint.
// Run: node --experimental-transform-types scripts/studio/tools/gp-contact-checkpoint.mjs 1000 [from=3090] [to=3190] [seconds=600]
// stdout: JSONL in the station window. stderr: all falls and final summary.
import { clamp, mod } from '../../../src/core/math.ts';
import { DEFAULT_OPTIONS } from '../../../src/simulation/config.ts';
import { PHASE } from '../../../src/simulation/race.ts';
import { trackPoint } from '../../../src/simulation/track.ts';
import { Simulation } from '../../../src/simulation/world.ts';

const seed = Number(process.argv[2] ?? 1000);
const from = Number(process.argv[3] ?? 3090);
const to = Number(process.argv[4] ?? 3190);
const seconds = Number(process.argv[5] ?? 600);
const dt = 1 / 120;
const sim = new Simulation({
  ...DEFAULT_OPTIONS,
  circuit: 'ardennes',
  mode: 'race',
  ruleset: 'gp-motorcycle',
  laps: 1,
  opponents: 3,
  vehicles: Array(4).fill('gpr1'),
  seed,
});
sim.autoPlayer = true;
const seen = new Array(4).fill(0);
const falls = [];
const road = [];
const inverse = [];
const beforeFall = [];
const distance = sim.cars.map((c) => ({
  s: c.s,
  x: c.dynamics.x,
  z: c.dynamics.z,
  frameDs: 0,
  frameTravel: 0,
  intervalDs: 0,
  intervalTravel: 0,
}));
const point = trackPoint();
const rounded = (v) => Math.round(v * 1e6) / 1e6;
for (let id = 0; id < sim.cars.length; id++) {
  const dynamics = sim.cars[id].dynamics;
  const gp = dynamics.motoGP;
  const originalInverse = gp.frontSteerFor.bind(gp);
  gp.frontSteerFor = (...args) => {
    const steer = originalInverse(...args);
    inverse[id] = {
      bodyForce: args[0],
      lean: args[1],
      speed: args[2],
      longitudinal: args[3],
      load: args[4],
      mu: args[5],
      steer,
    };
    return steer;
  };
  const originalFall = dynamics.fall.bind(dynamics);
  dynamics.fall = (kind) => {
    if (dynamics.state === 'riding')
      beforeFall[id] = {
        kind,
        lean: dynamics.lean,
        rollRate: dynamics.leanRate,
        speed: dynamics.speed,
        frontFy: gp.frontFy,
        rearFy: gp.rearFy,
        yawRate: gp.yawRate,
        lateralSpeed: gp.lateralSpeed,
        lateralAcceleration: gp.lateralAcceleration,
        lateralDemand: gp.lateralDemand,
        leanTarget: gp.leanTarget,
      };
    return originalFall(kind);
  };
  const suspension = sim.cars[id].roadSuspension;
  const original = suspension.step.bind(suspension);
  suspension.step = (q, stepDt) => {
    road[id] = {
      dt: stepDt,
      q: { ...q },
      before: {
        height: suspension.height,
        verticalSpeed: suspension.velocity,
        pitch: suspension.pitch,
        pitchRate: suspension.pitchRate,
      },
    };
    original(q, stepDt);
  };
}

function state(c, id) {
  const d = c.dynamics;
  const g = d.motoGP;
  const ai = sim.ai[id];
  const p = sim.track.at(c.s, point);
  const near = clamp(6 + c.speed * 0.48, 8, 46);
  const tactical = c.aiOffset - ai.steeringLineOffset(sim.track, c.s + near);
  const lineOffset = ai.steeringLineOffset(sim.track, c.s);
  const targetOffset = clamp(lineOffset + tactical, -p.width + 1.4, p.width - 1.4);
  const lineSlope =
    (ai.steeringLineOffset(sim.track, c.s + 3) - ai.steeringLineOffset(sim.track, c.s - 3)) / 6;
  return {
    id,
    s: rounded(c.s),
    lateral: rounded(c.lateral),
    aiOffset: rounded(c.aiOffset),
    tacticalOffset: rounded(tactical),
    sharedTacticalOffset: rounded(ai.tactical),
    targetOffset: rounded(targetOffset),
    lineOffset: rounded(lineOffset),
    lineSlope: rounded(lineSlope),
    steeringCorrection: rounded(ai.steeringCorrection),
    centrelineCurvature: rounded(p.curvature),
    offsetMetricWithoutTacticalSlope: rounded(
      Math.hypot(1 - p.curvature * targetOffset, lineSlope),
    ),
    frameCentrelineDs: rounded(distance[id].frameDs),
    framePlanarTravel: rounded(distance[id].frameTravel),
    sinceLogCentrelineDs: rounded(distance[id].intervalDs),
    sinceLogPlanarTravel: rounded(distance[id].intervalTravel),
    x: rounded(d.x),
    z: rounded(d.z),
    heading: rounded(d.heading),
    speed: rounded(c.speed),
    forwardSpeed: rounded(d.speed),
    targetSpeed: rounded(c.aiTarget),
    planNextSpeed: rounded(ai.planNext),
    planDistance: rounded(ai.planDistance),
    planRecovery: rounded(ai.planRecovery),
    planLimit: rounded(ai.planLimit),
    throttle: rounded(c.throttle),
    brake: rounded(c.brake),
    inputSteer: rounded(c.input.steer),
    bars: rounded(d.steer),
    lean: rounded(d.lean),
    rollRate: rounded(d.leanRate),
    yawRate: rounded(g?.yawRate ?? 0),
    lateralSpeed: rounded(g?.lateralSpeed ?? 0),
    frontLoad: rounded(d.frontLoad),
    rearLoad: rounded(d.rearLoad),
    frontUse: rounded(d.frontUse),
    rearUse: rounded(d.rearUse),
    frontBrakeForce: rounded(d.frontBrakeForce),
    rearBrakeForce: rounded(d.rearBrakeForce),
    lateralDemand: rounded(g?.lateralDemand ?? 0),
    leanTarget: rounded(g?.leanTarget ?? 0),
    lateralAcceleration: rounded(g?.lateralAcceleration ?? 0),
    frontFy: rounded(g?.frontFy ?? 0),
    rearFy: rounded(g?.rearFy ?? 0),
    groundSteer: rounded(g?.groundSteer ?? 0),
    inverse: inverse[id],
    beforeFall: beforeFall[id],
    longitudinalAcceleration: rounded(d.longitudinal),
    grip: rounded(d.grip),
    frontGrip: rounded(d.frontGrip ?? d.grip),
    rearGrip: rounded(d.rearGrip ?? d.grip),
    frontTemperature: rounded(c.tires[0].surfaceTemp),
    rearTemperature: rounded(c.tires[2].surfaceTemp),
    roadSlope: rounded(d.slope),
    frontGround: rounded(c.contacts[0].height),
    rearGround: rounded(c.contacts[2].height),
    frontGap: rounded(c.roadSuspension.frontGap),
    rearGap: rounded(c.roadSuspension.rearGap),
    bodyHeight: rounded(c.body.position.y),
    verticalSpeed: rounded(c.roadSuspension.velocity),
    verticalAcceleration: rounded(c.roadSuspension.acceleration),
    pitch: rounded(c.roadSuspension.pitch),
    road: road[id],
    frontHealth: rounded(c.frontHealth),
    rearHealth: rounded(c.rearHealth),
    impact: rounded(c.impact),
    crashes: d.crashes,
    state: d.state,
    decision: ai.decision,
    afterFlag: c.finishTime > 0,
  };
}

console.error(
  JSON.stringify({ event: 'configuration', seed, circuit: 'ardennes', dt, from, to, seconds }),
);
for (let frame = 0; frame < 120 * seconds && sim.race.phase !== PHASE.FINISHED; frame++) {
  sim.step(dt);
  for (let id = 0; id < sim.cars.length; id++) {
    const c = sim.cars[id];
    const previous = distance[id];
    previous.frameDs =
      mod(c.s - previous.s + sim.track.length / 2, sim.track.length) - sim.track.length / 2;
    previous.frameTravel = Math.hypot(c.dynamics.x - previous.x, c.dynamics.z - previous.z);
    previous.intervalDs += previous.frameDs;
    previous.intervalTravel += previous.frameTravel;
    previous.s = c.s;
    previous.x = c.dynamics.x;
    previous.z = c.dynamics.z;
  }
  const fell = sim.cars.some((c, id) => c.dynamics.crashes > seen[id]);
  const inWindow = sim.cars.some((c) => c.s >= from && c.s <= to);
  if ((frame % 6 === 0 || fell) && inWindow) {
    console.log(JSON.stringify({ time: rounded((frame + 1) * dt), cars: sim.cars.map(state) }));
    for (const q of distance) {
      q.intervalDs = 0;
      q.intervalTravel = 0;
    }
  }
  if (fell) {
    const event = {
      event: 'fall',
      time: rounded((frame + 1) * dt),
      cars: sim.cars.map(state).filter((c, id) => c.crashes > seen[id]),
    };
    falls.push(event);
    console.error(JSON.stringify(event));
  }
  for (let id = 0; id < sim.cars.length; id++) seen[id] = sim.cars[id].dynamics.crashes;
}
console.error(
  JSON.stringify({
    event: 'summary',
    finished: sim.race.phase === PHASE.FINISHED,
    fallEvents: falls.length,
    cars: sim.cars.map((c, id) => ({
      id,
      s: c.s,
      finishTime: c.finishTime,
      crashes: c.dynamics.crashes,
    })),
  }),
);
