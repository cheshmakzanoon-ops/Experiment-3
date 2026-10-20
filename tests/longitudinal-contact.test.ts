import { describe, expect, it } from 'vitest';
import { makeTire, solveTire } from '../src/simulation/tire.ts';
import { surfaceSample } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import {
  combinedForces,
  FORMULA_SLICK,
  longitudinalContact,
  longitudinalRelaxationLength,
  prepareLongitudinalContact,
  prepareSlip,
  slipState,
  transientLongitudinalForce,
  type LongitudinalContactMemory,
  type SlipState,
} from '../src/simulation/tyre-force.ts';

const emptyMemory = (): LongitudinalContactMemory => ({
  longitudinalDeflection: 0,
  longitudinalEnergy: 0,
});
function forceLaw(alpha = 0, load = 2200, mu = 1.84) {
  const state = slipState();
  prepareSlip(FORMULA_SLICK, load, mu, 1, 1, 1, state);
  state.alpha = alpha;
  return state;
}
function fixture(state: SlipState, speed = 40, length = 0.22) {
  const memory = emptyMemory(),
    contact = longitudinalContact(),
    steady = { fx: 0, fy: 0 };
  return {
    memory,
    contact,
    steady,
    step(slipSpeed: number, dt: number, overrideLimit = Infinity) {
      prepareLongitudinalContact(state, memory, speed, length, dt, contact);
      combinedForces(state, slipSpeed / speed, steady);
      const limit = Math.min(
        overrideLimit,
        state.dx * Math.sqrt(Math.max(0, 1 - (steady.fy / state.dy) ** 2)),
      );
      transientLongitudinalForce(contact, slipSpeed, steady.fx, limit);
      memory.longitudinalDeflection = contact.deflection;
      memory.longitudinalEnergy = contact.energy;
      return contact;
    },
  };
}

