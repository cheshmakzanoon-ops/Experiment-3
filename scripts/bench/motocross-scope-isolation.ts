/** Compare real non-MX gameplay against an explicit baseline checkout.
 * node --experimental-transform-types scripts/bench/motocross-scope-isolation.ts \
 *   --baseline ../motobound-baseline --candidate .
 *
 * Each checkout imports its own complete simulation module graph. No physics
 * state is patched. Every snapshot value is compared at every tick, including
 * the initial placement. Only the three named knobby foot poses and twelve
 * accepted-shift trajectory slots are reported separately from physical data;
 * their differences remain visible in the complete-frame hash and field list.
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Controls, SessionOptions } from '../../src/simulation/config.ts';
import type { BikeVehicle } from '../../src/simulation/bike-vehicle.ts';
import type { Vehicle } from '../../src/simulation/vehicle.ts';
import type { Simulation } from '../../src/simulation/world.ts';
import type { OpenWorldSimulation } from '../../src/simulation/open-world/session.ts';
import type { DirtBikeVehicle } from '../../src/simulation/offroad/dirt-bike-vehicle.ts';

type Protocol = typeof import('../../src/simulation/protocol.ts');
type Engine = Awaited<ReturnType<typeof loadEngine>>;
type Session = Simulation | OpenWorldSimulation;
type Scenario = {
  name: string;
  machine: string;
  circuit?: SessionOptions['circuit'];
  festival?: boolean;
  ai?: boolean;
};
const scenarios: Scenario[] = [
  { name: 'sm450-road', machine: 'sm450', circuit: 'aurel' },
  { name: 'sm450-outdoor-dirt', machine: 'sm450', circuit: 'valley-ridge-mx' },
  { name: 'sm450-stadium-dirt', machine: 'sm450', circuit: 'arena-nord-sx' },
  { name: 'gpr1-road', machine: 'gpr1', circuit: 'aurel' },
  { name: 'tc1-road', machine: 'tc1', circuit: 'aurel' },
  { name: 'mx250-road', machine: 'mx250', circuit: 'aurel' },
  { name: 'mx450-road', machine: 'mx450', circuit: 'aurel' },
  { name: 'sm450-festival', machine: 'sm450', festival: true },
  { name: 'sm450-outdoor-ai', machine: 'sm450', circuit: 'valley-ridge-mx', ai: true },
  { name: 'gpr1-road-ai', machine: 'gpr1', circuit: 'aurel', ai: true },
  { name: 'tc1-road-ai', machine: 'tc1', circuit: 'aurel', ai: true },
];

function argument(name: string, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing --${name} value`);
  return value;
}
async function moduleAt<T>(root: string, file: string): Promise<T> {
  return import(pathToFileURL(resolve(root, file)).href) as Promise<T>;
}
async function loadEngine(root: string) {
  const [world, config, events, identity, protocol, festival] = await Promise.all([
    moduleAt<typeof import('../../src/simulation/world.ts')>(root, 'src/simulation/world.ts'),
    moduleAt<typeof import('../../src/simulation/config.ts')>(root, 'src/simulation/config.ts'),
    moduleAt<typeof import('../../src/simulation/events.ts')>(root, 'src/simulation/events.ts'),
    moduleAt<typeof import('../../src/core/session-identity.ts')>(root, 'src/core/session-identity.ts'),
    moduleAt<Protocol>(root, 'src/simulation/protocol.ts'),
    moduleAt<typeof import('../../src/simulation/open-world/session.ts')>(root, 'src/simulation/open-world/session.ts'),
  ]);
  return { world, config, events, identity, protocol, festival };
}
function createSession(engine: Engine, scenario: Scenario): Session {
  if (scenario.festival) {
    if (!engine.festival.festivalAdmits(
      engine.festival.festivalVehicles().find((vehicle) => vehicle.id === scenario.machine)!,
    )) throw new Error(`Festival rejects ${scenario.machine}`);
    return new engine.festival.OpenWorldSimulation({
      vehicle: scenario.machine, assist: 'raw', seed: 30025, tileBudget: 24,
    });
  }
  const options = engine.config.validateOptions({
    ...engine.config.DEFAULT_OPTIONS,
    mode: 'practice', circuit: scenario.circuit, opponents: 0,
    vehicles: [scenario.machine], assist: 'raw', seed: 30025,
  });
  const errors = engine.events.sessionIncompatibilities(options);
  if (errors.length) throw new Error(`${scenario.name}: ${errors.join('; ')}`);
  const session = new engine.world.Simulation(options);
  session.autoPlayer = !!scenario.ai;
  return session;
}

/** Ordinary input sequence: drive, shift, lean, brake, provoke a fall, and
 * allow the existing recovery controller to return the rider to the bike. */
