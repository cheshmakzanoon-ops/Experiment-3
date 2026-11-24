import { describe, expect, it, vi } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { RigidBody } from '../src/simulation/rigid.ts';

const DT = 1 / 240;
const STRESS_SPIN = 986939.7654675277;
const fields = [
  'position',
  'velocity',
  'omega',
  'force',
  'torque',
  'acceleration',
  'angularAcceleration',
  'inertia',
] as const;

function snapshot(body: RigidBody) {
  return [
    ...fields.flatMap((field) => [body[field].x, body[field].y, body[field].z]),
    body.orientation.x,
    body.orientation.y,
    body.orientation.z,
    body.orientation.w,
    body.mass,
  ];
}

function stressBody(sign = 1) {
  const body = new RigidBody();
  body.omega.set(sign * STRESS_SPIN, sign * 0.7 * STRESS_SPIN, sign * 0.3 * STRESS_SPIN);
  body.position.set(7, -2, 11);
  body.velocity.set(3, 4, 5);
  body.force.set(790, 0, 0);
  body.acceleration.set(11, 12, 13);
  body.angularAcceleration.set(-14, -15, -16);
  return body;
}

/** Observe existing residual-norm reductions without replacing solver math.
 * The scale/tolerance reduction has four arguments; residuals have three. */
function traceResiduals(work: () => void) {
  const maximum = Math.max;
  const residuals: number[] = [];
  const spy = vi.spyOn(Math, 'max').mockImplementation((...values: number[]) => {
    const result = maximum(...values);
    if (values.length === 3) residuals.push(result);
    return result;
  });
  let error: unknown;
  try {
    work();
  } catch (caught) {
    error = caught;
  } finally {
    spy.mockRestore();
  }
  return { residuals, error };
}

function beforeDrift(body: RigidBody, start = new Vec3(), end = start) {
  const omega = body.orientation.inverseRotate(body.omega, new Vec3());
  const torque = body.orientation.inverseRotate(body.torque, new Vec3());
  const delta = new Vec3().copy(end).sub(start);
  const rotor = new Vec3().copy(start).add(end).scale(0.5);
  const inertia = body.inertia;
  const first = new Vec3(
    omega.x + (torque.x * DT - delta.x) / (2 * inertia.x),
    omega.y + (torque.y * DT - delta.y) / (2 * inertia.y),
    omega.z + (torque.z * DT - delta.z) / (2 * inertia.z),
  );
  return { first, delta, rotor };
}

/** Independently form the gyrostat equation as (I*m + h) cross m. Recover
 * its endpoint from the public world state, undoing the final torque kick. */
function reconstructedResidual(body: RigidBody, drift: ReturnType<typeof beforeDrift>) {
  const kick = body.inverseInertia(body.torque, new Vec3()).scale(DT * 0.5);
  const omega = body.orientation.inverseRotate(new Vec3().copy(body.omega).sub(kick), new Vec3());
  const inertia = body.inertia;
  const last = new Vec3(
    omega.x + drift.delta.x / (2 * inertia.x),
    omega.y + drift.delta.y / (2 * inertia.y),
    omega.z + drift.delta.z / (2 * inertia.z),
  );
  const middle = new Vec3().copy(drift.first).add(last).scale(0.5);
  const momentum = new Vec3(inertia.x * middle.x, inertia.y * middle.y, inertia.z * middle.z).add(
    drift.rotor,
  );
  const gyro = new Vec3().cross(momentum, middle);
  return new Vec3(
    last.x - drift.first.x - (DT * gyro.x) / inertia.x,
    last.y - drift.first.y - (DT * gyro.y) / inertia.y,
    last.z - drift.first.z - (DT * gyro.z) / inertia.z,
  );
}

