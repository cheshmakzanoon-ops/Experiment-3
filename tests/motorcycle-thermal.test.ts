import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import {
  MOTORCYCLE_THERMAL,
  motorcycleBrakePower,
  motorcycleContactSlipPower,
  motorcycleRollingPower,
  motorcycleRotorBrakeWork,
} from '../src/simulation/motorcycle-thermal.ts';
import {
  advanceWheelTemperatures,
  type ThermalInputs,
  type WheelTemperatures,
} from '../src/simulation/tyre-thermal.ts';

const temperatures = (value: number, disc = value): WheelTemperatures => ({
  surfaceTemp: value,
  carcassTemp: value,
  coreTemp: value,
  discTemp: disc,
});
const environment = (patch: Partial<ThermalInputs> = {}): ThermalInputs => ({
  slipPower: 0,
  rollingPower: 0,
  load: 0,
  speed: 0,
  airTemp: 20,
  trackTemp: 20,
  waterMm: 0,
  discTemp: 20,
  wear: 0,
  ...patch,
});

describe('motorcycle mechanical heat provenance', () => {
  it('does not heat a perfectly rolling steered front tyre from cornering force', () => {
    for (const steer of [-0.4, -0.08, 0, 0.08, 0.4]) {
      const speed = 36,
        forward = speed * Math.cos(steer),
        lateral = speed * Math.sin(steer);
      expect(motorcycleContactSlipPower(0, 2600, forward, lateral, speed, steer)).toBeCloseTo(0, 9);
    }
  });

  it('uses the signed force/slip power in the tyre frame', () => {
    const steer = 0.23,
      along = 32,
      across = -2,
      forward = along * Math.cos(steer) - across * Math.sin(steer),
      lateral = along * Math.sin(steer) + across * Math.cos(steer);
    expect(motorcycleContactSlipPower(1200, 500, forward, lateral, 34, steer)).toBeCloseTo(
      1200 * 2 + 500 * 2,
      9,
    );
    // An assisting reduced-model force must not become dissipated heat just
    // because its power is nonzero.
    expect(motorcycleContactSlipPower(0, 500, 20, 2, 20)).toBe(0);
    expect(motorcycleContactSlipPower(-1200, 0, 30, 0, 0)).toBe(36000);
  });

  it('allocates exactly the core rolling work across normal, partial and landing loads', () => {
    for (const factor of [0.02, 0.4, 1, 2.5]) {
      const front = factor * 1200,
        rear = factor * 1600,
        a = motorcycleRollingPower(0.016, 280, 45, front, front + rear),
        b = motorcycleRollingPower(0.016, 280, 45, rear, front + rear);
      expect(a + b).toBeCloseTo(0.016 * 280 * G * 45, 10);
      expect(a / b).toBeCloseTo(front / rear, 12);
    }
    expect(motorcycleRollingPower(0.016, 280, 45, 0, 1500)).toBe(0);
    expect(motorcycleRollingPower(0.016, 280, 45, 0, 0)).toBe(0);
    expect(motorcycleRollingPower(0.016, 280, 0, 1200, 2800)).toBe(0);
  });

  it('keeps engine braking out of the disc and uses rotor speed instead of road speed', () => {
    expect(motorcycleBrakePower(900, 300, 0.32, 100)).toBe(19200);
    expect(motorcycleBrakePower(900, 900, 0.32, 100)).toBe(0);
    expect(motorcycleBrakePower(900, 300, 0.32, 0)).toBe(0);
    expect(motorcycleBrakePower(900, 300, 0.32, -100)).toBe(19200);
  });

  it('integrates finite rotor rotation only until lock instead of heating a stopped disc', () => {
    const inertia = 0.6,
      start = 10,
      torque = 300,
      dt = 0.05;
    expect(motorcycleRotorBrakeWork(start, -torque / inertia, torque, dt)).toBeCloseTo(
      0.5 * inertia * start * start,
      12,
    );
    expect(motorcycleRotorBrakeWork(0, -torque / inertia, torque, dt)).toBe(0);
    expect(motorcycleRotorBrakeWork(20, 0, torque, dt)).toBeCloseTo(torque * 20 * dt, 12);
  });
});

