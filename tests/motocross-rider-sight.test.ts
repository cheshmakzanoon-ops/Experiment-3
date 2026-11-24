import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { angleDifference } from '../src/core/math.ts';
import { gpEyePose } from '../src/rendering/gp-helmet-optics.ts';
import { MotocrossRiderSight } from '../src/rendering/offroad/motocross-rider-sight.ts';
import { motocrossHeadFrame } from '../src/rendering/offroad/motocross-rider-spine.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { relief } from '../src/simulation/offroad/course.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { trackPoint } from '../src/simulation/track.ts';

describe.each(['valley-ridge-mx', 'arena-nord-sx'] as const)('%s riding sight', (venue) => {
  const track = rigTrack(venue),
    course = offroadCourse(track.circuit)!;
  const look = new MotocrossRiderSight(track, course);
  const road = trackPoint(),
    bank = relief();

  it('looks at the actual landing height as the chassis rises, and repeats the same held pose', () => {
    for (const jump of course.jumps) {
      const s = jump.takeoff + 3,
        p = track.at(s, road),
        heading = Math.atan2(p.tx, p.tz);
      const ground = course.groundAt(s, 0, p, bank);
      const at = (lift: number) => ({
        ...look.sample(s, s, 1, 0, 18, heading, ground + 0.56 + lift, 0.56)!,
      });
      const grounded = at(0),
        airborne = at(2);
      expect(airborne.gradeChange).toBeLessThan(grounded.gradeChange - 0.06);
      expect(airborne.yaw).toBe(grounded.yaw);
      expect(at(0)).toEqual(grounded);
    }
  });

  it('looks into a bend with level bars, keeps head and eyes aligned and releases off the course', () => {
    const s = venue === 'valley-ridge-mx' ? 259.25 : 97.25;
    const p = track.at(s, road),
      heading = Math.atan2(p.tx, p.tz);
    const result = look.sample(s, s, 1, 0, 15, heading, p.y + 0.56, 0.56)!;
    const dir = Math.sign(p.curvature);
    expect(result.yaw * dir).toBeGreaterThan(0.4);
    const pose = { lean: 0, offset: 0, tuck: 0, braking: 0, steer: 0, speed: 15, sight: result };
    const chest = new T.Quaternion().setFromEuler(new T.Euler(0.32, -0.11, 0.1));
    const head = motocrossHeadFrame(pose, chest, 0, new T.Quaternion());
    const forward = new T.Vector3(0, 0, 1).applyQuaternion(chest.multiply(head));
    expect(Math.atan2(forward.x, forward.z) * dir).toBeGreaterThan(0.24);
    expect(gpEyePose(new T.Vector3(), 17, 42, result).x * dir).toBeGreaterThan(0.1);
    expect(look.sample(s, s, 1, p.width + 3, 15, heading, p.y, 0.56)).toBeUndefined();
    expect(look.sample(s, s, 1, 0, 15, heading + Math.PI, p.y, 0.56)).toBeUndefined();
    expect(look.sample(s, s, 1, 0, 0, heading, p.y, 0.56)).toBeUndefined();
  });

  it('interpolates across the start line and keeps consecutive gaze directions continuous', () => {
    const p = track.at(0, road),
      heading = Math.atan2(p.tx, p.tz),
      y = p.y + 0.56;
    const wrapped = { ...look.sample(track.length - 1, 1, 0.5, 0, 14, heading, y, 0.56)! };
    const origin = look.sample(0, 0, 1, 0, 14, heading, y, 0.56)!;
    expect(wrapped.yaw).toBeCloseTo(origin.yaw, 12);
    expect(wrapped.gradeChange).toBeCloseTo(origin.gradeChange, 12);
    expect(wrapped.weight).toBe(origin.weight);
    let last: number | undefined,
      largest = 0;
    for (let s = 0; s < track.length; s += 0.25) {
      track.at(s, road);
      const gaze = look.sample(s, s, 1, 0, 15, Math.atan2(road.tx, road.tz), road.y + 0.56, 0.56)!;
      if (last !== undefined)
        largest = Math.max(largest, Math.abs(angleDifference(gaze.yaw, last)));
      last = gaze.yaw;
    }
    expect(largest).toBeLessThan(0.055);
  });
});
