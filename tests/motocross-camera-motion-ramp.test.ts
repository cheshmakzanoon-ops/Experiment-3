import { describe, expect, it } from 'vitest';
import {
  MOTOCROSS_CHASE,
  MotocrossChaseCamera,
  type MotocrossCameraFrame,
} from '../src/rendering/offroad/chase-camera.ts';
import type { Track } from '../src/simulation/track.ts';

const rates = [30, 60, 120, 144, 240];
const cgHeight = 0.86;

function terrain(height: (z: number) => number, slope: (z: number) => number = () => 0):
  Pick<Track, 'at' | 'sample'> {
  return {
    at(s, out) {
      Object.assign(out, { x: 0, y: height(s), z: s, s, tx: 0, tz: 1, nx: 1, nz: 0, width: 5 });
      return out;
    },
    sample(x, z, out) {
      out.height = height(z);
      out.normal.set(0, 1, -slope(z)).normalize();
      out.s = z;
      out.lateral = x;
      return out;
    },
  };
}

const flat = terrain(() => 0);
const approach = (grade = 0.25) => terrain(
  (z) => grade * Math.max(0, z - 7), (z) => z > 7 ? grade : 0,
);
const frame = (over: Partial<MotocrossCameraFrame> = {}): MotocrossCameraFrame => ({
  anchor: { x: 0, y: cgHeight, z: 0 }, heading: 0, s: 0, speed: 6, cgHeight,
  lean: 0, airborne: false, airTime: 0, landingSpeed: 0, bottom: 0, motion: 1, ...over,
});
const roll = (rig: MotocrossChaseCamera, heading = 0) => Math.atan2(
  rig.up.x * Math.cos(heading) - rig.up.z * Math.sin(heading), rig.up.y,
);
const rampResponse = (rate: number, duration: number, lag: number) =>
  rate * (duration - lag * (1 - Math.exp(-duration / lag)));

