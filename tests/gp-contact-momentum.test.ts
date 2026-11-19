import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { BIKE, Bike, EXPERT } from '../src/simulation/bike.ts';

const DT = 1 / 240;
const geometry = {
  frontArm: BIKE.cgToFront,
  rearArm: BIKE.cgToRear,
  yawInertia: 55,
  frontRadius: 0.3,
  rearRadius: 0.32,
  frontWheelInertia: 0.6,
  rearWheelInertia: 0.9,
};
const idle = { lean: 0, throttle: 0, frontBrake: 0, rearBrake: 0, rider: 0, drive: 0 };

function machine(mu = BIKE.mu) {
  const bike = new Bike(EXPERT, { ...BIKE, mu, drag: 0, rolling: 0 });
  bike.speed = 30;
  bike.heading = 0.4;
  bike.enableMotoGPPhysics(geometry);
  bike.contactLoads = {
    front: (bike.mass * G * BIKE.cgToRear) / BIKE.wheelbase,
    rear: (bike.mass * G * BIKE.cgToFront) / BIKE.wheelbase,
  };
  return bike;
}
function world(bike: Bike) {
  const side = bike.motoGP!.lateralSpeed;
  return {
    x: Math.sin(bike.heading) * bike.speed + Math.cos(bike.heading) * side,
    z: Math.cos(bike.heading) * bike.speed - Math.sin(bike.heading) * side,
  };
}

describe('GP coupled contact-frame momentum', () => {
  it('keeps the incident velocity and yaw guards dissipative', () => {
    const bike = machine(0),
      gp = bike.motoGP!;
    gp.yawRate = 4;
    gp.lateralSpeed = 50;
    const translational = bike.speed ** 2 + gp.lateralSpeed ** 2,
      angular = gp.yawRate ** 2;
    bike.step(idle, DT);
    expect(bike.speed ** 2 + gp.lateralSpeed ** 2).toBeLessThanOrEqual(translational);
    expect(gp.yawRate ** 2).toBeLessThanOrEqual(angular);
    expect(Math.abs(gp.yawRate)).toBe(2.5);
    expect(Math.abs(gp.lateralSpeed)).toBe(0.8 * 30);
  });

  it.each(['both', 'rear'] as const)(
    'conserves world momentum during force-free yaw with %s support',
    (contacts) => {
      const bike = machine(0),
        gp = bike.motoGP!;
      if (contacts === 'rear') bike.contactLoads!.front = 0;
      gp.yawRate = 0.6;
      gp.lateralSpeed = 3;
      const before = world(bike);
      for (let i = 0; i < 24; i++) {
        bike.step(idle, DT);
        expect(bike.state).toBe('riding');
        expect(gp.frontFy + gp.rearFy).toBe(0);
        expect(bike.driveForce + bike.frontBrakeForce + bike.rearBrakeForce).toBe(0);
        expect(world(bike).x).toBeCloseTo(before.x, 10);
        expect(world(bike).z).toBeCloseTo(before.z, 10);
      }
    },
  );

  it.each([0.6, 3])(
    'applies front-force projection once and preserves impulse work at yaw %s',
    (yaw) => {
      const bike = machine(),
        gp = bike.motoGP!;
      bike.lean = 0.2;
      bike.steer = 0.08;
      gp.yawRate = yaw;
      gp.lateralSpeed = -3;
      const forward = bike.speed,
        side = gp.lateralSpeed,
        heading = bike.heading,
        energy = (bike.mass * (forward * forward + side * side)) / 2;
      bike.step({ ...idle, lean: 0.4, frontBrake: 0.12, drive: 100 }, DT);
      expect(bike.state).toBe('riding');
      const steer = gp.groundSteer,
        frontFx = -bike.frontBrakeForce,
        rearFx = bike.driveForce - bike.rearBrakeForce,
        fx = rearFx + frontFx * Math.cos(steer) - gp.frontFy * Math.sin(steer),
        fy = gp.rearFy + frontFx * Math.sin(steer) + gp.frontFy * Math.cos(steer),
        jx = fx * DT,
        jy = fy * DT,
        expectedForward = forward + jx / bike.mass,
        expectedSide = side + jy / bike.mass,
        expectedX = Math.sin(heading) * expectedForward + Math.cos(heading) * expectedSide,
        expectedZ = Math.cos(heading) * expectedForward - Math.sin(heading) * expectedSide,
        impulseWork = forward * jx + side * jy + (jx * jx + jy * jy) / (2 * bike.mass),
        afterEnergy = (bike.mass * (bike.speed ** 2 + gp.lateralSpeed ** 2)) / 2;
      expect(world(bike).x).toBeCloseTo(expectedX, 10);
      expect(world(bike).z).toBeCloseTo(expectedZ, 10);
      expect(afterEnergy - energy).toBeCloseTo(impulseWork, 8);
      expect(bike.longitudinal).toBeCloseTo(fx / bike.mass, 10);
      expect(Math.abs(gp.yawRate)).toBeLessThanOrEqual(2.5);
      // The yaw guard and the velocity transform use the same clipped turn.
      expect(bike.heading - heading).toBeCloseTo(gp.yawRate * DT, 12);
    },
  );
});
