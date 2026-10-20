import { describe, expect, it } from 'vitest';
import { makeTire, resetTireContact, solveTire } from '../src/simulation/tire.ts';
import { surfaceSample } from '../src/simulation/track.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import {
  combinedForces,
  FORMULA_SLICK,
  lateralContact,
  longitudinalContact,
  prepareLateralContact,
  prepareLongitudinalContact,
  prepareSlip,
  slipState,
  transientCombinedForces,
} from '../src/simulation/tyre-force.ts';

const memory = () => ({
  longitudinalDeflection: 0,
  longitudinalEnergy: 0,
  lateralDeflection: 0,
  lateralEnergy: 0,
});
function rig() {
  const state = slipState(),
    previous = memory(),
    x = longitudinalContact(),
    y = lateralContact(),
    force = { fx: 0, fy: 0 },
    steady = { fx: 0, fy: 0 };
  return {
    state,
    previous,
    x,
    y,
    force,
    steady,
    step(sx: number, sy: number, dt: number, load = 2200, mu = 1.84, lengthScale = 1) {
      prepareSlip(FORMULA_SLICK, load, mu, 1, 1, 1, state);
      state.alpha = Math.atan2(sy, 40);
      if (load < 1) state.dx = state.dy = 0;
      prepareLongitudinalContact(state, previous, 40, 0.22 * lengthScale, dt, x);
      prepareLateralContact(state, previous, 40, 0.32 * lengthScale, dt, y);
      combinedForces(state, sx / 40, steady);
      transientCombinedForces(state, x, y, sx, 40, sy, force);
      previous.longitudinalDeflection = x.deflection;
      previous.longitudinalEnergy = x.energy;
      previous.lateralDeflection = y.deflection;
      previous.lateralEnergy = y.energy;
      return force;
    },
  };
}