describe('passive longitudinal contact deformation', () => {
  it('probes exactly the committed force without changing prepared or recorded contact state', () => {
    for (const alpha of [-0.3, 0, 0.2])
      for (const length of [0, 0.22])
        for (const preload of [-12, 0, 9])
          for (const dt of [1 / 960, 1 / 240, 0.1]) {
            const state = forceLaw(alpha),
              contact = longitudinalContact(),
              steady = { fx: 0, fy: 0 },
              memory = {
                longitudinalDeflection: Math.sign(preload) * 0.01,
                longitudinalEnergy: Math.abs(preload),
              };
            prepareLongitudinalContact(state, memory, 40, length, dt, contact);
            for (const slip of [-80, -1, -1e-10, 0, 1e-10, 1, 80])
              for (const cap of [0, 70, 5000]) {
                combinedForces(state, slip / 40, steady);
                const before = { ...contact },
                  probe = transientLongitudinalForce(contact, slip, steady.fx, cap, false);
                expect(contact).toEqual(before);
                const committed = transientLongitudinalForce(contact, slip, steady.fx, cap);
                expect(probe).toBe(committed);
                expect(contact.force).toBe(committed);
              }
          }
  });

  it('builds contact force over rolling distance and converges to the continuous response', () => {
    const speed = 40,
      length = 0.22,
      duration = length / speed,
      state = forceLaw();
    const errors: number[] = [];
    for (const steps of [4, 16, 64, 256]) {
      const rig = fixture(state, speed, length);
      let previous = 0;
      for (let i = 0; i < steps; i++) {
        const out = rig.step(0.0004, duration / steps);
        expect(out.force).toBeGreaterThan(previous);
        expect(out.force).toBeLessThan(rig.steady.fx);
        previous = out.force;
      }
      errors.push(Math.abs(rig.contact.force / rig.steady.fx - (1 - Math.exp(-1))));
    }
    expect(errors[3]).toBeLessThan(0.001);
    for (let i = 1; i < errors.length; i++) expect(errors[i]).toBeLessThan(errors[i - 1] / 3);
  });

  it('retains the calibrated combined-slip steady force, including either post-peak branch', () => {
    for (const alpha of [-0.12, 0, 0.22])
      for (const kappa of [-1, -0.04, 0.0001, 0.08, 1.6]) {
        const rig = fixture(forceLaw(alpha));
        for (let i = 0; i < 240; i++) rig.step(40 * kappa, 1 / 240);
        expect(rig.contact.force).toBeCloseTo(rig.steady.fx, 7);
        expect(rig.contact.dissipation).toBeCloseTo(rig.contact.force * 40 * kappa, 6);
        expect(rig.contact.numericalDissipation).toBeLessThan(1e-12);
      }
  });

  it('funds recoil only from stored energy and accounts for signed work through reversals', () => {
    for (const dt of [1 / 960, 1 / 240, 1 / 60, 0.1]) {
      const rig = fixture(forceLaw(0.11));
      for (let i = 0; i < 100; i++) rig.step(1.6, dt);
      let returnedWork = 0;
      for (let i = 0; i < 180; i++) {
        const slipSpeed = i < 30 ? -0.005 : i < 90 ? -2 : 0.8 * Math.sin(i * 0.3),
          before = rig.memory.longitudinalEnergy,
          out = rig.step(slipSpeed, dt),
          work = out.force * slipSpeed * dt,
          delta = out.energy - before;
        expect(work - delta).toBeGreaterThanOrEqual(-1e-10);
        expect(work - delta).toBeCloseTo((out.dissipation + out.numericalDissipation) * dt, 9);
        if (work < 0) {
          returnedWork -= work;
          expect(-work).toBeLessThanOrEqual(before + 1e-10);
          expect(out.energy).toBeLessThan(before);
        }
        expect(out.dissipation).toBeGreaterThanOrEqual(0);
        expect(out.numericalDissipation).toBeGreaterThanOrEqual(0);
      }
      expect(returnedWork).toBeGreaterThan(0);
    }
  });

  it('dissipates constrained deformation without exceeding the changed friction capacity', () => {
    const rig = fixture(forceLaw()),
      dt = 1 / 240;
    for (let i = 0; i < 120; i++) rig.step(4, dt);
    const before = rig.memory.longitudinalEnergy,
      out = rig.step(0, dt, 70);
    expect(out.force).toBeCloseTo(70, 10);
    expect(out.energy).toBeLessThan(before / 100);
    expect(out.dissipation).toBeGreaterThan(0);
    expect(before - out.energy).toBeCloseTo((out.dissipation + out.numericalDissipation) * dt, 9);
  });

  it('conserves preload energy across stiffness remaps and cannot create an unloaded preload', () => {
    const memory = { longitudinalDeflection: 0.01, longitudinalEnergy: 12 },
      contact = longitudinalContact();
    for (const load of [2, 300, 2200, 20000])
      for (const length of [0.00011, 0.02, 0.4, 1.3]) {
        prepareLongitudinalContact(forceLaw(0.1, load), memory, 40, length, 1 / 240, contact);
        expect(0.5 * contact.stiffness * contact.oldDeflection ** 2).toBeCloseTo(12, 10);
        expect(memory).toEqual({ longitudinalDeflection: 0.01, longitudinalEnergy: 12 });
        prepareLongitudinalContact(
          forceLaw(0.1, load),
          emptyMemory(),
          40,
          length,
          1 / 240,
          contact,
        );
        transientLongitudinalForce(contact, 0, 0, 4000);
        expect(contact.energy).toBe(0);
        expect(contact.force).toBe(0);
      }
  });

  it('has a finite continuous zero-slip limit with combined-slip stiffness', () => {
    const state = forceLaw(0.4),
      memory = { longitudinalDeflection: 0.01, longitudinalEnergy: 10 },
      contact = longitudinalContact(),
      out = { fx: 0, fy: 0 },
      forces: number[] = [];
    prepareLongitudinalContact(state, memory, 40, 0.22, 1 / 240, contact);
    for (const slipSpeed of [-1e-7, -1e-10, 0, 1e-10, 1e-7]) {
      combinedForces(state, slipSpeed / 40, out);
      forces.push(transientLongitudinalForce(contact, slipSpeed, out.fx, state.dx));
    }
    expect((forces[0] + forces[4]) * 0.5).toBeCloseTo(forces[2], 9);
    expect((forces[1] + forces[3]) * 0.5).toBeCloseTo(forces[2], 11);
    expect(forces[2]).toBeGreaterThan(0);
  });

  it('fades into the existing walking-speed law and discharges remaining energy once', () => {
    expect(longitudinalRelaxationLength(FORMULA_SLICK, 2200, 160, 0, 1)).toBe(0);
    const state = forceLaw(),
      memory = { longitudinalDeflection: 0.01, longitudinalEnergy: 9 },
      contact = longitudinalContact();
    prepareLongitudinalContact(state, memory, 2.5, 0, 1 / 240, contact);
    transientLongitudinalForce(contact, 0, 0, state.dx);
    expect(contact.force).toBe(0);
    expect(contact.energy).toBe(0);
    expect(contact.dissipation).toBe(0);
    expect(contact.relaxationHeat / 240).toBe(9);
    expect(contact.numericalDissipation).toBe(0);
    prepareLongitudinalContact(state, emptyMemory(), 2.5, 0, 1 / 240, contact);
    transientLongitudinalForce(contact, 0, 0, state.dx);
    expect(contact.dissipation).toBe(0);
    expect(contact.relaxationHeat).toBe(0);
  });
});

