import { expect, it } from 'vitest';
import { clamp, lerp } from '../src/core/math.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { MotocrossLaneIndex } from '../src/simulation/offroad/motocross-lane-index.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

it.each(['arena-nord-sx', 'valley-ridge-mx'] as const)(
  '%s keeps the full centreline search result across jumps, adjacent lanes and grid boundaries',
  (circuit) => {
    const track = new Track('clear', false, undefined, circuitDefinition(circuit));
    const at = trackPoint();
    const observed = trackPoint();
    const index = new MotocrossLaneIndex(track.points);
    const all = Array.from({ length: track.points.length - 1 }, (_, i) => i);
    let searched = 0;
    let retained = 0;
    let warmReads = 0;

    const check = (x: number, z: number, height: number) => {
      const coarse = track.hash.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`);
      const original = coarse ?? all;
      let best = Infinity;
      let station = 0;
      for (const i of original) {
        const a = track.points[i],
          b = track.points[i + 1];
        const dx = b.x - a.x,
          dz = b.z - a.z;
        const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
        const distance = (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2;
        if (distance < best) {
          best = distance;
          station = lerp(a.s, b.s, t);
        }
      }
      track.at(station, at);
      const lateral = (x - at.x) * at.nx + (z - at.z) * at.nz;
      expect(track.nearest(x, z, observed, height)).toBe(lateral);
      expect(observed.s).toBe(at.s);
      if (coarse) {
        const local = index.candidates(x, z, coarse);
        searched += coarse.length;
        retained += local.length;
        if (index.candidates(x, z, coarse) === local) warmReads++;
      }
    };

    for (let i = 0; i < track.points.length; i += 3) {
      const p = track.points[i];
      for (const offset of [-18.1, -p.width, -0.00001, 0, 0.00001, p.width, 20.3])
        check(p.x + offset * p.nx, p.z + offset * p.nz, p.y + 8);
      for (const epsilon of [-1e-7, 0, 1e-7])
        check(4 * Math.floor(p.x / 4) + epsilon, 4 * Math.floor(p.z / 4) - epsilon, p.y);
    }
    check(1e5, -1e5, 100);
    expect(warmReads).toBeGreaterThan(4000);
    expect(retained).toBeLessThan(searched / 2);
  },
);
