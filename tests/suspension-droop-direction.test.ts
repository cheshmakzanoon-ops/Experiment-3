import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { defaultSuspension, geometricLoad } from '../src/simulation/suspension.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { FORMULA_APX01 } from '../src/simulation/vehicles.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';

const DT = 1 / 240;

function airborneFixture(compression: number, frontDroop = 0.05, rearDroop = frontDroop) {
  const car = new Vehicle(
    0,
    'medium',
    { ...DEFAULT_SETUP, frontCamber: 0, rearCamber: 0, frontToe: 0, rearToe: 0 },
    'raw',
    {
      ...FORMULA_APX01,
      dynamics: {
        suspension: defaultSuspension({
          front: { droop: frontDroop },
          rear: { droop: rearDroop },
        }),
      },
    },
  );
  const track = new DynamicsTrack();
  car.place(track, 0);
  // All four stations have the same mounting height. A negative geometric
  // compression puts this road below the suspension's zero-travel plane,
  // while a previously extended hub may still compress its tire against it.
  car.body.position.y =
    car.spec.restLength + car.spec.wheelRadius - car.wheelPositions[0][1] - compression;
  car.fuel = car.battery = 0;
  car.input.manualClutch = true;
  car.input.clutch = 1;
  return { car, track };
}

describe('reachable road contact during suspension droop', () => {
  it('retains the exact compliant reaction below zero travel instead of dropping a loaded tire', () => {
    const compression = -0.002,
      previous = -0.008,
      link = 2000,
      { car, track } = airborneFixture(compression);
    car.hub.travel.fill(previous);
    car.jacking.fill(link);
    car.step(DT, track);

    for (let i = 0; i < 4; i++) {
      const hardware = car.hub.hardware[i],
        tyre = car.hub.tyreRate[i],
        // The fixture stays in the linear bump-damper branch and negative
        // spring travel. Equal axle travel cancels the anti-roll bar. This
        // closed-form series solution is independent of the Newton solver.
        damping = hardware.bump + hardware.tyreDamping,
        expectedTravel =
          (tyre * compression + (damping * previous) / DT - link) /
          (tyre + hardware.wheelRate + damping / DT),
        velocity = (expectedTravel - previous) / DT,
        expectedLoad = tyre * (compression - expectedTravel) - hardware.tyreDamping * velocity;
      expect(velocity).toBeGreaterThan(0);
      expect(velocity).toBeLessThan(hardware.bumpKnee);
      expect(expectedLoad).toBeGreaterThan(1700);
      expect(car.hub.compression[i]).toBeCloseTo(compression, 12);
      expect(car.hub.travel[i]).toBeCloseTo(expectedTravel, 12);
      expect(car.tires[i].load).toBeCloseTo(expectedLoad, 7);
      expect(car.tires[i].deflection).toBeGreaterThan(0);
      expect(car.hub.contact[i]).toBe(1);
    }
  });

  it('does not attract a resting free wheel to a road merely because it is within reach', () => {
    const { car, track } = airborneFixture(-0.002);
    car.step(DT, track);
    expect([...car.hub.travel]).toEqual([0, 0, 0, 0]);
    expect([...car.hub.contact]).toEqual([0, 0, 0, 0]);
    for (const tire of car.tires) {
      expect(tire.load).toBe(0);
      expect(tire.deflection).toBe(0);
    }
  });

  it('rejects a road beyond each axle droop limit despite approach speed and stale link loads', () => {
    const { car, track } = airborneFixture(-0.027, 0.012, 0.025);
    car.hub.travel.set([-0.012, -0.012, -0.025, -0.025]);
    car.jacking.fill(10000);
    car.body.velocity.y = -3;
    car.step(DT, track);
    for (let i = 0; i < 4; i++) {
      expect(car.hub.contact[i]).toBe(0);
      expect(car.hub.linkLoad[i]).toBe(0);
      expect(car.tires[i].load).toBe(0);
      expect(car.tires[i].length).toBeCloseTo(car.spec.restLength + car.hub.hardware[i].droop, 12);
      expect(car.hub.travel[i]).toBeGreaterThanOrEqual(-car.hub.hardware[i].droop);
    }
  });

  it('releases and reacquires an extended tire without retaining a contact across the gap', () => {
    const { car, track } = airborneFixture(-0.002);
    const reachableHeight = car.body.position.y;
    car.hub.travel.fill(-0.008);
    car.jacking.fill(2000);
    car.step(DT, track);
    expect(car.tires.every((tire) => tire.load > 1700)).toBe(true);

    car.body.position.y = reachableHeight + 0.06;
    car.body.velocity.set(0, 0, 0);
    car.body.omega.set(0, 0, 0);
    car.step(DT, track);
    expect(car.tires.every((tire) => tire.load === 0)).toBe(true);
    expect([...car.hub.linkLoad]).toEqual([0, 0, 0, 0]);

    // Move the rig back to the road while the suspension is still extended.
    // The spring/damper state, without restoring an obsolete link force,
    // determines whether and how the tire can support the chassis again.
    car.body.position.y = reachableHeight;
    car.body.velocity.set(0, 0, 0);
    car.body.omega.set(0, 0, 0);
    car.step(DT, track);
    expect(car.tires.every((tire) => tire.load > 1000)).toBe(true);
    expect(car.tires.every((tire) => tire.deflection > 0)).toBe(true);
  });
});

