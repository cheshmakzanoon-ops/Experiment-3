import { Track, trackPoint } from '../simulation/track.ts';
import { grassApronOffset } from './ground-profile.ts';
import { inStandFootprint } from './grandstand.ts';
import { tracksideRigs } from './trackside.ts';
export interface SignalSite {
  s: number;
  side: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}
/** Passive housings at the existing start and two exact split stations.
 * No timing logic, physical barrier or road-surface geometry is changed. */
export function timingSensorPlan(track: Track): readonly SignalSite[] {
  const rigs = tracksideRigs(track),
    sites: SignalSite[] = [];
  for (const [i, s] of [0, track.length / 3, (track.length * 2) / 3].entries()) {
    const p = track.at(s, trackPoint()),
      preferred = i % 2 ? 1 : -1;
    for (const side of [preferred, -preferred]) {
      const lateral = side * (track.boundary(s, side) + 1.45),
        x = p.x + p.nx * lateral,
        z = p.z + p.nz * lateral;
      let clear = true;
      for (const a of [-0.26, 0, 0.26])
        for (const b of [-0.26, 0, 0.26]) {
          const wx = x + p.nx * a + p.tx * b,
            wz = z + p.nz * a + p.tz * b,
            q = trackPoint(),
            l = track.nearest(wx, wz, q);
          if (
            Math.abs(l) - track.boundary(q.s, l < 0 ? -1 : 1) < 1.1 ||
            inStandFootprint(track, wx, wz, 0.4) ||
            rigs.some((r) => Math.hypot(r.position.x - wx, r.position.z - wz) < 2.5)
          )
            clear = false;
        }
      if (!clear) continue;
      const q = trackPoint(),
        l = track.nearest(x, z, q),
        y = q.y + q.bank * Math.max(-12, Math.min(12, l)) + grassApronOffset(track, q.s, l);
      sites.push(Object.freeze({ s, side, x, y, z, yaw: Math.atan2(p.tx, p.tz) }));
      break;
    }
  }
  return Object.freeze(sites);
}