describe('longitudinal contact inside the production wheel solve', () => {
  it('drops contact memory on vehicle placement without servicing tyre wear or temperatures', () => {
    const car = new Vehicle(0),
      track = new DynamicsTrack(),
      road = surfaceSample();
    car.place(track, 0);
    for (const tire of car.tires) {
      tire.omega = 40 / tire.radius;
      solveTire(tire, 40, 0, 2200, 300, 0, road, 0, 1 / 240);
      expect(tire.longitudinalEnergy).toBeGreaterThan(0);
    }
    const physicalState = car.tires.map((tire) => ({ wear: tire.wear, temp: tire.carcassTemp }));
    car.place(track, 50, 1);
    for (let i = 0; i < car.tires.length; i++) {
      const tire = car.tires[i];
      expect(tire.longitudinalDeflection).toBe(0);
      expect(tire.longitudinalEnergy).toBe(0);
      expect(tire.longitudinalDissipation).toBe(0);
      expect(tire.longitudinalRelaxationHeat).toBe(0);
      expect(tire.longitudinalNumericalDissipation).toBe(0);
      expect(tire.wear).toBe(physicalState[i].wear);
      expect(tire.carcassTemp).toBe(physicalState[i].temp);
    }
  });

  it('satisfies the torque residual and brake complementarity through changing signs and grip', () => {
    const tire = makeTire('medium'),
      road = surfaceSample(),
      dt = 1 / 240;
    tire.omega = 40 / tire.radius;
    for (let i = 0; i < 1500; i++) {
      const old = tire.omega,
        previousEnergy = tire.longitudinalEnergy,
        speed = i < 900 ? 40 : -25,
        drive = i % 180 < 90 ? 900 : -800,
        brake = i % 220 < 110 ? 0 : 2500;
      road.grip = i % 300 < 150 ? 1 : 0.15;
      solveTire(tire, speed, Math.sin(i * 0.014) * 6, 2200, drive, brake, road, 0, dt);
      const withoutBrake = (tire.inertia * (tire.omega - old)) / dt - drive + tire.fx * tire.radius;
      if (tire.omega === 0) expect(Math.abs(withoutBrake)).toBeLessThanOrEqual(brake + 1e-9);
      else expect(Math.abs(withoutBrake + brake * Math.sign(tire.omega))).toBeLessThan(0.4);
      const signedWork = tire.fx * (tire.omega * tire.radius - speed) * dt,
        released = previousEnergy - tire.longitudinalEnergy;
      expect(signedWork + released).toBeGreaterThanOrEqual(-1e-8);
      expect(signedWork + released).toBeCloseTo(
        (tire.longitudinalDissipation +
          tire.longitudinalRelaxationHeat +
          tire.longitudinalNumericalDissipation) *
          dt,
        7,
      );
      expect(tire.usage).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('accounts for whole-wheel kinetic, elastic, brake and boundary work independently', () => {
    const tire = makeTire('medium'),
      road = surfaceSample(),
      dt = 1 / 240,
      speed = 30;
    tire.omega = speed / tire.radius + 30;
    for (let i = 0; i < 800; i++) {
      const oldOmega = tire.omega,
        oldEnergy = 0.5 * tire.inertia * oldOmega ** 2 + tire.longitudinalEnergy,
        brake = i % 200 > 100 ? 1100 : 0;
      solveTire(tire, speed, 0, 2200, 0, brake, road, 0, dt);
      const now = 0.5 * tire.inertia * tire.omega ** 2 + tire.longitudinalEnergy,
        hubWork = tire.fx * speed * dt,
        brakeWork = brake * Math.abs(tire.omega) * dt,
        physicalHeat = (tire.longitudinalDissipation + tire.longitudinalRelaxationHeat) * dt,
        springLoss = tire.longitudinalNumericalDissipation * dt,
        wheelLoss = 0.5 * tire.inertia * (tire.omega - oldOmega) ** 2,
        balance = oldEnergy - now - hubWork - brakeWork - physicalHeat - springLoss - wheelLoss;
      // Original fixed 16-iteration bisection bounds the torque error. This
      // oracle checks physical units and all work channels without recomputing
      // the contact update itself.
      expect(Math.abs(balance)).toBeLessThan(0.15);
    }
  });

  it('does not turn stored recoil or numerical damping into fictitious slip heating', () => {
    const tire = makeTire('medium'),
      road = surfaceSample(),
      dt = 1 / 240;
    tire.omega = 40 / tire.radius;
    solveTire(tire, 40, 0, 2200, 300, 0, road, 0, dt);
    const contactWork = tire.fx * (tire.omega * tire.radius - 40);
    expect(tire.longitudinalEnergy).toBeGreaterThan(0);
    expect(tire.longitudinalNumericalDissipation).toBeGreaterThan(0);
    expect(tire.energy).toBe(tire.longitudinalDissipation);
    expect(tire.energy).toBeLessThan(contactWork);
    expect(contactWork - tire.energy).toBeCloseTo(
      tire.longitudinalEnergy / dt + tire.longitudinalNumericalDissipation,
      8,
    );
  });

  it('clears an airborne patch without ghost forces and never revives its old preload', () => {
    const tire = makeTire('medium'),
      road = surfaceSample(),
      dt = 1 / 240;
    tire.omega = 40 / tire.radius;
    for (let i = 0; i < 40; i++) solveTire(tire, 40, 0, 2200, 500, 0, road, 0, dt);
    const stored = tire.longitudinalEnergy,
      wear = tire.wear;
    expect(stored).toBeGreaterThan(0);
    solveTire(tire, 40, 0, 0, 0, 0, road, 0, dt);
    expect(tire.fx).toBe(0);
    expect(tire.fy).toBe(0);
    expect(tire.longitudinalDeflection).toBe(0);
    expect(tire.longitudinalEnergy).toBe(0);
    expect(tire.longitudinalDissipation).toBe(0);
    expect(tire.longitudinalRelaxationHeat * dt).toBeCloseTo(stored, 10);
    expect(tire.energy).toBe(0);
    expect(tire.wear).toBe(wear);
    solveTire(tire, 40, 0, 0, 0, 0, road, 0, dt);
    expect(tire.longitudinalDissipation).toBe(0);
    expect(tire.longitudinalRelaxationHeat).toBe(0);
    tire.omega = 40 / tire.radius;
    solveTire(tire, 40, 0, 2200, 0, 0, road, 0, dt);
    expect(Math.abs(tire.fx)).toBeLessThan(0.001);
    expect(tire.longitudinalEnergy).toBeLessThan(1e-8);
  });

  it('preserves rest under the brakes at walking pace and exactly repeats the same input sequence', () => {
    const a = makeTire('soft'),
      b = makeTire('soft'),
      road = surfaceSample(),
      dt = 1 / 240;
    a.longitudinalDeflection = b.longitudinalDeflection = 0.02;
    a.longitudinalEnergy = b.longitudinalEnergy = 20;
    for (let i = 0; i < 1000; i++) {
      const speed = i < 100 ? 0 : 0.5 * Math.sin(i * 0.03),
        drive = i < 100 ? 0 : i % 70 < 35 ? 50 : -50;
      solveTire(a, speed, 0, 2200, drive, 4000, road, 0, dt);
      solveTire(b, speed, 0, 2200, drive, 4000, road, 0, dt);
      expect(a.omega).toBe(0);
      expect(a.longitudinalEnergy).toBe(0);
      expect(a).toEqual(b);
    }
  });
});