describe.each(['front', 'rear'] as const)('one physical %s motorcycle thermal owner', (end) => {
  const model = MOTORCYCLE_THERMAL[end];
  const storedHeat = (t: WheelTemperatures) =>
    model.tyre.surfaceCapacity * t.surfaceTemp +
    model.tyre.carcassCapacity * t.carcassTemp +
    model.tyre.coreCapacity * t.coreTemp +
    model.brake.capacity * t.discTemp;

  it('leaves a cold idle at its air/road equilibrium instead of seeking an ideal tyre temperature', () => {
    const t = temperatures(20);
    for (let i = 0; i < 600; i++)
      advanceWheelTemperatures(t, environment({ load: 1400 }), 0, 1, model.tyre, model.brake);
    for (const value of Object.values(t)) expect(value).toBeCloseTo(20, 10);
  });

  it('conserves supplied work when environmental losses are closed', () => {
    const isolatedTyre = {
        ...model.tyre,
        airBase: 0,
        airSpeed: 0,
        trackContact: 0,
        waterBase: 0,
        waterSpeed: 0,
        sidewallBase: 0,
        sidewallSpeed: 0,
        rimBase: 0,
        rimSpeed: 0,
      },
      isolatedBrake = { ...model.brake, airBase: 0, airSpeed: 0 },
      t = temperatures(40, 320),
      before = storedHeat(t),
      slip = 5500,
      rolling = 1200,
      braking = 27000,
      dt = 1 / 240,
      count = 2400;
    for (let i = 0; i < count; i++)
      advanceWheelTemperatures(
        t,
        environment({ slipPower: slip, rollingPower: rolling }),
        braking,
        dt,
        isolatedTyre,
        isolatedBrake,
      );
    expect((storedHeat(t) - before) / (dt * count)).toBeCloseTo(
      model.tyre.slipShare * slip + rolling + braking,
      5,
    );
  });

  it('balances heat input against the actual endpoint losses to air, track and water', () => {
    const t = temperatures(87, 320),
      before = storedHeat(t),
      input = environment({
        slipPower: 1400,
        rollingPower: 950,
        load: 1300,
        speed: 32,
        trackTemp: 35,
        waterMm: 0.4,
      }),
      brakePower = 12000,
      dt = 0.1,
      p = model.tyre,
      b = model.brake;
    advanceWheelTemperatures(t, input, brakePower, dt, p, b);
    const loss =
      (p.airBase + p.airSpeed * input.speed) * (t.surfaceTemp - input.airTemp) +
      p.trackContact * (t.surfaceTemp - input.trackTemp) +
      input.waterMm * (p.waterBase + p.waterSpeed * input.speed) * (t.surfaceTemp - input.airTemp) +
      (p.sidewallBase + p.sidewallSpeed * input.speed) * (t.carcassTemp - input.airTemp) +
      (p.rimBase + p.rimSpeed * input.speed) * (t.coreTemp - input.airTemp) +
      (b.airBase + b.airSpeed * input.speed) * (t.discTemp - input.airTemp);
    expect(storedHeat(t) - before + loss * dt).toBeCloseTo(
      (p.slipShare * input.slipPower + input.rollingPower! + brakePower) * dt,
      7,
    );
  });

  it('has no track/water cooling or speed-based work in flight', () => {
    const dry = temperatures(87, 320),
      airborne = { ...dry },
      loadedWet = { ...dry },
      input = environment({ speed: 40, trackTemp: -10, waterMm: 2 });
    advanceWheelTemperatures(dry, { ...input, waterMm: 0 }, 0, 5, model.tyre, model.brake);
    advanceWheelTemperatures(airborne, input, 0, 5, model.tyre, model.brake);
    advanceWheelTemperatures(loadedWet, { ...input, load: 1300 }, 0, 5, model.tyre, model.brake);
    expect(airborne).toEqual(dry);
    expect(loadedWet.surfaceTemp).toBeLessThan(airborne.surfaceTemp);
  });

  it('keeps passive temperatures within their finite reservoirs at large timesteps', () => {
    for (const dt of [1 / 240, 1 / 30, 1, 1e6]) {
      const t = temperatures(87, 850);
      advanceWheelTemperatures(
        t,
        environment({ speed: 65, airTemp: -10, trackTemp: 2, waterMm: 3, load: 900 }),
        0,
        dt,
        model.tyre,
        model.brake,
      );
      for (const value of Object.values(t)) {
        expect(value).toBeGreaterThanOrEqual(-10);
        expect(value).toBeLessThanOrEqual(850);
      }
    }
  });
});
