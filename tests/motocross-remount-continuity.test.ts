import { describe, expect, it } from 'vitest';
import { mod } from '../src/core/math.ts';
import { BIKE_RECOVERY, writeBikeBlock } from '../src/simulation/bike-vehicle.ts';
import { controls, DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { MX_RECOVERY } from '../src/simulation/offroad/rider-recovery.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { B, BIKE_STRIDE } from '../src/simulation/protocol.ts';
import { surfaceSample, type Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

const TAU = 2 * Math.PI;
const angle = (a: number, b: number) => mod(a - b + Math.PI, TAU) - Math.PI;

/** Expose the real rider update for directional bounds; complete recoveries
 * below run the production DirtBikeVehicle.step()/Simulation.step() callers. */
class RecoveringBike extends DirtBikeVehicle {
  updateRecovery(dt: number, track: Track) {
    this.updateRider(dt, track);
  }

  separated(track: Track, side: number, ahead: number) {
    const d = this.dynamics;
    d.state = this.lastState = 'separated';
    d.stateClock = 2.1;
    d.lean = 1.3;
    this.writeBody(track, 0);
    const h = d.heading;
    this.rider.set(
      this.body.position.x + Math.cos(h) * side + Math.sin(h) * ahead,
      this.body.position.y,
      this.body.position.z - Math.sin(h) * side + Math.cos(h) * ahead,
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

  remountAt(track: Track, heading: number, clock = 0) {
    this.dynamics.state = this.lastState = 'remount';
    this.dynamics.stateClock = clock;
    this.dynamics.heading = heading;
    this.remount.active = false;
    this.writeBody(track, 0);
  }
}

describe('motocross remount simulation continuity', () => {
  it.each([
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ])('caps the complete rider displacement toward direction (%s, %s)', (x, z) => {
    const track = rigTrack('valley-ridge-mx');
    for (const dt of [1 / 60, 1 / 120, 1 / 240]) {
      const bike = new RecoveringBike(0, 'medium', DEFAULT_SETUP, 'sport', MX_450);
      bike.place(track, 35);
      bike.remountAt(track, 0.67);
      const targetX = bike.body.position.x + Math.cos(bike.heading) * 0.55;
      const targetZ = bike.body.position.z - Math.sin(bike.heading) * 0.55;
      const soil = surfaceSample();
      track.sample(targetX, targetZ, soil, bike.body.position.y);
      const targetY = soil.height + MX_RECOVERY.uprightHeight;
      // This case requests a purely planar stride. Height-offset strides
      // use the same 4 m/s XYZ bound in the remount-handoff regression.
      bike.rider.set(targetX - x * 2, targetY, targetZ - z * 2);
      const before = { x: bike.rider.x, z: bike.rider.z };
      bike.updateRecovery(dt, track);
      const dx = bike.rider.x - before.x,
        dz = bike.rider.z - before.z;
      expect(Math.hypot(dx, dz)).toBeCloseTo(BIKE_RECOVERY.jogSpeed * dt, 10);
      expect(dx * z - dz * x).toBeCloseTo(0, 10);
      expect(dx * x + dz * z).toBeGreaterThan(0);
      // The last fraction of a stride lands on the target without overshooting.
      bike.rider.set(targetX - x * 1e-5, targetY, targetZ - z * 1e-5);
      bike.updateRecovery(dt, track);
      expect(bike.rider.x).toBeCloseTo(targetX, 10);
      expect(bike.rider.z).toBeCloseTo(targetZ, 10);
    }
  });

  it.each([1, -1])(
    'turns through the %s pi seam by the short arc and holds a zero-duration sample',
    (sign) => {
      const track = rigTrack('valley-ridge-mx');
      const bike = new RecoveringBike(0, 'medium', DEFAULT_SETUP, 'sport', MX_450);
      bike.place(track, 35);
      bike.remountAt(track, sign * (-Math.PI + 0.06));
      bike.rider.copy(bike.body.position);
      bike.riderHeading = sign * (Math.PI - 0.04);
      const initial = bike.riderHeading,
        dt = 1 / 240;
      for (let i = 0; i < 8; i++) {
        const previous = bike.riderHeading;
        bike.updateRecovery(dt, track);
        expect(Math.abs(bike.riderHeading - previous)).toBeLessThanOrEqual(4 * dt + 1e-12);
        expect(sign * (bike.riderHeading - previous)).toBeGreaterThanOrEqual(-1e-12);
      }
      expect(bike.riderHeading - initial).toBeCloseTo(sign * 0.1, 10);
      expect(angle(bike.riderHeading, bike.heading)).toBeCloseTo(0, 10);
      const before = [bike.rider.x, bike.rider.z, bike.riderHeading, bike.riderTumble];
      bike.updateRecovery(0, track);
      expect([bike.rider.x, bike.rider.z, bike.riderHeading, bike.riderTumble]).toEqual(before);
    },
  );

  it.each([
    ['front', 0, 2],
    ['rear', 0, -2],
    ['left', 2, 0],
    ['right', -2, 0],
  ] as const)(
    'keeps every turn bounded from a natural %s approach through riding',
    (_, side, ahead) => {
      for (const definition of [MX_450, MX_250]) {
        const track = rigTrack('valley-ridge-mx');
        const bike = new RecoveringBike(0, 'medium', DEFAULT_SETUP, 'sport', definition);
        bike.place(track, 35);
        bike.separated(track, side, ahead);
        const dt = 1 / 240;
        let entered = false,
          completed = false,
          elapsed = 0,
          remountTime = 0;
        for (; elapsed < BIKE_RECOVERY.maxJog + BIKE_RECOVERY.maxPush; elapsed += dt) {
          const beforeHeading = bike.riderHeading;
          const before = { x: bike.rider.x, z: bike.rider.z };
          bike.step(dt, track);
          expect(Math.abs(angle(bike.riderHeading, beforeHeading))).toBeLessThanOrEqual(
            4 * dt + 1e-10,
          );
          if (bike.dynamics.state === 'remount') {
            entered = true;
            remountTime += dt;
            expect(
              Math.hypot(bike.rider.x - before.x, bike.rider.z - before.z),
            ).toBeLessThanOrEqual(BIKE_RECOVERY.jogSpeed * dt + 1e-10);
          }
          if (bike.riding) {
            completed = true;
            expect(angle(bike.riderHeading, bike.heading)).toBeCloseTo(0, 10);
            break;
          }
        }
        expect(entered).toBe(true);
        expect(completed).toBe(true);
        expect(remountTime).toBeLessThanOrEqual(BIKE_RECOVERY.maxPush + 2 * dt);
        expect(elapsed).toBeLessThan(BIKE_RECOVERY.maxJog + BIKE_RECOVERY.maxPush);
      }
    },
  );

  it('finishes the rider turn before a ready bike returns control, without deferring the snap to riding', () => {
    const track = rigTrack('valley-ridge-mx');
    const bike = new RecoveringBike(0, 'medium', DEFAULT_SETUP, 'sport', MX_450);
    bike.place(track, 35);
    bike.remountAt(track, bike.heading, 1.49);
    bike.rider.copy(bike.body.position);
    bike.riderHeading = bike.heading + Math.PI;
    const dt = 1 / 240;
    let time = 0;
    for (; time < 1 && !bike.riding; time += dt) {
      const before = bike.riderHeading;
      bike.step(dt, track);
      expect(Math.abs(angle(bike.riderHeading, before))).toBeLessThanOrEqual(4 * dt + 1e-10);
    }
    expect(bike.riding).toBe(true);
    expect(time).toBeGreaterThan(Math.PI / 4);
    expect(time + 1.49).toBeLessThan(BIKE_RECOVERY.maxPush);
  });

  it('replays the same physical recovery and publishes stable held rider snapshots', () => {
    const track = rigTrack('valley-ridge-mx');
    const recover = () => {
      const bike = new RecoveringBike(0, 'medium', DEFAULT_SETUP, 'sport', MX_450);
      bike.place(track, 35);
      bike.separated(track, -2, 2);
      const poses: number[][] = [];
      for (let i = 0; i < 6 * 240 && !bike.riding; i++) {
        bike.step(1 / 240, track);
        const block = new Float32Array(BIKE_STRIDE),
          held = new Float32Array(BIKE_STRIDE);
        writeBikeBlock(block, 0, bike);
        writeBikeBlock(held, 0, bike);
        expect(held).toEqual(block);
        poses.push([
          block[B.STATE],
          block[B.RIDER_X],
          block[B.RIDER_Y],
          block[B.RIDER_Z],
          block[B.RIDER_HEADING],
          block[B.RIDER_TUMBLE],
        ]);
      }
      expect(bike.riding).toBe(true);
      return poses;
    };
    expect(recover()).toEqual(recover());
  });

  it('selects the stranded policy after the real BARN DOUBLE approach timeout', () => {
    const track = rigTrack('valley-ridge-mx');
    const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', MX_450);
    const jump = offroadCourse(track.circuit)!.jumps.find(
      (feature) => feature.name === 'BARN DOUBLE',
    )!;
    const rim = bike.bikeSpec.cgToFront + bike.bikeSpec.frontWheelRadius;
    bike.place(track, jump.start - rim - 0.12, -2.5);
    bike.step(1 / 240, track);
    const before = bike.s;
    bike.restart(track);
    expect(bike.riding).toBe(true);
    expect(Math.abs(bike.s - before)).toBeLessThan(0.02);
    bike.input.throttle = 1;
    for (let i = 0; i < BIKE_RECOVERY.stuckSeconds * 120 - 1; i++)
      expect(bike.recoverIfUpset(1 / 120, track)).toBe(false);
    expect(bike.recoverIfUpset(2 / 120, track)).toBe(true);
    expect(bike.dynamics.state).toBe('remount');
    const deadline = bike.remountBudgetSeconds;
    for (let i = 0; i < Math.ceil(deadline * 120) + 8 && !bike.riding; i++) {
      const { x, y, z } = bike.rider;
      bike.step(1 / 120, track);
      expect(Math.hypot(bike.rider.x - x, bike.rider.y - y, bike.rider.z - z)).toBeLessThanOrEqual(
        4 / 120 + 1e-8,
      );
    }
    expect(bike.riding).toBe(true);
    expect(bike.s).toBeGreaterThan(jump.end);
    expect(bike.dynamics.crashes).toBe(0);
  });

  it('recovers a physically stalled BARN DOUBLE player through the normal world caller', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      weather: 'rain',
      circuit: 'valley-ridge-mx',
      opponents: 0,
      vehicles: ['mx450'],
      seed: 41003,
    });
    for (let i = 0; i < 6 * 120; i++) sim.step(1 / 120);
    const bike = sim.cars[0] as DirtBikeVehicle;
    const jump = offroadCourse(sim.track.circuit)!.jumps.find(
      (feature) => feature.name === 'BARN DOUBLE',
    )!;
    bike.place(sim.track, 315.4, -1.52);
    bike.gear = 2;
    sim.setInput({ ...controls(), throttle: 1 });
    let firstRemount = -1,
      stoppedTime = 0,
      largestStep = 0,
      deadline = BIKE_RECOVERY.stuckSeconds + BIKE_RECOVERY.maxPush + 1;
    for (let i = 0; i < Math.ceil(deadline * 120); i++) {
      const before = bike.s;
      const { x, y, z } = bike.rider;
      sim.step(1 / 120);
      largestStep = Math.max(largestStep, Math.abs(bike.s - before));
      if (firstRemount < 0 && bike.dynamics.state === 'remount') {
        firstRemount = (i + 1) / 120;
        deadline = firstRemount + bike.remountBudgetSeconds + 8 / 120;
      }
      if (firstRemount >= 0)
        expect(
          Math.hypot(bike.rider.x - x, bike.rider.y - y, bike.rider.z - z),
        ).toBeLessThanOrEqual(4 / 120 + 1e-8);
      if (firstRemount < 0 && bike.dynamics.speed <= 0.5) stoppedTime += 1 / 120;
      if (firstRemount >= 0 && bike.riding && bike.s > jump.end) break;
    }
    expect(sim.autoPlayer).toBe(false);
    expect(stoppedTime).toBeGreaterThan(BIKE_RECOVERY.stuckSeconds - 0.05);
    expect(firstRemount).toBeGreaterThanOrEqual(BIKE_RECOVERY.stuckSeconds - 1 / 120);
    expect(firstRemount).toBeLessThan(BIKE_RECOVERY.stuckSeconds + 0.05);
    expect(bike.riding).toBe(true);
    expect(bike.s).toBeGreaterThan(jump.end);
    expect(largestStep).toBeLessThan(0.12);
    expect(bike.dynamics.crashes).toBe(0);
  });
});
