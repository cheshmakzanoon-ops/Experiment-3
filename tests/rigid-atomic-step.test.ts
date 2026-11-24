import { describe, expect, it } from 'vitest';
import { Quat, Random, Vec3 } from '../src/core/math.ts';
import { RigidBody } from '../src/simulation/rigid.ts';

// Frozen solver from 5edead7a44c8ccb5a187b22b750ce2bda7715128. It deliberately
// retains pre-commit mutation and the original successful arithmetic.
/** World velocities, body-diagonal inertia; renderer-independent state. */
class OriginalRigidBody {
  position = new Vec3();
  orientation = new Quat();
  velocity = new Vec3();
  omega = new Vec3();
  force = new Vec3();
  torque = new Vec3();
  acceleration = new Vec3();
  angularAcceleration = new Vec3();
  inertia = new Vec3(510, 1220, 1080);
  mass = 790;
  private r = new Vec3();
  private torqueScratch = new Vec3();
  private localOmega = new Vec3();
  private localTorque = new Vec3();
  private midpoint = new Vec3();
  private oldOmega = new Vec3();
  clear() {
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }
  apply(force: Vec3, point: Vec3) {
    this.force.add(force);
    this.r.copy(point).sub(this.position);
    this.torqueScratch.cross(this.r, force);
    this.torque.add(this.torqueScratch);
  }
  pointVelocity(point: Vec3, out: Vec3) {
    this.r.copy(point).sub(this.position);
    return out.cross(this.omega, this.r).add(this.velocity);
  }
  inverseInertia(v: Vec3, out: Vec3) {
    this.orientation.inverseRotate(v, out);
    out.set(out.x / this.inertia.x, out.y / this.inertia.y, out.z / this.inertia.z);
    return this.orientation.rotate(out, out);
  }
  /** Internal rotor momentum endpoints are expressed in body coordinates.
   * Their change exchanges angular impulse with the chassis symmetrically;
   * fixed rotor momentum contributes gyroscopic torque during the drift. */
  integrate(dt: number, spinStart?: Vec3, spinEnd: Vec3 | undefined = spinStart) {
    const { x: ix, y: iy, z: iz } = this.inertia;
    const q = this.orientation;
    if (
      !Number.isFinite(dt) ||
      dt <= 0 ||
      !Number.isFinite(this.mass) ||
      this.mass <= 0 ||
      !this.inertia.finite() ||
      Math.min(ix, iy, iz) <= 0 ||
      !this.force.finite() ||
      !this.torque.finite() ||
      !this.omega.finite() ||
      (spinStart !== undefined && !spinStart.finite()) ||
      (spinEnd !== undefined && !spinEnd.finite()) ||
      !Number.isFinite(q.x + q.y + q.z + q.w) ||
      Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) > 1e-5
    )
      throw new Error('Invalid rigid-body integration state');
    this.acceleration.copy(this.force).scale(1 / this.mass);
    this.velocity.addScaled(this.acceleration, dt);
    this.position.addScaled(this.velocity, dt);
    this.oldOmega.copy(this.omega);
    this.orientation.inverseRotate(this.omega, this.localOmega);
    this.orientation.inverseRotate(this.torque, this.localTorque);

