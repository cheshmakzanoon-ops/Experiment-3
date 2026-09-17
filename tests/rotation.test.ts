import { describe, it, expect } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { RigidBody } from '../src/simulation/rigid.ts';

function invariants(body: RigidBody) {
  const w = body.orientation.inverseRotate(body.omega, new Vec3());
  const momentum = new Vec3(w.x * body.inertia.x, w.y * body.inertia.y, w.z * body.inertia.z);
  const energy = 0.5 * momentum.dot(w);
  body.orientation.rotate(momentum, momentum);
  return { energy, momentum };
}
describe('midpoint angular integration', () => {
  it.each([
    [10, 15, 25],
    [2, 80, -30],
    [0.001, 18, 0.001],
  ])('conserves free-spin energy and world momentum for 60 seconds: %j', (x, y, z) => {
    const body = new RigidBody();
    body.orientation.yaw(0.9);
    body.omega.set(x, y, z);
    const before = invariants(body);
    for (let tick = 0; tick < 14400; tick++) {
      body.integrate(1 / 240);
      if (tick % 120 === 0) {
        const after = invariants(body);
        expect(Math.abs(after.energy / before.energy - 1)).toBeLessThan(1e-8);
        expect(
          after.momentum.sub(before.momentum).length() / before.momentum.length(),
        ).toBeLessThan(1e-8);
      }
    }
    expect(
      Math.hypot(body.orientation.x, body.orientation.y, body.orientation.z, body.orientation.w),
    ).toBeCloseTo(1, 12);
  });
  it('transfers the exact external torque impulse in world space', () => {
    const body = new RigidBody();
    body.orientation.yaw(0.7);
    body.omega.set(4, 6, -2);
    body.torque.set(1400, -2300, 500);
    const before = invariants(body);
    for (let tick = 0; tick < 1200; tick++) body.integrate(1 / 240);
    const expected = before.momentum.addScaled(body.torque, 5);
    const after = invariants(body);
    expect(after.momentum.sub(expected).length()).toBeLessThan(1e-5);
  });
  it('matches principal-axis acceleration without artificial damping', () => {
    const body = new RigidBody();
    body.torque.y = body.inertia.y * 2;
    for (let tick = 0; tick < 240; tick++) body.integrate(1 / 240);
    expect(body.omega.y).toBeCloseTo(2, 10);
    expect(body.omega.x).toBe(0);
    expect(body.angularAcceleration.y).toBeCloseTo(2, 9);
  });
  it('rejects invalid inertia, timing, orientation and torque', () => {
    const body = new RigidBody();
    expect(() => body.integrate(NaN)).toThrow();
    expect(() => body.integrate(0)).toThrow();
    body.inertia.x = 0;
    expect(() => body.integrate(1 / 240)).toThrow();
    body.inertia.x = 510;
    body.orientation.w = 2;
    expect(() => body.integrate(1 / 240)).toThrow();
    body.orientation.w = 1;
    body.torque.z = Infinity;
    expect(() => body.integrate(1 / 240)).toThrow();
  });
});
