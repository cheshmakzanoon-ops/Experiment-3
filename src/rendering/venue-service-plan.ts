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
export interface ServiceAccessPoint {
  x: number;
  y: number;
  z: number;
}
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
  /** Grounded access spur; empty when neither direction clears protected sites. */
  access?: readonly ServiceAccessPoint[];
}

/** Six authored service areas, not random prop scatter. Reject the WHOLE
 * footprint if any sample crosses another road corridor, stand or camera site.
 * No gate is cut through a collision barrier and no recovery AI is implied. */
export function serviceSitePlan(track: Track): readonly ServiceSite[] {
  const result: ServiceSite[] = [],
    rigs = tracksideRigs(track);
  for (const zone of SERVICE_ZONES) {
    let accepted = false;
    for (const shift of [0, 18, -18]) {
      for (const side of [zone.side, -zone.side]) {
        const s = zone.s + shift;
        if (s < 360 || s > track.length - 230) continue;
        const p = track.at(s, trackPoint());
        const lateral = side * (track.boundary(s, side) + 20);
        const x = p.x + p.nx * lateral,
          z = p.z + p.nz * lateral;
        const yaw = Math.atan2(p.tx, p.tz),
          width = 10,
          length = 18;
        let clear = true,
          minY = Infinity,
          maxY = -Infinity,
          clearance = Infinity;
        const near = trackPoint();
        for (let u = -width / 2; u <= width / 2; u += 1)
          for (let v = -length / 2; v <= length / 2; v += 1) {
            const wx = x + p.nx * u + p.tx * v,
              wz = z + p.nz * u + p.tz * v;
            const l = track.nearest(wx, wz, near);
            const margin = Math.abs(l) - track.boundary(near.s, l < 0 ? -1 : 1);
            clearance = Math.min(clearance, margin);
            if (
              margin < 6 ||
              Math.abs(l) > near.width + 37 ||
              inStandFootprint(track, wx, wz, 2) ||
              rigs.some((rig) => Math.hypot(rig.position.x - wx, rig.position.z - wz) < 2.5)
            )
              clear = false;
            const y = near.y + near.bank * clamp(l, -12, 12) + grassApronOffset(track, near.s, l);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        if (clear && maxY - minY < 1.3) {
          const site: ServiceSite = {
            s,
            side,
            kind: zone.kind,
            x,
            y: maxY + 0.06,
            z,
            yaw,
            width,
            length,
            baseY: minY - 0.06,
            clearance,
          };
          site.access = serviceAccessPlan(track, site, rigs);
          result.push(site);
          accepted = true;
          break;
        }
      }
      if (accepted) break;
    }
  }
  return result;
}

/** A 3.4m-wide, non-racing access spur meets the raised pad through a bounded
 * grade. Test its complete width against the same ground/road/stand/camera data
 * as the site itself. No collision barrier is cut and no drivable road is claimed. */
export function serviceAccessPlan(
  track: Track,
  site: ServiceSite,
  rigs = tracksideRigs(track),
): readonly ServiceAccessPoint[] {
  for (const sign of [1, -1]) {
    const points: ServiceAccessPoint[] = [];
    let valid = true,
      previousY = site.y + 0.026;
    for (let i = 0; i <= 16; i++) {
      const v = sign * (site.length / 2 - 0.15 + i);
      const x = site.x + Math.sin(site.yaw) * v,
        z = site.z + Math.cos(site.yaw) * v;
      let ground = -Infinity;
      for (const across of [-1.7, -0.85, 0, 0.85, 1.7]) {
        const wx = x + Math.cos(site.yaw) * across,
          wz = z - Math.sin(site.yaw) * across;
        const p = trackPoint(),
          lateral = track.nearest(wx, wz, p);
        if (
          Math.abs(lateral) - track.boundary(p.s, lateral < 0 ? -1 : 1) < 6 ||
          Math.abs(lateral) > p.width + 37 ||
          inStandFootprint(track, wx, wz, 2) ||
          rigs.some((r) => Math.hypot(r.position.x - wx, r.position.z - wz) < 2.5)
        )
          valid = false;
        ground = Math.max(
          ground,
          p.y + p.bank * clamp(lateral, -12, 12) + grassApronOffset(track, p.s, lateral),
        );
      }
      const t = i / 16,
        mix = t * t * (3 - 2 * t);
      const y = Math.max(ground + 0.022, (site.y + 0.026) * (1 - mix) + (ground + 0.022) * mix);
      if (i > 0 && Math.abs(y - previousY) > 0.12) valid = false;
      previousY = y;
      points.push({ x, y, z });
    }
    if (valid && Math.abs(points[0].y - site.y - 0.026) < 0.015) return points;
  }
  return [];
}

/** Shared by vegetation and construction, including the whole access ribbon. */
export function inServiceFootprint(
  sites: readonly ServiceSite[],
  x: number,
  z: number,
  padding = 0,
) {
  return sites.some((site) => {
    const dx = x - site.x,
      dz = z - site.z;
    const u = dx * Math.cos(site.yaw) - dz * Math.sin(site.yaw);
    const v = dx * Math.sin(site.yaw) + dz * Math.cos(site.yaw);
    if (Math.abs(u) < site.width / 2 + padding && Math.abs(v) < site.length / 2 + padding)
      return true;
    const access = site.access ?? [];
    for (let i = 1; i < access.length; i++) {
      const a = access[i - 1],
        b = access[i],
        vx = b.x - a.x,
        vz = b.z - a.z;
      const t = clamp(((x - a.x) * vx + (z - a.z) * vz) / Math.max(0.001, vx * vx + vz * vz), 0, 1);
      if (Math.hypot(x - a.x - vx * t, z - a.z - vz * t) < 1.85 + padding) return true;
    }
    return false;
  });
}