function scriptedInput(tick: number, hz: number, neutral: Controls): Controls {
  const t = tick / hz;
  let throttle = 0.62, brake = 0, steer = 0, clutch = 0;
  if (t >= 5 && t < 7) steer = 0.14 * Math.sin((t - 5) * Math.PI);
  if (t >= 7 && t < 9) { throttle = 0; brake = 0.65; clutch = 0.25; }
  if (t >= 9 && t < 13) throttle = 0.8;
  if (t >= 13 && t < 15) { throttle = 0; brake = 1; steer = 1; }
  if (t >= 15 && t < 35) throttle = 0.3;
  if (t >= 35 && t < 38) { throttle = 0; brake = 0.4; }
  if (t >= 38) throttle = 0.65;
  const shift = [1, 3, 5, 11, 40].some((at) => tick === Math.round(at * hz)) ? 1
    : [7, 8, 36].some((at) => tick === Math.round(at * hz)) ? -1 : 0;
  return { ...neutral, throttle, brake, steer, clutch, shift };
}
function labels(protocol: Protocol, length: number) {
  const names = Array.from({ length }, (_, index) => `slot[${index}]`);
  const add = (base: number, values: Record<string, number>, prefix: string) => {
    for (const [name, index] of Object.entries(values)) names[base + index] = `${prefix}.${name}`;
  };
  add(0, protocol.H, 'H');
  const car = protocol.carBase(0);
  for (const [base, fields, prefix] of [
    [0, protocol.F, 'F'], [protocol.RACE_BASE, protocol.R, 'R'],
    [protocol.BIKE_BASE, protocol.B, 'B'], [protocol.OFFROAD_BASE, protocol.O, 'O'],
  ] as const) add(car + base, fields, prefix);
  for (let wheel = 0; wheel < 4; wheel++)
    add(car + protocol.WHEEL_BASE + wheel * protocol.WHEEL_STRIDE, protocol.W, `W${wheel}`);
  for (const name of ['MX_FOOT', 'MX_MOTION', 'MX_PUSH', 'MX_POSTURE', 'MX_FOOT_TRAJECTORY'] as const)
    if (protocol[name]) add(car, protocol[name], name);
  return names;
}
function footFields(protocol: Protocol, scenario: Scenario) {
  if (!['mx250', 'mx450'].includes(scenario.machine)) return new Set<number>();
  const car = protocol.carBase(0);
  return new Set([...Object.values(protocol.MX_FOOT), ...Object.values(protocol.MX_FOOT_TRAJECTORY)]
    .map((offset) => car + offset));
}
type Difference = { tick: number; field: string; baseline: number; candidate: number };
function differenceGroup() {
  const hashes = [createHash('sha256'), createHash('sha256')];
  const fields = new Map<string, { count: number; firstTick: number; lastTick: number; maxAbs: number }>();
  let count = 0, maxAbs = 0, first: Difference | null = null, hashed = false;
  return {
    observe(tick: number, field: string, baseline: number, candidate: number) {
      if (Object.is(baseline, candidate)) return;
      count++;
      first ??= { tick, field, baseline, candidate };
      const delta = Number.isFinite(baseline) && Number.isFinite(candidate)
        ? Math.abs(baseline - candidate) : Infinity;
      maxAbs = Math.max(maxAbs, delta);
      const seen = fields.get(field) ?? { count: 0, firstTick: tick, lastTick: tick, maxAbs: 0 };
      seen.count++;
      seen.lastTick = tick;
      seen.maxAbs = Math.max(seen.maxAbs, delta);
      fields.set(field, seen);
    },
    hash(index: number, frame: Float32Array | Float64Array) {
      hashed = true;
      hashes[index].update(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength));
    },
    result() {
      return { count, maxAbs, first,
        ...(hashed ? { hashes: hashes.map((hash) => hash.digest('hex').slice(0, 16)) } : {}),
        fields: Object.fromEntries(fields) };
    },
  };
}
function directState(car: Vehicle) {
  const body = car.body;
  const state: Record<string, number> = { speed: car.speed, s: car.s, fuel: car.fuel, gear: car.gear };
  for (const key of ['position', 'velocity', 'omega', 'acceleration', 'angularAcceleration'] as const)
    for (const axis of ['x', 'y', 'z'] as const) state[`${key}.${axis}`] = body[key][axis];
  for (const axis of ['x', 'y', 'z', 'w'] as const) state[`orientation.${axis}`] = body.orientation[axis];
  if (car.definition.bike) {
    const bike = car as BikeVehicle;
    for (const key of ['speed', 'lean', 'leanRate', 'heading', 'stateClock', 'crashes'] as const)
      state[`dynamics.${key}`] = bike.dynamics[key];
  }
  if ('cgY' in car) {
    const dirt = car as DirtBikeVehicle;
    for (const key of ['cgY', 'vy', 'pitch', 'pitchRate', 'airYaw', 'airYawRate',
      'compressionFront', 'compressionRear', 'forceFront', 'forceRear',
      'frontSpin', 'rearSpin', 'standing', 'dab', 'riderBody'] as const)
      state[`offroad.${key}`] = dirt[key];
  }
  car.tires.forEach((tire, index) => {
    for (const key of ['omega', 'load', 'compression', 'length', 'fx', 'fy', 'slip', 'angle',
      'rotation', 'surfaceTemp', 'discTemp', 'wear'] as const)
      state[`tire${index}.${key}`] = tire[key];
  });
  return state;
}
function outcome(session: Session, observations: { distance: number; peakSpeed: number; gears: Set<number>; states: Set<string> }) {
  const car = session.cars[0], bike = car.definition.bike ? car as BikeVehicle : null;
  return {
    distance: observations.distance, peakSpeed: observations.peakSpeed,
    gears: [...observations.gears], states: [...observations.states],
    speed: car.speed, s: car.s, retired: car.retired,
    crashes: bike?.dynamics.crashes ?? 0, state: bike?.dynamics.state ?? 'four-wheel',
    ...('race' in session ? {
      completedLaps: session.race.laps[0].completed,
      lapValid: session.race.laps[0].valid, events: session.race.control.events,
    } : { festivalRoad: session.status().road.onRoad }),
  };
}
function identity(engine: Engine, session: Session) {
  if (!('race' in session)) return { simulationVersion: engine.identity.SIMULATION_VERSION };
  return engine.identity.sessionIdentity(session.options);
}
function runScenario(baseline: Engine, candidate: Engine, scenario: Scenario, hz: number, seconds: number) {
  const sessions = [createSession(baseline, scenario), createSession(candidate, scenario)];
  const frames = sessions.map((session) => session.makeFrame());
  if (frames[0].length !== frames[1].length) throw new Error(`${scenario.name}: frame length changed`);
  const names = labels(candidate.protocol, frames[0].length);
  const visual = footFields(candidate.protocol, scenario), ticks = Math.round(seconds * hz);
  const all = differenceGroup(), physics = differenceGroup(), afterPlacement = differenceGroup();
  const foot = differenceGroup(), direct = differenceGroup();
  const physicalFrames = frames.map((frame) => new Float32Array(frame.length));
  const observations = sessions.map(() => ({ distance: 0, peakSpeed: 0, gears: new Set<number>(), states: new Set<string>() }));
  const previous = sessions.map((session) => ({ ...session.cars[0].body.position }));
  const identityPair = [identity(baseline, sessions[0]), identity(candidate, sessions[1])];
  const identityRest = identityPair.map(({ simulationVersion: _version, ...rest }) => rest);
  const controls = { throttleTicks: 0, brakeTicks: 0, shiftEdges: 0, resetCommands: 0 };
  let nonFiniteValues = 0;
  for (let tick = 0; tick <= ticks; tick++) {
    if (tick > 0) {
      const input = scriptedInput(tick - 1, hz, baseline.config.controls());
      if (!scenario.ai) {
        if (input.throttle) controls.throttleTicks++;
        if (input.brake) controls.brakeTicks++;
        if (input.shift) controls.shiftEdges++;
        for (const session of sessions) session.setInput(input);
      }
      // The Festival exposes an ordinary reset-to-road command; compare the
      // ordinary post-step frame following this lifecycle operation too.
      if (scenario.festival && tick === Math.round(30 * hz)) {
        for (const session of sessions) if ('command' in session) session.command({ type: 'reset' });
        controls.resetCommands++;
      }
      for (const session of sessions) session.step(1 / hz);
    }
    for (let side = 0; side < 2; side++) {
      sessions[side].writeFrame(frames[side]);
      all.hash(side, frames[side]);
      physicalFrames[side].set(frames[side]);
      for (const index of visual) physicalFrames[side][index] = 0;
      physics.hash(side, physicalFrames[side]);
      if (tick) afterPlacement.hash(side, physicalFrames[side]);
      const car = sessions[side].cars[0], seen = observations[side], pos = car.body.position;
      if (!(scenario.festival && tick === Math.round(30 * hz)))
        seen.distance += Math.hypot(pos.x - previous[side].x, pos.z - previous[side].z);
      previous[side] = { ...pos };
      seen.peakSpeed = Math.max(seen.peakSpeed, car.speed);
      seen.gears.add(car.gear);
      seen.states.add(car.definition.bike ? (car as BikeVehicle).dynamics.state : 'four-wheel');
    }
    for (let field = 0; field < frames[0].length; field++) {
      const left = frames[0][field], right = frames[1][field];
      if (!Number.isFinite(left) || !Number.isFinite(right)) nonFiniteValues++;
      all.observe(tick, names[field], left, right);
      if (visual.has(field)) foot.observe(tick, names[field], left, right);
      else {
        physics.observe(tick, names[field], left, right);
        if (tick) afterPlacement.observe(tick, names[field], left, right);
      }
    }
    const directPair = sessions.map((session) => directState(session.cars[0]));
    directPair.forEach((state, side) => direct.hash(side, Float64Array.from(Object.values(state))));
    for (const [name, left] of Object.entries(directPair[0]))
      direct.observe(tick, name, left, directPair[1][name]);
  }
  const outcomes = sessions.map((session, side) => outcome(session, observations[side]));
  return {
    scenario: scenario.name, hz, seconds: ticks / hz, ticks, snapshots: ticks + 1,
    frameValuesCompared: (ticks + 1) * frames[0].length, nonFiniteValues,
    identity: { versions: identityPair.map((value) => value.simulationVersion),
      remainingFieldsEqual: JSON.stringify(identityRest[0]) === JSON.stringify(identityRest[1]) },
    completeFrame: all.result(), physicalFrame: physics.result(),
    physicalAfterPlacement: afterPlacement.result(), footAnimation: foot.result(), directPhysicalState: direct.result(),
    controls, outcomesEqual: JSON.stringify(outcomes[0]) === JSON.stringify(outcomes[1]), outcomes,
  };
}

