import { clamp } from '../core/math.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { grassApronOffset } from './ground-profile.ts';
import { terrainFor } from './terrain.ts';
import { inStandFootprint } from './grandstand.ts';
import { districtPlan, inDistrictFootprint, type DistrictSite } from './venue-districts.ts';
import { serviceSitePlan, inServiceFootprint, type ServiceSite } from './venue-service-plan.ts';
import { inLandmarkFootprint, landmarkSitePlan } from './venue-landmark.ts';
import { trackInfrastructurePlan } from './track-infrastructure.ts';
import manifest from './aurel-quarry.manifest.json' with { type: 'json' };

export type QuarryVariant = keyof typeof manifest.bounds;
export interface QuarrySite {
  id: string;
  variant: QuarryVariant;
  x: number;
  z: number;
  yaw: number;
  scale: readonly [number, number, number];
  ground: 'terrain' | 'apron';
  station: number;
}
export type QuarryExclusion = (x: number, z: number, padding: number) => boolean;
export const QUARRY_STATIONS = Object.freeze([
  1160, 1184, 1208, 1232, 1256, 1280, 1304, 1328, 1352, 1376, 1400, 1424,
]);
/** Bounded, repeatable visual composition. Nothing here mutates Track or physics. */
export function quarryFootprint(site: QuarrySite, padding = 0) {
  if (
    ![site.x, site.z, site.yaw, ...site.scale, padding].every(Number.isFinite) ||
    site.scale.some((v) => v <= 0) ||
    padding < 0
  )
    throw new Error('Invalid quarry placement');
  const b = manifest.bounds[site.variant];
  return {
    minX: b.min[0] * site.scale[0] - padding,
    maxX: b.max[0] * site.scale[0] + padding,
    minZ: b.min[2] * site.scale[2] - padding,
    maxZ: b.max[2] * site.scale[2] + padding,
  };
}
export function inQuarryFootprint(sites: readonly QuarrySite[], x: number, z: number, padding = 0) {
  if (![x, z, padding].every(Number.isFinite) || padding < 0)
    throw new Error('Invalid quarry query');
  return sites.some((site) => {
    // Fine flush fittings need not exclude an entire tree crown. Large formations do.
    if (!['cliff-bench', 'cliff-cut', 'retaining-wall', 'talus', 'boulder'].includes(site.variant))
      return false;
    const b = quarryFootprint(site, padding),
      c = Math.cos(site.yaw),
      n = Math.sin(site.yaw),
      dx = x - site.x,
      dz = z - site.z,
      u = c * dx - n * dz,
      v = n * dx + c * dz;
    return u >= b.minX && u <= b.maxX && v >= b.minZ && v <= b.maxZ;
  });
}
/** Same metre-valued ground as the retained ribbons; terrain is used only beyond
 * the apron. This is a visual conformance query, never a contact-surface override. */
export function quarryGround(track: Track, x: number, z: number, kind: QuarrySite['ground']) {
  if (![x, z].every(Number.isFinite)) throw new Error('Invalid quarry ground query');
  if (kind === 'terrain') return terrainFor(track).height(x, z);
  const p = trackPoint(),
    l = track.nearest(x, z, p);
  return p.y + p.bank * clamp(l, -12, 12) + grassApronOffset(track, p.s, l);
}
export function quarryPlacementClearance(
  track: Track,
  services: readonly ServiceSite[] = serviceSitePlan(track),
  districts: readonly DistrictSite[] = districtPlan(track, services),
  excluded?: QuarryExclusion,
) {
  const landmark = landmarkSitePlan(track, services, districts),
    p = trackPoint();
  return (site: QuarrySite): boolean => {
    const b = quarryFootprint(site),
      c = Math.cos(site.yaw),
      n = Math.sin(site.yaw);
    // Sample the full exported LOD envelope on a <=1m lattice. Pads are not
    // accepted by their centre alone; nearby return-track segments also count.
    const step = site.variant === 'ridge' ? 8 : 1;
    const nx = Math.ceil((b.maxX - b.minX) / step),
      nz = Math.ceil((b.maxZ - b.minZ) / step);
    for (let i = 0; i <= nx; i++)
      for (let j = 0; j <= nz; j++) {
        const u = b.minX + ((b.maxX - b.minX) * i) / Math.max(1, nx),
          v = b.minZ + ((b.maxZ - b.minZ) * j) / Math.max(1, nz);
        const x = site.x + c * u + n * v,
          z = site.z - n * u + c * v,
          l = track.nearest(x, z, p),
          side = l < 0 ? -1 : 1;
        if (site.variant === 'drain-collar') {
          // Existing drainage is just beyond the continuous physical kerb. The
          // collar is flush dressing around that retained drain, not a new drain.
          if (Math.abs(l) < p.width + 1.1 || Math.abs(l) > p.width + 2.1) return false;
        } else {
          const margin = site.ground === 'terrain' ? 30 : 3;
          if (Math.abs(l) < track.boundary(p.s, side) + margin) return false;
          if (site.ground === 'apron' && Math.abs(l) > p.width + 37) return false;
        }
        if (l > 0 && (p.s < 335 || p.s > track.length - 230) && l < 70) return false;
        if (
          inStandFootprint(track, x, z, 2) ||
          inServiceFootprint(services, x, z, 2) ||
          inDistrictFootprint(districts, x, z, 3) ||
          inLandmarkFootprint(landmark, x, z, 3) ||
          excluded?.(x, z, 1)
        )
          return false;
      }
    return true;
  };
}

