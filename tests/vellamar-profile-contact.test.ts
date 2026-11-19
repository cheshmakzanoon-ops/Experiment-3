import { describe, expect, it } from 'vitest';
import { Vec3, mod } from '../src/core/math.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { GP_R1 } from '../src/simulation/bike-definitions.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { VELLAMAR, periodicProfile } from '../src/simulation/circuits.ts';
import { Track, surfaceSample, trackPoint } from '../src/simulation/track.ts';

const authoredLength = 3997;
const elevationKnots = [
  [0, 2],
  [700, 2],
  [900, 2.5],
  [1080, 4],
  [1260, 12],
  [1370, 18],
  [1500, 26],
  [1750, 36],
  [2100, 41],
  [2500, 45],
  [2900, 44],
  [3000, 43.5],
  [3200, 32],
  [3400, 20],
  [3620, 8],
  [3747, 2.6],
  [3860, 2],
] as const;
const bankKnots = [
  [0, 0],
  [1600, 0],
  [1700, 14],
  [1810, 14],
  [1900, 0],
  [3300, 0],
  [3400, 22],
  [3590, 22],
  [3680, 0],
] as const;

describe('Vellamar profiles share station-aware knot slopes', () => {
  it('retains every authored elevation and bank knot and the periodic seam', () => {
    for (const [station, height] of elevationKnots) {
      const u = station / authoredLength;
      expect(VELLAMAR.elevation(u, false)).toBeCloseTo(height, 12);
      expect(VELLAMAR.elevation(u + 1, false)).toBeCloseTo(height, 12);
      expect(VELLAMAR.elevation(u - 1, false)).toBeCloseTo(height, 12);
      expect(VELLAMAR.elevation(u, true)).toBe(0);
    }
    for (const [station, gain] of bankKnots)
      expect(VELLAMAR.bankGain(station / authoredLength)).toBeCloseTo(gain, 12);
  });

  it('has the same one-sided road grade at every nonuniform elevation knot', () => {
    const epsilon = 1e-8;
    for (const [station] of elevationKnots) {
      const u = station / authoredLength,
        y = VELLAMAR.elevation(u, false),
        left = (y - VELLAMAR.elevation(u - epsilon, false)) / epsilon / authoredLength,
        right = (VELLAMAR.elevation(u + epsilon, false) - y) / epsilon / authoredLength;
      expect(Math.abs(left - right), `station ${station}`).toBeLessThan(1e-6);
    }
  });

  it('shares derivatives across the raw bank profile, including its wrapped interval', () => {
    const profile = periodicProfile(bankKnots.map(([s, y]) => [s / authoredLength, y] as const));
    const epsilon = 1e-8;
    for (const [station] of bankKnots) {
      const u = station / authoredLength,
        y = profile(u),
        left = (y - profile(u - epsilon)) / epsilon / authoredLength,
        right = (profile(u + epsilon) - y) / epsilon / authoredLength;
      expect(Math.abs(left - right), `station ${station}`).toBeLessThan(1e-6);
    }
    // The definition retains its existing nonnegative gain policy separately.
    for (let i = 0; i < 1000; i++) expect(VELLAMAR.bankGain(i / 1000)).toBeGreaterThanOrEqual(0);
  });

  it('retains uniform Catmull-Rom interpolation when station intervals are equal', () => {
    const values = [1, -2, 4, 0.5],
      profile = periodicProfile(values.map((v, i) => [i / 4, v] as const));
    for (let u = -1.05; u < 2.05; u += 0.031) {
      const x = mod(u, 1) * 4,
        i = Math.floor(x),
        t = x - i,
        a = values[mod(i - 1, 4)],
        b = values[i],
        c = values[(i + 1) % 4],
        d = values[(i + 2) % 4],
        original =
          0.5 *
          (2 * b +
            (-a + c) * t +
            (2 * a - 5 * b + 4 * c - d) * t * t +
            (-a + 3 * b - 3 * c + d) * t * t * t);
      expect(profile(u)).toBeCloseTo(original, 12);
    }
  });
});

describe('real Vellamar contact ribbon through the descending profile knot', () => {
  const track = new Track('clear', false, undefined, VELLAMAR);
  it.each([
    [0, 40],
    [0, 55],
    [0, 60],
    [-2.2, 40],
    [-2.2, 55],
    [-2.2, 60],
  ])('keeps actual sprung contacts supported at offset %s m and speed %s m/s', (lateral, speed) => {
    const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', GP_R1),
      suspension = bike.roadSuspension,
      b = bike.bikeSpec,
      dt = 1 / 240,
      origin = new Vec3(),
      down = new Vec3(0, -1, 0),
      point = trackPoint(),
      surface = surfaceSample();
    // Prescribed traversal isolates the geometry/spring contract from the
    // AI and planar controller. Every height is from the actual owned BVH.
    const sample = (station: number) => {
      track.at(station, point);
      const x = point.x + point.nx * lateral,
        z = point.z + point.nz * lateral;
      const wheel = (arm: number) => {
        origin.set(x + point.tx * arm, point.y + 2, z + point.tz * arm);
        expect(Number.isFinite(track.cast(origin, down, 4, surface))).toBe(true);
        expect(surface.height).toBeGreaterThan(0);
        return surface.height;
      };
      return {
        front: wheel(b.cgToFront),
        rear: wheel(-b.cgToRear),
        metric: 1 - point.curvature * lateral,
      };
    };
    let station = 3500,
      current = sample(station),
      next = sample(station + (speed * dt) / current.metric);
    const velocity =
      ((next.front - current.front) * b.cgToRear + (next.rear - current.rear) * b.cgToFront) /
      (b.cgToFront + b.cgToRear) /
      dt;
    suspension.reset(current.front, current.rear, b.cgHeight, velocity);
    let checked = 0;
    while (station < 3660) {
      const distance = (speed * dt) / current.metric;
      next = sample(station + distance);
      suspension.step(
        {
          mass: bike.body.mass,
          rideHeight: b.cgHeight,
          frontHeight: current.front,
          rearHeight: current.rear,
          nextFrontHeight: next.front,
          nextRearHeight: next.rear,
          frontForce: 0,
          rearForce: 0,
          cgHeight: b.cgHeight,
          downforce: b.downforce * speed * speed,
          downforceFront: b.downforceFront,
        },
        dt,
      );
      if (station > 3605 && station < 3640) {
        checked++;
        expect(Number.isFinite(suspension.height)).toBe(true);
        expect(Number.isFinite(suspension.velocity)).toBe(true);
        expect(suspension.frontLoad + suspension.rearLoad).toBeGreaterThan(0);
        expect(suspension.airborne).toBe(false);
      }
      station += distance;
      current = next;
    }
    expect(checked).toBeGreaterThan(100);
  });
});
