import { describe, expect, it } from 'vitest';
import { mod, Vec3 } from '../src/core/math.ts';
import { BIKE_RECOVERY, writeBikeBlock } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { MX_RECOVERY } from '../src/simulation/offroad/rider-recovery.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { B, BIKE_STRIDE } from '../src/simulation/protocol.ts';
import { surfaceSample, type Track } from '../src/simulation/track.ts';

const TAU = 2 * Math.PI;
const angle = (a: number, b: number) => mod(a - b + Math.PI, TAU) - Math.PI;

class RecoveringBike extends DirtBikeVehicle {
  seat() {
    return this.remountSeatTarget(new Vec3());
  }

  ready() {
    return this.riderReady();
  }

  updateRecovery(dt: number, track: Track) {
    this.updateRider(dt, track);
  }

  stoppedRemount(track: Track, clock = 1.49) {
    this.dynamics.state = this.lastState = 'remount';
    this.dynamics.stateClock = clock;
    this.remount.active = false;
    this.writeBody(track, 0);
  }

  separated(track: Track, side: number, ahead: number) {
    const d = this.dynamics;
    d.state = this.lastState = 'separated';
    d.stateClock = 2.1;
    d.lean = 1.3;
    this.writeBody(track, 0);
    this.rider.set(
      this.body.position.x + Math.cos(d.heading) * side + Math.sin(d.heading) * ahead,
      this.body.position.y,
      this.body.position.z - Math.sin(d.heading) * side + Math.cos(d.heading) * ahead,
    );
    const soil = surfaceSample();
    track.sample(this.rider.x, this.rider.z, soil, this.rider.y);
    this.rider.y = soil.height + MX_RECOVERY.slideHeight;
    this.riderHeading = Math.atan2(
      this.body.position.x - this.rider.x,
      this.body.position.z - this.rider.z,
    );
    this.riderVelocity.set(0, 0, 0);
  }

  get pushDistance() {
    return Math.hypot(this.remount.x - this.dynamics.x, this.remount.z - this.dynamics.z);
  }
}

/** Test the production state machine through three mounted samples. The
 * second/third samples catch a deferred height snap after suspension settle. */
function completeRecovery(bike: RecoveringBike, track: Track, hz: number, deadline: number) {
  const dt = 1 / hz,
    block = new Float32Array(BIKE_STRIDE);
  let mounted = 0,
    remountSeconds = 0,
    firstMountedAt = 0,
    entered = false;
  for (let tick = 0; tick <= Math.ceil(deadline * hz) + 8; tick++) {
    const state = bike.dynamics.state,
      before = new Vec3().copy(bike.rider),
      heading = bike.riderHeading,
      bikeX = bike.dynamics.x,
      bikeZ = bike.dynamics.z,
      bikeHeading = bike.dynamics.heading;
    bike.step(dt, track);
    writeBikeBlock(block, 0, bike);
    expect(
      [
        bike.rider.x,
        bike.rider.y,
        bike.rider.z,
        bike.riderHeading,
        bike.body.position.x,
        bike.body.position.y,
        bike.body.position.z,
      ].every(Number.isFinite),
    ).toBe(true);
    if (state === 'remount' || bike.dynamics.state === 'remount' || mounted > 0) {
      expect(Math.sqrt(bike.rider.distanceSq(before))).toBeLessThanOrEqual(4 * dt + 1e-8);
      expect(Math.abs(angle(bike.riderHeading, heading))).toBeLessThanOrEqual(4 * dt + 1e-9);
      expect(block[B.RIDER_X]).toBeCloseTo(bike.rider.x, 4);
      expect(block[B.RIDER_Y]).toBeCloseTo(bike.rider.y, 4);
      expect(block[B.RIDER_Z]).toBeCloseTo(bike.rider.z, 4);
    }
    if (bike.dynamics.state === 'remount') {
      entered = true;
      remountSeconds += dt;
      expect(Math.hypot(bike.dynamics.x - bikeX, bike.dynamics.z - bikeZ)).toBeLessThanOrEqual(
        3 * dt + 1e-9,
      );
      expect(Math.abs(angle(bike.dynamics.heading, bikeHeading))).toBeLessThanOrEqual(
        1.6 * dt + 1e-9,
      );
    }
    if (bike.riding) {
      mounted++;
      if (mounted === 1) {
        firstMountedAt = (tick + 1) * dt;
        expect(bike.rider.distanceSq(bike.body.position)).toBeLessThan(1e-14);
        expect(Math.abs(angle(bike.riderHeading, bike.heading))).toBeLessThan(1e-9);
      }
      if (mounted === 3) break;
    }
  }
  expect(entered).toBe(true);
  expect(mounted).toBe(3);
  expect(firstMountedAt).toBeLessThanOrEqual(deadline + 6 * dt);
  expect(bike.dynamics.crashes).toBe(0);
  return { firstMountedAt, remountSeconds };
}

