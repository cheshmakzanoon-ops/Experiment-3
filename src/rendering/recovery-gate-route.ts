import * as T from 'three';
import { clamp } from '../core/math.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { grassApronOffset } from './ground-profile.ts';
import type { RecoveryGateSite } from './recovery-gate-plan.ts';
export function inRecoveryApproach(
  sites: readonly RecoveryGateSite[],
  x: number,
  z: number,
  padding = 0,
) {
  return sites.some((site) =>
    site.approach.some((b, i, points) => {
      if (!i) return false;
      const a = points[i - 1],
        vx = b.x - a.x,
        vz = b.z - a.z,
        t = clamp(((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz), 0, 1);
      return Math.hypot(x - a.x - t * vx, z - a.z - t * vz) < 1.6 + padding;
    }),
  );
}
export function recoveryApproachGeometry(track: Track, site: RecoveryGateSite) {
  const points = site.approach,
    vertices: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  let distance = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      a = points[Math.max(0, i - 1)],
      b = points[Math.min(points.length - 1, i + 1)],
      dx = b.x - a.x,
      dz = b.z - a.z,
      length = Math.hypot(dx, dz);
    if (i) distance += Math.hypot(p.x - a.x, p.z - a.z);
    for (const side of [-1, 1]) {
      const x = p.x + ((side * dz) / length) * 1.5,
        z = p.z - ((side * dx) / length) * 1.5,
        near = trackPoint(),
        l = track.nearest(x, z, near);
      const ground = near.y + near.bank * clamp(l, -12, 12) + grassApronOffset(track, near.s, l);
      const q = trackPoint(),
        centerL = track.nearest(p.x, p.z, q),
        centerGround =
          q.y + q.bank * clamp(centerL, -12, 12) + grassApronOffset(track, q.s, centerL);
      vertices.push(
        x,
        Math.max(ground + 0.012, p.y + (ground - centerGround) * Math.min(1, i / 3)),
        z,
      );
      uv.push(side < 0 ? 0 : 1, distance / 3);
    }
    if (i + 1 < points.length) {
      const n = i * 2;
      indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
