import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { sampleChassisPose } from '../src/rendering/snapshot-interpolation.ts';
import { RigidBody } from '../src/simulation/rigid.ts';
import {
  B,
  BIKE_BASE,
  CAR_STRIDE,
  F,
  H,
  HEADER,
  K,
  O,
  OFFROAD_BASE,
  SKID_BASE,
  W,
  WHEEL_BASE,
  carBase,
} from '../src/simulation/protocol.ts';

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

function fixedAxisPose(angle: number) {
  return new Quaternion().setFromAxisAngle(axis, angle).multiply(initial);
}

function writeRotation(value: Float32Array, pose: Quaternion, omega: Vector3, id = 0) {
  pose.toArray(value, carBase(id) + F.QX);
  omega.toArray(value, carBase(id) + F.WX);
}

function accelerationPair(speed = 0.8, acceleration = 24, duration = 1 / 15) {
  const a = frame(0),
    b = frame(duration),
    dt = b[H.TIME];
  writeRotation(a, initial, axis.clone().multiplyScalar(speed));
  writeRotation(
    b,
    fixedAxisPose(speed * dt + 0.5 * acceleration * dt * dt),
    axis.clone().multiplyScalar(speed + acceleration * dt),
  );
  return { a, b, dt };
}

function sample(a: Float32Array, b: Float32Array, alpha: number, offset = car) {
  const quaternion = new Quaternion();
  sampleChassisPose(a, b, offset, alpha, new Vector3(), quaternion);
  return quaternion;
}

function angularError(actual: Quaternion, expected: Quaternion) {
  return actual.clone().normalize().angleTo(expected.clone().normalize());
}

function slerp(a: Float32Array, b: Float32Array, alpha: number) {
  return new Quaternion()
    .fromArray(a, car + F.QX)
    .normalize()
    .slerp(new Quaternion().fromArray(b, car + F.QX).normalize(), alpha);
}

function measuredOmega(a: Quaternion, b: Quaternion, dt: number) {
  const change = b.clone().normalize().multiply(a.clone().normalize().conjugate());
  if (change.w < 0) change.set(-change.x, -change.y, -change.z, -change.w);
  const sine = Math.hypot(change.x, change.y, change.z),
    angle = 2 * Math.atan2(sine, change.w);
  return new Vector3(change.x, change.y, change.z).multiplyScalar(
    sine > 1e-12 ? angle / (sine * dt) : 2 / dt,
  );
}

