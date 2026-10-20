import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector2, Vector3, Vector4 } from 'three';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { sampleChassisPose } from '../src/rendering/snapshot-interpolation.ts';
import { MotionField } from '../src/rendering/studio/velocity.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';

const car = carBase(0),
  axis = new Vector3(1, 2, -1).normalize(),
  initial = new Quaternion().setFromEuler(new Euler(0.6, -0.9, 0.3, 'ZYX'));

function frame(time: number, cars = 1) {
  const value = new Float32Array(HEADER + cars * CAR_STRIDE);
  value[H.CARS] = cars;
  value[H.TIME] = time;
  for (let id = 0; id < cars; id++) value[carBase(id) + F.QW] = 1;
  return value;
}

function jerkPair() {
  const a = frame(0),
    b = frame(0.2),
    dt = b[H.TIME];
  // A change of throttle/braking force gives x(t)=20t+50t³. The exact
  // instantaneous speed is 21.5 m/s at its midpoint, not the 23 m/s endpoint mean.
  a[car + F.VZ] = 20;
  b[car + F.Z] = 20 * dt + 50 * dt ** 3;
  b[car + F.VZ] = 20 + 150 * dt ** 2;
  return { a, b, dt };
}

function pose(a: Float32Array, b: Float32Array, t: number) {
  const position = new Vector3(),
    rotation = new Quaternion();
  sampleChassisPose(a, b, car, t, position, rotation);
  return { position, rotation };
}

function measuredOmega(a: Quaternion, b: Quaternion, dt: number) {
  const delta = b.clone().normalize().multiply(a.clone().normalize().conjugate());
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
  const sine = Math.hypot(delta.x, delta.y, delta.z),
    angle = 2 * Math.atan2(sine, delta.w);
  return new Vector3(delta.x, delta.y, delta.z).multiplyScalar(
    sine > 1e-12 ? angle / (sine * dt) : 2 / dt,
  );
}

