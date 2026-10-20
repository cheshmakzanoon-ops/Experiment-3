import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { makeTire, solveTire } from '../src/simulation/tire.ts';
import { surfaceSample, type SurfaceSample, type TrackPoint } from '../src/simulation/track.ts';
import {
  FORMULA_SLICK,
  lateralContact,
  longitudinalContact,
  longitudinalRelaxationLength,
  prepareLateralContact,
  prepareLongitudinalContact,
  prepareSlip,
  relaxationLength,
  slipState,
  transientCombinedForces,
  transientLongitudinalForce,
} from '../src/simulation/tyre-force.ts';

function contactRig() {
  const state = slipState(),
    x = longitudinalContact(),
    y = lateralContact(),
    force = { fx: 0, fy: 0 },
    memory = {
      longitudinalDeflection: 0.001,
      longitudinalEnergy: 1,
      lateralDeflection: -0.001,
      lateralEnergy: 2,
    };
  return {
    state,
    x,
    y,
    force,
    memory,
    step(
      road: number,
      slipX: number,
      slipY: number,
      dt: number,
      load = 2200,
      mu = 1.84,
      legacy = false,
    ) {
      const speed = Math.max(2.5, Math.abs(road)),
        transport = Math.hypot(road, 3);
      prepareSlip(FORMULA_SLICK, load, mu, 1, 1, 1, state);
      state.alpha = Math.atan2(slipY, transport);
      if (load < 1) state.dx = state.dy = 0;
      prepareLongitudinalContact(
        state,
        memory,
        speed,
        load < 1 ? 0 : longitudinalRelaxationLength(FORMULA_SLICK, load, 160, 0, road),
        dt,
        x,
      );
      prepareLateralContact(
        state,
        memory,
        transport,
        load < 1 ? 0 : relaxationLength(FORMULA_SLICK, load, 160, 0, road),
        dt,
        y,
      );
      const beforeX = { ...x },
        beforeY = { ...y },
        probe = {
          ...transientCombinedForces(
            state,
            x,
            y,
            slipX,
            speed,
            slipY,
            force,
            false,
            legacy ? undefined : road,
          ),
        };
      expect(x).toEqual(beforeX);
      expect(y).toEqual(beforeY);
      transientCombinedForces(
        state,
        x,
        y,
        slipX,
        speed,
        slipY,
        force,
        true,
        legacy ? undefined : road,
      );
      expect(force).toEqual(probe);
      memory.longitudinalDeflection = x.deflection;
      memory.longitudinalEnergy = x.energy;
      memory.lateralDeflection = y.deflection;
      memory.lateralEnergy = y.energy;
      return force;
    },
  };
}

