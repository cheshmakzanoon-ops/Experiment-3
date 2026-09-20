import { expect, it } from 'vitest';
import { FrictionClutch } from '../src/simulation/clutch.ts';
import { VEHICLE } from '../src/simulation/config.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, carBase } from '../src/simulation/protocol.ts';
it('open clutch permits free engine acceleration with zero wheel torque', () => {
  const c = new FrictionClutch(),
    before = c.engineOmega;
  expect(c.step(1 / 240, 200, 0, 12, 1, false, false)).toBe(0);
  expect(c.engineOmega - before).toBeCloseTo(200 / (240 * c.inertia));
  expect(c.slipPower).toBe(0);
});
it.each([0.1, 0.5, 1])(
  'slip coupling is dissipative and conserves shaft impulse at engagement %s',
  (engagement) => {
    const c = new FrictionClutch(),
      dt = 1 / 240,
      ratio = 12,
      omega = 5,
      I = 2 * VEHICLE.wheelInertia;
    const before = 0.5 * c.inertia * c.engineOmega ** 2 + 0.5 * I * omega ** 2;
    const momentum = c.inertia * c.engineOmega;
    const torque = c.step(dt, 0, omega, ratio, 1 - engagement, false, false);
    const wheelAfter = omega + (torque * dt) / I;
    const after = 0.5 * c.inertia * c.engineOmega ** 2 + 0.5 * I * wheelAfter ** 2;
    expect(after).toBeLessThan(before);
    expect((before - after) / dt).toBeCloseTo(c.slipPower, 5);
    expect(momentum - c.inertia * c.engineOmega).toBeCloseTo((torque * dt) / ratio, 9);
    expect(Math.abs(c.transmittedTorque)).toBeLessThanOrEqual(c.capacity * engagement + 1e-9);
  },
);
it('supports reverse coupling and unloads for neutral and gearshift', () => {
  const c = new FrictionClutch();
  expect(c.step(1 / 240, 200, 0, -8, 0, false, false)).toBeLessThan(0);
  expect(c.step(1 / 240, 200, 0, 0, 0, false, false)).toBe(0);
  expect(c.step(1 / 240, 200, 0, 8, 0, false, true)).toBe(0);
  expect(() => c.step(0, 200, 0, 8, 0, false, false)).toThrow();
});
it('a real car can free-rev with its clutch open, then launch without a velocity override', () => {
  const track = new Track('clear', true);
  track.windX = track.windZ = 0;
  const car = new Vehicle(0);
  car.place(track, 30);
  car.input.manualClutch = true;
  car.input.clutch = 1;
  car.input.throttle = 0.6;
  for (let i = 0; i < 480; i++) car.step(1 / 240, track);
  expect(car.speed).toBeLessThan(0.3);
  expect(car.rpm).toBeGreaterThan(8000);
  car.input.clutch = 0;
  for (let i = 0; i < 720; i++) car.step(1 / 240, track);
  expect(car.speed).toBeGreaterThan(8);
  expect(car.clutch.transmittedTorque).not.toBe(0);
}, 30000);
it('serializes physical clutch state and rejects non-finite input', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice' });
  sim.setInput({ ...sim.cars[0].input, manualClutch: true, clutch: 1, throttle: 0.5 });
  sim.step(1 / 120);
  const f = sim.makeFrame(),
    o = carBase(0);
  expect(f[o + F.CLUTCH_PEDAL]).toBe(1);
  expect(f[o + F.CLUTCH_ENGAGEMENT]).toBe(0);
  expect(f[o + F.CLUTCH_TORQUE]).toBe(0);
  expect(f[o + F.ENGINE_TORQUE]).toBeGreaterThan(0);
  sim.setInput({ ...sim.cars[0].input, clutch: NaN });
  expect(sim.cars[0].input.clutch).toBe(0);
});
