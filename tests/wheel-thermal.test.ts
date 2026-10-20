import { describe, expect, it } from 'vitest';
import { BRAKE_THERMAL } from '../src/simulation/brake-thermal.ts';
import { makeTire, solveTire } from '../src/simulation/tire.ts';
import { surfaceSample } from '../src/simulation/track.ts';
import {
  advanceWheelTemperatures,
  hotPressure,
  TYRE_THERMAL,
  type ThermalInputs,
  type WheelTemperatures,
} from '../src/simulation/tyre-thermal.ts';

const isolatedTyre = {
  ...TYRE_THERMAL,
  airBase: 0,
  airSpeed: 0,
  trackContact: 0,
  waterBase: 0,
  waterSpeed: 0,
  sidewallBase: 0,
  sidewallSpeed: 0,
  rimBase: 0,
  rimSpeed: 0,
  hysteresis: 0,
};
const isolatedBrake = { ...BRAKE_THERMAL, airBase: 0, airSpeed: 0 };
const temperatures = (value: number, disc = value): WheelTemperatures => ({
  surfaceTemp: value,
  carcassTemp: value,
  coreTemp: value,
  discTemp: disc,
});
const environment = (patch: Partial<ThermalInputs> = {}): ThermalInputs => ({
  slipPower: 0,
  load: 0,
  speed: 0,
  airTemp: 24,
  trackTemp: 24,
  waterMm: 0,
  discTemp: 24,
  wear: 0,
  ...patch,
});
function storedHeat(t: WheelTemperatures) {
  return (
    TYRE_THERMAL.surfaceCapacity * t.surfaceTemp +
    TYRE_THERMAL.carcassCapacity * t.carcassTemp +
    TYRE_THERMAL.coreCapacity * t.coreTemp +
    BRAKE_THERMAL.capacity * t.discTemp
  );
}