describe('static elastic tyre contact', () => {
  it('keeps elastic strain through dashpot cancellation and projects reversal work passively', () => {
    for (const fixture of [
      { initial: 0.005, cap: 0.5, common: 1, force: 0, strain: 0.004, heat: 4 },
      { initial: 0.003, cap: 0.5, common: 1, force: -0.5, strain: 0.0005, heat: 1 },
      { initial: 0.003, cap: 10, common: 0.4, force: -0.8, strain: 0.0008, heat: 1.6 },
    ]) {
      const contact = longitudinalContact();
      Object.assign(contact, {
        stiffness: 1000,
        oldDeflection: fixture.initial,
        oldEnergy: 500 * fixture.initial ** 2,
        dt: 0.001,
      });
      const before = { ...contact },
        probe = transientLongitudinalForce(
          contact,
          -1,
          0,
          fixture.cap,
          false,
          0,
          0,
          4,
          fixture.common,
        );
      expect(contact).toEqual(before);
      const force = transientLongitudinalForce(
        contact,
        -1,
        0,
        fixture.cap,
        true,
        0,
        0,
        4,
        fixture.common,
      );
      expect(force).toBe(probe);
      expect(force).toBeCloseTo(fixture.force, 12);
      expect(contact.deflection).toBeCloseTo(fixture.strain, 12);
      expect(contact.relaxationHeat).toBeCloseTo(fixture.heat, 12);
      expect(contact.dissipation).toBeGreaterThanOrEqual(0);
      expect(contact.oldEnergy - force * contact.dt - contact.energy).toBeCloseTo(
        (contact.dissipation + contact.relaxationHeat + contact.numericalDissipation) * contact.dt,
        12,
      );
    }
    // A material dashpot's internal heating has no timestep coefficient and
    // does not masquerade as tread sliding/constraint loss.
    for (const dt of [1 / 960, 1 / 240, 1 / 60]) {
      const contact = longitudinalContact();
      contact.stiffness = 1000;
      contact.dt = dt;
      transientLongitudinalForce(contact, 1, 0, Infinity, true, 0, 0, 4);
      expect(contact.relaxationHeat).toBe(4);
      expect(contact.dissipation).toBe(0);
    }
  });

  it('holds both signed preloads at zero motion without heat, wear work or energy decay', () => {
    for (const dt of [1 / 960, 1 / 240, 1 / 60, 0.1]) {
      const contact = contactRig();
      contact.step(0, 0, 0, dt);
      const initial = { ...contact.force };
      for (let i = 0; i < 120; i++) {
        contact.step(0, 0, 0, dt);
        expect(contact.force.fx).toBeCloseTo(initial.fx, 10);
        expect(contact.force.fy).toBeCloseTo(initial.fy, 10);
        expect(contact.x.energy).toBeCloseTo(1, 12);
        expect(contact.y.energy).toBeCloseTo(2, 12);
        expect(contact.x.dissipation + contact.y.dissipation).toBe(0);
        expect(contact.x.relaxationHeat + contact.y.relaxationHeat).toBe(0);
      }
    }
  });

  it('preserves the passive work identity through static slip, reversal and moving transitions', () => {
    for (const dt of [1 / 960, 1 / 240, 1 / 60]) {
      const contact = contactRig();
      let clipped = false;
      for (let i = 0; i < 400; i++) {
        const road = i < 180 ? 0 : 6 * Math.sin((i - 180) * 0.03),
          sx = i < 100 ? 0.2 : 0.8 * Math.sin(i * 0.04),
          sy = i < 100 ? -0.4 : 1.4 * Math.cos(i * 0.05),
          oldX = contact.x.energy || contact.memory.longitudinalEnergy,
          oldY = contact.y.energy || contact.memory.lateralEnergy;
        contact.step(road, sx, sy, dt, i % 100 < 70 ? 2200 : 500, 1.1);
        for (const [axis, old, work] of [
          [contact.x, oldX, contact.force.fx * sx * dt],
          [contact.y, oldY, -contact.force.fy * sy * dt],
        ] as const) {
          expect(work + old - axis.energy).toBeCloseTo(
            (axis.dissipation + axis.relaxationHeat + axis.numericalDissipation) * dt,
            8,
          );
          expect(axis.dissipation).toBeGreaterThanOrEqual(0);
        }
        const use = Math.hypot(
          contact.force.fx / contact.state.dx,
          contact.force.fy / contact.state.dy,
        );
        expect(use).toBeLessThanOrEqual(1 + 1e-12);
        clipped ||= use > 1 - 1e-10;
      }
      expect(clipped).toBe(true);
    }
  });

  it('releases a static patch once on contact loss and does not resurrect its preload', () => {
    const contact = contactRig(),
      dt = 1 / 240;
    contact.step(0, 0, 0, dt);
    const stored = contact.x.energy + contact.y.energy;
    contact.step(0, 0, 0, dt, 0);
    expect(contact.force).toEqual({ fx: 0, fy: 0 });
    expect((contact.x.relaxationHeat + contact.y.relaxationHeat) * dt).toBeCloseTo(stored, 12);
    expect(contact.x.dissipation + contact.y.dissipation).toBe(0);
    contact.step(0, 0, 0, dt, 0);
    expect(contact.x.relaxationHeat + contact.y.relaxationHeat).toBe(0);
    contact.step(0, 0, 0, dt);
    expect(contact.force).toEqual({ fx: 0, fy: 0 });
  });

  it('retains the exact moving contact solve and responds to stationary wheelspin', () => {
    for (const road of [-40, 12, 40]) {
      const current = contactRig(),
        previous = contactRig();
      for (let i = 0; i < 120; i++) {
        const sx = 8 * Math.sin(i * 0.04),
          sy = 5 * Math.cos(i * 0.05);
        current.step(road, sx, sy, 1 / 240);
        previous.step(road, sx, sy, 1 / 240, 2200, 1.84, true);
        expect(current.force).toEqual(previous.force);
        expect(current.memory).toEqual(previous.memory);
      }
    }
    const spinning = contactRig(),
      movingLaw = contactRig();
    for (let i = 0; i < 120; i++) {
      spinning.step(0, 25, 0, 1 / 240);
      movingLaw.step(0, 25, 0, 1 / 240, 2200, 1.84, true);
    }
    expect(spinning.force).toEqual(movingLaw.force);
    expect(spinning.x.dissipation).toBeGreaterThan(1000);
  });

  it('balances low-speed wheel, brake, elastic and internal-heat work through the damping transition', () => {
    let viscousSteps = 0,
      lockedSteps = 0,
      rollingSteps = 0;
    for (const dt of [1 / 960, 1 / 240, 1 / 60]) {
      const tire = makeTire('medium'),
        road = surfaceSample();
      for (let i = 0; i < 360; i++) {
        const oldOmega = tire.omega,
          oldEnergy =
            0.5 * tire.inertia * oldOmega ** 2 + tire.longitudinalEnergy + tire.lateralEnergy,
          speed = 3.5 * Math.sin(i * 0.06),
          sideways = 0.3 * Math.cos(i * 0.11),
          drive = 150 * Math.sin(i * 0.1),
          brake = i % 40 < 20 ? 1800 : 0;
        road.grip = i % 90 < 60 ? 1 : 0.1;
        solveTire(tire, speed, sideways, i % 70 < 50 ? 2200 : 500, drive, brake, road, 0, dt);
        const withoutBrake =
          (tire.inertia * (tire.omega - oldOmega)) / dt -
          drive +
          tire.fx * tire.radius -
          tire.rollingTorque;
        if (tire.omega === 0) {
          lockedSteps++;
          expect(Math.abs(withoutBrake)).toBeLessThanOrEqual(brake + 1e-9);
        } else {
          rollingSteps++;
          expect(Math.abs(withoutBrake + brake * Math.sign(tire.omega))).toBeLessThan(0.4);
        }
        const internalHeat = tire.longitudinalRelaxationHeat + tire.lateralRelaxationHeat,
          now = 0.5 * tire.inertia * tire.omega ** 2 + tire.longitudinalEnergy + tire.lateralEnergy,
          boundaryWork = (tire.fx * speed + tire.fy * sideways) * dt,
          physicalHeat = (tire.energy + internalHeat + tire.rollingDissipation) * dt,
          numericalLoss =
            (tire.longitudinalNumericalDissipation + tire.lateralNumericalDissipation) * dt +
            0.5 * tire.inertia * (tire.omega - oldOmega) ** 2,
          balance =
            oldEnergy +
            drive * tire.omega * dt -
            now -
            boundaryWork -
            brake * Math.abs(tire.omega) * dt -
            physicalHeat -
            numericalLoss;
        expect(Math.abs(balance)).toBeLessThan(0.15);
        expect(tire.usage).toBeLessThanOrEqual(1 + 1e-12);
        expect(tire.energy).toBe(tire.longitudinalDissipation + tire.lateralDissipation);
        if (internalHeat > 0.01) viscousSteps++;
      }
    }
    expect(viscousSteps).toBeGreaterThan(100);
    expect(lockedSteps).toBeGreaterThan(100);
    expect(rollingSteps).toBeGreaterThan(100);
  });
});