describe('motocross camera measured motion ramps', () => {
  it.each([-0.35, 0.35])(
    'follows a continuous %f rad/s lean with the analytical lag at every refresh rate',
    (leanRate) => {
      const expected = rampResponse(leanRate * 0.12, 1, 0.14);
      for (const hz of rates) {
        const f = frame(), rig = new MotocrossChaseCamera().update(0, flat, f);
        for (let tick = 1; tick <= hz; tick++) {
          f.lean = leanRate * tick / hz;
          rig.update(1 / hz, flat, f);
        }
        expect(Math.abs(roll(rig) - expected), `${hz} Hz`).toBeLessThan(1e-12);
      }
    },
  );

  it.each([-0.14, 0.25])(
    'looks into a physical %f grade with the analytical terrain-height lag',
    (grade) => {
      const track = approach(grade);
      for (const hz of rates) {
        const f = frame(), rig = new MotocrossChaseCamera().update(0, track, f);
        const initial = rig.gaze.y;
        for (let tick = 1; tick <= hz; tick++) {
          // The bike is still on level ground while the gaze advances along
          // the slope ahead. Its measured terrain target is exactly linear.
          f.anchor.z = f.s = f.speed * tick / hz;
          rig.update(1 / hz, track, f);
        }
        const expected = initial + rampResponse(grade * f.speed * 0.35, 1, 0.16);
        expect(Math.abs(rig.gaze.y - expected), `${hz} Hz`).toBeLessThan(1e-12);
      }
    },
  );

  it('retains the analytical lag through a continuous lean reversal', () => {
    const lag = 0.14, motion = 0.35;
    let expected = 0, previous = 0;
    for (const [duration, leanRate] of [[0.5, 0.8], [1, -0.8], [0.5, 0.8]]) {
      expected = previous + (expected - previous) * Math.exp(-duration / lag) +
        rampResponse(leanRate * 0.12 * motion, duration, lag);
      previous += leanRate * 0.12 * motion * duration;
    }
    for (const hz of rates) {
      const f = frame({ motion }), rig = new MotocrossChaseCamera().update(0, flat, f);
      for (let tick = 1; tick <= 2 * hz; tick++) {
        const time = tick / hz;
        f.lean = time <= 0.5 ? 0.8 * time : time <= 1.5 ? 0.8 - 0.8 * time : 0.8 * time - 1.6;
        rig.update(1 / hz, flat, f);
      }
      expect(Math.abs(roll(rig) - expected), `${hz} Hz`).toBeLessThan(1e-12);
    }
  });

  it('converges to the continuous sinusoidal lean response as samples become denser', () => {
    const angularRate = 1.5 * Math.PI, lag = 0.14, ratio = angularRate * lag;
    const expected = 0.3 * 0.12 / (1 + ratio * ratio) * (
      Math.sin(angularRate) - ratio * Math.cos(angularRate) + ratio * Math.exp(-1 / lag)
    );
    const errors = rates.map((hz) => {
      const f = frame(), rig = new MotocrossChaseCamera().update(0, flat, f);
      for (let tick = 1; tick <= hz; tick++) {
        f.lean = 0.3 * Math.sin(angularRate * tick / hz);
        rig.update(1 / hz, flat, f);
      }
      return Math.abs(roll(rig) - expected);
    });
    expect(errors[0]).toBeLessThan(0.00006);
    // A curved signal has interpolation error; doubling the samples should
    // reduce that error quadratically, not merely hide a first-order lead.
    expect(errors[1]).toBeLessThan(errors[0] * 0.26);
    expect(errors[2]).toBeLessThan(errors[1] * 0.26);
    expect(errors[4]).toBeLessThan(errors[2] * 0.26);
    expect(errors[3]).toBeLessThan(errors[2]);
  });

  it('converges on a curved climb including the existing heave filter and height limit', () => {
    const speed = 15, curvature = 0.006, a = 0.5 * curvature * speed ** 2;
    const track = terrain((z) => 0.5 * curvature * z * z, (z) => curvature * z);
    const tau = MOTOCROSS_CHASE.heaveLag, limit = MOTOCROSS_CHASE.maxHeaveOffset;
    const distance = MOTOCROSS_CHASE.distance + speed * MOTOCROSS_CHASE.distancePerMS;
    const look = MOTOCROSS_CHASE.lookAhead + speed * MOTOCROSS_CHASE.lookPerMS;
    const height = (time: number) => {
      const anchor = cgHeight + a * time * time;
      // Continuous response to the quadratic height of this physical climb.
      const filtered = cgHeight + a * (
        time * time - 2 * tau * time + 2 * tau * tau * (1 - Math.exp(-time / tau))
      );
      return anchor + limit * Math.tanh((filtered - anchor) / limit);
    };
    const target = (time: number) => {
      const ground = 0.5 * curvature * (speed * time + look) ** 2;
      const rise = Math.max(-1.3, Math.min(2.3, ground + cgHeight - height(time)));
      return MOTOCROSS_CHASE.height - (distance + look) * 0.205 + rise * 0.35;
    };
    // Independent Simpson quadrature of the continuous first-order response.
    const divisions = 4096, lag = 0.16;
    let integral = 0;
    for (let i = 0; i <= divisions; i++) {
      const time = i / divisions, weight = i === 0 || i === divisions ? 1 : i % 2 ? 4 : 2;
      integral += weight * Math.exp(-(1 - time) / lag) * target(time) / lag;
    }
    const expected = height(1) + target(0) * Math.exp(-1 / lag) + integral / divisions / 3;
    const errors = rates.map((hz) => {
      const f = frame({ speed }), rig = new MotocrossChaseCamera().update(0, track, f);
      for (let tick = 1; tick <= hz; tick++) {
        const time = tick / hz;
        f.anchor.z = f.s = speed * time;
        f.anchor.y = cgHeight + a * time * time;
        rig.update(1 / hz, track, f);
      }
      return Math.abs(rig.gaze.y - expected);
    });
    expect(errors[0]).toBeLessThan(0.00008);
    expect(errors[1]).toBeLessThan(errors[0] * 0.26);
    expect(errors[2]).toBeLessThan(errors[1] * 0.26);
    expect(errors[4]).toBeLessThan(errors[2] * 0.26);
    expect(errors[3]).toBeLessThan(errors[2]);
  });

  it('keeps the existing step response for unresolved lean and terrain jumps', () => {
    const track = terrain((z) => z >= 9 ? 2 : 0);
    for (const hz of rates) {
      const f = frame(), rig = new MotocrossChaseCamera().update(0, track, f);
      const initial = rig.gaze.y;
      f.lean = 0.4;
      f.anchor.z = f.s = 2;
      const target = new MotocrossChaseCamera().update(0, track, f);
      for (let tick = 1; tick <= hz / 2; tick++) rig.update(1 / hz, track, f);
      expect(roll(rig)).toBeCloseTo(0.4 * 0.12 * (1 - Math.exp(-0.5 / 0.14)), 12);
      expect(rig.gaze.y).toBeCloseTo(
        initial + (target.gaze.y - initial) * (1 - Math.exp(-0.5 / 0.16)), 12,
      );
    }
  });

  it('treats a changed motion setting as a step and immediately clears disabled motion', () => {
    const f = frame({ lean: 0.01, motion: 0.25 });
    const rig = new MotocrossChaseCamera().update(0, flat, f);
    const initial = roll(rig);
    f.motion = 1;
    rig.update(1 / 60, flat, f);
    expect(roll(rig)).toBeCloseTo(initial + (0.0012 - initial) * (1 - Math.exp(-1 / 60 / 0.14)), 14);
    f.motion = 0;
    rig.update(0, flat, f);
    expect(rig.up.toArray()).toEqual([0, 1, -0]);
    f.motion = 1;
    rig.update(1 / 60, flat, f);
    expect(roll(rig)).toBeCloseTo(0.0012 * (1 - Math.exp(-1 / 60 / 0.14)), 14);
  });

  it('retains the step response when a heading snap changes the sampled corridor', () => {
    const track = approach();
    for (const hz of rates) {
      const f = frame(), rig = new MotocrossChaseCamera().update(0, track, f);
      const initial = rig.gaze.y;
      f.heading = 2.5;
      f.lean = 0.01;
      const target = new MotocrossChaseCamera().update(0, track, f);
      rig.update(1 / hz, track, f);
      expect(rig.eye.toArray()).toEqual(target.eye.toArray());
      expect(roll(rig, f.heading)).toBeCloseTo(0.0012 * (1 - Math.exp(-1 / hz / 0.14)), 14);
      expect(rig.gaze.y).toBeCloseTo(
        initial + (target.gaze.y - initial) * (1 - Math.exp(-1 / hz / 0.16)), 14,
      );
    }
  });

  it('does not consume new lean or terrain targets during held presentation time', () => {
    const track = approach(), f = frame();
    const paused = new MotocrossChaseCamera().update(0, track, f);
    const running = new MotocrossChaseCamera().update(0, track, f);
    for (let tick = 1; tick <= 60; tick++) {
      f.lean = 0.35 * tick / 60;
      f.anchor.z = f.s = 6 * tick / 60;
      paused.update(1 / 60, track, f);
      running.update(1 / 60, track, f);
      const heldRoll = paused.up.toArray(), heldGaze = paused.gaze.y;
      paused.update(0, track, {
        ...f, lean: -0.4, motion: 0.2, s: f.s + 1,
        anchor: { ...f.anchor, z: f.anchor.z + 1 },
      });
      expect(paused.up.toArray()).toEqual(heldRoll);
      expect(paused.gaze.y).toBe(heldGaze);
    }
    paused.update(0, track, f);
    expect(paused.up.toArray()).toEqual(running.up.toArray());
    expect(paused.gaze.toArray()).toEqual(running.gaze.toArray());
  });

  it.each([true, false])('preserves the recorded %s air edge on a sloping landing corridor', (takeoff) => {
    const track = approach(), before = 0.060, after = 0.007, flight = 0.6;
    const f = frame({ airborne: !takeoff, airTime: takeoff ? 0 : flight, lean: 0.3,
      landingSpeed: 5, bottom: 0.4, velocityX: 0, velocityZ: 6 });
    const split = new MotocrossChaseCamera().update(0, track, f);
    const skipped = new MotocrossChaseCamera().update(0, track, f);
    const previous = { ...f, airTime: takeoff ? 0 : flight + before };
    const presented = { ...f, airborne: takeoff, airTime: takeoff ? after : previous.airTime };
    split.update(before, track, previous);
    split.update(after, track, presented);
    skipped.update(before + after, track, presented);
    expect(skipped.eye.distanceTo(split.eye)).toBeLessThan(1e-12);
    expect(skipped.gaze.distanceTo(split.gaze)).toBeLessThan(1e-12);
    expect(skipped.up.distanceTo(split.up)).toBeLessThan(1e-12);
  });

  it('reseeds roll and terrain history on reset after an airborne motion setting change', () => {
    const track = approach(), f = frame({ lean: -0.4, motion: 0.25 });
    const rig = new MotocrossChaseCamera().update(0, track, {
      ...f, airborne: true, airTime: 0.7, velocityX: 6, velocityZ: 0,
    });
    rig.update(1 / 30, track, frame({ lean: 0.4, landingSpeed: 5 }));
    rig.reset();
    rig.update(0, track, f);
    const fresh = new MotocrossChaseCamera().update(0, track, f);
    for (let tick = 1; tick <= 144; tick++) {
      f.lean = -0.4 + 0.35 * tick / 144;
      f.anchor.z = f.s = 6 * tick / 144;
      rig.update(1 / 144, track, f);
      fresh.update(1 / 144, track, f);
      expect(rig.up.toArray()).toEqual(fresh.up.toArray());
      expect(rig.gaze.toArray()).toEqual(fresh.gaze.toArray());
    }
  });

  it('keeps tiny positive ramp intervals numerically stable', () => {
    const f = frame(), rig = new MotocrossChaseCamera().update(0, flat, f);
    const dt = 1e-9, rate = 0.35 * 0.12;
    f.lean = 0.35 * dt;
    rig.update(dt, flat, f);
    const leadingTerm = rate * dt * dt / (2 * 0.14);
    expect(Math.abs(roll(rig) / leadingTerm - 1)).toBeLessThan(1e-8);
  });
});
