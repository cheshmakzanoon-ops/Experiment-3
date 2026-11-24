import { describe, expect, it } from 'vitest';
import { RigidBody } from '../src/simulation/rigid.ts';

const vectors = [
  'position',
  'velocity',
  'omega',
  'force',
  'torque',
  'acceleration',
  'angularAcceleration',
  'inertia',
] as const;

function bytes(body: RigidBody) {
  const values = [
    ...vectors.flatMap((key) => [body[key].x, body[key].y, body[key].z]),
    body.orientation.x,
    body.orientation.y,
    body.orientation.z,
    body.orientation.w,
    body.mass,
  ];
  return new Uint8Array(new Float64Array(values).buffer);
}

function configure(body: RigidBody) {
  body.mass = 790;
  body.inertia.set(510, 1220, 1080);
  body.position.set(12, -0, -4);
  body.velocity.set(3, 0.5, 7);
  body.omega.set(0.3, -0.2, 0.1);
  body.force.set(100, -50, 200);
  body.torque.set(20, -10, 5);
  body.acceleration.set(1, 2, 3);
  body.angularAcceleration.set(-1, -2, -3);
  body.orientation.yaw(0.7);
}

const overflowCases = [
  {
    name: 'position',
    prepare(body: RigidBody) {
      body.position.set(4e307, 4e307, 0);
      body.velocity.set(4e307, 4e307, 0);
      return 2;
    },
  },
  {
    name: 'velocity',
    prepare(body: RigidBody) {
      body.mass = 1;
      body.position.set(-4.5e307, -4.5e307, 0);
      body.velocity.set(3e307, 3e307, 0);
      body.force.set(6e307, 6e307, 0);
      return 1;
    },
  },
  {
    name: 'acceleration',
    prepare(body: RigidBody) {
      body.mass = 0.5;
      body.force.set(6e307, 6e307, 0);
      return 0.25;
    },
  },
  {
    name: 'angularAcceleration',
    prepare(body: RigidBody) {
      body.inertia.set(0.5, 0.5, 0.5);
      body.torque.set(6e307, 6e307, 0);
      return 1e-308;
    },
  },
];

describe('scalar rigid candidates preserve the accepted-state contract', () => {
  it.each(overflowCases)(
    'retains sum-overflow rejection and retry recovery for $name',
    ({ prepare }) => {
      const body = new RigidBody();
      const objects = [...vectors.map((key) => body[key]), body.orientation];
      const dt = prepare(body);
      for (const key of vectors) expect(body[key].finite()).toBe(true);
      const rejected = bytes(body);
      // These inputs pass entry validation. Candidate sums overflow even though
      // their individual components are finite: Vec3.finite's existing contract
      // must survive replacing temporary vectors with scalar candidates.
      for (let retry = 0; retry < 3; retry++) {
        expect(() => body.integrate(dt)).toThrow('Non-finite rigid body');
        expect(bytes(body)).toEqual(rejected);
      }
      configure(body);
      const fresh = new RigidBody();
      configure(fresh);
      body.integrate(1 / 120);
      fresh.integrate(1 / 120);
      expect(bytes(body)).toEqual(bytes(fresh));
      for (let index = 0; index < vectors.length; index++)
        expect(body[vectors[index]]).toBe(objects[index]);
      expect(body.orientation).toBe(objects.at(-1));
    },
  );

  it.each([0, -0])('preserves the exact translation zero signs for %s', (zero) => {
    const body = new RigidBody();
    body.position.set(zero, zero, zero);
    body.velocity.set(zero, zero, zero);
    body.force.set(zero, zero, zero);
    body.integrate(1 / 120);
    for (const field of ['position', 'velocity', 'acceleration'] as const)
      for (const axis of ['x', 'y', 'z'] as const)
        expect(Object.is(body[field][axis], zero)).toBe(true);
  });
});
