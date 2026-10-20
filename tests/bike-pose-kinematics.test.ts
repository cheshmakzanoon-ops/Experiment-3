import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { Quat, Vec3 } from '../src/core/math.ts';
import { OrientationKinematics } from '../src/simulation/pose-kinematics.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { EXPERT } from '../src/simulation/bike.ts';
import { chassisLean, GP_R1 } from '../src/simulation/bike-definitions.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { AUREL } from '../src/simulation/circuits.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import type { RigidBody } from '../src/simulation/rigid.ts';
import type { SurfaceSample, Track, TrackPoint } from '../src/simulation/track.ts';

const DT = 1 / 240;
const quaternion = (q: Quat) => new Quaternion(q.x, q.y, q.z, q.w);
const solverQuaternion = (q: Quaternion) => new Quat(q.x, q.y, q.z, q.w);
const vector = (v: Vec3) => new Vector3(v.x, v.y, v.z);

/** Reconstruct the physical orientation with an independent Three.js
 * exponential. This checks the world-axis convention and the angular
 * displacement, rather than repeating the production logarithm. */
function expectRotation(before: Quaternion, body: RigidBody, dt: number) {
  const speed = body.omega.length(),
    axis = speed > 0 ? vector(body.omega).multiplyScalar(1 / speed) : new Vector3(1, 0, 0),
    after = new Quaternion().setFromAxisAngle(axis, speed * dt).multiply(before);
  expect(1 - Math.abs(after.dot(quaternion(body.orientation)))).toBeLessThan(1e-12);
}

/** Independent plane for adapter kinematics. It supplies genuine static
 * surface values; tests prescribe reduced-coordinate motion explicitly. */
function road(slope = 0) {
  return {
    circuit: AUREL,
    length: 10000,
    sample(x: number, z: number, out: SurfaceSample) {
      out.height = slope * z;
      out.normal.set(0, 1, -slope).normalize();
      out.s = z;
      out.lateral = x;
      return out;
    },
    nearest(x: number, z: number, out: TrackPoint) {
      out.s = out.z = z;
      out.x = 0;
      out.y = slope * z;
      return x;
    },
    boundaryAt: () => 8,
  } as unknown as Track;
}

class RoadPoseProbe extends BikeVehicle {
  constructor() {
    super(0, 'medium', DEFAULT_SETUP, 'sport', GP_R1);
  }
  pose(track: Track, dt = 0) {
    this.writeBody(track, dt);
  }
  absorb(dt: number) {
    this.absorbExternal(dt);
  }
  get collisionYaw() {
    return this.yawKick;
  }
}
class DirtPoseProbe extends DirtBikeVehicle {
  constructor() {
    super(0, 'medium', DEFAULT_SETUP, 'sport', MX_450);
  }
  pose(track: Track, dt = 0) {
    this.writeBody(track, dt);
  }
}

describe('authoritative world orientation kinematics', () => {
  it.each([1 / 120, 1 / 240, 1 / 480])(
    'recovers a known world spin from a tilted chassis at dt %s',
    (dt) => {
      const sampler = new OrientationKinematics(),
        q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, -1).normalize(), 1.3),
        rate = new Vector3(0.7, -1.2, 0.9),
        step = new Quaternion().setFromAxisAngle(rate.clone().normalize(), rate.length() * dt),
        omega = new Vec3(),
        acceleration = new Vec3();
      sampler.sample(solverQuaternion(q), 0, omega, acceleration);
      for (let i = 0; i < 20; i++) {
        q.premultiply(step);
        sampler.sample(solverQuaternion(q), dt, omega, acceleration);
        expect(vector(omega).distanceTo(rate)).toBeLessThan(1e-11);
        expect(acceleration.length()).toBeLessThan(1e-8);
      }
    },
  );

  it('differentiates interval rates at their actual midpoint times', () => {
    const sampler = new OrientationKinematics(),
      omega = new Vec3(),
      acceleration = new Vec3(),
      axis = new Vector3(1, -2, 3).normalize(),
      rateOfChange = 4;
    sampler.sample(new Quat(), 0, omega, acceleration);
    let time = 0;
    for (const [index, dt] of [1 / 120, 1 / 240, 1 / 480, 1 / 240].entries()) {
      time += dt;
      const q = new Quaternion().setFromAxisAngle(axis, 0.5 * rateOfChange * time ** 2);
      sampler.sample(solverQuaternion(q), dt, omega, acceleration);
      expect(
        vector(omega).distanceTo(axis.clone().multiplyScalar(rateOfChange * (time - dt / 2))),
      ).toBeLessThan(1e-10);
      if (index > 0)
        expect(
          vector(acceleration).distanceTo(axis.clone().multiplyScalar(rateOfChange)),
        ).toBeLessThan(1e-9);
      else expect(acceleration.length()).toBe(0);
    }
  });

  it('resets on placement and treats antipodal quaternions as the same pose', () => {
    const sampler = new OrientationKinematics(),
      omega = new Vec3(9, 8, 7),
      acceleration = new Vec3(6, 5, 4),
      q = new Quat().yaw(2.4);
    sampler.sample(q, 0, omega, acceleration);
    expect(omega.length() + acceleration.length()).toBe(0);
    sampler.sample(new Quat(-q.x, -q.y, -q.z, -q.w), DT, omega, acceleration);
    expect(omega.length() + acceleration.length()).toBe(0);
    q.yaw(-1.9);
    sampler.sample(q, 0, omega, acceleration);
    sampler.sample(q, DT, omega, acceleration);
    expect(omega.length() + acceleration.length()).toBe(0);
    for (const dt of [-1, NaN, Infinity])
      expect(() => sampler.sample(q, dt, omega, acceleration)).toThrow('Invalid authoritative');
    expect(() => sampler.sample(new Quat(0, 0, 0, 0), DT, omega, acceleration)).toThrow(
      'Invalid authoritative',
    );
  });
});