    // Kick / gyrostat drift / kick. Moving from hStart to hMid and from
    // hMid to hEnd transfers -deltaH/2 at each boundary. World external torque
    // changes total (chassis + rotor) angular momentum by exactly torque*dt.
    const hx = ((spinStart?.x ?? 0) + (spinEnd?.x ?? 0)) * 0.5,
      hy = ((spinStart?.y ?? 0) + (spinEnd?.y ?? 0)) * 0.5,
      hz = ((spinStart?.z ?? 0) + (spinEnd?.z ?? 0)) * 0.5,
      dx = (spinEnd?.x ?? 0) - (spinStart?.x ?? 0),
      dy = (spinEnd?.y ?? 0) - (spinStart?.y ?? 0),
      dz = (spinEnd?.z ?? 0) - (spinStart?.z ?? 0);
    const x0 = this.localOmega.x + (this.localTorque.x * dt - dx) / (2 * ix);
    const y0 = this.localOmega.y + (this.localTorque.y * dt - dy) / (2 * iy);
    const z0 = this.localOmega.z + (this.localTorque.z * dt - dz) / (2 * iz);
    const kx = (iy - iz) / ix,
      ky = (iz - ix) / iy,
      kz = (ix - iy) / iz;
    let x = x0,
      y = y0,
      z = z0;
    const tolerance = 2e-12 * Math.max(1, Math.abs(x0), Math.abs(y0), Math.abs(z0));
    let converged = false;
    for (let iteration = 0; iteration < 12; iteration++) {
      const mx = (x0 + x) * 0.5,
        my = (y0 + y) * 0.5,
        mz = (z0 + z) * 0.5;
      const fx = x - x0 - dt * kx * my * mz - (dt * (hy * mz - hz * my)) / ix;
      const fy = y - y0 - dt * ky * mz * mx - (dt * (hz * mx - hx * mz)) / iy;
      const fz = z - z0 - dt * kz * mx * my - (dt * (hx * my - hy * mx)) / iz;
      if (Math.max(Math.abs(fx), Math.abs(fy), Math.abs(fz)) < tolerance) {
        converged = true;
        break;
      }
      // Analytic inverse of the 3x3 midpoint Jacobian (diagonal entries = 1).
      const a = -0.5 * dt * kx * mz + (0.5 * dt * hz) / ix,
        b = -0.5 * dt * kx * my - (0.5 * dt * hy) / ix;
      const c = -0.5 * dt * ky * mz - (0.5 * dt * hz) / iy,
        d = -0.5 * dt * ky * mx + (0.5 * dt * hx) / iy;
      const e = -0.5 * dt * kz * my + (0.5 * dt * hy) / iz,
        f = -0.5 * dt * kz * mx - (0.5 * dt * hx) / iz;
      const determinant = 1 - d * f - a * (c - d * e) + b * (c * f - e);
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
        throw new Error('Singular rigid-body midpoint solve');
      x -= ((1 - d * f) * fx + (b * f - a) * fy + (a * d - b) * fz) / determinant;
      y -= ((d * e - c) * fx + (1 - b * e) * fy + (b * c - d) * fz) / determinant;
      z -= ((c * f - e) * fx + (a * e - f) * fy + (1 - a * c) * fz) / determinant;
    }
    if (!converged) throw new Error('Rigid-body midpoint solve did not converge');
    this.midpoint.set((x0 + x) * 0.5, (y0 + y) * 0.5, (z0 + z) * 0.5);
    this.orientation.rotate(this.midpoint, this.midpoint);
    // integrateWorld's normalized quaternion increment is a Cayley rotation.
    // Paired with the midpoint drift, it preserves the WORLD momentum vector,
    // not just its magnitude. Never substitute the endpoint angular velocity.
    this.orientation.integrateWorld(this.midpoint, dt);
    this.orientation.rotate(
      this.localOmega.set(x - dx / (2 * ix), y - dy / (2 * iy), z - dz / (2 * iz)),
      this.omega,
    );
    this.inverseInertia(this.torque, this.localTorque);
    this.omega.addScaled(this.localTorque, dt * 0.5);
    this.angularAcceleration
      .copy(this.omega)
      .sub(this.oldOmega)
      .scale(1 / dt);
    if (
      !this.position.finite() ||
      !this.velocity.finite() ||
      !this.omega.finite() ||
      !Number.isFinite(q.x + q.y + q.z + q.w)
    )
      throw new Error('Non-finite rigid body');
  }
}

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
type Body = Pick<RigidBody, (typeof vectors)[number] | 'orientation' | 'mass'>;

function snapshot(body: Body) {
  return [
    ...vectors.flatMap((key) => [body[key].x, body[key].y, body[key].z]),
    body.orientation.x,
    body.orientation.y,
    body.orientation.z,
    body.orientation.w,
    body.mass,
  ];
}

function configure<T extends Body>(body: T): T {
  body.position.set(17, -3, 29);
  body.velocity.set(3, 4, 5);
  body.omega.set(0.4, -0.3, 0.2);
  body.orientation.yaw(0.71);
  body.force.set(790, -100, 40);
  body.torque.set(30, -20, 10);
  body.acceleration.set(11, 12, 13);
  body.angularAcceleration.set(-14, -15, -16);
  body.inertia.set(510, 1220, 1080);
  body.mass = 790;
  return body;
}

function copyState(from: Body, into: Body) {
  for (const key of vectors) into[key].copy(from[key]);
  Object.assign(into.orientation, from.orientation);
  into.mass = from.mass;
}

