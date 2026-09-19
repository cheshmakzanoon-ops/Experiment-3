import { expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { RigidBody } from '../src/simulation/rigid.ts';
import { SkidContact, SKID_CONTACT } from '../src/simulation/skid-contact.ts';
import { SURFACE, type SurfaceSample, type Track } from '../src/simulation/track.ts';
const dt = 1 / 240;
function body() {
  const b = new RigidBody();
  b.position.y = 0.42;
  return b;
}
function plane(
  slopeX = 0,
  slopeZ = 0,
  surface: number = SURFACE.ASPHALT,
  active = (_x: number, _z: number) => true,
): Pick<Track, 'cast'> {
  return {
    cast(origin: Vec3, direction: Vec3, maximum: number, sample: SurfaceSample) {
      const t =
        (origin.x * slopeX + origin.z * slopeZ - origin.y) /
        (direction.y - direction.x * slopeX - direction.z * slopeZ);
      const x = origin.x + direction.x * t,
        z = origin.z + direction.z * t;
      if (t < 0 || t > maximum || !active(x, z)) return Infinity;
      sample.height = x * slopeX + z * slopeZ;
      sample.normal.set(-slopeX, 1, -slopeZ).normalize();
      sample.surface = surface;
      return t;
    },
  };
}
it('distributes the original total vertical stiffness symmetrically without invented torque', () => {
  const b = body(),
    skid = new SkidContact();
  skid.apply(b, plane(), dt);
  expect(skid.contacts).toBe(4);
  expect(skid.normalLoad).toBeCloseTo(0.01 * SKID_CONTACT.stiffness, 7);
  expect(b.force.y).toBeCloseTo(skid.normalLoad, 10);
  expect(b.torque.length()).toBeLessThan(1e-8);
  expect(skid.totalWorkJ).toBe(0);
  expect(skid.sparkWorkJ).toBe(0);
});
it.each(['front', 'left'] as const)('applies a %s strike at the contact lever arm', (side) => {
  const b = body(),
    skid = new SkidContact();
  skid.apply(
    b,
    plane(0, 0, SURFACE.KERB, (x, z) => (side === 'front' ? z > 0 : x > 0)),
    dt,
  );
  expect(skid.contacts).toBe(2);
  if (side === 'front') expect(b.torque.x).toBeCloseTo(-SKID_CONTACT.front * skid.normalLoad, 7);
  else expect(b.torque.z).toBeCloseTo(SKID_CONTACT.halfWidth * skid.normalLoad, 7);
});
it('sliding, not a vertical-motion flag, creates real dissipated work and hard-contact sparks', () => {
  const b = body(),
    skid = new SkidContact();
  b.velocity.z = 30;
  const work = skid.apply(b, plane(), dt);
  expect(skid.slidingPower).toBeCloseTo(0.06 * skid.normalLoad * 30, 7);
  expect(skid.dampingPower).toBe(0);
  expect(skid.sparkPower).toBe(skid.slidingPower);
  expect(work).toBe(skid.slidingPower);
  expect(skid.totalWorkJ).toBeCloseTo(work * dt, 9);
  expect(skid.sparkWorkJ).toBe(skid.totalWorkJ);
  expect(b.force.z).toBeCloseTo(-0.06 * skid.normalLoad, 8);
  expect(skid.point.y).toBeCloseTo(0, 12);
  expect(skid.point.z).toBe(SKID_CONTACT.front);
});
it.each([SURFACE.GRASS, SURFACE.GRAVEL])(
  'soft surface %s dissipates work without generating metal sparks',
  (surface) => {
    const b = body(),
      skid = new SkidContact();
    b.velocity.z = 40;
    skid.apply(b, plane(0, 0, surface), dt);
    expect(skid.slidingPower).toBeGreaterThan(0);
    expect(skid.slidingWorkJ).toBeGreaterThan(0);
    expect(skid.sparkWorkJ).toBe(0);
  },
);
it('preserves the actual hard-contact anchor and accumulated work after the strike has ended', () => {
  const b = body(),
    skid = new SkidContact();
  b.velocity.z = 40;
  skid.apply(b, plane(), dt);
  const point = { ...skid.point },
    work = skid.sparkWorkJ;
  b.clear();
  b.position.y = 2;
  expect(skid.apply(b, plane(), dt)).toBe(0);
  expect(skid.contacts).toBe(0);
  expect(skid.sparkPower).toBe(0);
  expect(skid.sparkWorkJ).toBe(work);
  expect({ ...skid.point }).toEqual(point);
  expect(b.force.length() + b.torque.length()).toBe(0);
});
it('damping opposes contact-point normal motion and never attracts a separating chassis', () => {
  const b = body(),
    skid = new SkidContact();
  b.velocity.y = -2;
  skid.apply(b, plane(), dt);
  expect(skid.dampingPower).toBeCloseTo(SKID_CONTACT.damping * 4, 7);
  expect(skid.sparkWorkJ).toBe(0);
  b.clear();
  b.velocity.y = 20;
  skid.apply(b, plane(), dt);
  expect(skid.normalLoad).toBe(0);
  expect(b.force.length()).toBe(0);
});
it('uses the local road normal rather than applying a vertical-only floor force', () => {
  const b = body(),
    skid = new SkidContact();
  const normal = new Vec3(-0.1, 1, -0.03).normalize();
  skid.apply(b, plane(0.1, 0.03), dt);
  expect(b.force.x).toBeLessThan(0);
  expect(b.force.z).toBeLessThan(0);
  expect(b.force.dot(normal)).toBeCloseTo(skid.normalLoad, 6);
  expect(new Vec3().cross(b.force, normal).length()).toBeLessThan(1e-8);
});
it.each([1e-7, 0.001, 0.1])(
  'bounds the combined friction impulse at low speed %s without adding kinetic energy',
  (speed) => {
    const b = body(),
      skid = new SkidContact();
    b.velocity.x = speed;
    const before = 0.5 * b.mass * speed * speed;
    skid.apply(b, plane(), dt);
    // Isolate the already-calculated friction contribution; this is a component
    // energy oracle, not a driving fixture or a production velocity intervention.
    b.force.y = 0;
    b.integrate(dt);
    const after =
      0.5 * b.mass * b.velocity.length() ** 2 +
      0.5 *
        (b.inertia.x * b.omega.x ** 2 +
          b.inertia.y * b.omega.y ** 2 +
          b.inertia.z * b.omega.z ** 2);
    expect(b.velocity.x).toBeGreaterThanOrEqual(0);
    expect(after).toBeLessThan(before);
  },
);
it('rejects invalid timestep, query and surface-normal results without suppressing errors', () => {
  const b = body(),
    skid = new SkidContact();
  for (const value of [0, -1, NaN, Infinity]) expect(() => skid.apply(b, plane(), value)).toThrow();
  expect(() => skid.apply(b, { cast: () => NaN }, dt)).toThrow();
  expect(() =>
    skid.apply(
      b,
      {
        cast(_a, _b, _c, s) {
          s.normal.set(0, 2, 0);
          return 0.9;
        },
      },
      dt,
    ),
  ).toThrow();
});
