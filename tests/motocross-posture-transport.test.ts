import { describe, expect, it } from 'vitest';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { sampleMxPostureField } from '../src/rendering/offroad/mx-rider-pose.ts';
import { sampleOffroadField } from '../src/rendering/snapshot-interpolation.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import {
  B, BIKE_BASE, CAR_STRIDE, F, H, HEADER, MX_POSTURE, O, OFFROAD_BASE,
  PROTOCOL_VERSION, R, RACE_BASE, WHEEL_CONTACT_BASE, carBase, hasMxRiderPosture,
} from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { writeWheelContact } from '../src/simulation/wheel-contact-state.ts';
import { Simulation } from '../src/simulation/world.ts';
import { ReplayRecorder } from '../src/storage/recorders.ts';

const car = carBase(0), offroad = car + OFFROAD_BASE, bikeBlock = car + BIKE_BASE;
const channels = [[O.STANDING, MX_POSTURE.STANDING_RATE], [O.DAB, MX_POSTURE.DAB_RATE]] as const;

function frame(time: number) {
  const out = new Float32Array(HEADER + CAR_STRIDE);
  out[H.TIME] = time;
  out[H.CARS] = 1;
  out[car + F.QW] = 1;
  out[car + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
  out[car + MX_POSTURE.RECORDED] = 1;
  out[bikeBlock + B.STATE_CLOCK] = time;
  return out;
}

function pair() {
  const a = frame(0), b = frame(0.1);
  a[offroad + O.STANDING] = 0.25;
  b[offroad + O.STANDING] = 0.32;
  a[car + MX_POSTURE.STANDING_RATE] = 0.2;
  b[car + MX_POSTURE.STANDING_RATE] = 1.2;
  a[offroad + O.DAB] = -0.2;
  b[offroad + O.DAB] = 0.2;
  a[car + MX_POSTURE.DAB_RATE] = 3;
  b[car + MX_POSTURE.DAB_RATE] = 5;
  return { a, b };
}

describe('recorded motocross rider posture', () => {
  it.each([['valley-ridge-mx', 'mx450'], ['arena-nord-sx', 'mx250']] as const)(
    '%s writes real controller tangents and reconstructs stance/dab between 30 Hz snapshots',
    (circuit, vehicle) => {
      const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit, vehicles: [vehicle],
        opponents: 0, mode: 'practice', ruleset: 'motocross-moto' });
      const bike = sim.cars[0] as DirtBikeVehicle;
      const course = offroadCourse(sim.track.circuit)!;
      const shown = new PresentedFrame();
      const error = [0, 0], linearError = [0, 0], maximumRate = [0, 0], compared = [0, 0];
      for (const fast of [true, false]) {
        bike.place(sim.track, course.jumps[0].start - 10);
        bike.dynamics.speed = fast ? 10 : 3;
        const window: Float32Array[] = [];
        for (let tick = 0; tick <= 120; tick++) {
          if (tick) {
            sim.setInput({ ...bike.input, throttle: fast ? 0.3 : 0,
              steer: fast ? 0 : tick <= 60 ? 0.9 : -0.9 });
            sim.step(1 / 240);
          }
          const value = sim.makeFrame(), motion = bike.postureMotion;
          if (motion) {
            expect(hasMxRiderPosture(value, car)).toBe(true);
            expect(value[car + WHEEL_CONTACT_BASE]).toBe(0);
            expect(value[offroad + O.STANDING]).toBe(Math.fround(bike.standing));
            expect(value[offroad + O.DAB]).toBe(Math.fround(bike.dab));
            expect(value[car + MX_POSTURE.STANDING_RATE]).toBe(Math.fround(motion.standingRate));
            expect(value[car + MX_POSTURE.DAB_RATE]).toBe(Math.fround(motion.dabRate));
          }
          window.push(value);
          if (window.length !== 9) continue;
          const a = window[0], b = window[8];
          if (hasMxRiderPosture(a, car) && hasMxRiderPosture(b, car)) {
            for (let sub = 1; sub < 8; sub++) {
              const alpha = sub / 8, displayed = shown.sample(a, b, alpha);
              for (const [index, [field, rate]] of channels.entries()) {
                const actual = sampleOffroadField(a, b, car, field, alpha), p = offroad + field;
                expect(displayed[p]).toBe(Math.fround(actual));
                maximumRate[index] = Math.max(maximumRate[index], Math.abs(a[car + rate]));
                linearError[index] += Math.abs(window[sub][p] - (a[p] + (b[p] - a[p]) * alpha));
                error[index] += Math.abs(window[sub][p] - actual);
                compared[index]++;
              }
            }
          }
          window.splice(0, 8);
        }
      }
      for (let index = 0; index < 2; index++) {
        expect(compared[index]).toBeGreaterThan(100);
        expect(maximumRate[index]).toBeGreaterThan(0.2);
        expect(linearError[index]).toBeGreaterThan(0.001);
        expect(error[index]).toBeLessThan(linearError[index] * 0.4);
      }
    },
  );

  it('retains endpoint poses and signed endpoint slopes, including a reversal between equal poses', () => {
    const { a, b } = pair(), dt = b[H.TIME] - a[H.TIME];
    for (const [field, rate] of channels) {
      const p = offroad + field;
      expect(sampleOffroadField(a, b, car, field, 0)).toBe(a[p]);
      expect(sampleOffroadField(a, b, car, field, 1)).toBe(b[p]);
      const h = 1e-6;
      const left = (sampleOffroadField(a, b, car, field, h) - a[p]) / (h * dt);
      const right = (b[p] - sampleOffroadField(a, b, car, field, 1 - h)) / (h * dt);
      expect(left).toBeCloseTo(a[car + rate], 4);
      expect(right).toBeCloseTo(b[car + rate], 4);
      a[p] = b[p] = field === O.STANDING ? 0.5 : -0.5;
      a[car + rate] = 1;
      b[car + rate] = -1;
      // A real turn happens inside the interval; monotonic limiting would
      // erase its incoming momentum simply because the endpoints coincide.
      expect(sampleOffroadField(a, b, car, field, 0.5)).toBeCloseTo(a[p] + dt / 4, 8);
    }
  });

  it('bounds complete cubic strokes near both physical stops with extreme finite tangents', () => {
    const { a, b } = pair();
    for (const [field, rate] of channels) {
      const minimum = field === O.STANDING ? 0 : -1, p = offroad + field;
      for (const [start, end] of [[minimum, 1], [1, minimum], [minimum, minimum], [1, 1], [0.2, 0.3]]) {
        a[p] = start;
        b[p] = end;
        for (const direction of [-1, 1]) {
          a[car + rate] = direction * 1e30;
          b[car + rate] = -direction * 1e30;
          for (let i = 0; i <= 100; i++) {
            const value = sampleOffroadField(a, b, car, field, i / 100);
            expect(value).toBeGreaterThanOrEqual(minimum);
            expect(value).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it.each(['same time', 'rewind', 'teleport', 'vehicle', 'crash', 'crash count', 'rider clock', 'remount'])(
    'holds the recorded pose across a %s boundary until the new sample', (change) => {
      const { a, b } = pair(), display = new PresentedFrame();
      if (change === 'same time') b[H.TIME] = a[H.TIME];
      if (change === 'rewind') b[H.TIME] = -1;
      if (change === 'teleport') b[car + F.Z] = 100;
      if (change === 'vehicle') b[car + RACE_BASE + R.VEHICLE] = vehicleIndex('sm450');
      if (change === 'crash') b[bikeBlock + B.STATE] = 1;
      if (change === 'crash count') b[bikeBlock + B.CRASHES] = 1;
      if (change === 'rider clock') a[bikeBlock + B.STATE_CLOCK] = 2;
      if (change === 'remount') {
        a[bikeBlock + B.STATE] = 4;
        a[car + MX_POSTURE.RECORDED] = 0;
      }
      for (const [field] of channels) {
        const p = offroad + field;
        for (const alpha of [0, 0.2, 0.8, 0.999]) {
          expect(sampleOffroadField(a, b, car, field, alpha)).toBe(a[p]);
          if (change !== 'rewind') expect(display.sample(a, b, alpha)[p]).toBe(a[p]);
        }
        expect(sampleOffroadField(a, b, car, field, 1)).toBe(b[p]);
        expect(sampleOffroadField(b, b, car, field, 0.3)).toBe(b[p]);
      }
    },
  );

  it('falls back exactly to existing linear poses for absent, malformed and long-gap tangents', () => {
    for (const defect of ['unmarked', 'one unmarked', 'invalid marker', 'nan', 'infinity', 'long gap']) {
      const { a, b } = pair();
      if (defect === 'unmarked') a[car + MX_POSTURE.RECORDED] = b[car + MX_POSTURE.RECORDED] = 0;
      if (defect === 'one unmarked') b[car + MX_POSTURE.RECORDED] = 0;
      if (defect === 'invalid marker') b[car + MX_POSTURE.RECORDED] = 2;
      if (defect === 'long gap') b[H.TIME] = 2;
      for (const [field, rate] of channels) {
        if (defect === 'nan') b[car + rate] = NaN;
        if (defect === 'infinity') a[car + rate] = Infinity;
        for (const alpha of [0.125, 0.5, 0.875]) {
          const p = offroad + field, linear = a[p] + (b[p] - a[p]) * alpha;
          expect(sampleMxPostureField(a, b, car, field, alpha)).toBeUndefined();
          expect(sampleOffroadField(a, b, car, field, alpha)).toBe(linear);
          expect(new PresentedFrame().sample(a, b, alpha)[p]).toBe(Math.fround(linear));
        }
      }
    }
  });

  it('preserves tangents in compact replay, with deterministic seeks and byte-identical legacy fallback', () => {
    const { a, b } = pair();
    const replay = new ReplayRecorder(1, 1), display = new PresentedFrame();
    replay.append(a);
    replay.append(b);
    const left = replay.makeFrame(), right = replay.makeFrame();
    const originals = [a.slice(), b.slice()];
    for (const alpha of [0.5, 0.9, 0.2, 1, 0, 0.5]) {
      const t = replay.sample(alpha * b[H.TIME], left, right);
      for (const [field, rate] of channels) {
        expect(left[car + rate]).toBe(a[car + rate]);
        expect(right[car + rate]).toBe(b[car + rate]);
        const expected = sampleOffroadField(a, b, car, field, t);
        expect(display.sample(left, right, t)[offroad + field]).toBe(Math.fround(expected));
      }
    }
    expect(display.sample(b, b, 0.4)).toEqual(b);
    expect(a).toEqual(originals[0]);
    expect(b).toEqual(originals[1]);
    const legacy = new ReplayRecorder(1, 1);
    for (const value of [a, b]) {
      value.fill(0, car + MX_POSTURE.RECORDED, car + MX_POSTURE.DAB_RATE + 1);
      legacy.append(value);
    }
    const t = legacy.sample(b[H.TIME] * 0.37, left, right);
    expect(hasMxRiderPosture(left, car)).toBe(false);
    expect(hasMxRiderPosture(right, car)).toBe(false);
    for (const [field] of channels) {
      const p = offroad + field, linear = a[p] + (b[p] - a[p]) * t;
      expect(sampleOffroadField(left, right, car, field, t)).toBe(linear);
      expect(display.sample(left, right, t)[p]).toBe(Math.fround(linear));
    }
    expect(PROTOCOL_VERSION).toBe(17);
    expect(CAR_STRIDE).toBe(331);
  });

  it('clears reused optional bytes outside a ridden MX course and ignores other vehicles', () => {
    for (const [vehicle, circuit] of [['sm450', 'arena-nord-sx'], ['mx450', 'aurel']] as const) {
      const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit, vehicles: [vehicle], opponents: 0, mode: 'practice' });
      for (let tick = 0; tick < 4; tick++) sim.step(1 / 120);
      const value = sim.makeFrame();
      value.fill(12, car + MX_POSTURE.RECORDED, car + MX_POSTURE.DAB_RATE + 1);
      writeWheelContact(value, car, sim.cars[0]);
      expect(Array.from(value.subarray(car + MX_POSTURE.RECORDED, car + MX_POSTURE.DAB_RATE + 1)))
        .toEqual([0, 0, 0]);
    }
    const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit: 'arena-nord-sx', vehicles: ['mx250'],
      opponents: 0, mode: 'practice' });
    sim.step(1 / 120);
    const bike = sim.cars[0] as DirtBikeVehicle, value = sim.makeFrame();
    expect(hasMxRiderPosture(value, car)).toBe(true);
    bike.restart(sim.track, 'wrong-way');
    writeWheelContact(value, car, bike);
    expect(Array.from(value.subarray(car + MX_POSTURE.RECORDED, car + MX_POSTURE.DAB_RATE + 1)))
      .toEqual([0, 0, 0]);
    for (const vehicle of ['sm450', 'apx01'] as const) {
      const { a, b } = pair();
      a[car + RACE_BASE + R.VEHICLE] = b[car + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
      for (const [field] of channels) {
        const p = offroad + field;
        expect(sampleMxPostureField(a, b, car, field, 0.3)).toBeUndefined();
        expect(sampleOffroadField(a, b, car, field, 0.3)).toBe(a[p] + (b[p] - a[p]) * 0.3);
      }
    }
  });
});