describe('coupled brake and tyre thermal network', () => {
  it('uses an explicit rolling-work input, including an exact zero override', () => {
    const held = temperatures(40),
      rolling = temperatures(40),
      before = storedHeat(rolling),
      power = 2500,
      dt = 0.25;
    const input = environment({ load: 3000, speed: 50, rollingPower: 0 });
    const explicitWork = { ...isolatedTyre, hysteresis: TYRE_THERMAL.hysteresis };
    advanceWheelTemperatures(held, input, 0, dt, explicitWork, isolatedBrake);
    advanceWheelTemperatures(
      rolling,
      { ...input, rollingPower: power },
      0,
      dt,
      explicitWork,
      isolatedBrake,
    );
    expect(storedHeat(held)).toBeCloseTo(before, 8);
    expect(storedHeat(rolling) - before).toBeCloseTo(power * dt, 8);
  });

  it('removes every joule of conducted brake heat from its finite rotor reservoir', () => {
    const t = temperatures(30, 900),
      before = storedHeat(t);
    for (let i = 0; i < 1000; i++)
      advanceWheelTemperatures(t, environment(), 0, 1, isolatedTyre, isolatedBrake);
    expect(storedHeat(t) / before).toBeCloseTo(1, 11);
    expect(t.discTemp).toBeLessThan(900);
    expect(t.coreTemp).toBeGreaterThan(30);
    expect(hotPressure(155, t.coreTemp, 30)).toBeGreaterThan(155);
  });

  it('conserves brake and tread work together, with internal conduction cancelled', () => {
    const t = temperatures(45),
      before = storedHeat(t),
      dt = 1 / 240,
      steps = 2400,
      brakePower = 47000,
      slipPower = 23000,
      input = environment({ slipPower });
    for (let i = 0; i < steps; i++)
      advanceWheelTemperatures(t, input, brakePower, dt, isolatedTyre, isolatedBrake);
    const supplied = (brakePower + TYRE_THERMAL.slipShare * slipPower) * steps * dt;
    expect((storedHeat(t) - before) / supplied).toBeCloseTo(1, 10);
    expect(t.discTemp).toBeGreaterThan(t.coreTemp);
    expect(t.surfaceTemp).toBeGreaterThan(t.carcassTemp);
  });

  it('retains all internal relaxation heat in the airborne carcass without a road share', () => {
    const t = temperatures(50),
      before = storedHeat(t),
      power = 36000,
      dt = 1 / 240;
    advanceWheelTemperatures(
      t,
      environment({ carcassPower: power }),
      0,
      dt,
      isolatedTyre,
      isolatedBrake,
    );
    expect(storedHeat(t) - before).toBeCloseTo(power * dt, 8);
    expect(t.carcassTemp).toBeGreaterThan(t.surfaceTemp);
    expect(t.carcassTemp).toBeGreaterThan(t.coreTemp);
  });

  it('reaches the capacity-weighted equilibrium of an isolated hot rotor and cold tyre', () => {
    const t = temperatures(30, 900),
      expected =
        storedHeat(t) /
        (TYRE_THERMAL.surfaceCapacity +
          TYRE_THERMAL.carcassCapacity +
          TYRE_THERMAL.coreCapacity +
          BRAKE_THERMAL.capacity);
    for (let i = 0; i < 8; i++)
      advanceWheelTemperatures(t, environment(), 0, 1e6, isolatedTyre, isolatedBrake);
    for (const value of Object.values(t)) expect(value).toBeCloseTo(expected, 3);
  });

  it.each([1 / 240, 1 / 30, 1, 100, 1e6])(
    'keeps passive thermal transfer bounded with a %s second step',
    (dt) => {
      const t = temperatures(75, 1100);
      advanceWheelTemperatures(
        t,
        environment({ airTemp: -12, trackTemp: 4, waterMm: 3, load: 0, speed: 80 }),
        0,
        dt,
      );
      for (const value of Object.values(t)) {
        expect(value).toBeGreaterThanOrEqual(-12);
        expect(value).toBeLessThanOrEqual(1100);
      }
    },
  );

  it('balances supplied work against stored heat and ambient losses in one step', () => {
    const t = temperatures(90, 700),
      before = storedHeat(t),
      dt = 0.5,
      speed = 25,
      ambient = 10,
      brakePower = 17000;
    advanceWheelTemperatures(
      t,
      environment({ speed, airTemp: ambient, trackTemp: ambient }),
      brakePower,
      dt,
    );
    // Independent first-law oracle using each external path at the implicit
    // endpoint. Internal surface/carcass/core/disc exchange must cancel.
    const loss =
      (TYRE_THERMAL.airBase + TYRE_THERMAL.airSpeed * speed) * (t.surfaceTemp - ambient) +
      (TYRE_THERMAL.sidewallBase + TYRE_THERMAL.sidewallSpeed * speed) * (t.carcassTemp - ambient) +
      (TYRE_THERMAL.rimBase + TYRE_THERMAL.rimSpeed * speed) * (t.coreTemp - ambient) +
      (BRAKE_THERMAL.airBase + BRAKE_THERMAL.airSpeed * speed) * (t.discTemp - ambient);
    expect(storedHeat(t) - before + loss * dt).toBeCloseTo(brakePower * dt, 6);
  });

  it('uses the recorded ambient temperature and cools equally in forward and reverse', () => {
    const forward = temperatures(600),
      reverse = temperatures(600),
      cold = temperatures(600);
    advanceWheelTemperatures(forward, environment({ speed: 40, airTemp: 35 }), 0, 10);
    advanceWheelTemperatures(reverse, environment({ speed: -40, airTemp: 35 }), 0, 10);
    advanceWheelTemperatures(cold, environment({ speed: 40, airTemp: -5 }), 0, 10);
    expect(reverse).toEqual(forward);
    expect(cold.discTemp).toBeLessThan(forward.discTemp);
  });

  it('ignores an imposed rotor temperature when that rotor is part of the finite network', () => {
    const a = temperatures(50, 500),
      b = { ...a };
    advanceWheelTemperatures(a, environment({ discTemp: 0 }), 0, 1);
    advanceWheelTemperatures(b, environment({ discTemp: 10000 }), 0, 1);
    expect(a).toEqual(b);
  });

  it('heats production rotors from friction braking while regeneration stays out of the rotor', () => {
    const friction = makeTire('medium'),
      electric = makeTire('medium'),
      surface = surfaceSample();
    surface.temp = 33;
    for (const tyre of [friction, electric]) {
      Object.assign(tyre, temperatures(33));
      tyre.omega = 120;
    }
    solveTire(friction, 0, 0, 0, 0, 1000, surface, 0, 1 / 240, 0, 33);
    solveTire(electric, 0, 0, 0, 0, 1000, surface, 0, 1 / 240, 1000, 33);
    expect(friction.omega).toBe(electric.omega);
    expect(electric.discTemp).toBeCloseTo(33, 12);
    expect(friction.discTemp).toBeGreaterThan(electric.discTemp);
    expect(friction.coreTemp).toBeGreaterThan(electric.coreTemp);
  });

  it('generates no brake heat while the production brake holds a stationary wheel', () => {
    const tyre = makeTire('medium'),
      surface = surfaceSample();
    Object.assign(tyre, temperatures(37));
    surface.temp = 37;
    solveTire(tyre, 0, 0, 0, 0, 4000, surface, 0, 1 / 240, 0, 37);
    expect(tyre.omega).toBe(0);
    expect(tyre.discTemp).toBeCloseTo(37, 12);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid integration step %s',
    (dt) => {
      expect(() => advanceWheelTemperatures(temperatures(50), environment(), 0, dt)).toThrow(
        'Invalid tyre thermal timestep',
      );
    },
  );
});
