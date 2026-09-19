import { expect, it } from 'vitest';
import { Quat, Vec3 } from '../src/core/math.ts';
import { RoadContactFrame } from '../src/simulation/road-contact.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { type SurfaceSample, SURFACE } from '../src/simulation/track.ts';

class InclinedTrack extends DynamicsTrack {
  readonly slope = 0.16;
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    out.height = x * this.slope;
    out.normal.set(-this.slope, 1, 0).normalize();
    return out;
  }
  override cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    const distance = (origin.x * this.slope - origin.y) / (down.y - this.slope * down.x);
    if (distance < 0 || distance > maximum) return Infinity;
    this.sample(origin.x + distance * down.x, origin.z + distance * down.z, out);
    return distance;
  }
}
class FloorStrip extends DynamicsTrack {
  constructor(readonly raised: boolean) {
    super();
  }
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    out.height = this.raised && Math.abs(x) < 0.7 && z > 0.8 ? 0.1 : 0;
    out.surface = out.height > 0 ? SURFACE.KERB : SURFACE.ASPHALT;
    return out;
  }
  override cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    this.sample(origin.x, origin.z, out);
    const distance = (out.height - origin.y) / down.y;
    return distance >= 0 && distance <= maximum ? distance : Infinity;
  }
}
it.each([0, 0.15, -0.3, 0.7])('uses an orthonormal banked contact frame at slope %s', (slope) => {
  const frame = new RoadContactFrame(),
    n = new Vec3(-slope, 1, 0).normalize();
  expect(frame.set(new Quat().yaw(0.7), 0.18, n)).toBe(true);
  expect(frame.forward.length()).toBeCloseTo(1, 12);
  expect(frame.lateral.length()).toBeCloseTo(1, 12);
  expect(frame.forward.dot(n)).toBeCloseTo(0, 12);
  expect(frame.lateral.dot(n)).toBeCloseTo(0, 12);
  expect(frame.lateral.dot(frame.forward)).toBeCloseTo(0, 12);
  const v = new Vec3(3, 2, -4);
  const force = new Vec3().addScaled(frame.forward, 300).addScaled(frame.lateral, -700);
  expect(force.dot(v)).toBeCloseTo(300 * v.dot(frame.forward) - 700 * v.dot(frame.lateral), 10);
  expect(frame.forward.dot(new Vec3().copy(n).scale(5))).toBeCloseTo(0, 12);
});
it('treats normal heave as suspension motion, not lateral tire sliding in the production vehicle', () => {
  const track = new InclinedTrack();
  const car = new Vehicle(0, 'medium', {
    ...DEFAULT_SETUP,
    frontCamber: 0,
    rearCamber: 0,
    frontToe: 0,
    rearToe: 0,
  });
  car.place(track, 0);
  car.body.velocity.set(track.slope, -1, 0).normalize();
  car.input.brake = 1;
  car.step(1 / 240, track);
  expect(car.tires.some((tire) => tire.load > 1000)).toBe(true);
  for (const tire of car.tires) {
    expect(tire.angle).toBeCloseTo(0, 12);
    expect(tire.fy).toBeCloseTo(0, 9);
    expect(tire.slip).toBeCloseTo(0, 12);
    expect(tire.energy).toBeCloseTo(0, 9);
  }
});
it('a real front floor strike changes pitch even when the CG and all four wheels miss the raised strip', () => {
  const flat = new Vehicle(0),
    raised = new Vehicle(0);
  flat.body.position.set(0, 0.5, 0);
  raised.body.position.copy(flat.body.position);
  flat.input.brake = raised.input.brake = 1;
  flat.step(1 / 240, new FloorStrip(false));
  raised.step(1 / 240, new FloorStrip(true));
  expect(raised.body.torque.x - flat.body.torque.x).toBeLessThan(-1000);
  expect(raised.body.force.y - flat.body.force.y).toBeGreaterThan(1000);
  expect(raised.body.omega.x).toBeLessThan(flat.body.omega.x);
});
it('handles tangent degeneracy without manufacturing a traction direction', () => {
  const frame = new RoadContactFrame();
  expect(frame.set(new Quat(), 0, new Vec3(0, 0, 1))).toBe(false);
  expect(frame.forward.length()).toBe(0);
  expect(frame.lateral.length()).toBe(0);
  expect(() => frame.set(new Quat(), 0, new Vec3())).toThrow();
  expect(() => frame.set(new Quat(NaN), 0, new Vec3(0, 1, 0))).toThrow();
  expect(() => frame.set(new Quat(), NaN, new Vec3(0, 1, 0))).toThrow();
});

it('floor abrasion never repairs prior collision damage, even with no active contact', () => {
  for (const raised of [false, true]) {
    const car = new Vehicle(0);
    car.floorHealth = 0.1;
    car.body.position.set(0, 0.5, 0);
    car.body.velocity.z = 20;
    car.step(1 / 240, new FloorStrip(raised));
    expect(car.floorHealth).toBe(0.1);
  }
});
