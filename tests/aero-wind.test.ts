import { describe, expect, it } from 'vitest';
import { Euler, Quaternion } from 'three';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { G, Vec3 } from '../src/core/math.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';

const DT = 1 / 240;
type Vector = readonly [number, number, number];

/** A contact-free production step isolates aerodynamic force and moment.
 * The two wind-tunnel descriptions below have the same body pose, angular
 * velocity and air-relative translation, but different ground velocities. */
function windTunnel(
  velocity: Vector,
  wind: readonly [number, number] = [0, 0],
  attitude: Vector = [0, 0, 0],
  angularVelocity: Vector = [0, 0, 0],
) {
  const track = new DynamicsTrack();
  track.windX = wind[0];
  track.windZ = wind[1];
  const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'raw');
  car.place(track, 0);
  car.fuel = car.battery = 0;
  car.gear = 0;
  car.autoShift = false;
  car.body.position.set(0, 4, 0);
  const q = new Quaternion().setFromEuler(new Euler(...attitude, 'YXZ'));
  Object.assign(car.body.orientation, { x: q.x, y: q.y, z: q.z, w: q.w });
  car.body.velocity.set(...velocity);
  car.body.omega.set(...angularVelocity);
  car.step(DT, track);
  expect(car.tires.every((tire) => tire.load === 0)).toBe(true);
  expect(car.bottomEnergy).toBe(0);
  return car;
}

function sameVector(a: Vec3, b: Vec3) {
  for (const axis of ['x', 'y', 'z'] as const) expect(a[axis]).toBeCloseTo(b[axis], 8);
}

describe('production aerodynamics in the air-relative frame', () => {
  it.each<Vector>([
    [0, 0, 0],
    [0.08, 0.4, -0.1],
    [-0.06, -0.5, 0.12],
  ])('preserves forces and moments under a common crosswind velocity shift: %j', (...attitude) => {
    const calm = windTunnel([-18, 1.4, 55], [0, 0], attitude, [0.2, 0.1, -0.13]);
    const windy = windTunnel([0, 1.4, 55], [18, 0], attitude, [0.2, 0.1, -0.13]);
    for (const field of ['front', 'rear', 'floor', 'drag'] as const)
      expect(windy.aero[field]).toBeCloseTo(calm.aero[field], 8);
    sameVector(windy.body.force, calm.body.force);
    sameVector(windy.body.torque, calm.body.torque);
  });

  it('uses relative wind for wing-station plunge on a pitched and rotating chassis', () => {
    const attitude: Vector = [0.12, 0, 0],
      rate: Vector = [0.24, 0, 0];
    const calm = windTunnel([0, 0, 50], [0, 0], attitude, rate);
    const windy = windTunnel([0, 0, 65], [0, 15], attitude, rate);
    // Longitudinal translation cannot change yaw here. A difference in these
    // forces would specifically expose ground-relative plunge damping.
    expect(windy.aero).toEqual(calm.aero);
    sameVector(windy.body.force, calm.body.force);
    sameVector(windy.body.torque, calm.body.torque);
  });

  it('reduces downforce for crossflow at equal airspeed and mirrors opposite gusts', () => {
    const speed = 60,
      lateral = 20,
      windZ = speed - Math.sqrt(speed * speed - lateral * lateral),
      straight = windTunnel([0, 0, speed]),
      left = windTunnel([0, 0, speed], [lateral, windZ]),
      right = windTunnel([0, 0, speed], [-lateral, windZ]);
    for (const field of ['front', 'rear', 'floor'] as const) {
      expect(left.aero[field]).toBeLessThan(straight.aero[field] * 0.85);
      expect(left.aero[field]).toBeGreaterThan(straight.aero[field] * 0.6);
      expect(left.aero[field]).toBeCloseTo(right.aero[field], 10);
    }
    expect(left.aero.drag).toBeCloseTo(straight.aero.drag, 10);
    expect(left.body.force.x).toBeGreaterThan(0);
    expect(right.body.force.x).toBeCloseTo(-left.body.force.x, 10);
  });

  it('has no aerodynamic load when the body translates with the air', () => {
    const car = windTunnel([20, 0, 50], [20, 50], [0.1, 0.3, -0.1]);
    expect(car.aero).toEqual({ front: 0, rear: 0, floor: 0, drag: 0, wake: 0 });
    sameVector(car.body.force, new Vec3(0, -car.body.mass * G, 0));
    sameVector(car.body.torque, new Vec3());
  });
});
