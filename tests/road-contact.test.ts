import { expect, it } from 'vitest';
import { Quat, Vec3 } from '../src/core/math.ts';
import { RoadContactFrame } from '../src/simulation/road-contact.ts';
import { wheelAngularMomentum } from '../src/simulation/wheel-momentum.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { type SurfaceSample, SURFACE } from '../src/simulation/track.ts';

class InclinedTrack extends DynamicsTrack {
  constructor(
    readonly slope = 0.16,
    readonly grade = 0,
  ) {
    super();
  }
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    out.height = x * this.slope + z * this.grade;
    out.normal.set(-this.slope, 1, -this.grade).normalize();
    return out;
  }
  override cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    const distance =
      (origin.x * this.slope + origin.z * this.grade - origin.y) /
      (down.y - this.slope * down.x - this.grade * down.z);
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
it('rolls in the physical wheel plane under combined steering, camber, bank and pitch', () => {
  const pitch = 0.12,
    orientation = new Quat(Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)),
    steering = 0.32,
    camber = 0.08,
    normal = new Vec3(-0.25, 1, 0.09).normalize(),
    frame = new RoadContactFrame();
  expect(frame.set(orientation, steering, normal, camber)).toBe(true);
  const axle = wheelAngularMomentum([{ inertia: 1, omega: 1 }], [steering], [camber], new Vec3());
  orientation.rotate(axle, axle);
  expect(frame.axle.x).toBeCloseTo(axle.x, 12);
  expect(frame.axle.y).toBeCloseTo(axle.y, 12);
  expect(frame.axle.z).toBeCloseTo(axle.z, 12);
  expect(frame.forward.dot(axle)).toBeCloseTo(0, 12);
  expect(frame.forward.dot(normal)).toBeCloseTo(0, 12);
  expect(frame.lateral.dot(normal)).toBeCloseTo(0, 12);
  expect((frame.inclination * 180) / Math.PI).toBeCloseTo(17.273216421426646, 10);

  // The circular wheel's radius to contact is the negative road normal
  // projected into its plane. The tread's spin velocity exactly cancels
  // centre translation when rolling without slip, including inclination.
  const radius = 0.335,
    omega = 90,
    spoke = new Vec3().copy(normal).addScaled(axle, -axle.dot(normal)).normalize().scale(-radius),
    spinVelocity = new Vec3().cross(axle, spoke).scale(omega),
    centreVelocity = new Vec3().copy(frame.forward).scale(radius * omega),
    treadVelocity = new Vec3().copy(centreVelocity).add(spinVelocity);
  expect(treadVelocity.length()).toBeLessThan(1e-12);
  expect(centreVelocity.dot(frame.lateral)).toBeCloseTo(0, 12);
});
it('uses steering when resolving a bank or gradient into road-relative inclination', () => {
  const frame = new RoadContactFrame(),
    orientation = new Quat(),
    bank = new Vec3(-0.25, 1, 0).normalize(),
    gradient = new Vec3(0, 1, 0.3).normalize();
  frame.set(orientation, 0, bank);
  expect(frame.inclination).toBeCloseTo(Math.atan(0.25), 12);
  frame.set(orientation, Math.PI / 2, bank);
  expect(frame.inclination).toBeCloseTo(0, 12);
  frame.set(orientation, 0, gradient);
  expect(frame.inclination).toBeCloseTo(0, 12);
  frame.set(orientation, Math.PI / 2, gradient);
  expect(frame.inclination).toBeCloseTo(Math.atan(0.3), 12);
  for (const camber of [-0.2, 0, 0.15]) {
    frame.set(orientation, 0.45, new Vec3(0, 1, 0), camber);
    expect(frame.inclination).toBeCloseTo(camber, 12);
  }
});
it.each([-0.6, 0, 0.5])(
  'mirrors contact forces and their work across a banked turn at steer %s',
  (steer) => {
    const a = new RoadContactFrame(),
      b = new RoadContactFrame(),
      pitch = 0.17,
      orientation = new Quat(Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2));
    a.set(orientation, steer, new Vec3(-0.22, 1, 0.08), 0.11);
    b.set(orientation, -steer, new Vec3(0.22, 1, 0.08), -0.11);
    expect(a.inclination).toBeCloseTo(-b.inclination, 12);
    const forceA = new Vec3().addScaled(a.forward, 1500).addScaled(a.lateral, 900),
      forceB = new Vec3().addScaled(b.forward, 1500).addScaled(b.lateral, -900),
      velocityA = new Vec3(2, -0.4, 30),
      velocityB = new Vec3(-2, -0.4, 30);
    expect(forceA.x).toBeCloseTo(-forceB.x, 10);
    expect(forceA.y).toBeCloseTo(forceB.y, 10);
    expect(forceA.z).toBeCloseTo(forceB.z, 10);
    expect(forceA.dot(a.normal)).toBeCloseTo(0, 10);
    expect(forceA.dot(velocityA)).toBeCloseTo(forceB.dot(velocityB), 9);
  },
);
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
it('uses the same wheel geometry in the production force solve on mirrored banked turns', () => {
  const cars = [1, -1].map((sign) => {
    const track = new InclinedTrack(sign * 0.08, 0.015),
      car = new Vehicle(0);
    car.place(track, 0);
    car.body.velocity.set(sign, 0, 25);
    car.body.omega.y = sign * 0.1;
    car.steer = sign * 0.28;
    car.input.steer = sign * 0.8;
    for (const tire of car.tires) tire.omega = 25 / tire.radius;
    car.step(1 / 240, track);
    for (let i = 0; i < car.tires.length; i++) {
      const tire = car.tires[i],
        frame = car.contactFrames[i],
        axle = wheelAngularMomentum(
          [{ inertia: 1, omega: 1 }],
          [car.wheelSteering[i]],
          [car.wheelCamber[i]],
          new Vec3(),
        );
      // The solve began at identity chassis orientation. The rigid-body
      // orientation after step() has advanced, while this frame records the
      // actual geometry used to resolve the contact velocity and force.
      expect(frame.forward.dot(axle)).toBeCloseTo(0, 12);
      expect(tire.inclination).toBe(frame.inclination);
      expect(tire.inclination).toBeCloseTo(-Math.asin(axle.dot(frame.normal)), 12);
      const force = new Vec3().addScaled(frame.forward, tire.fx).addScaled(frame.lateral, tire.fy);
      expect(force.dot(frame.normal)).toBeCloseTo(0, 9);
    }
    expect(car.tires.some((tire) => tire.load > 1000 && Math.abs(tire.fy) > 100)).toBe(true);
    return car;
  });
  // Mirroring swaps left/right contacts and lateral signs, preserving forward
  // and normal response. The existing suspension's nonlinear convergence can
  // differ on unloaded corners; they exert no contact force.
  for (let i = 0; i < 4; i++) {
    const a = cars[0].tires[i],
      b = cars[1].tires[i ^ 1];
    expect(a.load).toBeCloseTo(b.load, 6);
    expect(a.fx).toBeCloseTo(b.fx, 6);
    expect(a.fy).toBeCloseTo(-b.fy, 6);
  }
  expect(cars[0].body.force.x).toBeCloseTo(-cars[1].body.force.x, 6);
  expect(cars[0].body.force.y).toBeCloseTo(cars[1].body.force.y, 6);
  expect(cars[0].body.force.z).toBeCloseTo(cars[1].body.force.z, 6);
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
  // A wheel lying flat has no unique rolling tangent. A wheel aimed into a
  // vertical road still has a wheel/road-plane intersection and can roll.
  expect(frame.set(new Quat(), 0, new Vec3(1, 0, 0))).toBe(false);
  expect(frame.forward.length()).toBe(0);
  expect(frame.lateral.length()).toBe(0);
  expect(frame.inclination).toBeCloseTo(-Math.PI / 2, 12);
  expect(frame.set(new Quat(), 0, new Vec3(0, 0, 1))).toBe(true);
  expect(frame.forward.y).toBe(-1);
  expect(frame.set(new Quat(0, 0, 1, 0), 0, new Vec3(0, 1, 0))).toBe(true);
  expect(frame.forward.z).toBe(-1);
  expect(frame.set(new Quat(), 0, new Vec3(0, 1, 0), Math.PI / 2)).toBe(false);
  expect(frame.forward.length()).toBe(0);
  expect(frame.lateral.length()).toBe(0);
  expect(() => frame.set(new Quat(), 0, new Vec3())).toThrow();
  expect(() => frame.set(new Quat(NaN), 0, new Vec3(0, 1, 0))).toThrow();
  expect(() => frame.set(new Quat(), NaN, new Vec3(0, 1, 0))).toThrow();
  expect(() => frame.set(new Quat(), 0, new Vec3(0, 1, 0), NaN)).toThrow();
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
