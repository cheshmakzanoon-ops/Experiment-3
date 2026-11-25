import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { angleDifference } from '../src/core/math.ts';
import {
  MOTOCROSS_CHASE,
  MotocrossChaseCamera,
  type MotocrossCameraFrame,
} from '../src/rendering/offroad/chase-camera.ts';
import type { Track } from '../src/simulation/track.ts';

const flat: Pick<Track, 'at' | 'sample'> = {
  at(s, out) {
    Object.assign(out, { x: 0, y: 0, z: s, s, tx: 0, tz: 1, nx: 1, nz: 0, width: 5 });
    return out;
  },
  sample(x, z, out) {
    out.height = 0;
    out.normal.set(0, 1, 0);
    out.s = z;
    out.lateral = x;
    return out;
  },
};

function frame(heading = 0): MotocrossCameraFrame {
  return {
    anchor: new Vector3(0, 0.86, 0), heading, s: 0, speed: 15, cgHeight: 0.86,
    lean: 0, airborne: false, airTime: 0, landingSpeed: 0, bottom: 0, motion: 0,
  };
}

const rates = [30, 60, 144, 240];
const bearing = (rig: MotocrossChaseCamera) => Math.atan2(-rig.eye.x, -rig.eye.z);

it.each([0, Math.PI - 0.15, -Math.PI + 0.15])(
  'follows a continuous turn from %f radians with the same physical lag at 30–240 Hz',
  (initial) => {
    const duration = 2, turnRate = initial < 0 ? -0.7 : 0.7;
    const expected = initial + turnRate * (
      duration - MOTOCROSS_CHASE.headingLag * (1 - Math.exp(-duration / MOTOCROSS_CHASE.headingLag))
    );
    const results = rates.map((hz) => {
      const f = frame(initial), rig = new MotocrossChaseCamera().update(0, flat, f);
      for (let tick = 1; tick <= duration * hz; tick++) {
        const heading = initial + turnRate * tick / hz;
        f.heading = Math.atan2(Math.sin(heading), Math.cos(heading));
        rig.update(1 / hz, flat, f);
      }
      expect(Math.abs(angleDifference(bearing(rig), expected))).toBeLessThan(1e-12);
      return rig;
    });
    for (const rig of results.slice(1)) {
      expect(rig.eye.distanceTo(results[0].eye)).toBeLessThan(1e-11);
      expect(rig.gaze.distanceTo(results[0].gaze)).toBeLessThan(1e-11);
    }
  },
);

it('keeps a continuous turn reversal independent of presentation subdivisions', () => {
  const results = rates.map((hz) => {
    const f = frame(), rig = new MotocrossChaseCamera().update(0, flat, f);
    for (let tick = 1; tick <= 2 * hz; tick++) {
      const time = tick / hz;
      f.heading = time <= 1 ? 0.8 * time : 0.8 - 0.8 * (time - 1);
      rig.update(1 / hz, flat, f);
    }
    return rig;
  });
  for (const rig of results.slice(1)) {
    expect(rig.eye.distanceTo(results[0].eye)).toBeLessThan(1e-11);
    expect(rig.gaze.distanceTo(results[0].gaze)).toBeLessThan(1e-11);
  }
  expect(bearing(results[0])).toBeGreaterThan(0);
  expect(bearing(results[0])).toBeLessThan(0.1);
});

it('does not advance the measured target history during held presentation time', () => {
  const paused = new MotocrossChaseCamera(), continuous = new MotocrossChaseCamera();
  const f = frame();
  paused.update(0, flat, f);
  continuous.update(0, flat, f);
  for (let tick = 1; tick <= 60; tick++) {
    f.heading = 0.7 * tick / 60;
    paused.update(1 / 60, flat, f);
    continuous.update(1 / 60, flat, f);
    const held = [paused.eye.toArray(), paused.gaze.toArray(), paused.up.toArray()];
    for (let redraw = 0; redraw < 8; redraw++) paused.update(0, flat, f);
    expect([paused.eye.toArray(), paused.gaze.toArray(), paused.up.toArray()]).toEqual(held);
  }
  expect(paused.eye.toArray()).toEqual(continuous.eye.toArray());
  expect(paused.gaze.toArray()).toEqual(continuous.gaze.toArray());
});

it('clears a prior flight bearing and target history before following a new turn', () => {
  const rig = new MotocrossChaseCamera();
  rig.update(0, flat, {
    ...frame(2.7), airborne: true, airTime: 0.7, velocityX: 18, velocityZ: 0,
  });
  rig.update(1 / 60, flat, frame(-2.5));
  rig.reset();
  const f = frame(-1.2), fresh = new MotocrossChaseCamera().update(0, flat, f);
  rig.update(0, flat, f);
  for (let tick = 1; tick <= 144; tick++) {
    f.heading = -1.2 + 0.7 * tick / 144;
    rig.update(1 / 144, flat, f);
    fresh.update(1 / 144, flat, f);
    expect(rig.eye.toArray()).toEqual(fresh.eye.toArray());
    expect(rig.gaze.toArray()).toEqual(fresh.gaze.toArray());
  }
});