describe('the final permitted rigid-body Newton correction', () => {
  it.each(['no rotor', 'constant rotor', 'changing rotor', 'external torque'])(
    'accepts the extreme numerical fixture only after correction twelve: %s',
    (kind) => {
      const body = stressBody();
      const start =
        kind.includes('rotor') && kind !== 'no rotor' ? new Vec3(350, -40, 85) : undefined;
      const end = kind === 'changing rotor' ? new Vec3(360, -35, 90) : start;
      if (kind === 'external torque') body.torque.set(30, -20, 10);
      const drift = beforeDrift(body, start, end);
      const tolerance =
        2e-12 *
        Math.max(1, Math.abs(drift.first.x), Math.abs(drift.first.y), Math.abs(drift.first.z));
      const objects = [...fields.map((field) => body[field]), body.orientation];
      const result = traceResiduals(() => body.integrate(DT, start, end));

      expect(result.error).toBeUndefined();
      expect(result.residuals).toHaveLength(13);
      expect(result.residuals.slice(0, 12).every((value) => value >= tolerance)).toBe(true);
      expect(result.residuals[12]).toBeLessThan(tolerance);
      expect(snapshot(body).every(Number.isFinite)).toBe(true);
      for (let index = 0; index < fields.length; index++)
        expect(body[fields[index]]).toBe(objects[index]);
      expect(body.orientation).toBe(objects[fields.length]);

      const residual = reconstructedResidual(body, drift);
      // Two world/body transforms and differently grouped cross products add
      // rounding at this deliberately extreme angular speed. Acceptance above
      // still uses the original, unscaled solver tolerance exactly.
      expect(
        Math.max(Math.abs(residual.x), Math.abs(residual.y), Math.abs(residual.z)),
      ).toBeLessThan(2 * tolerance);
    },
  );

  it('does not grant an extra correction to a still-unconverged candidate', () => {
    const body = stressBody(-1);
    const before = snapshot(body);
    const result = traceResiduals(() => body.integrate(DT));
    expect(result.error).toEqual(new Error('Rigid-body midpoint solve did not converge'));
    expect(result.residuals).toHaveLength(13);
    expect(result.residuals[12]).toBeGreaterThan(2e-12 * STRESS_SPIN);
    expect(snapshot(body)).toStrictEqual(before);
  });

  it('keeps the complete step atomic when the final accepted correction has invalid translation', () => {
    const body = stressBody();
    body.position.x = Number.MAX_VALUE;
    body.velocity.x = Number.MAX_VALUE;
    const before = snapshot(body);
    const result = traceResiduals(() => body.integrate(DT));
    expect(result.error).toEqual(new Error('Non-finite rigid body'));
    expect(result.residuals).toHaveLength(13);
    expect(result.residuals[12]).toBeLessThan(2e-12 * STRESS_SPIN);
    expect(snapshot(body)).toStrictEqual(before);

    body.position.x = 7;
    body.velocity.x = 3;
    const fresh = stressBody();
    body.integrate(DT);
    fresh.integrate(DT);
    expect(snapshot(body)).toStrictEqual(snapshot(fresh));
  });

  it.each(['singular', 'non-finite Jacobian'])(
    'preserves earlier %s rejection without a terminal retry',
    (kind) => {
      const body = stressBody();
      let dt = DT;
      if (kind === 'singular') {
        body.inertia.set(1, 2, 3);
        body.omega.set(1, 2, 0);
        dt = 2;
      } else body.omega.set(1e300, 1e300, 1e300);
      const before = snapshot(body);
      const result = traceResiduals(() => body.integrate(dt));
      expect(result.error).toEqual(new Error('Singular rigid-body midpoint solve'));
      expect(result.residuals).toHaveLength(1);
      expect(snapshot(body)).toStrictEqual(before);
    },
  );

  it('leaves immediate convergence at one residual evaluation', () => {
    const body = new RigidBody();
    const result = traceResiduals(() => body.integrate(DT));
    expect(result.error).toBeUndefined();
    expect(result.residuals).toStrictEqual([0]);
    expect(body.orientation.w).toBe(1);
    expect(body.omega).toEqual(new Vec3());
  });

  it('does not add residual work after ordinary early convergence with rotor exchange', () => {
    const body = new RigidBody();
    body.omega.set(0.4, -0.3, 0.2);
    body.orientation.yaw(0.71);
    body.torque.set(30, -20, 10);
    const result = traceResiduals(() =>
      body.integrate(1 / 120, new Vec3(350, -40, 85), new Vec3(360, -35, 90)),
    );
    expect(result.error).toBeUndefined();
    expect(result.residuals).toHaveLength(3);
    expect(result.residuals[1]).toBeGreaterThan(2e-12);
    expect(result.residuals[2]).toBeLessThan(2e-12);
  });
});
