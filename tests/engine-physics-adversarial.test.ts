import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '../src/core/math.ts';
import { TrackContactMesh } from '../src/simulation/contact.ts';
import { RoadContactFrame } from '../src/simulation/road-contact.ts';
import { Track } from '../src/simulation/track.ts';

describe('contact mesh row domain', () => {
  const track = new Track();

  // Before scalar stores, fractional row counts failed when TypedArray.set
  // crossed the truncated allocation. Indexed stores instead ignored overflow
  // and could return a partial mesh referencing zero-initialized vertices.
  it.each([0.4, 1.4, 7.4, 0, -0, -1, NaN, Infinity, -Infinity])(
    'rejects an incomplete or empty ribbon for %s rows',
    (rows) => {
      expect(() => new TrackContactMesh(track, rows)).toThrowError(
        new RangeError('Contact mesh rows must be a positive integer'),
      );
    },
  );
});

describe('road-frame normal ownership', () => {
  it.each(['normal', 'axle', 'forward', 'lateral'] as const)(
    'accepts its own %s vector as a normal with the same exact result as a copy',
    (member) => {
      const actual = new RoadContactFrame(),
        expected = new RoadContactFrame(),
        initialOrientation = new Quat().yaw(0.37),
        nextOrientation = new Quat().yaw(-0.26);
      for (const frame of [actual, expected])
        frame.set(initialOrientation, 0.21, new Vec3(-0.25, 1, 0.09), -0.05);
      const normal = new Vec3().copy(actual[member]);
      expect(actual.set(nextOrientation, -0.18, actual[member], 0.06)).toBe(
        expected.set(nextOrientation, -0.18, normal, 0.06),
      );
      expect(actual).toStrictEqual(expected);
    },
  );
});
