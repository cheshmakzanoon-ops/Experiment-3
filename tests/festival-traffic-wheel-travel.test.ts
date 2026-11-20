import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import {
  AmbientTraffic,
  TF,
  TRAFFIC_HEADER,
  TRAFFIC_STRIDE,
  TRAFFIC_VERSION,
} from '../src/simulation/open-world/ambient-traffic.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

function fixture() {
  const world = openWorld();
  const traffic = new AmbientTraffic(world.network, 42, { maxCars: 0, perTile: 0 });
  const edge = world.network.edges.find((e) => e.roadClass === 'highway' && e.length > 500)!;
  const player = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.tc1);
  player.body.position.set(100_000, 100, 100_000);
  return { traffic, edge, player };
}

describe('authoritative traffic wheel travel', () => {
  it('settles from actual braking and turning with car-specific spring rates', () => {
    const { traffic, player } = fixture();
    const straight = openWorld().network.edges.find((edge) => edge.roadClass === 'runway')!;
    const car = traffic.place(straight.index, 1, 200, 22, 'rp6');
    car.accel = -5;
    // Settle the chassis independently of the lower-frequency traffic planner.
    for (let i = 0; i < 100; i++) {
      const old = car.speed,
        yaw = car.yaw;
      car.speed -= 5 / 120;
      car.yaw += 0.16 / 120;
      car.settleChassis(old, yaw, 1 / 120);
    }
    expect(car.pitch.angle).toBeGreaterThan(0.003);
    expect(car.roll.angle).toBeGreaterThan(0.002);
    expect(car.curvature).toBeGreaterThan(0);
    const frame = traffic.writeSnapshot(),
      o = TRAFFIC_HEADER;
    expect(frame[o + TF.PITCH]).toBeCloseTo(car.pitch.angle, 7);
    expect(frame[o + TF.ROLL]).toBeCloseTo(car.roll.angle, 7);
    expect(frame[o + TF.CURVATURE]).toBeCloseTo(car.curvature, 7);
    const frozen = [car.pitch.angle, car.roll.angle];
    traffic.step(0, player);
    expect([car.pitch.angle, car.roll.angle]).toEqual(frozen);
    const angle = car.pitch.angle;
    for (let i = 0; i < 240; i++) car.settleChassis(car.speed, car.yaw, 1 / 120);
    expect(Math.abs(car.pitch.angle)).toBeLessThan(angle * 0.1);
  });

  it('records physical longitudinal travel in the versioned auxiliary snapshot', () => {
    const { traffic, edge, player } = fixture();
    const car = traffic.place(edge.index, 1, 200, 12, 'rh3');
    const previous = new Vec3().copy(car.position);
    expect(car.distance).toBe(0);
    traffic.step(1 / 120, player);
    const displacement = new Vec3().copy(car.position).sub(previous).length();
    expect(car.distance).toBeGreaterThan(0.09);
    expect(car.distance).toBeLessThan(0.11);
    expect(car.distance).toBeCloseTo(displacement, 4);
    const data = traffic.writeSnapshot();
    expect(data.length).toBe(TRAFFIC_HEADER + TRAFFIC_STRIDE);
    expect(data[2]).toBe(TRAFFIC_VERSION);
    expect(data[TRAFFIC_HEADER + TF.DISTANCE]).toBeCloseTo(car.distance, 7);
  });

  it('does not roll stopped tyres during a pure lateral shove', () => {
    const { traffic, edge, player } = fixture();
    const car = traffic.place(edge.index, 1, 200, 0, 'rp6');
    const previous = new Vec3().copy(car.position);
    car.shove = 3;
    traffic.step(1 / 120, player);
    expect(new Vec3().copy(car.position).sub(previous).length()).toBeGreaterThan(0.01);
    expect(Math.abs(car.distance)).toBeLessThan(0.0001);
    car.shove = 0;
    const held = car.distance;
    traffic.step(0, player);
    expect(car.distance).toBe(held);
  });

  it('does not reset distance when moving onto another road edge', () => {
    const { traffic, edge, player } = fixture();
    const car = traffic.place(edge.index, 1, edge.length - 0.04, 12, 'rs5');
    expect(car.next).not.toBeNull();
    car.distance = 123.5;
    traffic.step(1 / 120, player);
    expect(car.edge).not.toBe(edge.index);
    expect(car.distance).toBeGreaterThan(123);
    expect(car.distance).toBeLessThan(124);
    expect(traffic.writeSnapshot()[TRAFFIC_HEADER + TF.DISTANCE]).toBeCloseTo(car.distance, 4);
  });

  it('leaves distance unchanged at a stopped dead end and is independent of snapshot reads', () => {
    const { traffic, edge, player } = fixture();
    const car = traffic.place(edge.index, 1, edge.length, 0, 'rh3');
    car.next = null;
    car.distance = 17;
    traffic.step(1 / 120, player);
    const first = traffic.writeSnapshot();
    expect(car.distance).toBe(17);
    expect(Array.from(traffic.writeSnapshot())).toEqual(Array.from(first));
  });
});
