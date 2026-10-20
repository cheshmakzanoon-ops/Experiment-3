import { expect, it } from 'vitest';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { defaultSuspension } from '../src/simulation/suspension.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { FORMULA_APX01 } from '../src/simulation/vehicles.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';

const DT = 1 / 240;

function braking(steer: number, rollCentre: number, anti: number) {
  const track = new DynamicsTrack();
  const car = new Vehicle(
    0,
    'medium',
    { ...DEFAULT_SETUP, frontCamber: 0, rearCamber: 0, frontToe: 0, rearToe: 0 },
    'raw',
    {
      ...FORMULA_APX01,
      dynamics: {
        suspension: defaultSuspension({
          front: { rollCentreHeight: rollCentre, antiBrake: anti, antiDrive: anti },
          rear: { rollCentreHeight: rollCentre, antiBrake: anti, antiDrive: anti },
        }),
      },
    },
  );
  car.place(track, 0);
  // A prescribed flat-road state isolates the direction of link forces. All
  // four tyres carry load; the next production substep determines the forces.
  car.body.position.y = 0.5;
  car.body.orientation.yaw(0);
  car.body.velocity.set(0, 0, 22);
  car.steer = steer;
  car.input.steer = steer / car.spec.maxSteer;
  car.input.brake = 1;
  car.step(DT, track);
  expect(car.tires.every((tyre) => tyre.load > 1000)).toBe(true);
  return car;
}

it.each([-0.3, 0.3])(
  'steered braking at %s rad transfers the actual chassis roll moment through the links',
  (steer) => {
    const height = 0.08;
    const car = braking(steer, height, 0);
    let actualMoment = 0,
      expectedMoment = 0,
      tyreFrameMoment = 0;
    for (let i = 0; i < 2; i++) {
      const tyre = car.tires[i],
        angle = car.wheelSteering[i],
        // On this flat, unpitched body, the contact and chassis frames differ
        // only by steering. Resolve the measured patch force independently.
        // Carcass rolling loss is an axle torque in the implicit wheel solve;
        // only ground compaction supplies this separate longitudinal force.
        groundResistance =
          Math.tanh(22 * Math.cos(angle) * 2) * (tyre.groundRolling * tyre.load + tyre.groundDrag),
        bodyLateral = (tyre.fx - groundResistance) * Math.sin(angle) + tyre.fy * Math.cos(angle);
      actualMoment += car.wheelPositions[i][0] * car.jacking[i];
      expectedMoment -= height * bodyLateral;
      tyreFrameMoment -= height * tyre.fy;
    }
    expect(actualMoment).toBeCloseTo(expectedMoment, 9);
    // The fixture must distinguish the corrected moment from simply treating a
    // steered tyre's lateral force as chassis-lateral load transfer.
    expect(Math.abs(expectedMoment - tyreFrameMoment)).toBeGreaterThan(10);
  },
);

it.each([-0.3, 0.3])(
  'anti geometry at %s rad receives the chassis-longitudinal part of both tyre forces',
  (steer) => {
    const anti = 0.04;
    const car = braking(steer, 0, anti);
    let expectedTotal = 0,
      actualTotal = 0,
      tyreFrameTotal = 0;
    for (let i = 0; i < 2; i++) {
      const tyre = car.tires[i],
        angle = car.wheelSteering[i],
        groundResistance =
          Math.tanh(22 * Math.cos(angle) * 2) * (tyre.groundRolling * tyre.load + tyre.groundDrag),
        bodyLongitudinal =
          (tyre.fx - groundResistance) * Math.cos(angle) - tyre.fy * Math.sin(angle);
      expectedTotal -= anti * bodyLongitudinal;
      actualTotal += car.jacking[i];
      tyreFrameTotal -= anti * tyre.fx;
    }
    expect(actualTotal).toBeCloseTo(expectedTotal, 9);
    expect(Math.abs(expectedTotal - tyreFrameTotal)).toBeGreaterThan(1);
  },
);
