import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeShells } from '../src/rendering/bike.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { sampleMxPostureField } from '../src/rendering/offroad/mx-rider-pose.ts';
import { sampleOffroadField } from '../src/rendering/snapshot-interpolation.ts';
import { controls, DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/jump-target.ts';
import { rideLine } from '../src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import {
  B, BIKE_BASE, CAR_STRIDE, F, H, HEADER, MX_POSTURE, O, OFFROAD_BASE,
  PROTOCOL_VERSION, R, RACE_BASE, WHEEL_CONTACT_BASE, carBase, hasMxRiderPosture,
} from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { writeWheelContact } from '../src/simulation/wheel-contact-state.ts';
import { Simulation } from '../src/simulation/world.ts';
import { ReplayRecorder } from '../src/storage/recorders.ts';
import { levelMotocrossPatch } from './motocross-test-track.ts';

const car = carBase(0), offroad = car + OFFROAD_BASE, body = offroad + O.BODY;
const bodyRate = car + MX_POSTURE.BODY_RATE, bikeBlock = car + BIKE_BASE, DT = 1 / 240;

beforeAll(() => {
  const context = new Proxy({}, {
    get: (_, key) => key === 'measureText' ? () => ({ width: 10 }) : () => undefined,
    set: () => true,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
});
afterAll(() => vi.unstubAllGlobals());

function frame(time: number) {
  const value = new Float32Array(HEADER + CAR_STRIDE);
  value[H.TIME] = time;
  value[H.CARS] = 1;
  value[car + F.QW] = 1;
  value[car + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
  value[car + MX_POSTURE.RECORDED] = 1;
  value[bikeBlock + B.STATE_CLOCK] = time;
  return value;
}

function pair() {
  const a = frame(0), b = frame(0.1);
  a[body] = -0.4;
  b[body] = 0.1;
  a[bodyRate] = 2;
  b[bodyRate] = 4;
  return { a, b };
}

function simulation(vehicle: 'mx250' | 'mx450') {
  return new Simulation({ ...DEFAULT_OPTIONS, circuit: 'valley-ridge-mx', vehicles: [vehicle],
    opponents: 0, mode: 'practice', assist: 'raw', ruleset: 'motocross-moto' });
}

function measuredFrame(sim: Simulation) {
  const value = sim.makeFrame(), bike = sim.cars[0] as DirtBikeVehicle;
  expect(hasMxRiderPosture(value, car)).toBe(true);
  expect(value[car + WHEEL_CONTACT_BASE]).toBe(0);
  expect(value[body]).toBe(Math.fround(bike.riderBody));
  expect(value[bodyRate]).toBe(Math.fround(bike.riderBodyRate));
  return value;
}

/** Compare all seven true intermediate poses, not a fitted visual reference.
 * Simulation.step subdivides each 240 Hz call into two physics steps; only
 * every eighth observation becomes a published 30 Hz endpoint. */
function reconstructionError(frames: Float32Array[]) {
  const display = new PresentedFrame();
  let error = 0, linearError = 0, peak = 0, linearPeak = 0, samples = 0;
  let fallbacks = 0, hiddenFlights = 0, airborneSamples = 0, maximumRate = 0;
  let airborneError = 0, airborneLinearError = 0, airbornePeak = 0, airborneLinearPeak = 0;
  let fallbackError = 0, unrestrictedError = 0, improvedFallbacks = 0;
  for (let i = 0; i + 8 < frames.length; i += 8) {
    const a = frames[i], b = frames[i + 8];
    if (!hasMxRiderPosture(a, car) || !hasMxRiderPosture(b, car)) continue;
    const boundary = sampleMxPostureField(a, b, car, O.BODY, 0.5) === undefined;
    if (boundary) fallbacks++;
    // Removing only event metadata measures the same Hermite path before
    // its conservative boundary guard, against the original physics poses.
    const continuousB = boundary ? b.slice() : b;
    if (boundary) {
      continuousB[offroad + O.AIRBORNE] = a[offroad + O.AIRBORNE];
      continuousB[offroad + O.AIR_TIME] = a[offroad + O.AIR_TIME];
    }
    let boundaryLinear = 0, boundaryCubic = 0;
    if (a[offroad + O.AIRBORNE] === 0 && b[offroad + O.AIRBORNE] === 0 &&
        a[offroad + O.AIR_TIME] !== b[offroad + O.AIR_TIME]) hiddenFlights++;
    for (let sub = 1; sub < 8; sub++) {
      const t = sub / 8, truth = frames[i + sub][body];
      const linear = a[body] + (b[body] - a[body]) * t;
      const sampled = sampleOffroadField(a, b, car, O.BODY, t);
      const currentError = Math.abs(truth - sampled), previousError = Math.abs(truth - linear);
      expect(display.sample(a, b, t)[body]).toBe(Math.fround(sampled));
      expect(sampled).toBeGreaterThanOrEqual(-1);
      expect(sampled).toBeLessThanOrEqual(1);
      if (boundary) {
        expect(sampled).toBe(linear);
        boundaryLinear += previousError;
        boundaryCubic += Math.abs(truth - sampleMxPostureField(a, continuousB, car, O.BODY, t)!);
      }
      if (a[offroad + O.AIRBORNE] && b[offroad + O.AIRBORNE]) {
        airborneSamples++;
        airborneError += currentError;
        airborneLinearError += previousError;
        airbornePeak = Math.max(airbornePeak, currentError);
        airborneLinearPeak = Math.max(airborneLinearPeak, previousError);
      }
      maximumRate = Math.max(maximumRate, Math.abs(a[bodyRate]), Math.abs(b[bodyRate]));
      error += currentError;
      linearError += previousError;
      peak = Math.max(peak, currentError);
      linearPeak = Math.max(linearPeak, previousError);
      samples++;
    }
    fallbackError += boundaryLinear;
    unrestrictedError += boundaryCubic;
    if (boundaryCubic > boundaryLinear + 1e-8) improvedFallbacks++;
  }
  return { samples, mean: error / samples, linearMean: linearError / samples, peak, linearPeak,
    fallbacks, hiddenFlights, airborneSamples, maximumRate,
    airborneMean: airborneSamples ? airborneError / airborneSamples : 0,
    airborneLinearMean: airborneSamples ? airborneLinearError / airborneSamples : 0,
    airbornePeak, airborneLinearPeak, fallbackError, unrestrictedError, improvedFallbacks };
}

describe('recorded motocross body tangent', () => {
  it.each(['mx250', 'mx450'] as const)(
    '%s reconstructs real manual reversals and brake changes between 30 Hz snapshots', (vehicle) => {
      const sim = simulation(vehicle), bike = sim.cars[0] as DirtBikeVehicle;
      // This case isolates a stationary posture trajectory. Bank support and
      // its finite-precision force balance are covered by the cross-slope rig.
      levelMotocrossPatch(sim.track);
      bike.place(sim.track, 35);
      sim.setInput({ ...controls(), brake: 1, riderLean: 1 });
      for (let tick = 0; tick < 5 / DT; tick++) sim.step(DT);
      const frames = [measuredFrame(sim)];
      let manualContribution = 0, automaticRate = 0;
      for (let tick = 1; tick <= 360; tick++) {
        // Deliberately change some inputs inside publication intervals.
        sim.setInput({ ...controls(), brake: tick < 53 ? 1 : tick < 119 ? 0.2 : tick < 220 ? 1 : 0.6,
          riderLean: tick < 137 ? -1 : tick < 241 ? 1 : 0 });
        sim.step(DT);
        expect(bike.riding && !bike.airborne).toBe(true);
        expect(bike.speed).toBe(0);
        manualContribution = Math.max(manualContribution,
          Math.abs(bike.riderBodyRate - bike.postureMotion!.bodyRate));
        automaticRate = Math.max(automaticRate, Math.abs(bike.postureMotion!.bodyRate));
        frames.push(measuredFrame(sim));
      }
      const metrics = reconstructionError(frames);
      expect(metrics.samples).toBe(315);
      expect(metrics.fallbacks).toBe(0);
      expect(metrics.maximumRate).toBeGreaterThan(1);
      expect(manualContribution).toBeGreaterThan(1);
      expect(automaticRate).toBeGreaterThan(1);
      expect(metrics.linearMean).toBeGreaterThan(0.001);
      expect(metrics.mean).toBeLessThan(metrics.linearMean * 0.15);
      expect(metrics.peak).toBeLessThan(metrics.linearPeak * 0.4);
      if (process.env.MX_BODY_METRICS) console.info(JSON.stringify({ vehicle, trace: 'brake/reversals', ...metrics }));
    },
  );

  it.each(['mx250', 'mx450'] as const)(
    '%s reconstructs a surveyed approach and real airborne reversal, with flight-boundary fallback', (vehicle) => {
      const sim = simulation(vehicle), bike = sim.cars[0] as DirtBikeVehicle;
      const jump = offroadCourse(sim.track.circuit)!.jumps.find((entry) => entry.name === 'RIDGE TABLE')!;
      const speed = jumpHoldSpeed(jump);
      bike.place(sim.track, jump.start - 12);
      bike.dynamics.speed = speed;
      bike.aiControlled(1e6);
      for (let gear = 1; gear < bike.spec.gearRatios.length - 1; gear++) {
        bike.gear = gear;
        const rpm = speed / bike.spec.wheelRadius * bike.spec.gearRatios[gear + 1] *
          bike.spec.finalDrive * 30 / Math.PI;
        if (rpm < bike.spec.shiftRPM * 0.85) break;
      }
      // Keep the original placement sample and publication phase. Its empty
      // optional contract is skipped until ordinary physics has established it.
      const frames = [sim.makeFrame()];
      let launched = false, flightTicks = 0;
      for (let tick = 1; tick <= 6 / DT; tick++) {
        if (!launched && !bike.airborne) rideLine(bike, sim.track,
          bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
            ? Math.max(speed, bike.dynamics.speed) : speed);
        if (launched) {
          flightTicks++;
          sim.setInput({ ...controls(), throttle: 0.1, brake: flightTicks < 73 ? 0.35 : 0.1,
            clutch: 0.05, riderLean: flightTicks < 60 ? 1 : flightTicks < 144 ? -1 : 0 });
        }
        sim.step(DT);
        expect(bike.riding).toBe(true);
        frames.push(measuredFrame(sim));
        if (!launched && bike.airborne && bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 3) {
          launched = true;
          bike.aiControlled(0);
        }
        if (flightTicks === 240) break;
      }
      expect(launched && bike.airborne).toBe(true);
      expect(flightTicks).toBe(240);
      const metrics = reconstructionError(frames);
      expect(metrics.samples).toBeGreaterThan(400);
      expect(metrics.airborneSamples).toBeGreaterThan(190);
      expect(metrics.airborneMean).toBeLessThan(metrics.airborneLinearMean * 0.2);
      expect(metrics.airbornePeak).toBeLessThan(metrics.airborneLinearPeak);
      expect(metrics.fallbacks).toBeGreaterThan(0);
      if (vehicle === 'mx250') {
        expect(metrics.hiddenFlights).toBeGreaterThan(0);
        expect(metrics.improvedFallbacks).toBeGreaterThan(0);
      }
      expect(metrics.maximumRate).toBeGreaterThan(1);
      expect(metrics.linearMean).toBeGreaterThan(0.0001);
      expect(metrics.mean).toBeLessThan(metrics.linearMean * 0.2);
      expect(metrics.peak).toBeLessThan(metrics.linearPeak);
      if (process.env.MX_BODY_METRICS) console.info(JSON.stringify({ vehicle, trace: 'approach/flight', ...metrics }));
    },
  );

  it('retains exact body endpoints, signed slopes and genuine equal-position reversals', () => {
    const { a, b } = pair(), dt = b[H.TIME] - a[H.TIME], h = 1e-6;
    expect(sampleOffroadField(a, b, car, O.BODY, 0)).toBe(a[body]);
    expect(sampleOffroadField(a, b, car, O.BODY, 1)).toBe(b[body]);
    expect((sampleOffroadField(a, b, car, O.BODY, h) - a[body]) / (h * dt))
      .toBeCloseTo(a[bodyRate], 4);
    expect((b[body] - sampleOffroadField(a, b, car, O.BODY, 1 - h)) / (h * dt))
      .toBeCloseTo(b[bodyRate], 4);
    a[body] = b[body] = -0.5;
    a[bodyRate] = 1;
    b[bodyRate] = -1;
    expect(sampleOffroadField(a, b, car, O.BODY, 0.5)).toBeCloseTo(-0.5 + dt / 4, 8);
  });

  it('bounds the full signed body stroke without treating a recorded zero rate as missing', () => {
    const { a, b } = pair();
    a[bodyRate] = b[bodyRate] = 0;
    expect(sampleOffroadField(a, b, car, O.BODY, 0.25))
      .toBeCloseTo(a[body] + (b[body] - a[body]) * 0.15625, 12);
    for (const [start, end] of [[-1, 1], [1, -1], [-1, -1], [1, 1], [-0.8, 0.6]]) {
      a[body] = start;
      b[body] = end;
      for (const sign of [-1, 1]) {
        a[bodyRate] = sign * 1e30;
        b[bodyRate] = -sign * 1e30;
        for (let i = 0; i <= 100; i++) {
          const value = sampleOffroadField(a, b, car, O.BODY, i / 100);
          expect(value).toBeGreaterThanOrEqual(-1);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it.each(['same time', 'rewind', 'teleport', 'vehicle', 'crash', 'crash count', 'clock', 'remount'])(
    'holds the recorded body through a %s boundary', (boundary) => {
      const { a, b } = pair(), shown = new PresentedFrame();
      if (boundary === 'same time') b[H.TIME] = 0;
      if (boundary === 'rewind') b[H.TIME] = -1;
      if (boundary === 'teleport') b[car + F.Z] = 100;
      if (boundary === 'vehicle') b[car + RACE_BASE + R.VEHICLE] = vehicleIndex('sm450');
      if (boundary === 'crash') b[bikeBlock + B.STATE] = 1;
      if (boundary === 'crash count') b[bikeBlock + B.CRASHES] = 1;
      if (boundary === 'clock') a[bikeBlock + B.STATE_CLOCK] = 2;
      if (boundary === 'remount') {
        a[bikeBlock + B.STATE] = 4;
        a[car + MX_POSTURE.RECORDED] = 0;
      }
      for (const t of [0, 0.3, 0.9, 0.999]) {
        expect(sampleOffroadField(a, b, car, O.BODY, t)).toBe(a[body]);
        if (boundary !== 'rewind') expect(shown.sample(a, b, t)[body]).toBe(a[body]);
      }
      expect(sampleOffroadField(a, b, car, O.BODY, 1)).toBe(b[body]);
      expect(sampleOffroadField(b, b, car, O.BODY, 0.6)).toBe(b[body]);
    },
  );

  it.each(['takeoff', 'landing', 'short hop', 'new flight'])(
    'uses the original linear body segment across a %s without changing stance or dab', (boundary) => {
      const { a, b } = pair();
      if (boundary === 'takeoff') b[offroad + O.AIRBORNE] = 1;
      if (boundary === 'landing') a[offroad + O.AIRBORNE] = 1;
      if (boundary === 'short hop') b[offroad + O.AIR_TIME] = 1 / 240;
      if (boundary === 'new flight') {
        a[offroad + O.AIRBORNE] = b[offroad + O.AIRBORNE] = 1;
        a[offroad + O.AIR_TIME] = 0.9;
        b[offroad + O.AIR_TIME] = 0.1;
      }
      for (const t of [0.125, 0.5, 0.875]) {
        const linear = a[body] + (b[body] - a[body]) * t;
        expect(sampleMxPostureField(a, b, car, O.BODY, t)).toBeUndefined();
        expect(sampleOffroadField(a, b, car, O.BODY, t)).toBe(linear);
        expect(new PresentedFrame().sample(a, b, t)[body]).toBe(Math.fround(linear));
        for (const field of [O.STANDING, O.DAB])
          expect(sampleMxPostureField(a, b, car, field, t)).toBe(0);
      }
    },
  );

  it('keeps body output finite and exactly linear with absent, malformed or long-gap optional rates', () => {
    for (const defect of ['zero marker', 'one unmarked', 'marker', 'nan', 'infinity', 'long gap']) {
      const { a, b } = pair();
      if (defect === 'zero marker') a[car + MX_POSTURE.RECORDED] = b[car + MX_POSTURE.RECORDED] = 0;
      if (defect === 'one unmarked') b[car + MX_POSTURE.RECORDED] = 0;
      if (defect === 'marker') b[car + MX_POSTURE.RECORDED] = 2;
      if (defect === 'nan') b[bodyRate] = NaN;
      if (defect === 'infinity') a[bodyRate] = Infinity;
      if (defect === 'long gap') b[H.TIME] = 2;
      for (const t of [0.125, 0.5, 0.875]) {
        const linear = a[body] + (b[body] - a[body]) * t;
        expect(sampleMxPostureField(a, b, car, O.BODY, t)).toBeUndefined();
        expect(sampleOffroadField(a, b, car, O.BODY, t)).toBe(linear);
        expect(new PresentedFrame().sample(a, b, t)[body]).toBe(Math.fround(linear));
      }
    }
  });

  it('clears stale and unrepresentable body rates, and preserves legacy and other-vehicle interpolation', () => {
    const sim = simulation('mx250'), bike = sim.cars[0] as DirtBikeVehicle;
    sim.step(DT);
    const value = measuredFrame(sim);
    for (const invalid of [NaN, Infinity, Number.MAX_VALUE]) {
      const rate = vi.spyOn(bike, 'riderBodyRate', 'get').mockReturnValue(invalid);
      try {
        value.fill(12, car + MX_POSTURE.RECORDED, bodyRate + 1);
        writeWheelContact(value, car, bike);
        expect(Array.from(value.subarray(car + MX_POSTURE.RECORDED, bodyRate + 1))).toEqual([0, 0, 0, 0]);
      } finally {
        rate.mockRestore();
      }
    }
    bike.restart(sim.track, 'wrong-way');
    value[bodyRate] = 12;
    writeWheelContact(value, car, bike);
    expect(value[car + MX_POSTURE.RECORDED]).toBe(0);
    expect(value[bodyRate]).toBe(0);
    for (const [vehicle, circuit] of [['sm450', 'arena-nord-sx'], ['mx450', 'aurel']] as const) {
      const other = new Simulation({ ...DEFAULT_OPTIONS, circuit, vehicles: [vehicle], opponents: 0, mode: 'practice' });
      other.step(DT);
      const out = other.makeFrame();
      out[bodyRate] = 12;
      writeWheelContact(out, car, other.cars[0]);
      expect(out[car + MX_POSTURE.RECORDED]).toBe(0);
      expect(out[bodyRate]).toBe(0);
    }
    for (const vehicle of ['sm450', 'apx01'] as const) {
      const { a, b } = pair();
      a[car + RACE_BASE + R.VEHICLE] = b[car + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
      expect(sampleMxPostureField(a, b, car, O.BODY, 0.3)).toBeUndefined();
      expect(sampleOffroadField(a, b, car, O.BODY, 0.3)).toBe(a[body] + (b[body] - a[body]) * 0.3);
    }
    const { a, b } = pair();
    a[car + MX_POSTURE.RECORDED] = b[car + MX_POSTURE.RECORDED] = 0;
    b[bikeBlock + B.STATE] = 1;
    expect(sampleOffroadField(a, b, car, O.BODY, 0.3)).toBe(a[body] + (b[body] - a[body]) * 0.3);
  });

  it('passes the same reconstructed body to the live renderer and PresentedFrame after compact replay seeks', () => {
    const { a, b } = pair(), originals = [a.slice(), b.slice()];
    const recorder = new ReplayRecorder(1, 1), shells = new BikeShells(), display = new PresentedFrame();
    const host = { root: new T.Object3D() }, camera = new T.PerspectiveCamera(58, 16 / 9);
    const posed = vi.spyOn(DirtBikeModel.prototype, 'pose');
    recorder.append(a);
    recorder.append(b);
    const left = recorder.makeFrame(), right = recorder.makeFrame();
    try {
      for (const t of [0.37, 0.9, 0.1, 1, 0, 0.37]) {
        const alpha = recorder.sample(t * b[H.TIME], left, right);
        expect(left[bodyRate]).toBe(a[bodyRate]);
        expect(right[bodyRate]).toBe(b[bodyRate]);
        const shown = display.sample(left, right, alpha);
        host.root.position.fromArray(shown, car + F.X);
        host.root.quaternion.fromArray(shown, car + F.QX);
        camera.position.copy(host.root.position);
        camera.position.z -= t > 0.8 ? 500 : 2;
        shells.update(left, right, alpha, [host], camera, 'high', -1);
        const drawn = posed.mock.lastCall![0].body!;
        expect(drawn).toBe(sampleOffroadField(a, b, car, O.BODY, alpha));
        expect(shown[body]).toBe(Math.fround(drawn));
      }
      expect(display.sample(b, b, 0.4)[body]).toBe(b[body]);
      expect(a).toEqual(originals[0]);
      expect(b).toEqual(originals[1]);
      expect(PROTOCOL_VERSION).toBe(17);
      expect(CAR_STRIDE).toBe(331);
      expect(MX_POSTURE.BODY_RATE - WHEEL_CONTACT_BASE).toBe(20);
    } finally {
      posed.mockRestore();
      shells.disposeAll();
    }
  });
});
