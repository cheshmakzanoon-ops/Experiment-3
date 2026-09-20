import { clamp } from '../core/math.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { grassApronOffset } from './ground-profile.ts';
import { inStandFootprint } from './grandstand.ts';
import { tracksideRigs } from './trackside.ts';

export const SERVICE_ZONES = Object.freeze([
  { s: 420, side: 1, kind: 'recovery' },
  { s: 1010, side: -1, kind: 'maintenance' },
  { s: 1460, side: 1, kind: 'recovery' },
  { s: 1940, side: -1, kind: 'maintenance' },
  { s: 2390, side: 1, kind: 'recovery' },
  { s: 2710, side: -1, kind: 'maintenance' },
] as const);
export interface ServiceSite {
  s: number;
  side: number;
  kind: 'recovery' | 'maintenance';
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  length: number;
  baseY: number;
  clearance: number;
}

/** Six authored service areas, not random prop scatter. Reject the WHOLE
 * footprint if any sample crosses another road corridor, stand or camera site.
 * No gate is cut through a collision barrier and no recovery AI is implied. */
export function serviceSitePlan(track: Track): readonly ServiceSite[] {
  const result: ServiceSite[] = [], rigs = tracksideRigs(track);
  for (const zone of SERVICE_ZONES) {
    let accepted = false;
    for (const shift of [0, 18, -18]) {
      for (const side of [zone.side, -zone.side]) {
        const s = zone.s + shift;
        if (s < 360 || s > track.length - 230) continue;
        const p = track.at(s, trackPoint());
        const lateral = side * (track.boundary(s, side) + 20);
        const x = p.x + p.nx * lateral, z = p.z + p.nz * lateral;
        const yaw = Math.atan2(p.tx, p.tz), width = 10, length = 18;
        let clear = true, minY = Infinity, maxY = -Infinity, clearance = Infinity;
        const near = trackPoint();
        for (let u = -width / 2; u <= width / 2; u += 1)
          for (let v = -length / 2; v <= length / 2; v += 1) {
            const wx = x + p.nx * u + p.tx * v, wz = z + p.nz * u + p.tz * v;
            const l = track.nearest(wx, wz, near);
            const margin = Math.abs(l) - track.boundary(near.s, l < 0 ? -1 : 1);
            clearance = Math.min(clearance, margin);
            if (margin < 6 || Math.abs(l) > near.width + 37 || inStandFootprint(track, wx, wz, 2) ||
              rigs.some((rig) => Math.hypot(rig.position.x - wx, rig.position.z - wz) < 2.5)) clear = false;
            const y = near.y + near.bank * clamp(l, -12, 12) + grassApronOffset(track, near.s, l);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        if (clear && maxY - minY < 1.3) {
          result.push({ s, side, kind: zone.kind, x, y: maxY + 0.06, z, yaw,
            width, length, baseY: minY - 0.06, clearance });
          accepted = true; break;
        }
      }
      if (accepted) break;
    }
  }
  return result;
}

/** Shared by vegetation and construction. A tree cannot grow through the
 * service building just because a separate procedural system placed it. */
export function inServiceFootprint(sites: readonly ServiceSite[], x: number, z: number, padding = 0) {
  return sites.some((site) => {
    const dx = x - site.x, dz = z - site.z;
    const u = dx * Math.cos(site.yaw) - dz * Math.sin(site.yaw);
    const v = dx * Math.sin(site.yaw) + dz * Math.cos(site.yaw);
    return Math.abs(u) < site.width / 2 + padding && Math.abs(v) < site.length / 2 + padding;
  });
}