const baselinePath = argument('baseline'), candidatePath = argument('candidate', process.cwd());
if (!baselinePath) throw new Error('Pass --baseline <untouched-checkout>');
const hz = Number(argument('hz', '120')), seconds = Number(argument('seconds', '48'));
if (![hz, seconds].every((value) => Number.isFinite(value) && value > 0))
  throw new Error('--hz and --seconds must be positive finite numbers');
const selected = scenarios.filter((scenario) => scenario.name.includes(argument('scenario')));
if (!selected.length) throw new Error('No scenario matched');
const [baseline, candidate] = await Promise.all([loadEngine(baselinePath), loadEngine(candidatePath)]);
console.log(JSON.stringify({ baseline: resolve(baselinePath), candidate: resolve(candidatePath),
  seed: 30025, scenarios: selected.length, physicalTolerance: 0 }));
let failures = 0;
for (const scenario of selected) {
  const result = runScenario(baseline, candidate, scenario, hz, seconds);
  const compactGroup = (group: ReturnType<ReturnType<typeof differenceGroup>['result']>) => {
    const { fields, ...rest } = group;
    return { ...rest, fields: Object.keys(fields) };
  };
  console.log(JSON.stringify(process.argv.includes('--details') ? result : {
    scenario: result.scenario, hz, seconds: result.seconds,
    snapshots: result.snapshots, frameValuesCompared: result.frameValuesCompared,
    nonFiniteValues: result.nonFiniteValues, identity: result.identity,
    completeFrame: compactGroup(result.completeFrame), physicalFrame: compactGroup(result.physicalFrame),
    physicalAfterPlacement: compactGroup(result.physicalAfterPlacement),
    footAnimation: compactGroup(result.footAnimation), directPhysicalState: compactGroup(result.directPhysicalState),
    controls: result.controls, outcomesEqual: result.outcomesEqual,
    outcomes: result.outcomes.map((value) => Object.fromEntries(
      Object.entries(value).filter(([name]) => name !== 'events'),
    )),
  }));
  if (result.physicalFrame.count || result.directPhysicalState.count || !result.outcomesEqual ||
      result.nonFiniteValues || !result.identity.remainingFieldsEqual) failures++;
}
console.log(JSON.stringify({ comparedScenarios: selected.length, physicalMismatchScenarios: failures }));
if (failures) process.exitCode = 1;