describe('velocity of the presented trajectory', () => {
  it('reports the derivative of changing-acceleration translation, not endpoint-average speed', () => {
    const { a, b, dt } = jerkPair(),
      presented = new PresentedFrame();
    for (const alpha of [0.05, 0.2, 0.5, 0.8, 0.95]) {
      const time = dt * alpha,
        value = presented.sample(a, b, alpha);
      expect(value[car + F.Z]).toBeCloseTo(20 * time + 50 * time ** 3, 6);
      expect(value[car + F.VZ]).toBeCloseTo(20 + 150 * time ** 2, 5);
    }
  });

  it('reports the world angular derivative of a cubic spin from a tilted chassis', () => {
    const a = frame(0),
      b = frame(0.2),
      dt = b[H.TIME],
      presented = new PresentedFrame();
    initial.toArray(a, car + F.QX);
    axis
      .clone()
      .multiplyScalar(2)
      .toArray(a, car + F.WX);
    new Quaternion()
      .setFromAxisAngle(axis, 2 * dt + 10 * dt ** 3)
      .multiply(initial)
      .toArray(b, car + F.QX);
    axis
      .clone()
      .multiplyScalar(2 + 30 * dt ** 2)
      .toArray(b, car + F.WX);
    for (const alpha of [0.05, 0.2, 0.5, 0.8, 0.95]) {
      const value = presented.sample(a, b, alpha),
        expected = axis.clone().multiplyScalar(2 + 30 * (dt * alpha) ** 2);
      expect(new Vector3().fromArray(value, car + F.WX).distanceTo(expected)).toBeLessThan(2e-6);
    }
  });

  it('matches actual root motion when the rotation axis changes', () => {
    const a = frame(0),
      b = frame(0.16),
      dt = b[H.TIME],
      presented = new PresentedFrame();
    for (const [value, time] of [
      [a, 0],
      [b, dt],
    ] as const) {
      const yaw = 0.7 + 0.8 * time + 2 * time ** 2,
        pitch = -0.3 + 0.3 * time + 0.4 * time ** 2;
      new Quaternion()
        .setFromAxisAngle(new Vector3(0, 1, 0), yaw)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch))
        .multiply(initial)
        .toArray(value, car + F.QX);
      new Vector3(
        Math.cos(yaw) * (0.3 + 0.8 * time),
        0.8 + 4 * time,
        -Math.sin(yaw) * (0.3 + 0.8 * time),
      ).toArray(value, car + F.WX);
    }
    for (const alpha of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const h = 0.002,
        measured = measuredOmega(
          pose(a, b, alpha - h).rotation,
          pose(a, b, alpha + h).rotation,
          2 * h * dt,
        ),
        value = presented.sample(a, b, alpha);
      expect(new Vector3().fromArray(value, car + F.WX).distanceTo(measured)).toBeLessThan(0.0003);
    }
  });

  it('keeps angular rates invariant to equivalent quaternion signs', () => {
    const a = frame(0),
      b = frame(0.1),
      presented = new PresentedFrame();
    initial.toArray(a, car + F.QX);
    new Quaternion()
      .setFromAxisAngle(axis, 0.2)
      .multiply(initial)
      .toArray(b, car + F.QX);
    axis
      .clone()
      .multiplyScalar(2)
      .toArray(a, car + F.WX);
    axis
      .clone()
      .multiplyScalar(2)
      .toArray(b, car + F.WX);
    const expected = new Vector3().fromArray(presented.sample(a, b, 0.37), car + F.WX);
    for (let field = F.QX as number; field <= F.QW; field++) b[car + field] *= -1;
    expect(
      new Vector3().fromArray(presented.sample(a, b, 0.37), car + F.WX).distanceTo(expected),
    ).toBeLessThan(1e-7);
    for (let field = F.QX as number; field <= F.QW; field++) a[car + field] *= -1;
    expect(
      new Vector3().fromArray(presented.sample(a, b, 0.37), car + F.WX).distanceTo(expected),
    ).toBeLessThan(1e-7);
  });

  it('uses finite secant rates when stale or invalid tangents require a linear/short-arc fallback', () => {
    const a = frame(0),
      b = frame(0.1),
      dt = b[H.TIME];
    b[car + F.X] = 1;
    a[car + F.VX] = 1000;
    b[car + F.VX] = -980;
    new Quaternion().setFromAxisAngle(axis, 0.4).toArray(b, car + F.QX);
    b[car + F.WX] = NaN;
    const value = new PresentedFrame().sample(a, b, 0.3);
    expect(value[car + F.VX]).toBeCloseTo(1 / dt, 6);
    expect(
      new Vector3().fromArray(value, car + F.WX).distanceTo(axis.clone().multiplyScalar(0.4 / dt)),
    ).toBeLessThan(1e-6);
  });

  it.each([0, 1e-10, 1e-7, 1e-4])(
    'keeps near-identity rotations finite and accurate at %s radians',
    (angle) => {
      const a = frame(0),
        b = frame(0.1),
        dt = b[H.TIME];
      new Quaternion().setFromAxisAngle(axis, angle).toArray(b, car + F.QX);
      const value = new PresentedFrame().sample(a, b, 0.5),
        expected = axis.clone().multiplyScalar(angle / dt);
      expect(new Vector3().fromArray(value, car + F.WX).distanceTo(expected)).toBeLessThan(1e-9);
    },
  );

  it('preserves measured endpoints and discontinuity holds without inventing cut velocities', () => {
    const { a, b } = jerkPair(),
      presented = new PresentedFrame();
    b[car + F.Z] = 1000;
    expect(presented.sample(a, b, 0.4).subarray(car)).toEqual(a.subarray(car));
    expect(presented.sample(a, b, 0)).toEqual(a);
    expect(presented.sample(a, b, 1)).toEqual(b);
    expect(presented.sample(b, b, 0.5)).toEqual(b);
  });

  it('is independent of pause, repeated sampling and reordered replay queries', () => {
    const { a, b } = jerkPair(),
      originals = [a.slice(), b.slice()],
      presented = new PresentedFrame(),
      expected = presented.sample(a, b, 0.37).slice();
    for (const alpha of [1, 0.1, 0, 0.8, 0.37, 0.37]) presented.sample(a, b, alpha);
    expect(presented.value).toEqual(expected);
    expect(a).toEqual(originals[0]);
    expect(b).toEqual(originals[1]);
  });

  it('makes production motion blur follow the instantaneous visible path', () => {
    const { a, b, dt } = jerkPair(),
      value = new PresentedFrame().sample(a, b, 0.5),
      position = new Vector3().fromArray(value, car + F.X),
      camera = new PerspectiveCamera(50, 1280 / 720, 0.05, 1000),
      motion = new MotionField(),
      shutter = 0.01,
      size = new Vector2(1280, 720);
    camera.position.copy(position).add(new Vector3(0, 1.65, -4.9));
    camera.lookAt(position.clone().add(new Vector3(0, 0.9, 13)));
    camera.updateMatrixWorld(true);
    motion.update(
      value,
      camera,
      0,
      'attached',
      shutter,
      [new Matrix4().makeTranslation(position)],
      [new Vector4(0, 0, 0, 0)],
      1,
    );
    const world = position.clone().add(new Vector3(3.5, 0, 4)),
      previous = camera.clone();
    previous.position.z -= (20 + 150 * (dt * 0.5) ** 2) * shutter;
    previous.updateMatrixWorld(true);
    const now = world.clone().project(camera),
      before = world.clone().project(previous),
      expected = new Vector2(((now.x - before.x) * size.x) / 2, ((now.y - before.y) * size.y) / 2);
    expect(motion.pixels(world, camera, size).distanceTo(expected)).toBeLessThan(0.0001);
    const former = value.slice();
    former[car + F.VZ] = (a[car + F.VZ] + b[car + F.VZ]) * 0.5;
    motion.update(
      former,
      camera,
      0,
      'attached',
      shutter,
      [new Matrix4().makeTranslation(position)],
      [new Vector4(0, 0, 0, 0)],
      1,
    );
    expect(motion.pixels(world, camera, size).distanceTo(expected)).toBeGreaterThan(0.4);
  });
});