describe('anti geometry in either direction of travel', () => {
  it.each([-1, 1])(
    'uses braking and drive paths with their unchanged chassis force signs at direction %s',
    (direction) => {
      const axle = {
        ...defaultSuspension().front,
        antiBrake: 0.07,
        antiDrive: 0.005,
        rollCentreHeight: 0.04,
      };
      for (const z of [-1.6, 1.8])
        for (const side of [-0.83, 0.83]) {
          const lateral = 800,
            braking = -4000 * direction,
            driving = 2500 * direction,
            lateralLoad = -(axle.rollCentreHeight / side) * lateral;
          expect(geometricLoad(axle, side, z, braking, lateral, 0, direction)).toBeCloseTo(
            lateralLoad - axle.antiBrake * braking * Math.sign(z),
            12,
          );
          expect(geometricLoad(axle, side, z, driving, lateral, 0, direction)).toBeCloseTo(
            lateralLoad - axle.antiDrive * driving * Math.sign(z),
            12,
          );
        }
    },
  );

  it.each([-0.3, 0, 0.3])(
    'routes reverse braking through brake geometry with steering %s',
    (steer) => {
      const antiBrake = 0.07,
        antiDrive = 0.005;
      const { car, track } = airborneFixture(0.035);
      // Keep the authored chassis geometry but select distinguishable brake
      // and drive paths. A fresh definition avoids altering a cached vehicle.
      const brakingCar = new Vehicle(0, 'medium', car.setup, 'raw', {
        ...FORMULA_APX01,
        dynamics: {
          suspension: defaultSuspension({
            front: { antiBrake, antiDrive },
            rear: { antiBrake, antiDrive },
          }),
        },
      });
      brakingCar.place(track, 0);
      brakingCar.body.position.y = 0.5;
      brakingCar.body.velocity.set(0, 0, -22);
      brakingCar.steer = steer;
      brakingCar.input.steer = steer / brakingCar.spec.maxSteer;
      brakingCar.input.brake = 1;
      brakingCar.input.reverse = true;
      brakingCar.autoShift = false;
      brakingCar.gear = -1;
      for (const tire of brakingCar.tires) tire.omega = -22 / tire.radius;
      brakingCar.step(DT, track);

      let actualFront = 0,
        expectedFront = 0,
        incorrectDrivePath = 0;
      for (let i = 0; i < 2; i++) {
        const tire = brakingCar.tires[i],
          basis = brakingCar.contactFrames[i],
          long = brakingCar.pointVelocities[i].dot(basis.forward),
          groundResistance =
            Math.tanh(long * 2) * (tire.groundRolling * tire.load + tire.groundDrag),
          force =
            (tire.fx - groundResistance) * basis.forward.dot(brakingCar.forward) +
            tire.fy * basis.lateral.dot(brakingCar.forward);
        expect(force).toBeGreaterThan(0);
        actualFront += brakingCar.jacking[i];
        expectedFront -= antiBrake * force;
        incorrectDrivePath -= antiDrive * force;
      }
      expect(actualFront).toBeCloseTo(expectedFront, 8);
      expect(Math.abs(expectedFront - incorrectDrivePath)).toBeGreaterThan(100);
    },
  );
});
