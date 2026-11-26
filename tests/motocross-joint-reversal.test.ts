import { expect, it } from 'vitest';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { sampleMxJointField } from '../src/rendering/offroad/mx-machine-pose.ts';
import { sampleBikeField } from '../src/rendering/snapshot-interpolation.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine } from '../src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import {
  B, BIKE_BASE, CAR_STRIDE, F, H, HEADER, K, MX_MOTION, O, OFFROAD_BASE, R, RACE_BASE,
  SKID_BASE, W, WHEEL_BASE, WHEEL_STRIDE, carBase, hasMxMachineMotion,
} from '../src/simulation/protocol.ts';
import { vehicleAt, vehicleIndex } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';
import { rideMotocrossFlight } from './motocross-flight-controls.ts';

const car = carBase(0), dt = 1 / 30;
const joints = [
  { name: 'fork', field: B.FORK, rate: MX_MOTION.FORK_RATE },
  { name: 'shock', field: B.SHOCK, rate: MX_MOTION.SHOCK_RATE },
  { name: 'steering', field: B.STEER, rate: MX_MOTION.STEER_RATE },
] as const;

function frame(time: number) {
  const value = new Float32Array(HEADER + CAR_STRIDE);
  value[H.CARS] = 1;
  value[H.TIME] = time;
  value[car + F.QW] = 1;
  value[car + RACE_BASE + R.VEHICLE] = vehicleIndex('mx250');
  value[car + MX_MOTION.VALID] = 1;
  for (let wheel = 0; wheel < 4; wheel++) {
    value[car + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LOAD] = 600;
    value[car + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LENGTH] = 0.5;
  }
  return value;
}

it.each(joints)('preserves a resolved $name extremum at equal and nearly equal positions', ({ field, rate }) => {
  for (const difference of [0, 5e-9]) for (const direction of [-1, 1]) {
    const a = frame(0), b = frame(dt), p = car + BIKE_BASE + field, r = car + rate;
    a[p] = 0.08;
    b[p] = 0.08 + difference;
    a[r] = 0.6 * direction;
    b[r] = -0.6 * direction;
    const interval = b[H.TIME] - a[H.TIME];
    // A symmetric constant acceleration produces this quadratic peak/trough.
    const expected = (a[p] + b[p]) / 2 + a[r] * interval / 4;
    expect(sampleBikeField(a, b, car, field, 0.5)).toBeCloseTo(expected, 12);
    expect(Math.abs(expected - a[p])).toBeGreaterThan(0.0049);
    const display = new PresentedFrame();
    const middle = display.sample(a, b, 0.5);
    expect(middle[p]).toBe(Math.fround(expected));
    expect(Math.abs(middle[r])).toBeLessThan(1e-6);
    expect(display.sample(a, b, 0)).toEqual(a);
    expect(display.sample(a, b, 1)).toEqual(b);
    expect(display.sample(b, b, 0.5)[r]).toBe(b[r]);
  }
});

it.each(joints)('meets the next $name interval with the same observed velocity', ({ field, rate }) => {
  const a = frame(0), b = frame(dt), c = frame(2 * dt);
  const p = car + BIKE_BASE + field, r = car + rate;
  a[p] = b[p] = 0.12;
  c[p] = 0.08;
  a[r] = 0.6;
  b[r] = -0.6;
  c[r] = -1.8;
  const epsilon = 1e-5, interval = b[H.TIME] - a[H.TIME], display = new PresentedFrame();
  const leftRate = (b[p] - sampleBikeField(a, b, car, field, 1 - epsilon)) / (interval * epsilon);
  const rightRate = (sampleBikeField(b, c, car, field, epsilon) - b[p]) / (interval * epsilon);
  expect(leftRate).toBeCloseTo(b[r], 4);
  expect(rightRate).toBeCloseTo(b[r], 4);
  expect(display.sample(a, b, 1 - epsilon)[r]).toBeCloseTo(b[r], 4);
  expect(display.sample(b, c, epsilon)[r]).toBeCloseTo(b[r], 4);
});

it.each(joints)('bounds every $name sample at travel stops and rejects inconsistent reversal rates', ({ field, rate }) => {
  const spec = vehicleAt(vehicleIndex('mx250')).bike!;
  const maximum = Math.fround(field === B.FORK ? spec.forkTravel
    : field === B.SHOCK ? spec.shockTravel : spec.maxSteer);
  const minimum = field === B.STEER ? -maximum : 0;
  for (const position of [minimum, minimum + 0.001, maximum - 0.001, maximum]) {
    for (const direction of [-1, 1]) {
      const a = frame(0), b = frame(dt), p = car + BIKE_BASE + field, r = car + rate;
      a[p] = b[p] = position;
      a[r] = direction * 3;
      b[r] = -direction * 3;
      for (let sub = 0; sub <= 64; sub++) {
        const value = sampleMxJointField(a, b, car, field, sub / 64)!;
        expect(value).toBeGreaterThanOrEqual(minimum);
        expect(value).toBeLessThanOrEqual(maximum);
      }
    }
  }
  const a = frame(0), b = frame(dt), p = car + BIKE_BASE + field, r = car + rate;
  a[p] = b[p] = 0.12;
  a[r] = 2;
  b[r] = -0.01;
  expect(sampleMxJointField(a, b, car, field, 0.5)).toBe(a[p]);
});