describe.each([60, 120, 240])('motocross position handoff at %s Hz', (hz) => {
  it('bounds the complete XYZ seat approach, including diagonal and final partial steps', () => {
    const track = rigTrack('valley-ridge-mx'),
      dt = 1 / hz;
    for (const direction of [
      [1, 1, 1],
      [-1, -1, 1],
      [0, 1, 0],
      [1, 0, -1],
    ]) {
      const bike = new RecoveringBike(0, 'medium', DEFAULT_SETUP, 'sport', MX_450);
      bike.place(track, 35);
      bike.stoppedRemount(track);
      const seat = bike.seat(),
        vector = new Vec3(...(direction as [number, number, number]));
      bike.rider.copy(seat).addScaled(vector, -2);
      const before = new Vec3().copy(bike.rider);
      bike.updateRecovery(dt, track);
      const displacement = new Vec3().copy(bike.rider).sub(before);
      expect(displacement.length()).toBeCloseTo(4 * dt, 10);
      expect(displacement.normalize().distanceSq(vector.normalize())).toBeLessThan(1e-20);
      bike.rider.copy(seat).addScaled(vector, -1e-5);
      bike.updateRecovery(dt, track);
      expect(bike.rider.distanceSq(seat)).toBeLessThan(1e-20);
      const held = [bike.rider.x, bike.rider.y, bike.rider.z, bike.riderHeading];
      bike.updateRecovery(0, track);
      expect([bike.rider.x, bike.rider.y, bike.rider.z, bike.riderHeading]).toEqual(held);
    }
  });

  it('does not bypass either actual seat position or heading after the old five-second timeout', () => {
    const track = rigTrack('valley-ridge-mx'),
      dt = 1 / hz;
    const bike = new RecoveringBike(0, 'medium', DEFAULT_SETUP, 'sport', MX_450);
    bike.place(track, 35);
    bike.stoppedRemount(track, BIKE_RECOVERY.maxPush + dt);
    const seat = bike.seat();
    bike.rider.copy(seat).add(new Vec3(0.55, 0.4, 0));
    bike.riderHeading = bike.heading;
    expect(bike.ready()).toBe(false);
    bike.rider.copy(seat);
    bike.riderHeading = bike.heading + Math.PI;
    expect(bike.ready()).toBe(false);
    bike.rider.add(new Vec3(0.55, 0.4, 0));
    const result = completeRecovery(bike, track, hz, 1.5);
    expect(result.firstMountedAt).toBeGreaterThanOrEqual(Math.PI / 4);
  });

  it('holds the motorcycle while a distant rider physically reaches its pushing position', () => {
    const track = rigTrack('valley-ridge-mx'),
      dt = 1 / hz;
    const bike = new RecoveringBike(0, 'medium', DEFAULT_SETUP, 'sport', MX_450);
    const jump = offroadCourse(track.circuit)!.jumps.find(
      (feature) => feature.name === 'BARN DOUBLE',
    )!;
    bike.place(
      track,
      jump.start - bike.bikeSpec.cgToFront - bike.bikeSpec.frontWheelRadius - 0.12,
      -2.5,
    );
    bike.step(dt, track);
    bike.rider.add(new Vec3(-12, 5, 0));
    bike.riderHeading += Math.PI;
    const beside = new Vec3(
        bike.dynamics.x + Math.cos(bike.heading) * 0.55,
        0,
        bike.dynamics.z - Math.sin(bike.heading) * 0.55,
      ),
      soil = surfaceSample();
    track.sample(beside.x, beside.z, soil, bike.body.position.y);
    beside.y = soil.height + MX_RECOVERY.uprightHeight;
    const acquisition = Math.sqrt(bike.rider.distanceSq(beside)) / BIKE_RECOVERY.jogSpeed;
    bike.restart(track, 'stranded');
    const startX = bike.dynamics.x,
      startZ = bike.dynamics.z,
      distance = bike.pushDistance,
      deadline = bike.remountBudgetSeconds;
    const waitingTicks = Math.floor(acquisition * hz);
    for (let tick = 0; tick < waitingTicks; tick++) {
      const previous = new Vec3().copy(bike.rider),
        heading = bike.riderHeading;
      bike.step(dt, track);
      expect(bike.dynamics.x).toBe(startX);
      expect(bike.dynamics.z).toBe(startZ);
      expect(Math.sqrt(bike.rider.distanceSq(previous))).toBeLessThanOrEqual(4 * dt + 1e-8);
      expect(Math.abs(angle(bike.riderHeading, heading))).toBeLessThanOrEqual(4 * dt + 1e-9);
    }
    const result = completeRecovery(bike, track, hz, deadline - waitingTicks * dt);
    expect(result.firstMountedAt + waitingTicks * dt).toBeGreaterThanOrEqual(
      acquisition + distance / BIKE_RECOVERY.pushSpeed,
    );
  });

  it.each([MX_250, MX_450])(
    'hands a naturally recovering $id rider to the seat without an XYZ or heading snap',
    (definition) => {
      for (const [side, ahead] of [
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ]) {
        const track = rigTrack('valley-ridge-mx');
        const bike = new RecoveringBike(0, 'medium', DEFAULT_SETUP, 'sport', definition);
        bike.place(track, 35);
        bike.separated(track, side, ahead);
        const result = completeRecovery(
          bike,
          track,
          hz,
          BIKE_RECOVERY.maxJog + BIKE_RECOVERY.maxPush,
        );
        expect(result.remountSeconds).toBeLessThanOrEqual(BIKE_RECOVERY.maxPush + 2 / hz);
      }
    },
  );

  it.each([
    ['valley-ridge-mx', 'BARN DOUBLE approach', 'stranded', 0],
    ['valley-ridge-mx', 'first jump push gait', 'wrong-way', 0],
    ['arena-nord-sx', 'timing gate 145.4', 'rider', 145.4],
    ['arena-nord-sx', 'timing gate 448', 'rider', 448],
  ] as const)(
    'uses a distance-aware finite trajectory for %s / %s',
    (venue, name, reason, station) => {
      for (const definition of [MX_250, MX_450]) {
        const track = rigTrack(venue),
          course = offroadCourse(track.circuit)!;
        const bike = new RecoveringBike(0, 'medium', DEFAULT_SETUP, 'sport', definition);
        const barn = course.jumps.find((jump) => jump.name === 'BARN DOUBLE');
        const s =
          station ||
          (name === 'BARN DOUBLE approach'
            ? barn!.start - bike.bikeSpec.cgToFront - bike.bikeSpec.frontWheelRadius - 0.12
            : course.jumps[0].takeoff - 0.25);
        bike.place(track, s, barn && name === 'BARN DOUBLE approach' ? -2.5 : 0);
        bike.step(1 / hz, track);
        bike.restart(track, reason);
        expect(bike.dynamics.state).toBe('remount');
        const distance = bike.pushDistance,
          deadline = bike.remountBudgetSeconds;
        expect(distance).toBeGreaterThan(15);
        expect(deadline).toBeGreaterThanOrEqual(distance / BIKE_RECOVERY.pushSpeed);
        expect(deadline).toBeGreaterThan(BIKE_RECOVERY.maxPush);
        const result = completeRecovery(bike, track, hz, deadline);
        // Independent physical lower bound prevents a larger reported budget
        // from disguising the previous accelerated push or endpoint teleport.
        expect(result.firstMountedAt).toBeGreaterThanOrEqual(distance / BIKE_RECOVERY.pushSpeed);
        expect(bike.remountBudgetSeconds).toBe(deadline);
        expect(bike.s).toBeGreaterThan(s + distance - 1);
        if (name === 'BARN DOUBLE approach') expect(bike.s).toBeGreaterThan(barn!.end);
      }
    },
  );
});
