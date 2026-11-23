import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { clamp } from '../src/core/math.ts';
import { inStandFootprint } from '../src/rendering/grandstand.ts';
import { trackInfrastructurePlan } from '../src/rendering/track-infrastructure.ts';
import { tracksideRigs } from '../src/rendering/trackside.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

/** Intersect a camera-to-tyre ray with the surveyed fence crown in XZ.
 * Interpolate both actual heights at that crossing. */
function verticalClearance(lens: Vector3, tyre: Vector3, a: Vector3, b: Vector3) {
  const rx = tyre.x - lens.x,
    rz = tyre.z - lens.z,
    sx = b.x - a.x,
    sz = b.z - a.z;
  const det = rx * sz - rz * sx;
  if (Math.abs(det) < 1e-8) return;
  const ax = a.x - lens.x,
    az = a.z - lens.z;
  const t = (ax * sz - az * sx) / det,
    u = (ax * rz - az * rx) / det;
  if (t <= 0 || t >= 1 || u < 0 || u > 1) return;
  return lens.y + t * (tyre.y - lens.y) - a.y - u * (b.y - a.y);
}

describe('GP grid camera sightline to the racing surface', () => {
  it.each(['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const)(
    '%s sees the tyres across the start straight above the surveyed catch fence',
    (id) => {
      const track = new Track('clear', false, undefined, CIRCUITS[id]);
      const lens = tracksideRigs(track)[0].position,
        side = -track.pit.side;
      const platform = trackInfrastructurePlan(track).cameras.find((camera) => camera.rigId === 0)!;
      expect([platform.x, platform.cameraY, platform.z]).toEqual(lens.toArray());
      expect(platform.supported).toBe(true);
      const p = trackPoint(),
        fence: Vector3[] = [];
      const lateral = track.nearest(lens.x, lens.z, p);
      expect(lateral * side).toBeGreaterThan(track.boundaryAt(p, side) + 1);
      expect(inStandFootprint(track, lens.x, lens.z, 0.7)).toBe(false);
      // Half-size samples resolve the four-metre panels' inward-leaning top.
      for (let s = -142; s <= 142; s += 2) {
        track.at(s, p);
        const lip = side * (track.boundaryAt(p, side) - 0.2);
        fence.push(
          new Vector3(p.x + p.nx * lip, p.y + p.bank * clamp(lip, -12, 12) + 4.5, p.z + p.nz * lip),
        );
      }
      let rays = 0,
        minGap = Infinity;
      for (let s = -112; s <= 112; s += 4) {
        track.at(s, p);
        for (const fraction of [-0.84, 0, 0.84]) {
          const l = p.width * fraction;
          const tyre = new Vector3(p.x + p.nx * l, p.y + p.bank * l + 0.13, p.z + p.nz * l);
          const crossings = [];
          for (let i = 1; i < fence.length; i++) {
            const gap = verticalClearance(lens, tyre, fence[i - 1], fence[i]);
            if (gap !== undefined) crossings.push(gap);
          }
          expect(crossings.length).toBeGreaterThan(0);
          minGap = Math.min(minGap, ...crossings);
          rays++;
        }
      }
      expect(rays).toBe(171);
      expect(minGap).toBeGreaterThan(1.5);
    },
  );
});