export function aurelQuarryPlan(
  track: Track,
  services = serviceSitePlan(track),
  excluded?: QuarryExclusion,
): QuarrySite[] {
  if (track.circuit.id !== 'aurel') return [];
  const sites: QuarrySite[] = [],
    districts = districtPlan(track, services),
    clear = quarryPlacementClearance(track, services, districts, excluded);
  const add = (site: QuarrySite) => {
    if (clear(site)) sites.push(site);
  };
  const at = (
    variant: QuarryVariant,
    s: number,
    l: number,
    scale: readonly [number, number, number] = [1, 1, 1],
    ground: QuarrySite['ground'] = 'terrain',
    suffix = '',
  ) => {
    const p = track.at(s, trackPoint());
    return {
      id: `${variant}-${s}-${l}${suffix}`,
      variant,
      x: p.x + p.nx * l,
      z: p.z + p.nz * l,
      yaw: Math.atan2(p.tx, p.tz),
      scale,
      ground,
      station: s,
    };
  };
  // A cut and a lower bench form a connected district, with deliberate gaps
  // for the existing terrace and service compounds, not random rock scatter.
  QUARRY_STATIONS.forEach((s, i) => {
    add(
      at(i % 3 === 1 ? 'cliff-cut' : 'cliff-bench', s, -68 - (i % 3) * 4, [
        1,
        0.78 + (i % 4) * 0.08,
        1.1,
      ]),
    );
    add(at('talus', s + 7, -55, [1.2, 1, 1.2]));
    add(at('boulder', s - 6, -52, [0.8 + (i % 3) * 0.12, 0.85, 1]));
  });
  for (const s of [1150, 1156, 1162, 1388, 1394, 1400, 1406]) add(at('retaining-wall', s, -56));
  // Ground fittings retain existing drainage positions and do not remove the
  // current grates, their slots or the underlying runoff/collision geometry.
  for (const drain of trackInfrastructurePlan(track).drains) {
    if (drain.s < 1080 || drain.s > 1510) continue;
    add({
      id: `collar-${drain.s}`,
      variant: 'drain-collar',
      x: drain.x,
      z: drain.z,
      yaw: drain.yaw,
      scale: [1, 1, 1],
      ground: 'apron',
      station: drain.s,
    });
  }
  for (let s = 1110; s < 1490; s += 8) {
    const lateral = -(track.boundary(s, -1) + 4.2);
    add(at('verge-edge', s, lateral, [1, 1, 1], 'apron'));
    for (let j = 0; j < 3; j++)
      add(at('tussock', s + j * 1.2, lateral - 1.4 - (j % 2) * 0.9, [1, 1, 1], 'apron', `-${j}`));
    // Layered shrubs behind the safety corridor; leave clear recovery access.
    const shrub = at('shrub', s + 3, -52, [0.82 + (Math.floor(s) % 3) * 0.06, 0.75, 1]);
    if (!inQuarryFootprint(sites, shrub.x, shrub.z, 1.7)) add(shrub);
    // Preserve the course-facing sightline: keep hedges on the rear side.
    if (Math.floor(s / 8) % 3 === 0) add(at('hedge', s + 2, -90, [1, 0.7, 1]));
  }
  // Four far landform shoulders continue the limestone identity behind Quarry.
  // They stand on the retained procedural heightfield, not over the race apron.
  for (const [i, angle] of [0.3, 0.51, 0.75, 0.96].entries()) {
    const radius = 1420 + (i % 2) * 110;
    add({
      id: `ridge-${i}`,
      variant: 'ridge',
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      yaw: -angle,
      scale: [1 + (i % 2) * 0.12, 0.7 + i * 0.1, 1],
      ground: 'terrain',
      station: -1,
    });
  }
  if (sites.length > 360) throw new Error('Quarry site budget exceeded');
  return sites;
}