/** Exact analytic inclined plane; no pose/velocity clamp or hidden brake
 * force. All suspension, tyre, wheel and chassis updates are production code. */
class InclineTrack extends DynamicsTrack {
  readonly grade = Math.tan((10 * Math.PI) / 180);
  grip = 1;
  constructor(readonly axis: 'x' | 'z') {
    super();
  }
  override at(s: number, out: TrackPoint) {
    super.at(s, out);
    out.y = this.axis === 'z' ? this.grade * s : 0;
    out.gradient = this.axis === 'z' ? this.grade : 0;
    out.bank = this.axis === 'x' ? this.grade : 0;
    return out;
  }
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    out.height = this.grade * (this.axis === 'x' ? x : z);
    out.normal
      .set(this.axis === 'x' ? -this.grade : 0, 1, this.axis === 'z' ? -this.grade : 0)
      .normalize();
    out.grip = this.grip;
    return out;
  }
  override cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    const denominator = down.y - this.grade * down[this.axis],
      distance = (this.grade * origin[this.axis] - origin.y) / denominator;
    if (denominator >= -1e-6 || distance < 0 || distance > maximum) return Infinity;
    this.sample(origin.x + down.x * distance, origin.z + down.z * distance, out);
    return distance;
  }
}

describe('parked car contact at 60, 120 and 240 Hz', () => {
  for (const axis of ['x', 'z'] as const)
    it(`holds a 10-degree ${axis === 'x' ? 'cross-slope' : 'incline'} then releases its constraint physically`, () => {
      const positions: number[] = [];
      for (const hz of [60, 120, 240]) {
        const track = new InclineTrack(axis),
          car = new Vehicle(0);
        car.place(track, 0);
        car.fuel = 0;
        car.gear = 0;
        car.autoShift = false;
        car.input.brake = 1;
        for (let i = 0; i < 8 * hz; i++) car.step(1 / hz, track);
        const start = car.body.position[axis];
        for (let i = 0; i < 20 * hz; i++) car.step(1 / hz, track);
        expect(Math.abs(car.body.position[axis] - start)).toBeLessThan(0.003);
        expect(car.body.velocity.length()).toBeLessThan(0.0005);
        expect(car.tires.every((tire) => tire.omega === 0)).toBe(true);
        positions.push(car.body.position[axis]);
        const held = car.body.position[axis];
        // A longitudinal hill releases by releasing its brakes; sideways
        // support releases by exceeding its reduced physical friction budget.
        if (axis === 'z') car.input.brake = 0;
        else track.grip = 0.03;
        for (let i = 0; i < 3 * hz; i++) car.step(1 / hz, track);
        expect(car.body.position[axis]).toBeLessThan(held - 0.5);
        expect(car.body.velocity.length()).toBeGreaterThan(0.5);
        expect(car.tires.every((tire) => tire.usage <= 1 + 1e-12)).toBe(true);
      }
      expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1e-9);
    }, 60000);
});