describe('measured chassis angular presentation', () => {
  it('preserves constant WORLD-axis spin from an initially tilted chassis', () => {
    const { a, b, dt } = accelerationPair(2.7, 0, 0.12);
    for (const alpha of [0, 0.07, 0.25, 0.5, 0.77, 0.99, 1]) {
      const pose = sample(a, b, alpha);
      expect(angularError(pose, fixedAxisPose(2.7 * dt * alpha))).toBeLessThan(2e-7);
      expect(Math.abs(pose.length() - 1)).toBeLessThan(1e-7);
    }
  });

  it.each([
    [0.8, 24],
    [2.4, -24],
  ])('reconstructs measured angular acceleration from %s rad/s at %s rad/s²', (speed, rate) => {
    const { a, b, dt } = accelerationPair(speed, rate);
    for (const alpha of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
      const time = dt * alpha,
        expected = fixedAxisPose(speed * time + 0.5 * rate * time * time);
      expect(angularError(sample(a, b, alpha), expected)).toBeLessThan(2e-7);
    }
    const midpoint = fixedAxisPose(speed * dt * 0.5 + (rate * dt * dt) / 8);
    // At 15 Hz the former constant-rate segment is ~0.764 degrees wrong here.
    expect(angularError(slerp(a, b, 0.5), midpoint)).toBeGreaterThan(0.013);
    expect(angularError(sample(a, b, 0.5), midpoint)).toBeLessThan(2e-7);
  });

  it('meets the measured angular rate on both sides of a shared snapshot', () => {
    const { a, b, dt } = accelerationPair(0.8, 24),
      c = frame(2 * dt),
      duration = c[H.TIME];
    writeRotation(
      c,
      fixedAxisPose(0.8 * duration + 12 * duration * duration),
      axis.clone().multiplyScalar(0.8 + 24 * duration),
    );
    const h = dt * 0.005,
      boundary = sample(a, b, 1),
      incoming = measuredOmega(sample(a, b, 0.995), boundary, h),
      outgoing = measuredOmega(boundary, sample(b, c, 0.005), h),
      speed = 0.8 + 24 * dt;
    expect(incoming.distanceTo(axis.clone().multiplyScalar(speed - 12 * h))).toBeLessThan(0.001);
    expect(outgoing.distanceTo(axis.clone().multiplyScalar(speed + 12 * h))).toBeLessThan(0.001);
    // Constant-rate segments had a 1.6 rad/s velocity step at this boundary.
    const oldIncoming = measuredOmega(slerp(a, b, 0.995), boundary, h),
      oldOutgoing = measuredOmega(boundary, slerp(b, c, 0.005), h);
    expect(oldIncoming.distanceTo(oldOutgoing)).toBeGreaterThan(1.59);
    expect(incoming.distanceTo(outgoing)).toBeLessThan(0.009);
  });

  it('preserves world-space endpoint rates when the rotation axis changes', () => {
    const a = frame(0),
      b = frame(0.1),
      dt = b[H.TIME];
    function trajectory(time: number) {
      const yaw = 0.7 + 0.8 * time + 2 * time * time,
        pitch = -0.3 + 0.3 * time + 0.4 * time * time,
        pose = new Quaternion()
          .setFromAxisAngle(new Vector3(0, 1, 0), yaw)
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch))
          .multiply(initial),
        omega = new Vector3(
          Math.cos(yaw) * (0.3 + 0.8 * time),
          0.8 + 4 * time,
          -Math.sin(yaw) * (0.3 + 0.8 * time),
        );
      return { pose, omega };
    }
    const start = trajectory(0),
      end = trajectory(dt);
    writeRotation(a, start.pose, start.omega);
    writeRotation(b, end.pose, end.omega);
    const h = dt * 0.001,
      incoming = measuredOmega(sample(a, b, 0), sample(a, b, 0.001), h),
      outgoing = measuredOmega(sample(a, b, 0.999), sample(a, b, 1), h);
    expect(incoming.distanceTo(start.omega)).toBeLessThan(0.002);
    expect(outgoing.distanceTo(end.omega)).toBeLessThan(0.002);
    for (const alpha of [0.25, 0.5, 0.75])
      expect(angularError(sample(a, b, alpha), trajectory(dt * alpha).pose)).toBeLessThan(2e-5);
  });

  it('retains a coherent rocking apex between matching endpoint orientations', () => {
    const { a, b, dt } = accelerationPair(2, -40, 0.1),
      expected = fixedAxisPose(dt - 5 * dt * dt);
    expect(angularError(sample(a, b, 0.5), expected)).toBeLessThan(2e-7);
    expect(angularError(sample(a, b, 0.5), initial)).toBeGreaterThan(0.049);
  });

  it.each(['start', 'end', 'both'])('is invariant to equivalent %s quaternion signs', (signs) => {
    const { a, b } = accelerationPair(),
      expected = [0.1, 0.5, 0.9].map((t) => sample(a, b, t));
    for (const value of signs === 'both' ? [a, b] : [signs === 'start' ? a : b])
      for (let field = F.QX as number; field <= F.QW; field++) value[car + field] *= -1;
    [0.1, 0.5, 0.9].forEach((t, index) => {
      expect(angularError(sample(a, b, t), expected[index])).toBeLessThan(1e-7);
    });
    expect(sample(a, b, 0).toArray()).toEqual(Array.from(a.subarray(car + F.QX, car + F.QW + 1)));
    expect(sample(a, b, 1).toArray()).toEqual(Array.from(b.subarray(car + F.QX, car + F.QW + 1)));
  });

  it.each([
    'missing rates',
    'stale nonzero rates',
    'inconsistent rates',
    'angular impulse',
    'ambiguous turns',
    'invalid rates',
    'long gap',
    'tyre contact',
    'airborne transition',
    'floor contact',
    'new impact',
    'rider crash',
    'rider clock reset',
  ])('retains the bounded shortest arc for %s', (reason) => {
    const { a, b } = accelerationPair();
    if (reason === 'missing rates') {
      a.fill(0, car + F.WX, car + F.WZ + 1);
      b.fill(0, car + F.WX, car + F.WZ + 1);
    }
    if (reason === 'stale nonzero rates') {
      initial.toArray(b, car + F.QX);
      axis
        .clone()
        .multiplyScalar(0.01)
        .toArray(a, car + F.WX);
      axis
        .clone()
        .multiplyScalar(0.01)
        .toArray(b, car + F.WX);
    }
    if (reason === 'inconsistent rates') b[car + F.WY] = -2;
    if (reason === 'angular impulse') {
      axis
        .clone()
        .multiplyScalar(25)
        .toArray(a, car + F.WX);
      axis
        .clone()
        .multiplyScalar(-21.8)
        .toArray(b, car + F.WX);
    }
    if (reason === 'ambiguous turns') {
      axis
        .clone()
        .multiplyScalar(100)
        .toArray(a, car + F.WX);
      axis
        .clone()
        .multiplyScalar(100)
        .toArray(b, car + F.WX);
      fixedAxisPose(100 * b[H.TIME]).toArray(b, car + F.QX);
    }
    if (reason === 'invalid rates') b[car + F.WX] = NaN;
    if (reason === 'long gap') b[H.TIME] = 1;
    if (reason === 'tyre contact') b[car + WHEEL_BASE + W.LOAD] = 1000;
    if (reason === 'airborne transition') b[car + OFFROAD_BASE + O.AIRBORNE] = 1;
    if (reason === 'floor contact') b[car + SKID_BASE + K.CONTACTS] = 1;
    if (reason === 'new impact') b[car + F.IMPACT] = 0.5;
    if (reason === 'rider crash') b[car + BIKE_BASE + B.STATE] = 1;
    if (reason === 'rider clock reset') a[car + BIKE_BASE + B.STATE_CLOCK] = 2;
    for (const alpha of [0.01, 0.25, 0.5, 0.75, 0.99])
      expect(angularError(sample(a, b, alpha), slerp(a, b, alpha))).toBeLessThan(1e-7);
  });

  it('reduces rotational error against the real 240 Hz rigid-body solver at 15 Hz snapshots', () => {
    const body = new RigidBody(),
      frames: Float32Array[] = [];
    body.inertia.set(20, 20, 20);
    body.omega.set(0, 0.8, 0);
    Object.assign(body.orientation, { x: initial.x, y: initial.y, z: initial.z, w: initial.w });
    for (let step = 0; step <= 16; step++) {
      const value = frame(step / 240);
      writeRotation(
        value,
        new Quaternion(
          body.orientation.x,
          body.orientation.y,
          body.orientation.z,
          body.orientation.w,
        ),
        new Vector3(body.omega.x, body.omega.y, body.omega.z),
      );
      frames.push(value);
      body.clear();
      body.torque.set(0, 480, 0);
      body.integrate(1 / 240);
    }
    let oldError = 0,
      newError = 0;
    for (let step = 1; step < 16; step++) {
      const expected = new Quaternion().fromArray(frames[step], car + F.QX);
      oldError = Math.max(
        oldError,
        angularError(slerp(frames[0], frames[16], step / 16), expected),
      );
      newError = Math.max(
        newError,
        angularError(sample(frames[0], frames[16], step / 16), expected),
      );
    }
    expect(oldError).toBeGreaterThan(0.013);
    expect(newError).toBeLessThan(3e-6);
    expect(newError).toBeLessThan(oldError * 0.0003);
  });

  it('keeps all 32 roots identical to PresentedFrame through pauses and reordered seeks', () => {
    const a = frame(0, 32),
      b = frame(1 / 15, 32),
      dt = b[H.TIME],
      presented = new PresentedFrame();
    for (let id = 0; id < 32; id++) {
      const speed = 0.4 + id * 0.03;
      writeRotation(a, initial, axis.clone().multiplyScalar(speed), id);
      writeRotation(
        b,
        fixedAxisPose(speed * dt + 6 * dt * dt),
        axis.clone().multiplyScalar(speed + 12 * dt),
        id,
      );
    }
    const originals = [a.slice(), b.slice()],
      retained = presented.sample(a, b, 0.37),
      expected = retained.slice();
    for (const alpha of [1, 0.9, 0, 0.1, 0.8, 0.37, 0.37]) {
      expect(presented.sample(a, b, alpha)).toBe(retained);
      for (let id = 0; id < 32; id++) {
        const offset = carBase(id);
        expect(sample(a, b, alpha, offset).toArray()).toEqual(
          Array.from(retained.subarray(offset + F.QX, offset + F.QW + 1)),
        );
      }
    }
    expect(retained).toEqual(expected);
    expect(presented.sample(a, b, 0)).toEqual(a);
    expect(presented.sample(a, b, 1)).toEqual(b);
    expect(presented.sample(b, b, 0.4)).toEqual(b);
    expect(a).toEqual(originals[0]);
    expect(b).toEqual(originals[1]);
  });
});