const edges = [
  { name: 'takeoff', field: OFFROAD_BASE + O.AIRBORNE, value: 1 },
  { name: 'front contact', field: WHEEL_BASE + W.LOAD, value: 0 },
  { name: 'rear contact', field: WHEEL_BASE + 2 * WHEEL_STRIDE + W.LOAD, value: 0 },
  { name: 'landing speed', field: OFFROAD_BASE + O.LANDING_SPEED, value: 2 },
  { name: 'landing pitch', field: OFFROAD_BASE + O.LANDING_PITCH, value: 0.1 },
  { name: 'bottoming', field: OFFROAD_BASE + O.BOTTOM, value: 0.5 },
  { name: 'impact', field: F.IMPACT, value: 0.5 },
  { name: 'skid contact', field: SKID_BASE + K.CONTACTS, value: 1 },
  { name: 'crash count', field: BIKE_BASE + B.CRASHES, value: 1 },
  { name: 'reset clock', field: BIKE_BASE + B.STATE_CLOCK, value: -1 },
  { name: 'teleport', field: F.Z, value: 100 },
  { name: 'vehicle swap', field: RACE_BASE + R.VEHICLE, value: vehicleIndex('mx450') },
] as const;

it.each(edges)('does not invent suspension rebound across an unresolved $name', ({ field, value }) => {
  const a = frame(1), b = frame(1 + dt), p = car + BIKE_BASE + B.FORK;
  a[p] = b[p] = 0.1;
  a[car + MX_MOTION.FORK_RATE] = 0.6;
  b[car + MX_MOTION.FORK_RATE] = -0.6;
  b[car + field] = value;
  for (const t of [0.1, 0.5, 0.9]) expect(sampleMxJointField(a, b, car, B.FORK, t)).toBe(a[p]);
});

it('keeps legacy, coarse and non-increasing-time fallback without modifying the recorded pose', () => {
  const a = frame(1), b = frame(1 + dt), p = car + BIKE_BASE + B.FORK;
  a[p] = b[p] = 0.1;
  a[car + MX_MOTION.FORK_RATE] = 0.6;
  b[car + MX_MOTION.FORK_RATE] = -0.6;
  for (const time of [1, 0.9, 1.2]) {
    b[H.TIME] = time;
    expect(sampleMxJointField(a, b, car, B.FORK, 0.5)).toBe(a[p]);
  }
  b[H.TIME] = 1 + dt;
  b[car + MX_MOTION.VALID] = 0;
  const saved = b.slice();
  expect(sampleMxJointField(a, b, car, B.FORK, 0.5)).toBeUndefined();
  expect(sampleBikeField(a, b, car, B.FORK, 0.5)).toBe(a[p]);
  expect(b).toEqual(saved);
});

const traces = (['mx250', 'mx450'] as const).flatMap(vehicle =>
  (['valley-ridge-mx', 'arena-nord-sx'] as const).flatMap(circuit =>
    (['jump', 'whoops'] as const).map(feature => ({ vehicle, circuit, feature })),
  ),
);

it.each(traces)('$vehicle on $circuit $feature restores measured extrema within mechanical travel', ({ vehicle, circuit, feature }) => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit, vehicles: [vehicle], opponents: 0,
    ruleset: 'motocross-moto', mode: 'practice' });
  const bike = sim.cars[0] as DirtBikeVehicle, track = sim.track, course = offroadCourse(track.circuit)!;
  const jump = course.jumps.find(item => item.name === (circuit === 'valley-ridge-mx' ? 'RIDGE TABLE' : 'TABLETOP'))!;
  const whoops = course.rough.find(item => item.kind === 'whoops')!;
  const start = feature === 'jump' ? jump.start : whoops.from;
  const speed = feature === 'jump' ? circuit === 'valley-ridge-mx' ? 13.5 : 13 : 8;
  bike.place(track, start - 12);
  bike.dynamics.speed = speed;
  bike.gear = 3;
  const window: Float32Array[] = [];
  let restored = 0, restoredError = 0, endpointError = 0, compared = 0;
  for (let tick = 0; tick <= 720; tick++) {
    if (tick) {
      if (!bike.airborne) rideLine(bike, track,
        feature === 'jump' && bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
          ? Math.max(speed, bike.dynamics.speed) : speed);
      else if (feature === 'jump') rideMotocrossFlight(bike);
      bike.step(1 / 120, track);
    }
    const measured = sim.makeFrame();
    // This rig drives the production adapter directly; publish its solver
    // clock alongside the untouched production frame's joint/contact data.
    measured[H.TIME] = tick / 120;
    window.push(measured);
    if (window.length < 5) continue;
    const a = window[0], b = window[4];
    if (hasMxMachineMotion(a, car) && hasMxMachineMotion(b, car)) {
      for (const { field, rate } of joints.slice(0, 2)) {
        const p = car + BIKE_BASE + field, lo = Math.min(a[p], b[p]), hi = Math.max(a[p], b[p]);
        const travel = Math.fround(field === B.FORK ? bike.definition.bike!.forkTravel : bike.definition.bike!.shockTravel);
        for (let sub = 1; sub < 4; sub++) {
          const truth = window[sub][p], value = sampleBikeField(a, b, car, field, sub / 4);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(travel);
          if (a[car + rate] * b[car + rate] >= 0) {
            expect(value).toBeGreaterThanOrEqual(lo - 1e-8);
            expect(value).toBeLessThanOrEqual(hi + 1e-8);
          }
          if ((truth < lo - 1e-5 && value < lo - 1e-5) || (truth > hi + 1e-5 && value > hi + 1e-5)) {
            restored++;
            restoredError += Math.abs(truth - value);
            // Any endpoint-bounded interpolation must miss by at least this
            // much; the higher-frequency simulation supplies the actual extremum.
            endpointError += truth < lo ? lo - truth : truth - hi;
          }
          compared++;
        }
      }
    }
    window.splice(0, 4);
  }
  expect(bike.dynamics.crashes).toBe(0);
  expect(compared).toBeGreaterThan(1000);
  expect(restored).toBeGreaterThan(2);
  expect(restoredError).toBeLessThan(endpointError * 0.8);
});
