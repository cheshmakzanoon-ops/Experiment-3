import * as T from 'three';
import { Track, trackPoint } from '../simulation/track.ts';
import { inStandFootprint } from './grandstand.ts';
import { serviceSitePlan, inServiceFootprint, type ServiceSite } from './venue-service-plan.ts';
import { terrainHeight } from './terrain-profile.ts';
import { BroadcastSightlines } from './broadcast-sightlines.ts';
import { box, mesh, label } from './geometry.ts';
import { buildDistrictArchitecture } from './venue-architecture.ts';
import { venueMaterials } from './venue-materials.ts';
import { districtPlazaGeometry } from './venue-plaza.ts';

/** Named districts of ONE circuit, not fictional extra tracks. Their complete
 * plaza footprint is shared with planting and clearance checks. */
export const DISTRICTS = Object.freeze([
  { id: 'orchard-club', name: 'ORCHARD / MOTOR CLUB', s: 725, kind: 'club', side: -1 },
  { id: 'quarry-terrace', name: 'QUARRY / TERRACE', s: 1330, kind: 'terrace', side: 1 },
  { id: 'north-works', name: 'NORTH / WORKS', s: 1845, kind: 'works', side: -1 },
  { id: 'south-concourse', name: 'SOUTH / CONCOURSE', s: 2480, kind: 'concourse', side: 1 },
] as const);
export interface DistrictSite {
  id: string;
  name: string;
  kind: (typeof DISTRICTS)[number]['kind'];
  s: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  length: number;
  clearance: number;
}
export function inDistrictFootprint(
  sites: readonly DistrictSite[],
  x: number,
  z: number,
  margin = 0,
) {
  return sites.some((p) => {
    const c = Math.cos(p.yaw),
      n = Math.sin(p.yaw),
      dx = x - p.x,
      dz = z - p.z;
    return (
      Math.abs(c * dx - n * dz) < p.width / 2 + margin &&
      Math.abs(n * dx + c * dz) < p.length / 2 + margin
    );
  });
}
export function districtPlan(
  track: Track,
  services: readonly ServiceSite[] = serviceSitePlan(track),
): DistrictSite[] {
  const sites: DistrictSite[] = [],
    p = trackPoint(),
    near = trackPoint();
  for (const district of DISTRICTS) {
    let found: DistrictSite | undefined;
    for (const delta of [0, -35, 35, -70, 70]) {
      if (found) break;
      const s = district.s + delta;
      track.at(s, p);
      for (const side of [district.side, -district.side]) {
        if (found) break;
        for (const offset of [90, 125, 160]) {
          const x = p.x + p.nx * side * offset,
            z = p.z + p.nz * side * offset,
            yaw = Math.atan2(p.tx, p.tz),
            c = Math.cos(yaw),
            n = Math.sin(yaw);
          let clear = true,
            clearance = Infinity,
            low = Infinity,
            high = -Infinity;
          for (const u of [-22, -11, 0, 11, 22])
            for (const v of [-18, -9, 0, 9, 18]) {
              const wx = x + c * u + n * v,
                wz = z - n * u + c * v;
              const l = track.nearest(wx, wz, near),
                margin = Math.abs(l) - track.boundary(near.s, l < 0 ? -1 : 1);
              // Stay entirely on the distant ground mesh, not across the raised
              // physical apron, pit access, return straight or existing structures.
              if (
                margin < 25 ||
                Math.abs(l) < near.width + 42 ||
                (l > 0 && (near.s < 335 || near.s > track.length - 50) && l < 65) ||
                inStandFootprint(track, wx, wz, 5) ||
                inServiceFootprint(services, wx, wz, 5) ||
                inDistrictFootprint(sites, wx, wz, 8)
              )
                clear = false;
              const h = terrainHeight(wx, wz);
              low = Math.min(low, h);
              high = Math.max(high, h);
              clearance = Math.min(clearance, margin);
            }
          if (clear && high - low < 0.5) {
            found = { ...district, s, x, y: high + 0.12, z, yaw, width: 44, length: 36, clearance };
            break;
          }
        }
      }
    }
    // A failed plan is a visible authoring error, not a tree-overlapped building.
    if (!found) throw new Error(`No safe footprint for Aurel district ${district.id}`);
    sites.push(found);
  }
  return sites;
}

export function buildDistricts(
  parent: T.Group,
  sites: readonly DistrictSite[],
  sightlines: BroadcastSightlines,
) {
  const materials = venueMaterials();
  for (const site of sites) {
    const g = new T.Group();
    g.name = `Aurel district / ${site.id}`;
    g.position.set(site.x, site.y, site.z);
    g.rotation.y = site.yaw;
    parent.add(g);
    const plaza = mesh(g, districtPlazaGeometry(site), materials.paving);
    plaza.name = `Terrain-graded public plaza / ${site.id}`;
    plaza.castShadow = false;
    buildDistrictArchitecture(g, site.kind, materials, sightlines);
    // Existing directional identity is retained. The front pedestrian approach
    // stays clear; no access road or new gate through the racing barrier is implied.
    const sign = new T.MeshStandardMaterial({ map: label(site.name), roughness: 0.7 });
    sign.name = `Aurel district wayfinding / ${site.id}`;
    mesh(g, new T.PlaneGeometry(3.8, 1.1), sign, -16, 1.95, -12.8).castShadow = false;
    for (const x of [-17.5, -14.5]) box(g, materials.steel, x, 0.975, -12.75, 0.075, 1.95, 0.075);
  }
}
