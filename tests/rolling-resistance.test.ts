import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { BRAKE_THERMAL } from '../src/simulation/brake-thermal.ts';
import { makeTire, resetTireContact, solveTire } from '../src/simulation/tire.ts';
import { surfaceSample, SURFACE } from '../src/simulation/track.ts';
import { TYRE_THERMAL } from '../src/simulation/tyre-thermal.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';

const DT = 1 / 240;

describe('mechanical rolling resistance and its heat destination', () => {
  it.each([-1, 1])(
    'opposes solved wheel rotation in direction %i without heating the brake',
    (sign) => {
      const tyre = makeTire('medium'),
        road = surfaceSample();
      road.temp = 40;
      tyre.surfaceTemp = tyre.carcassTemp = tyre.coreTemp = tyre.discTemp = 40;
      tyre.omega = (sign * 35) / tyre.radius;
      const before = tyre.omega;
      solveTire(tyre, sign * 35, 0, 3000, 0, 0, road, 0, DT, 0, 40);
      expect(tyre.omega * sign).toBeGreaterThan(0);
      expect(Math.abs(tyre.omega)).toBeLessThan(Math.abs(before));
      expect(tyre.rollingTorque * sign).toBeLessThan(0);
      expect(tyre.fx * sign).toBeLessThan(0);
      expect(tyre.rollingDissipation).toBeGreaterThan(1000);
      expect(tyre.discTemp - 40).toBeLessThan(1e-8);
    },
  );

  it('has symmetric forward/reverse work without an extra body-speed heat source', () => {
    const forward = makeTire('medium'),
      reverse = makeTire('medium'),
      road = surfaceSample();
    forward.omega = 30 / forward.radius;
    reverse.omega = -forward.omega;
    solveTire(forward, 30, 0, 3000, 0, 0, road, 0, DT);
    solveTire(reverse, -30, 0, 3000, 0, 0, road, 0, DT);
    expect(reverse.omega).toBeCloseTo(-forward.omega, 12);
    expect(reverse.rollingTorque).toBeCloseTo(-forward.rollingTorque, 12);
    expect(reverse.rollingDissipation).toBeCloseTo(forward.rollingDissipation, 10);
    expect(reverse.surfaceTemp).toBeCloseTo(forward.surfaceTemp, 12);
  });

  it('heats a locked sliding contact through slip, with zero rolling or rotor work', () => {
    const tyre = makeTire('medium'),
      road = surfaceSample();
    tyre.omega = 0;
    for (let i = 0; i < 120; i++) solveTire(tyre, 30, 0, 3000, 0, 10000, road, 0, DT);
    expect(tyre.omega).toBe(0);
    expect(tyre.rollingTorque).toBe(0);
    expect(tyre.rollingDissipation).toBe(0);
    expect(tyre.energy).toBeGreaterThan(10000);
    expect(tyre.wear).toBeGreaterThan(0);
  });

  it('heats a loaded spinning carcass even when the vehicle is stationary', () => {
    const tyre = makeTire('medium'),
      road = surfaceSample();
    tyre.omega = 150;
    solveTire(tyre, 0, 0, 3000, 2500, 0, road, 0, DT);
    expect(tyre.omega).toBeGreaterThan(100);
    expect(tyre.rollingDissipation).toBeGreaterThan(1000);
    expect(tyre.energy).toBeGreaterThan(0);
  });

  it('removes load-dependent rolling torque in the air and clears it on placement', () => {
    const tyre = makeTire('medium'),
      road = surfaceSample();
    tyre.omega = 100;
    solveTire(tyre, 30, 0, 3000, 0, 0, road, 0, DT);
    expect(tyre.rollingDissipation).toBeGreaterThan(0);
    const airborneOmega = tyre.omega;
    solveTire(tyre, 30, 0, 0, 0, 0, road, 0, DT);
    expect(tyre.omega).toBeCloseTo(airborneOmega, 12);
    expect(tyre.rollingTorque).toBe(0);
    expect(tyre.rollingDissipation).toBe(0);
    solveTire(tyre, 30, 0, 3000, 0, 0, road, 0, DT);
    resetTireContact(tyre);
    expect(tyre.fx).toBe(0);
    expect(tyre.fy).toBe(0);
    expect(tyre.energy).toBe(0);
    expect(tyre.usage).toBe(0);
    expect(tyre.rollingTorque).toBe(0);
    expect(tyre.rollingDissipation).toBe(0);
  });

  it('couples lower pressure to both stronger rolling deceleration and more carcass heat', () => {
    const low = makeTire('medium', 100),
      high = makeTire('medium', 210),
      road = surfaceSample();
    for (const tyre of [low, high]) {
      tyre.omega = 40 / tyre.radius;
      solveTire(tyre, 40, 0, 3000, 0, 0, road, 0, DT);
    }
    expect(Math.abs(low.rollingTorque)).toBeGreaterThan(Math.abs(high.rollingTorque));
    expect(low.rollingDissipation).toBeGreaterThan(high.rollingDissipation);
    expect(low.omega).toBeLessThan(high.omega);
  });

  it('keeps excess loose-ground resistance out of carcass rolling heat', () => {
    const paved = makeTire('medium'),
      gravel = makeTire('medium'),
      road = surfaceSample(),
      loose = { ...surfaceSample(), surface: SURFACE.GRAVEL, resistance: 0.115 };
    paved.omega = gravel.omega = 30 / paved.radius;
    solveTire(paved, 30, 0, 3000, 0, 0, road, 0, DT);
    solveTire(gravel, 30, 0, 3000, 0, 0, loose, 0, DT);
    expect(paved.groundRolling).toBeCloseTo(0, 12);
    expect(gravel.groundRolling).toBeGreaterThan(0.08);
    expect(gravel.rolling).toBeGreaterThan(paved.rolling * 5);
    // The soil work remains an external translational sink. It must not
    // multiply the tire's axial moment by the gravel resistance coefficient.
    expect(Math.abs(gravel.rollingTorque / paved.rollingTorque)).toBeCloseTo(1, 10);
  });

  it('balances production rolling, slip and brake inputs against stored heat and boundary losses', () => {
    const tyre = makeTire('medium'),
      road = surfaceSample(),
      initial = 50,
      speed = 30,
      ambient = 25,
      brake = 150;
    road.temp = 35;
    tyre.surfaceTemp = tyre.carcassTemp = tyre.coreTemp = tyre.discTemp = initial;
    tyre.omega = speed / tyre.radius;
    const before =
      initial *
      (TYRE_THERMAL.surfaceCapacity +
        TYRE_THERMAL.carcassCapacity +
        TYRE_THERMAL.coreCapacity +
        BRAKE_THERMAL.capacity);
    solveTire(tyre, speed, 0, 3000, 0, brake, road, 0, DT, 0, ambient);
    const after =
      TYRE_THERMAL.surfaceCapacity * tyre.surfaceTemp +
      TYRE_THERMAL.carcassCapacity * tyre.carcassTemp +
      TYRE_THERMAL.coreCapacity * tyre.coreTemp +
      BRAKE_THERMAL.capacity * tyre.discTemp;
    const loss =
      (TYRE_THERMAL.airBase + TYRE_THERMAL.airSpeed * speed) * (tyre.surfaceTemp - ambient) +
      TYRE_THERMAL.trackContact * (tyre.surfaceTemp - road.temp) +
      (TYRE_THERMAL.sidewallBase + TYRE_THERMAL.sidewallSpeed * speed) *
        (tyre.carcassTemp - ambient) +
      (TYRE_THERMAL.rimBase + TYRE_THERMAL.rimSpeed * speed) * (tyre.coreTemp - ambient) +
      (BRAKE_THERMAL.airBase + BRAKE_THERMAL.airSpeed * speed) * (tyre.discTemp - ambient);
    const input =
      tyre.rollingDissipation +
      TYRE_THERMAL.slipShare * tyre.energy +
      tyre.longitudinalRelaxationHeat +
      tyre.lateralRelaxationHeat +
      brake * Math.abs(tyre.omega);
    expect(after - before + loss * DT).toBeCloseTo(input * DT, 6);
  });

  it('applies the road axial moment to total momentum through the production vehicle', () => {
    const track = new DynamicsTrack(),
      car = new Vehicle(0);
    car.place(track, 0);
    car.fuel = 0;
    car.input.brake = 1;
    for (let i = 0; i < 480; i++) car.step(DT, track);
    car.input.brake = car.brake = 0;
    car.body.velocity.set(0, 0, 25);
    car.speed = 25;
    for (const tyre of car.tires) tyre.omega = 25 / tyre.radius;
    const forceMoment = new Vec3(),
      arm = new Vec3(),
      moment = new Vec3(),
      apply = car.body.apply.bind(car.body);
    car.body.apply = (force, point) => {
      forceMoment.add(moment.cross(arm.copy(point).sub(car.body.position), force));
      apply(force, point);
    };
    car.step(DT, track);
    const expectedRollingMoment = new Vec3();
    for (let i = 0; i < 4; i++)
      expectedRollingMoment.addScaled(car.contactFrames[i].axle, car.tires[i].rollingTorque);
    expect(expectedRollingMoment.length()).toBeGreaterThan(1);
    expect(
      new Vec3().copy(car.body.torque).sub(forceMoment).sub(expectedRollingMoment).length(),
    ).toBeLessThan(1e-8);
    expect(car.tires.every((tyre) => tyre.groundRolling < 1e-10)).toBe(true);
  });
});