interface FailureCase {
  name: string;
  prepare: (body: RigidBody) => void;
  dt?: number;
  start?: Vec3;
  end?: Vec3;
  message: RegExp;
}
const preflight: FailureCase[] = [
  {
    name: 'NaN position',
    prepare: (b: RigidBody) => {
      b.position.x = NaN;
    },
  },
  {
    name: 'infinite position',
    prepare: (b: RigidBody) => {
      b.position.y = Infinity;
    },
  },
  {
    name: 'NaN velocity',
    prepare: (b: RigidBody) => {
      b.velocity.z = NaN;
    },
  },
  {
    name: 'infinite velocity',
    prepare: (b: RigidBody) => {
      b.velocity.x = -Infinity;
    },
  },
  {
    name: 'nonpositive mass',
    prepare: (b: RigidBody) => {
      b.mass = 0;
    },
  },
  {
    name: 'non-finite inertia',
    prepare: (b: RigidBody) => {
      b.inertia.x = Infinity;
    },
  },
  {
    name: 'nonpositive inertia',
    prepare: (b: RigidBody) => {
      b.inertia.y = 0;
    },
  },
  {
    name: 'non-finite force',
    prepare: (b: RigidBody) => {
      b.force.x = NaN;
    },
  },
  {
    name: 'non-finite torque',
    prepare: (b: RigidBody) => {
      b.torque.y = Infinity;
    },
  },
  {
    name: 'non-finite angular velocity',
    prepare: (b: RigidBody) => {
      b.omega.z = NaN;
    },
  },
  {
    name: 'non-finite orientation',
    prepare: (b: RigidBody) => {
      b.orientation.w = NaN;
    },
  },
  {
    name: 'unnormalized orientation',
    prepare: (b: RigidBody) => {
      b.orientation.w = 2;
    },
  },
  { name: 'zero timestep', prepare: () => {}, dt: 0 },
  { name: 'negative timestep', prepare: () => {}, dt: -0.01 },
  { name: 'non-finite timestep', prepare: () => {}, dt: NaN },
  { name: 'non-finite rotor start', prepare: () => {}, start: new Vec3(NaN, 0, 0) },
  {
    name: 'non-finite rotor end',
    prepare: () => {},
    start: new Vec3(),
    end: new Vec3(0, Infinity, 0),
  },
].map((entry) => ({ ...entry, message: /Invalid rigid-body integration state/ }));

const candidates: FailureCase[] = [
  {
    name: 'singular midpoint Jacobian',
    dt: 2,
    message: /Singular rigid-body midpoint solve/,
    prepare(b) {
      b.orientation.yaw(0);
      b.torque.set(0, 0, 0);
      b.inertia.set(1, 2, 3);
      b.omega.set(1, 2, 0);
    },
  },
  {
    name: 'bounded midpoint nonconvergence',
    message: /midpoint solve did not converge/,
    prepare(b) {
      b.orientation.yaw(0);
      b.torque.set(0, 0, 0);
      b.inertia.set(1, 10, 100);
      b.omega.set(1000, 700, 300);
    },
  },
  {
    name: 'position overflow',
    dt: 1,
    message: /Non-finite rigid body/,
    prepare(b) {
      b.position.set(Number.MAX_VALUE, 0, 0);
      b.velocity.set(Number.MAX_VALUE, 0, 0);
      b.force.set(0, 0, 0);
    },
  },
  {
    name: 'velocity overflow',
    dt: 1,
    message: /Non-finite rigid body/,
    prepare(b) {
      b.velocity.set(Number.MAX_VALUE, 0, 0);
      b.force.set(Number.MAX_VALUE, 0, 0);
      b.mass = 1;
    },
  },
  {
    name: 'non-finite acceleration',
    message: /Non-finite rigid body/,
    prepare(b) {
      b.mass = Number.MIN_VALUE;
      b.force.set(0, 0, 0);
    },
  },
  {
    name: 'derived angular acceleration overflow',
    dt: 1e-320,
    message: /Non-finite rigid body/,
    prepare(b) {
      b.orientation.yaw(0);
      b.omega.set(0, 0, 0);
      b.torque.set(0, 0, 0);
    },
  },
  {
    name: 'candidate orientation overflow',
    dt: 1e200,
    message: /Non-finite rigid body/,
    prepare(b) {
      b.orientation.yaw(0);
      b.omega.set(1e200, 0, 0);
      b.inertia.set(100, 100, 100);
      b.position.set(0, 0, 0);
      b.velocity.set(0, 0, 0);
      b.force.set(0, 0, 0);
      b.torque.set(0, 0, 0);
    },
  },
];

