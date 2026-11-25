import { describe, expect, it } from 'vitest';
import { controls, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/ai.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import {
  DirtBikeVehicle,
  type LandingRecord,
} from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine, rigBike, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { trackPoint, type Track } from '../src/simulation/track.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;

/** Read the actual settlement boundary; no private state or solver method
 * is written or invoked to manufacture a landing or a recovery. */
function contactState(bike: DirtBikeVehicle) {
  return bike as unknown as {
    pendingLanding: LandingRecord | null;
    settleTime: number;
    bottomPeak: number;
    frontLight: number;
    noseTorque: number;
    predictClock: number;
    written: Pick<DirtBikeVehicle['body'], 'position' | 'velocity' | 'omega'>;
  };
}

/** Overshoot the surveyed triple with production controls and terrain.
 * Stop after its real bottoming stroke, one tick before the pending
 * judgement turns this still-riding motorcycle into a flat-landing crash. */
function pendingHardLanding(definition: VehicleDefinition) {
  const track = rigTrack('valley-ridge-mx'),
    jump = offroadCourse(track.circuit)!.jumps.find((j) => j.name === 'SKY TRIPLE')!,
    speed = jumpHoldSpeed(jump) + 2.6,
    bike = rigBike(definition, track, jump.start - 12, speed);
  for (let i = 0; i < 6 / DT; i++) {
    if (!bike.airborne) {
      const face = bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1;
      rideLine(bike, track, face ? Math.max(speed, bike.dynamics.speed) : speed);
    }
    bike.step(DT, track);
    const pending = contactState(bike).pendingLanding;
    if (pending && pending.bottomSpeed > bike.air.bottomOutSpeed && bike.riding) {
      expect(pending).toBe(bike.lastLanding);
      expect(pending.airTime).toBeGreaterThan(1);
      expect(pending.normalSpeed).toBeGreaterThan(8);
      expect(pending.outcome).toBe('clean');
      expect(contactState(bike).settleTime).toBeGreaterThan(0);
      expect(bike.machineMotion!.valid).toBe(true);
      expect(Math.abs(bike.machineMotion!.forkRate)).toBeGreaterThan(1);
      return { bike, track };
    }
    if (!bike.riding) break;
  }
  throw new Error(`${definition.id} did not reach the surveyed triple's pending bottom-out verdict`);
}

function history(bike: DirtBikeVehicle) {
  return {
    lastLanding: bike.lastLanding,
    record: bike.lastLanding && { ...bike.lastLanding },
    landings: bike.landings,
    crashes: bike.dynamics.crashes,
    causes: bike.crashCauses.map((cause) => ({ ...cause })),
    clock: bike.clock,
  };
}

function expectHistory(bike: DirtBikeVehicle, saved: ReturnType<typeof history>) {
  expect(bike.lastLanding).toBe(saved.lastLanding);
  expect(bike.lastLanding).toEqual(saved.record);
  expect(bike.landings).toBe(saved.landings);
  expect(bike.dynamics.crashes).toBe(saved.crashes);
  expect(bike.crashCauses).toEqual(saved.causes);
}

function expectPublishedContact(bike: DirtBikeVehicle) {
  const state = contactState(bike);
  expect(state.written.position).toEqual(bike.body.position);
  expect(state.written.velocity).toEqual(bike.body.velocity);
  expect(state.written.omega).toEqual(bike.body.omega);
  expect(bike.body.omega.length()).toBe(0);
  expect(bike.body.angularAcceleration.length()).toBe(0);
  for (let i = 0; i < 4; i++) {
    const tire = bike.tires[i],
      front = i < 2;
    expect(tire.omega).toBe(front ? bike.frontSpin : bike.rearSpin);
    expect(tire.compression).toBe(front ? bike.fork : bike.shock);
    expect(tire.load).toBe(bike.riding ? (front ? bike.forceFront : bike.forceRear) : 0);
    expect(tire.fx).toBe(0);
    expect(tire.fy).toBe(0);
    expect(tire.slip).toBe(0);
  }
}

const boundaries = ['place', 'placeFree', 'restart', 'assisted-remount'] as const;

function resetAt(bike: DirtBikeVehicle, track: Track, boundary: typeof boundaries[number]) {
  if (boundary === 'place') bike.place(track, 120);
  else if (boundary === 'placeFree') {
    const point = trackPoint();
    track.at(120, point);
    bike.placeFree(track, point.x, point.z, Math.atan2(point.tx, point.tz), point.y);
  } else bike.restart(track, boundary === 'assisted-remount' ? 'wrong-way' : 'rider');
}

describe.each([MX_250, MX_450])('$id contact lifecycle', (definition) => {
  it('proves the natural pending bottom-out would crash on the very next tick', () => {
    const { bike, track } = pendingHardLanding(definition),
      saved = history(bike);
    bike.step(DT, track);
    expect(bike.riding).toBe(false);
    expect(bike.dynamics.crashes).toBe(saved.crashes + 1);
    expect(bike.lastLanding).toBe(saved.lastLanding);
    expect(bike.lastLanding!.outcome).toBe('crash-flat');
    expect(bike.crashCauses.at(-1)!.cause).toBe('crash-flat');
  });

  it.each(boundaries)('%s invalidates the pending verdict and synchronizes motion immediately', (boundary) => {
    const { bike, track } = pendingHardLanding(definition),
      saved = history(bike),
      stance = [bike.standing, bike.dab, bike.riderBody],
      posture = bike.postureMotion!,
      rotations = bike.tires.map((tire) => [tire.rotation, tire.turns]),
      temperatures = bike.tires.map((tire) => [
        tire.surfaceTemp, tire.carcassTemp, tire.coreTemp, tire.discTemp,
      ]);
    Object.assign(bike.input, controls());
    resetAt(bike, track, boundary);

    const state = contactState(bike);
    expect(state.pendingLanding).toBeNull();
    expect(state.settleTime).toBe(0);
    expect(state.bottomPeak).toBe(0);
    expect(state.frontLight).toBe(0);
    expect(state.noseTorque).toBe(0);
    expect(state.predictClock).toBe(0);
    expect(bike.bottom).toBe(0);
    expect(bike.landingTarget).toBe(bike.groundPitch);
    expect(bike.landingIn).toBe(0.6);
    expect(bike.airborne).toBe(false);
    expect(bike.airTime).toBe(0);
    expect([bike.vy, bike.pitchRate, bike.airYaw, bike.airYawRate]).toEqual([0, 0, 0, 0]);
    expect([bike.standing, bike.dab, bike.riderBody]).toEqual(stance);
    expect([posture.standingRate, posture.dabRate, posture.bodyRate]).toEqual([0, 0, 0]);
    expect(bike.machineMotion!.valid).toBe(false);
    expect([
      bike.machineMotion!.forkRate, bike.machineMotion!.shockRate,
      bike.machineMotion!.front.position, bike.machineMotion!.front.rate,
      bike.machineMotion!.rear.position, bike.machineMotion!.rear.rate,
    ]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(bike.clock).toBe(saved.clock);
    expectHistory(bike, saved);
    expectPublishedContact(bike);
    expect(bike.tires.map((tire) => [tire.rotation, tire.turns])).toEqual(rotations);
    expect(bike.tires.map((tire) => [
      tire.surfaceTemp, tire.carcassTemp, tire.coreTemp, tire.discTemp,
    ])).toEqual(temperatures);

    // Run beyond the abandoned quarter-second judgement window. Neither
    // the former fatal record nor the old bottoming pulse may be consumed.
    for (let i = 0; i < 0.3 / DT; i++) bike.step(DT, track);
    expectHistory(bike, saved);
    expect(bike.bottom).toBe(0);
    expect(bike.clock).toBeCloseTo(saved.clock + 0.3, 10);
    expect(bike.dynamics.state).toBe(boundary === 'assisted-remount' ? 'remount' : 'riding');
  });

  it('starts resumed riding from the stopped remount wheels while retaining crash history', () => {
    const { bike, track } = pendingHardLanding(definition);
    bike.aiControlled(0);
    Object.assign(bike.input, controls());
    bike.step(DT, track);
    expect(bike.lastLanding!.outcome).toBe('crash-flat');
    const saved = history(bike),
      seen = new Set([bike.dynamics.state]);
    expect(saved.landings).toBeGreaterThan(0);
    expect(saved.crashes).toBeGreaterThan(0);
    expect(saved.causes).toHaveLength(saved.crashes);

    let resumed = false;
    for (let i = 0; i < 30 / DT; i++) {
      const previous = bike.dynamics.state,
        omega = [bike.tires[0].omega, bike.tires[2].omega];
      bike.step(DT, track);
      seen.add(bike.dynamics.state);
      if (previous !== 'remount' || !bike.riding) continue;
      expect(omega).toEqual([0, 0]);
      expect(bike.dynamics.speed).toBe(0);
      expect([bike.frontSpin, bike.rearSpin]).toEqual([0, 0]);
      expect([bike.tires[0].omega, bike.tires[2].omega]).toEqual(omega);
      expect(contactState(bike).pendingLanding).toBeNull();
      expect(contactState(bike).settleTime).toBe(0);
      expect(contactState(bike).bottomPeak).toBe(0);
      expect(bike.landingTarget).toBe(bike.groundPitch);
      expect(bike.landingIn).toBe(0.6);
      expectHistory(bike, saved);
      expectPublishedContact(bike);
      resumed = true;
      break;
    }
    expect(resumed).toBe(true);
    expect([...seen]).toEqual(['lowside', 'separated', 'remount', 'riding']);

    // Placement after a completed crash is also a contact boundary, not a
    // new lifetime: preserve a nonzero crash count and its original record.
    for (const boundary of ['place', 'placeFree'] as const) {
      const clock = bike.clock;
      resetAt(bike, track, boundary);
      expectHistory(bike, saved);
      expect(bike.clock).toBe(clock);
    }
  });
});

it('does not carry a real wheelie age or drive pitch torque into a fresh placement', () => {
  const track = rigTrack('valley-ridge-mx'),
    course = offroadCourse(track.circuit)!,
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', MX_450);
  bike.place(track, course.spec.gate!.s - 1.5);
  bike.gear = 1;
  for (let i = 0; i < 3 / DT && bike.riding; i++) {
    bike.input.throttle = 1;
    bike.input.steer = Math.max(-1, Math.min(1, -bike.lateral * 0.08));
    bike.step(DT, track);
    if (contactState(bike).frontLight > 0.3 && contactState(bike).noseTorque > 0) break;
  }
  expect(bike.riding).toBe(true);
  expect(contactState(bike).frontLight).toBeGreaterThan(0.3);
  expect(contactState(bike).noseTorque).toBeGreaterThan(0);
  expect(bike.forceFront).toBe(0);
  Object.assign(bike.input, controls());
  bike.place(track, 120);
  expect(contactState(bike).frontLight).toBe(0);
  expect(contactState(bike).noseTorque).toBe(0);
  expect(bike.forceFront).toBeGreaterThan(0);
  for (let i = 0; i < 0.3 / DT; i++) bike.step(DT, track);
  expect(bike.dynamics.crashes).toBe(0);
  expect(bike.riding).toBe(true);
});