describe('two-axis elastic tire contact', () => {
  it('builds lateral force over distance and converges to the continuous spring response', () => {
    const duration = 0.32 / 40,
      slipSpeed = 0.004,
      errors: number[] = [];
    for (const steps of [4, 16, 64, 256]) {
      const contact = rig();
      let previous = 0;
      for (let i = 0; i < steps; i++) {
        contact.step(0, slipSpeed, duration / steps);
        const resistance = -contact.force.fy;
        expect(resistance).toBeGreaterThan(previous);
        expect(resistance).toBeLessThan(-contact.steady.fy);
        previous = resistance;
      }
      const target = -contact.steady.fy,
        rate = (contact.y.stiffness * slipSpeed) / target,
        analytic = target * (1 - Math.exp(-rate * duration));
      errors.push(Math.abs(contact.force.fy + analytic) / target);
    }
    expect(errors[3]).toBeLessThan(0.001);
    for (let i = 1; i < errors.length; i++) expect(errors[i]).toBeLessThan(errors[i - 1] / 3);
  });

  it('recovers both original steady force curves through combined slip and post-peak sliding', () => {
    for (const sx of [-80, -4, 0, 2, 60])
      for (const sy of [-100, -8, -0.01, 0, 4, 120]) {
        const contact = rig();
        for (let i = 0; i < 240; i++) contact.step(sx, sy, 1 / 240);
        expect(contact.force.fx).toBeCloseTo(contact.steady.fx, 7);
        expect(contact.force.fy).toBeCloseTo(contact.steady.fy, 7);
        expect(contact.x.dissipation).toBeCloseTo(contact.force.fx * sx, 6);
        expect(contact.y.dissipation).toBeCloseTo(-contact.force.fy * sy, 6);
        expect(contact.x.numericalDissipation + contact.y.numericalDissipation).toBeLessThan(1e-12);
      }
  });

  it('probes exactly the committed pair without changing either spring state', () => {
    for (const alpha of [-1.1, 0, 0.2])
      for (const length of [0, 0.32])
        for (const dt of [1 / 960, 1 / 240, 0.1]) {
          const contact = rig(),
            { state, x, y, previous } = contact;
          prepareSlip(FORMULA_SLICK, 500, 0.2, 1, 1, 1, state);
          state.alpha = alpha;
          previous.longitudinalDeflection = -0.01;
          previous.longitudinalEnergy = 25;
          previous.lateralDeflection = 0.02;
          previous.lateralEnergy = 18;
          prepareLongitudinalContact(state, previous, 40, length, dt, x);
          prepareLateralContact(state, previous, 40, length, dt, y);
          const sy = 40 * Math.tan(alpha);
          for (const sx of [-90, -0.01, 0, 1e-10, 0.02, 70]) {
            const beforeX = { ...x },
              beforeY = { ...y },
              probe = { ...transientCombinedForces(state, x, y, sx, 40, sy, contact.force, false) };
            expect(x).toEqual(beforeX);
            expect(y).toEqual(beforeY);
            const final = transientCombinedForces(state, x, y, sx, 40, sy, contact.force);
            expect(final).toEqual(probe);
            expect(x.force).toBe(final.fx);
            expect(0 - y.force).toBe(final.fy);
            expect(Math.hypot(final.fx / state.dx, final.fy / state.dy)).toBeLessThanOrEqual(
              1 + 1e-12,
            );
          }
        }
  });

  it('accounts for signed work and elastic recoil per axis through changing loads and grip', () => {
    const contact = rig();
    let recovered = 0,
      projected = false;
    for (let i = 0; i < 1000; i++) {
      const dt = [1 / 960, 1 / 240, 1 / 60][i % 3],
        sx = i % 180 < 60 ? 4 : i % 180 < 120 ? -0.001 : -4,
        sy = i % 220 < 80 ? 5 : i % 220 < 160 ? -0.001 : -6,
        load = i % 210 < 140 ? 6000 : 350,
        mu = i % 170 < 100 ? 1.9 : 0.15,
        oldX = contact.previous.longitudinalEnergy,
        oldY = contact.previous.lateralEnergy;
      contact.step(sx, sy, dt, load, mu, i % 120 < 90 ? 1 : 0.15);
      const workX = contact.force.fx * sx * dt,
        workY = -contact.force.fy * sy * dt;
      for (const [axis, work, oldEnergy] of [
        [contact.x, workX, oldX],
        [contact.y, workY, oldY],
      ] as const) {
        expect(work + oldEnergy - axis.energy).toBeCloseTo(
          (axis.dissipation + axis.relaxationHeat + axis.numericalDissipation) * dt,
          8,
        );
        expect(axis.dissipation).toBeGreaterThanOrEqual(0);
        expect(axis.numericalDissipation).toBeGreaterThanOrEqual(0);
        if (work < 0) {
          recovered -= work;
          expect(-work).toBeLessThanOrEqual(oldEnergy + 1e-9);
        }
      }
      const use = Math.hypot(
        contact.force.fx / contact.state.dx,
        contact.force.fy / contact.state.dy,
      );
      expect(use).toBeLessThanOrEqual(1 + 1e-12);
      if (use > 1 - 1e-10 && contact.x.oldEnergy + contact.y.oldEnergy > 1) projected = true;
    }
    expect(recovered).toBeGreaterThan(0);
    expect(projected).toBe(true);
  });

  it('preserves elastic energy while remapping lateral stiffness and cannot invent a preload', () => {
    const contact = rig(),
      { previous, state, y } = contact;
    previous.lateralDeflection = -0.01;
    previous.lateralEnergy = 17;
    for (const load of [5, 300, 2200, 18000])
      for (const length of [0.00011, 0.03, 0.32, 1.2]) {
        prepareSlip(FORMULA_SLICK, load, 1.4, 1, 1, 1, state);
        prepareLateralContact(state, previous, 40, length, 1 / 240, y);
        expect(0.5 * y.stiffness * y.oldDeflection ** 2).toBeCloseTo(17, 10);
        expect(y.oldDeflection).toBeLessThan(0);
        expect(previous.lateralEnergy).toBe(17);
        prepareLateralContact(state, memory(), 40, length, 1 / 240, y);
        expect(y.oldDeflection).toBe(0);
        expect(y.oldEnergy).toBe(0);
      }
  });

  it('has a continuous zero-lateral-slip limit even while spinning or locking', () => {
    for (const sx of [-40, 0, 60]) {
      const contact = rig(),
        { previous, state, x, y } = contact,
        values: number[] = [];
      previous.lateralDeflection = 0.01;
      previous.lateralEnergy = 12;
      prepareSlip(FORMULA_SLICK, 2200, 1.84, 1, 1, 1, state);
      prepareLongitudinalContact(state, previous, 40, 0.22, 1 / 240, x);
      prepareLateralContact(state, previous, 40, 0.32, 1 / 240, y);
      for (const sy of [-1e-7, -1e-10, 0, 1e-10, 1e-7]) {
        state.alpha = Math.atan2(sy, 40);
        values.push(transientCombinedForces(state, x, y, sx, 40, sy, contact.force, false).fy);
      }
      expect((values[0] + values[4]) * 0.5).toBeCloseTo(values[2], 8);
      expect((values[1] + values[3]) * 0.5).toBeCloseTo(values[2], 10);
      expect(values[2]).toBeLessThan(0);
    }
  });
});

