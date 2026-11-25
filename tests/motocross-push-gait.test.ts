import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MxRecoveryPose } from '../src/rendering/offroad/motocross-recovery.ts';
import { MX_BOOT_PEG } from '../src/rendering/offroad/motocross-rider-contact.ts';
import { Rider } from '../src/rendering/rider.ts';
import { BIKE_STATES } from '../src/simulation/bike.ts';
import { B, BIKE_BASE, CAR_STRIDE, H, HEADER, MX_PUSH, carBase } from '../src/simulation/protocol.ts';
import { rigBike, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { MX_PUSH_STRIDE } from '../src/simulation/offroad/rider-recovery.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { writeWheelContact } from '../src/simulation/wheel-contact-state.ts';

beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_, key) => key === 'measureText' ? () => ({ width: 10 }) : () => undefined,
    set: () => true,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
});
afterAll(() => vi.unstubAllGlobals());

const car = carBase(0), root = car + BIKE_BASE;
const remount = BIKE_STATES.indexOf('remount');
function frame(time: number, x: number, z: number, vx: number, vz: number, phase: number, recorded = true) {
  const f = new Float32Array(HEADER + CAR_STRIDE);
  f[H.TIME] = time;
  f[root + B.STATE_CLOCK] = time;
  f[root + B.STATE] = remount;
  f[root + B.RIDER_X] = x;
  f[root + B.RIDER_Z] = z;
  f[root + B.RIDER_Y] = 0.95;
  if (recorded) {
    f[car + MX_PUSH.RECORDED] = 1;
    f[car + MX_PUSH.VX] = vx;
    f[car + MX_PUSH.VZ] = vz;
    f[car + MX_PUSH.PHASE] = phase;
  }
  return f;
}

describe('motocross rider pushing the bike', () => {
  it('locks a diagonal stance in world space in both new and legacy recordings', () => {
    const actor = new Rider({ primary: 0x682b12, secondary: 0x111111, accent: 0xdddddd }, 'mid', 'motocross');
    const recovery = new MxRecoveryPose(), heading = 0.62;
    const foot = actor.root.getObjectByName('Motocross left boot')!;
    const ground = { planeAtWorld: (_: T.Vector3, out: T.Plane) => { out.setComponents(0, 1, 0, 0); return true; } };
    const point = new T.Vector3(), start = new T.Vector3();
    const vx = 0.65, vz = 1.85, speed = Math.hypot(vx, vz);
    const sample = (clock: number, recorded: boolean) => frame(clock, vx * clock, vz * clock, vx, vz,
      2 * Math.PI * (0.04 + (clock - 0.6) * speed / MX_PUSH_STRIDE), recorded);
    const draw = (a: Float32Array, b: Float32Array, t: number, animated: boolean) => {
      const clock = T.MathUtils.lerp(a[H.TIME], b[H.TIME], t);
      point.set(T.MathUtils.lerp(a[root + B.RIDER_X], b[root + B.RIDER_X], t), 0.95,
        T.MathUtils.lerp(a[root + B.RIDER_Z], b[root + B.RIDER_Z], t));
      const gait = animated ? recovery.pushMotion(a, b, car, t, heading) : undefined;
      recovery.place(actor, point, heading, 'remount', clock, 1, 0, clock, ground, undefined, gait);
      return foot.localToWorld(point.fromArray(MX_BOOT_PEG));
    };
    try {
      for (const recorded of [false, true]) {
        const a = sample(0.62, recorded), b = sample(0.74, recorded);
        start.copy(draw(a, b, 0, false));
        expect(start.distanceTo(draw(a, b, 1, false))).toBeGreaterThan(0.23);
        start.copy(draw(a, b, 0, true));
        for (let i = 1; i <= 24; i++) {
          expect(start.distanceTo(draw(a, b, i / 24, true))).toBeLessThan(1e-6);
          expect(Math.abs(point.y)).toBeLessThan(1e-6);
        }
        if (!recorded) expect(recovery.pushMotion(a, a, car, 0, heading)).toBeUndefined();
      }
      const a = sample(0.62, true), b = sample(0.74, true);
      const c = frame(0.86, 0.35, 1.63, -1.6, 0.4, 3.1);
      const end = draw(a, b, 1, true).toArray();
      expect(draw(b, c, 0, true).toArray()).toEqual(end);
      draw(b, c, 0.8, true);
      expect(draw(b, b, 0.4, true).toArray()).toEqual(end);
      expect(draw(a, b, 1, true).toArray()).toEqual(end);
    } finally { actor.dispose(); }
  });

  it('records measured motion on an assisted restart and clears the optional slots when riding resumes', () => {
    const track = rigTrack('valley-ridge-mx'), jump = offroadCourse(track.circuit)!.jumps[0];
    const bike = rigBike(VEHICLES.mx450, track, jump.takeoff - 0.25, 0);
    bike.step(1 / 240, track);
    bike.restart(track, 'wrong-way');
    const f = new Float32Array(HEADER + CAR_STRIDE);
    let distance = 0, previousX = bike.rider.x, previousZ = bike.rider.z;
    let maxSpeed = 0, lastPhase = 0;
    for (let i = 0; i <= 6 * 240; i++) {
      bike.step(1 / 240, track);
      writeWheelContact(f, car, bike);
      if (bike.dynamics.state !== 'remount') break;
      expect(f[car + MX_PUSH.RECORDED]).toBe(1);
      expect(f[car + MX_PUSH.PHASE]).toBeGreaterThanOrEqual(lastPhase);
      lastPhase = f[car + MX_PUSH.PHASE];
      maxSpeed = Math.max(maxSpeed, Math.hypot(f[car + MX_PUSH.VX], f[car + MX_PUSH.VZ]));
      distance += Math.hypot(bike.rider.x - previousX, bike.rider.z - previousZ);
      previousX = bike.rider.x;
      previousZ = bike.rider.z;
    }
    expect(distance).toBeGreaterThan(10);
    expect(maxSpeed).toBeGreaterThan(2);
    expect(lastPhase).toBeGreaterThan(4 * Math.PI);
    expect(bike.dynamics.state).toBe('riding');
    expect(Array.from(f.subarray(car + MX_PUSH.RECORDED, car + MX_PUSH.PHASE + 1))).toEqual([0, 0, 0, 0]);
  });
});
