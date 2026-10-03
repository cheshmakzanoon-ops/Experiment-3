import { clamp } from '../core/math.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { grassApronOffset } from './ground-profile.ts';
import { inStandFootprint } from './grandstand.ts';
import { tracksideRigs } from './trackside.ts';
import type { ServiceSite, ServiceAccessPoint } from './venue-service-plan.ts';
export interface RecoveryGateSite {
  readonly s: number;
  readonly start: number;
  readonly end: number;
  readonly side: number;
  readonly variant: 'recovery' | 'maintenance';
  readonly sourceStation: number;
  readonly approach: readonly ServiceAccessPoint[];
}
function ground(track: Track, x: number, z: number) {
  const p = trackPoint(),
    l = track.nearest(x, z, p);
  return p.y + p.bank * clamp(l, -12, 12) + grassApronOffset(track, p.s, l);
}
/** A closed visual connection, never a physical barrier opening. Both the
 * original service pad/spur and the original boundary grid remain unchanged. */
export function recoveryGatePlan(
  track: Track,
  sites: readonly ServiceSite[],
): readonly RecoveryGateSite[] {
  const result: RecoveryGateSite[] = [],
    rigs = tracksideRigs(track),
    spans = Math.ceil(track.length / 80),
    span = track.length / spans,
    modules = Math.ceil(span / 3.8);
  for (const site of sites) {
    const access = site.access ?? [];
    if (access.length < 2) continue;
    const a = access.at(-1)!,
      prior = access.at(-2)!,
      near = trackPoint();
    track.nearest(a.x, a.z, near);
    const sign = (a.x - prior.x) * near.tx + (a.z - prior.z) * near.tz < 0 ? -1 : 1;
    const desired = near.s + sign * 6;
    if (desired < 0 || desired >= track.length) continue;
    const batch = Math.floor(desired / span),
      ordinal = Math.floor((desired - batch * span) / (span / modules));
    const start = batch * span + (ordinal * span) / modules,
      end = start + span / modules,
      s = (start + end) / 2,
      p = track.at(s, trackPoint());
    const lateral = site.side * (track.boundary(s, site.side) + 0.42),
      endX = p.x + p.nx * lateral,
      endZ = p.z + p.nz * lateral;
    const dx = a.x - prior.x,
      dz = a.z - prior.z,
      length = Math.hypot(dx, dz),
      c1 = { x: a.x + (dx / length) * 6, z: a.z + (dz / length) * 6 },
      c2 = { x: endX + p.nx * site.side * 7, z: endZ + p.nz * site.side * 7 };
    const approach: ServiceAccessPoint[] = [];
    let valid = true;
    for (let i = 0; i <= 24; i++) {
      const t = i / 24,
        u = 1 - t,
        x = u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * endX,
        z = u * u * u * a.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * endZ;
      const tx = 3 * u * u * (c1.x - a.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (endX - c2.x),
        tz = 3 * u * u * (c1.z - a.z) + 6 * u * t * (c2.z - c1.z) + 3 * t * t * (endZ - c2.z),
        len = Math.hypot(tx, tz);
      for (const across of [-1.5, 0, 1.5]) {
        const wx = x + (tz / len) * across,
          wz = z - (tx / len) * across,
          q = trackPoint(),
          l = track.nearest(wx, wz, q);
        if (
          Math.abs(l) - track.boundary(q.s, l < 0 ? -1 : 1) < 0.26 ||
          inStandFootprint(track, wx, wz, 1) ||
          rigs.some((r) => Math.hypot(r.position.x - wx, r.position.z - wz) < 2.5)
        )
          valid = false;
      }
      const blend = Math.min(1, t * 8),
        y = a.y * (1 - blend) + (ground(track, x, z) + 0.015) * blend;
      if (
        i > 0 &&
        Math.abs(y - approach[i - 1].y) / Math.hypot(x - approach[i - 1].x, z - approach[i - 1].z) >
          0.18
      )
        valid = false;
      approach.push(Object.freeze({ x, y, z }));
    }
    if (valid)
      result.push(
        Object.freeze({
          s,
          start,
          end,
          side: site.side,
          variant: site.kind === 'recovery' ? 'recovery' : 'maintenance',
          sourceStation: site.s,
          approach: Object.freeze(approach),
        }),
      );
  }
  return Object.freeze(result);
}