describe('motorcycle pose and contact velocity agreement', () => {
  it('records the actual GP wheelie and touchdown descent generated by the bike core', () => {
    const track = road(),
      bike = new RoadPoseProbe();
    bike.placeFree(track, 0, 0, 0, 0);
    bike.dynamics.speed = 14;
    bike.dynamics.assists = { ...EXPERT, lean: true };
    const input = { lean: 0, rider: 0, throttle: 1, drive: 6000, frontBrake: 0, rearBrake: 0 };
    for (let i = 0; i < 30; i++) {
      const before = quaternion(bike.body.orientation);
      bike.dynamics.step(input, DT);
      bike.pose(track, DT);
      expectRotation(before, bike.body, DT);
    }
    expect(bike.dynamics.pitch).toBeGreaterThan(0.05);
    expect(bike.body.omega.x).toBeLessThan(-0.05);
    const before = quaternion(bike.body.orientation),
      oldRate = bike.body.omega.x,
      oldPitch = bike.dynamics.pitch;
    bike.dynamics.step({ ...input, throttle: 0, drive: 0 }, DT);
    bike.pose(track, DT);
    expect(bike.dynamics.pitch).toBeLessThan(oldPitch);
    expect(bike.body.omega.x).toBeGreaterThan(0.05);
    expect(bike.body.angularAcceleration.x).toBeCloseTo((bike.body.omega.x - oldRate) / DT, 8);
    expectRotation(before, bike.body, DT);
  });

  it('includes tyre-crown lean rate and the tilted roll axis in GP point velocity', () => {
    const track = road(0.25),
      bike = new RoadPoseProbe(),
      heading = 0.7,
      lean = 0.5,
      dt = 1e-5;
    bike.placeFree(track, 0, 0, heading, 0);
    bike.dynamics.lean = lean;
    bike.pose(track);
    const before = quaternion(bike.body.orientation);
    bike.dynamics.lean += dt;
    bike.dynamics.leanRate = 1;
    bike.pose(track, dt);
    const pitch = Math.asin(
        (bike.contactPoints[0].y - bike.contactPoints[2].y) / bike.spec.wheelbase,
      ),
      rollRate = (chassisLean(lean + dt, bike.bikeSpec) - chassisLean(lean, bike.bikeSpec)) / dt,
      expected = new Vector3(
        -Math.sin(heading) * Math.cos(pitch) * rollRate,
        -Math.sin(pitch) * rollRate,
        -Math.cos(heading) * Math.cos(pitch) * rollRate,
      );
    expect(Math.abs(expected.y)).toBeGreaterThan(0.1);
    expect(vector(bike.body.omega).distanceTo(expected)).toBeLessThan(1e-9);
    expectRotation(before, bike.body, dt);
    const offset = new Vec3(0.2, 0.3, 0.7),
      point = new Vec3().copy(bike.body.position).add(offset),
      velocity = bike.body.pointVelocity(point, new Vec3()).sub(bike.body.velocity),
      expectedVelocity = expected.clone().cross(vector(offset));
    expect(vector(velocity).distanceTo(expectedVelocity)).toBeLessThan(1e-9);
  });

  it('measures MX airborne pitch and whip motion from the pose the adapter actually publishes', () => {
    const track = road(),
      bike = new DirtPoseProbe();
    bike.placeFree(track, 0, 0, 0.8, 0);
    // A controlled airborne state isolates pose kinematics from take-off tuning.
    bike.cgY = 4;
    bike.airborne = true;
    bike.pitch = 0.3;
    bike.pitchRate = 0.6;
    bike.dynamics.lean = 0.4;
    bike.pose(track);
    const before = quaternion(bike.body.orientation);
    bike.airYaw += 0.4 * DT;
    bike.dynamics.lean += 0.2 * DT;
    bike.pose(track, DT);
    expect(bike.pitch).toBeGreaterThan(0.3);
    expect(bike.body.omega.length()).toBeGreaterThan(0.4);
    expectRotation(before, bike.body, DT);
  });

  it.each(['gp', 'mx'] as const)(
    'records %s recovery motion and resets only at pose boundaries',
    (kind) => {
      const track = road(),
        bike = kind === 'gp' ? new RoadPoseProbe() : new DirtPoseProbe();
      bike.placeFree(track, 0, 0, 0.6, 0);
      bike.dynamics.lean = 1.21;
      bike.dynamics.state = 'lowside';
      bike.pose(track, DT);
      expect(bike.body.omega.length() + bike.body.angularAcceleration.length()).toBe(0);
      const before = quaternion(bike.body.orientation);
      bike.dynamics.step({ lean: 0, rider: 0, throttle: 0, frontBrake: 0, rearBrake: 0 }, DT);
      expect(bike.dynamics.leanRate).toBe(0);
      bike.pose(track, DT);
      expect(bike.body.omega.length()).toBeGreaterThan(3);
      expectRotation(before, bike.body, DT);
      bike.placeFree(track, 2, 3, -1.1, 0);
      expect(bike.body.omega.length() + bike.body.angularAcceleration.length()).toBe(0);
      bike.pose(track, DT);
      expect(bike.body.omega.length() + bike.body.angularAcceleration.length()).toBeLessThan(1e-9);
    },
  );

  it('ignores a GP collision position correction when differentiating physical heave', () => {
    const track = road(),
      bike = new RoadPoseProbe();
    bike.placeFree(track, 0, 0, 0, 0);
    const authoritativeY = bike.body.position.y;
    bike.body.position.y += 0.015;
    bike.pose(track, DT);
    expect(bike.body.position.y).toBe(authoritativeY);
    expect(bike.body.velocity.y).toBe(0);
  });

  it('does not turn the core remount reset into an angular collision impulse', () => {
    const track = road(),
      bike = new RoadPoseProbe();
    bike.placeFree(track, 0, 0, 0, 0);
    bike.dynamics.state = 'remount';
    bike.dynamics.stateClock = 1.499;
    bike.dynamics.pitch = 0.15;
    bike.dynamics.riderReady = true;
    bike.pose(track);
    bike.dynamics.step({ lean: 0, rider: 0, throttle: 0, frontBrake: 0, rearBrake: 0 }, DT);
    expect(bike.dynamics.state).toBe('riding');
    expect(bike.dynamics.pitch).toBe(0);
    bike.pose(track, DT);
    // A raw difference across this explicit reset would report 36 rad/s.
    expect(bike.body.omega.length() + bike.body.angularAcceleration.length()).toBe(0);
    bike.absorb(DT);
    expect(bike.collisionYaw).toBe(0);
    expect(bike.dynamics.leanRate).toBe(0);
  });

  it('does not absorb its measured rotation as a collision and consumes an external impulse once', () => {
    const track = road(),
      bike = new RoadPoseProbe();
    bike.placeFree(track, 0, 0, 0.7, 0);
    bike.dynamics.lean = 0.002;
    bike.dynamics.pitch = 0.001;
    bike.dynamics.heading += 0.001;
    bike.pose(track, DT);
    const leanRate = bike.dynamics.leanRate;
    bike.absorb(DT);
    expect(bike.collisionYaw).toBe(0);
    expect(bike.dynamics.leanRate).toBe(leanRate);
    const heading = bike.dynamics.heading;
    bike.body.omega.add(new Vec3(-0.3 * Math.sin(heading), 0.4, -0.3 * Math.cos(heading)));
    // The collision solver can also change the transient body orientation.
    // It must not become part of the next authoritative angular displacement.
    bike.body.orientation.yaw(-2);
    bike.absorb(DT);
    expect(bike.collisionYaw).toBeCloseTo(0.4, 12);
    expect(bike.dynamics.leanRate).toBeCloseTo(leanRate + 0.3, 12);
    bike.pose(track, DT);
    expect(bike.body.omega.length()).toBeLessThan(1e-12);
    bike.absorb(DT);
    expect(bike.collisionYaw).toBeCloseTo(0.4, 12);
    expect(bike.dynamics.leanRate).toBeCloseTo(leanRate + 0.3, 12);
  });
});