describe('elastic lateral contact in the production wheel solve', () => {
  it('stores a cornering impulse before heating/wearing the tire and releases energy on reversal', () => {
    const tire = makeTire('medium'),
      road = surfaceSample(),
      dt = 1 / 240;
    tire.omega = 40 / tire.radius;
    solveTire(tire, 40, 4, 2200, 0, 0, road, 0, dt);
    expect(tire.lateralDeflection).toBeGreaterThan(0);
    expect(tire.fy).toBeLessThan(0);
    expect(tire.lateralEnergy).toBeGreaterThan(0);
    expect(tire.lateralNumericalDissipation).toBeGreaterThan(0);
    expect(-tire.fy * 4 - tire.lateralDissipation).toBeCloseTo(
      tire.lateralEnergy / dt + tire.lateralNumericalDissipation,
      8,
    );
    expect(tire.energy).toBe(tire.longitudinalDissipation + tire.lateralDissipation);
    const old = tire.lateralEnergy;
    solveTire(tire, 40, -0.001, 2200, 0, 0, road, 0, dt);
    const signedWork = -tire.fy * -0.001 * dt;
    expect(signedWork).toBeLessThan(0);
    expect(-signedWork).toBeLessThan(old);
    expect(tire.lateralEnergy).toBeLessThan(old);
    expect(signedWork + old - tire.lateralEnergy).toBeCloseTo(
      (tire.lateralDissipation + tire.lateralNumericalDissipation) * dt,
      8,
    );
  });

  it('keeps wheel torque and both contact work budgets consistent during braking and slides', () => {
    const tire = makeTire('medium'),
      road = surfaceSample(),
      dt = 1 / 240;
    tire.omega = 40 / tire.radius;
    for (let i = 0; i < 1200; i++) {
      const oldOmega = tire.omega,
        oldX = tire.longitudinalEnergy,
        oldY = tire.lateralEnergy,
        speed = i < 800 ? 40 : -30,
        sideways = 16 * Math.sin(i * 0.04),
        load = i % 230 < 200 ? 3000 : 0,
        drive = i % 180 < 90 ? 850 : -900,
        brake = i % 170 < 100 ? 2500 : 0;
      road.grip = i % 250 < 140 ? 1 : 0.12;
      solveTire(tire, speed, sideways, load, drive, brake, road, 0, dt);
      const residual =
        (tire.inertia * (tire.omega - oldOmega)) / dt -
        drive +
        tire.fx * tire.radius -
        tire.rollingTorque;
      if (tire.omega === 0) expect(Math.abs(residual)).toBeLessThanOrEqual(brake + 1e-9);
      else expect(Math.abs(residual + brake * Math.sign(tire.omega))).toBeLessThan(0.4);
      const workX = tire.fx * (tire.omega * tire.radius - speed) * dt,
        workY = -tire.fy * sideways * dt;
      expect(workX + oldX - tire.longitudinalEnergy).toBeCloseTo(
        (tire.longitudinalDissipation +
          tire.longitudinalRelaxationHeat +
          tire.longitudinalNumericalDissipation) *
          dt,
        7,
      );
      expect(workY + oldY - tire.lateralEnergy).toBeCloseTo(
        (tire.lateralDissipation + tire.lateralRelaxationHeat + tire.lateralNumericalDissipation) *
          dt,
        7,
      );
      expect(tire.camberPower).toBe(0);
      expect(tire.usage).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('reports camber as an explicit signed geometric work port, including zero lateral speed', () => {
    const tire = makeTire('medium'),
      road = surfaceSample(),
      dt = 1 / 240;
    tire.omega = 40 / tire.radius;
    solveTire(tire, 40, 0, 2200, 0, 0, road, 0.08, dt);
    expect(tire.fy).toBeGreaterThan(0);
    expect(tire.camberPower).toBeGreaterThan(0);
    expect(tire.camberPower * dt).toBeCloseTo(
      tire.lateralEnergy + (tire.lateralDissipation + tire.lateralNumericalDissipation) * dt,
      10,
    );
    for (let i = 0; i < 500; i++) {
      const old = tire.lateralEnergy,
        vLat = 8 * Math.sin(i * 0.033),
        camber = 0.15 * Math.sin(i * 0.049),
        speed = i < 250 ? 35 : -25;
      solveTire(tire, speed, vLat, 2200, 0, 0, road, camber, dt);
      const supplied = (-tire.fy * vLat + tire.camberPower) * dt;
      expect(supplied + old - tire.lateralEnergy).toBeCloseTo(
        (tire.lateralDissipation + tire.lateralRelaxationHeat + tire.lateralNumericalDissipation) *
          dt,
        8,
      );
      expect(tire.lateralDissipation).toBeGreaterThanOrEqual(0);
    }
  });

  it('releases unloaded strain once into the carcass without airborne friction or extra wear', () => {
    const tire = makeTire('medium'),
      road = surfaceSample(),
      dt = 1 / 240;
    tire.omega = 40 / tire.radius;
    solveTire(tire, 40, 5, 2200, 500, 0, road, 0, dt);
    const oldX = tire.longitudinalEnergy,
      oldY = tire.lateralEnergy,
      wear = tire.wear;
    expect(oldX + oldY).toBeGreaterThan(0);
    solveTire(tire, 40, 5, 0, 500, 0, road, 0.08, dt);
    expect(tire.fx).toBe(0);
    expect(tire.fy).toBe(0);
    expect(tire.energy).toBe(0);
    expect(tire.longitudinalEnergy + tire.lateralEnergy).toBe(0);
    expect(tire.lateralDeflection).toBe(0);
    expect(tire.longitudinalRelaxationHeat * dt).toBeCloseTo(oldX, 10);
    expect(tire.lateralRelaxationHeat * dt).toBeCloseTo(oldY, 10);
    expect(tire.wear).toBe(wear);
    solveTire(tire, 40, 5, 0, 500, 0, road, 0.08, dt);
    expect(tire.lateralRelaxationHeat + tire.longitudinalRelaxationHeat).toBe(0);
    expect(tire.camberPower).toBe(0);
  });

  it('clears contact memories on placement without servicing physical tire state', () => {
    const car = new Vehicle(0),
      track = new DynamicsTrack(),
      road = surfaceSample();
    car.place(track, 0);
    const tire = car.tires[0];
    tire.omega = 40 / tire.radius;
    solveTire(tire, 40, 4, 2200, 500, 0, road, 0.05, 1 / 240);
    expect(tire.lateralEnergy).toBeGreaterThan(0);
    const wear = tire.wear,
      temperature = tire.carcassTemp;
    car.place(track, 50, 1);
    expect(tire.lateralDeflection).toBe(0);
    expect(tire.lateralEnergy).toBe(0);
    expect(tire.lateralDissipation).toBe(0);
    expect(tire.lateralRelaxationHeat).toBe(0);
    expect(tire.lateralNumericalDissipation).toBe(0);
    expect(tire.camberPower).toBe(0);
    expect(tire.wear).toBe(wear);
    expect(tire.carcassTemp).toBe(temperature);
    resetTireContact(tire);
    expect(tire.lateralEnergy + tire.longitudinalEnergy).toBe(0);
  });
});