describe('rigid-body steps commit only complete finite states', () => {
  it.each([...preflight, ...candidates])(
    'preserves every public state field after $name',
    (entry) => {
      const body = configure(new RigidBody());
      body.integrate(1 / 240, new Vec3(100, 20, -30));
      entry.prepare(body);
      const before = snapshot(body);
      const objects = [...vectors.map((key) => body[key]), body.orientation];
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(() => body.integrate(entry.dt ?? 1 / 240, entry.start, entry.end)).toThrow(
          entry.message,
        );
        expect(snapshot(body)).toStrictEqual(before);
        for (let i = 0; i < vectors.length; i++) expect(body[vectors[i]]).toBe(objects[i]);
        expect(body.orientation).toBe(objects[vectors.length]);
      }
      configure(body);
      const fresh = configure(new RigidBody());
      const start = new Vec3(350, -40, 85),
        end = new Vec3(360, -35, 90);
      body.integrate(1 / 120, start, end);
      fresh.integrate(1 / 120, start, end);
      expect(snapshot(body)).toStrictEqual(snapshot(fresh));
    },
  );

  it('reproduces the original partial translation on a failed midpoint solve', () => {
    const original = configure(new OriginalRigidBody());
    original.orientation.yaw(0);
    original.torque.set(0, 0, 0);
    original.inertia.set(1, 10, 100);
    original.omega.set(1000, 700, 300);
    const candidate = new RigidBody();
    copyState(original, candidate);
    const before = snapshot(candidate);
    expect(() => original.integrate(1 / 240)).toThrow(/did not converge/);
    expect(() => candidate.integrate(1 / 240)).toThrow(/did not converge/);
    expect(original.position.x).not.toBe(before[0]);
    expect(original.velocity.x).not.toBe(before[3]);
    expect(snapshot(candidate)).toStrictEqual(before);
  });

  it.each([60, 120, 240])('matches the frozen successful solver exactly at %i Hz', (hz) => {
    const random = new Random(2400 + hz);
    const signed = (range: number) => (random.next() * 2 - 1) * range;
    for (let trial = 0; trial < 128; trial++) {
      const original = configure(new OriginalRigidBody());
      original.mass = 90 + random.next() * 1500;
      original.inertia.set(
        80 + random.next() * 1500,
        80 + random.next() * 1500,
        80 + random.next() * 1500,
      );
      original.position.set(signed(1e4), signed(10), signed(1e4));
      original.velocity.set(signed(80), signed(10), signed(80));
      original.omega.set(signed(8), signed(8), signed(8));
      original.orientation.integrateWorld(new Vec3(signed(6), signed(6), signed(6)), 1);
      const actual = new RigidBody();
      copyState(original, actual);
      const owned = Object.values(actual).filter(
        (value) => value instanceof Vec3 || value instanceof Quat,
      );
      for (let step = 0; step < 16; step++) {
        original.force.set(signed(5000), signed(5000), signed(5000));
        original.torque.set(signed(1000), signed(1000), signed(1000));
        actual.force.copy(original.force);
        actual.torque.copy(original.torque);
        const start = step % 4 === 0 ? undefined : new Vec3(signed(800), signed(800), signed(800));
        const end =
          step % 4 === 1
            ? undefined
            : start && new Vec3().copy(start).add(new Vec3(signed(40), signed(40), signed(40)));
        original.integrate(1 / hz, start, end);
        actual.integrate(1 / hz, start, end);
        expect(snapshot(actual)).toStrictEqual(snapshot(original));
      }
      const after = Object.values(actual).filter(
        (value) => value instanceof Vec3 || value instanceof Quat,
      );
      expect(after.length).toBe(owned.length);
      for (let index = 0; index < owned.length; index++) expect(after[index]).toBe(owned[index]);
    }
  });

  it('retains signed-zero arithmetic and public vector identities on successful steps', () => {
    const actual = new RigidBody(),
      original = new OriginalRigidBody();
    for (const body of [actual, original]) {
      for (const key of vectors) if (key !== 'inertia') body[key].set(-0, 0, -0);
      body.orientation.x = -0;
      body.orientation.z = -0;
    }
    const identities = vectors.map((key) => actual[key]);
    for (let tick = 0; tick < 32; tick++) {
      actual.integrate(1 / 240);
      original.integrate(1 / 240);
      const expected = snapshot(original),
        observed = snapshot(actual);
      for (let index = 0; index < expected.length; index++)
        expect(Object.is(observed[index], expected[index])).toBe(true);
      for (let index = 0; index < vectors.length; index++)
        expect(actual[vectors[index]]).toBe(identities[index]);
    }
  });
});
