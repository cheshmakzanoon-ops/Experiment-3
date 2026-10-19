import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { RigidBody } from '../src/simulation/rigid.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { wheelAngularMomentum } from '../src/simulation/wheel-momentum.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';

function momentum(body: RigidBody, rotor = new Vec3()) {
  const w = body.orientation.inverseRotate(body.omega, new Vec3());
  w.set(w.x * body.inertia.x, w.y * body.inertia.y, w.z * body.inertia.z).add(rotor);
  return body.orientation.rotate(w, w);
}
function energy(body: RigidBody) {
  const w = body.orientation.inverseRotate(body.omega, new Vec3());
  return (body.inertia.x * w.x ** 2 + body.inertia.y * w.y ** 2 + body.inertia.z * w.z ** 2) / 2;
}

describe('wheel and chassis angular momentum', () => {
  it('sums signed wheel speeds and individual inertias, including reverse rotation', () => {
    const out = new Vec3(9, 8, 7);
    expect(
      wheelAngularMomentum(
        [
          { inertia: 2, omega: 20 },
          { inertia: 3, omega: -10 },
        ],
        [0, 0],
        [0, 0],
        out,
      ),
    ).toBe(out);
    expect(out.x).toBe(10);
    expect(out.y).toBe(0);
    expect(out.z).toBe(0);
  });

  it('uses the steered and cambered axle rather than a permanently fixed axis', () => {
    const tire = [{ inertia: 2, omega: 50 }];
    const out = new Vec3();
    wheelAngularMomentum(tire, [Math.PI / 2], [0], out);
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(-100, 12);
    wheelAngularMomentum(tire, [0], [Math.PI / 2], out);
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(-100, 12);
    wheelAngularMomentum(tire, [0.37], [-0.14], out);
    expect(out.length()).toBeCloseTo(100, 12);
  });

  it.each([60, 120, 240])(
    'conserves world momentum and gyrostat energy for ten seconds at %i Hz',
    (hz) => {
      const body = new RigidBody();
      body.inertia.set(510, 1220, 1080);
      body.orientation.yaw(0.71);
      body.omega.set(4, 1, -2);
      const rotor = new Vec3(670, -130, 85);
      const initialMomentum = momentum(body, rotor);
      const initialEnergy = energy(body);
      for (let i = 0; i < hz * 10; i++) body.integrate(1 / hz, rotor);
      expect(momentum(body, rotor).sub(initialMomentum).length()).toBeLessThan(1e-6);
      expect(Math.abs(energy(body) / initialEnergy - 1)).toBeLessThan(1e-9);
    },
  );

  it('accounts for changing rotor axes/speeds and changing external world torque', () => {
    const body = new RigidBody();
    body.orientation.yaw(-0.8);
    body.omega.set(1.1, -0.9, 0.4);
    const h = (t: number) =>
      new Vec3(350 + 100 * Math.sin(t), 40 * Math.cos(2 * t), 80 * Math.sin(0.7 * t));
    const expected = momentum(body, h(0));
    const dt = 1 / 240;
    for (let i = 0; i < 1440; i++) {
      body.torque.set(20 * Math.cos(i * dt), -13, 17 * Math.sin(i * dt));
      expected.addScaled(body.torque, dt);
      body.integrate(dt, h(i * dt), h((i + 1) * dt));
    }
    expect(momentum(body, h(6)).sub(expected).length()).toBeLessThan(1e-6);
  });

  it.each([1, -1])(
    'precesses in the physically signed direction for rotor direction %i',
    (sign) => {
      const body = new RigidBody();
      body.inertia.set(100, 100, 100);
      body.omega.set(0, 1, 0);
      body.integrate(0.01, new Vec3(sign * 200, 0, 0));
      expect(body.omega.z * sign).toBeGreaterThan(0.019);
      expect(body.omega.z * sign).toBeLessThan(0.021);
    },
  );

  it('does not retain rotor state when a subsequent caller supplies no rotors', () => {
    const body = new RigidBody();
    body.inertia.set(100, 100, 100);
    body.omega.set(0, 1, 0);
    body.integrate(0.01, new Vec3(200, 0, 0));
    const expected = new Vec3().copy(body.omega);
    body.integrate(0.1);
    expect(new Vec3().copy(body.omega).sub(expected).length()).toBeLessThan(1e-12);
  });

  it.each(['start', 'end'])(
    'rejects a non-finite %s endpoint before translating the body',
    (endpoint) => {
      const body = new RigidBody();
      body.position.set(1, 2, 3);
      body.velocity.set(4, 5, 6);
      body.force.set(100, 100, 100);
      const bad = new Vec3(NaN, 0, 0),
        good = new Vec3();
      expect(() =>
        body.integrate(0.01, endpoint === 'start' ? bad : good, endpoint === 'end' ? bad : good),
      ).toThrow(/Invalid rigid-body/);
      expect(body.position).toEqual(new Vec3(1, 2, 3));
      expect(body.velocity).toEqual(new Vec3(4, 5, 6));
    },
  );

  it('transfers actual airborne braking impulse through the production Vehicle substep', () => {
    const track = new DynamicsTrack();
    const car = new Vehicle(0);
    car.place(track, 0);
    car.body.position.y = 30;
    car.input.brake = 1;
    car.autoShift = false;
    for (const tire of car.tires) tire.omega = 75;
    const before = wheelAngularMomentum(car.tires, car.wheelSteering, car.wheelCamber, new Vec3());
    const expected = momentum(car.body, before);
    car.step(1 / 240, track);
    const after = wheelAngularMomentum(car.tires, car.wheelSteering, car.wheelCamber, new Vec3());
    expected.addScaled(car.body.torque, 1 / 240);
    expect(car.tires.every((t) => t.load === 0)).toBe(true);
    expect(new Vec3().copy(after).sub(before).length()).toBeGreaterThan(0.1);
    expect(momentum(car.body, after).sub(expected).length()).toBeLessThan(1e-7);
  });
});
