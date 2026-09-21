import * as T from 'three';
import { Track, trackPoint } from '../simulation/track.ts';
import { inStandFootprint } from './grandstand.ts';
import { serviceSitePlan, inServiceFootprint, type ServiceSite } from './venue-service-plan.ts';
import { terrainHeight } from './terrain-profile.ts';
import { BroadcastSightlines } from './broadcast-sightlines.ts';
import { box, mesh, rod, label } from './geometry.ts';

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
  const stone = new T.MeshStandardMaterial({ color: 0x9b9786, roughness: 0.91 }),
    timber = new T.MeshStandardMaterial({ color: 0x7b5739, roughness: 0.78 }),
    metal = new T.MeshStandardMaterial({ color: 0x303f43, metalness: 0.62, roughness: 0.43 }),
    roof = new T.MeshStandardMaterial({ color: 0xc7c5b4, roughness: 0.74 }),
    glass = new T.MeshPhysicalMaterial({
      color: 0x233c45,
      metalness: 0.2,
      roughness: 0.17,
      clearcoat: 0.7,
    }),
    accent = new T.MeshStandardMaterial({ color: 0xba5d34, roughness: 0.72 });
  for (const site of sites) {
    const g = new T.Group();
    g.name = `Aurel district / ${site.id}`;
    g.position.set(site.x, site.y, site.z);
    g.rotation.y = site.yaw;
    parent.add(g);
    const solid = (
      m: T.Material,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
    ) => {
      const o = box(g, m, x, y, z, w, h, d);
      sightlines.add(o);
      return o;
    };
    box(g, stone, 0, -0.18, 0, 44, 0.36, 36);
    // Original pedestrian paving, drain channel, bollards and consistent furniture.
    for (let i = -4; i <= 4; i++) box(g, roof, i * 4.5, 0.012, -12.2, 0.055, 0.018, 8);
    for (const x of [-18, -12, -6, 0, 6, 12, 18]) box(g, metal, x, 0.44, -17, 0.16, 0.88, 0.16);
    for (const x of [-15, -7, 7, 15]) {
      box(g, timber, x, 0.46, -12, 3, 0.13, 0.65);
      box(g, timber, x, 0.9, -11.68, 3, 0.65, 0.1);
      for (const dx of [-1, 1]) box(g, metal, x + dx, 0.23, -12, 0.11, 0.46, 0.5);
      mesh(g, new T.CylinderGeometry(0.28, 0.25, 0.8, 10), metal, x + 1.95, 0.4, -11.7);
    }
    if (site.kind === 'club') {
      solid(stone, 0, 2.7, 5, 29, 5.4, 14);
      for (let x = -12; x <= 12; x += 4) {
        box(g, glass, x, 2.7, -2.025, 3.65, 4.2, 0.07);
        box(g, timber, x + 1.9, 2.7, -2.13, 0.16, 5.6, 0.25);
      }
      for (const side of [-1, 1]) {
        const r = box(g, metal, 0, 6.0, 5 + side * 3.75, 31, 0.25, 8.1);
        r.rotation.x = side * 0.15;
        sightlines.add(r);
      }
      for (let x = -14; x <= 14; x += 2) box(g, timber, x, 5.05, -3.5, 0.085, 0.18, 2.7);
    } else if (site.kind === 'terrace') {
      for (let level = 0; level < 4; level++) {
        const z = -5 + level * 3.5,
          h = 0.6 + level * 0.65;
        solid(stone, 0, h * 0.5, z, 31, h, 3.5);
        for (let x = -13; x <= 13; x += 3.25) box(g, timber, x, h + 0.12, z + 0.8, 2.85, 0.12, 0.6);
      }
      for (const x of [-17, 17])
        for (const z of [-5, 10]) box(g, metal, x, 3.8, z, 0.16, 7.6, 0.16);
      const sail = new T.BufferGeometry();
      const pos: number[] = [],
        ix: number[] = [];
      for (let j = 0; j <= 8; j++)
        for (let i = 0; i <= 16; i++) {
          const u = i / 16,
            v = j / 8;
          pos.push(
            (u - 0.5) * 36,
            7.8 - 1.15 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v),
            -6 + v * 17,
          );
        }
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 16; i++) {
          const k = j * 17 + i;
          ix.push(k, k + 17, k + 1, k + 1, k + 17, k + 18);
        }
      sail.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      sail.setAttribute(
        'uv',
        new T.Float32BufferAttribute(
          Array.from({ length: 153 * 2 }, (_, i) =>
            i % 2 ? Math.floor(i / 34) / 8 : (Math.floor(i / 2) % 17) / 16,
          ),
          2,
        ),
      );
      sail.setIndex(ix);
      sail.computeVertexNormals();
      const fabric = roof.clone();
      fabric.side = T.DoubleSide;
      mesh(g, sail, fabric);
    } else if (site.kind === 'works') {
      for (const x of [-9, 9]) {
        solid(accent, x, 3.2, 5, 15, 6.4, 17);
        for (const z of [-2, 2, 6, 10]) box(g, metal, x, 6.46, z, 15.7, 0.16, 0.15);
        box(g, metal, x, 2.6, -3.56, 9.5, 4.6, 0.08);
        for (let y = 0.5; y < 4.8; y += 0.4) box(g, roof, x, y, -3.62, 9.4, 0.05, 0.07);
        box(g, glass, x, 5.5, -3.56, 11, 0.75, 0.08);
      }
      for (const x of [-3, 3]) {
        mesh(g, new T.CylinderGeometry(1.3, 1.3, 8, 20), metal, x, 4, 12);
        box(g, metal, x, 8.4, 12, 0.14, 1, 0.14);
      }
    } else {
      for (const x of [-12, 0, 12]) {
        solid(timber, x, 1.9, 4, 8.5, 3.8, 8);
        box(g, glass, x, 2.1, -0.04, 7, 1.9, 0.08);
        solid(metal, x, 4.2, 3, 10, 0.24, 11);
        for (const dx of [-4.4, 4.4]) box(g, metal, x + dx, 2, -2, 0.15, 4, 0.15);
        box(g, accent, x, 3.55, -2.35, 8.8, 0.4, 0.09);
      }
      for (const x of [-9, 9])
        for (const z of [-5, -8]) {
          box(g, timber, x, 0.75, z, 2.2, 0.14, 1.1);
          for (const dx of [-0.8, 0.8])
            rod(g, metal, new T.Vector3(x + dx, 0, z), new T.Vector3(x + dx, 0.75, z), 0.045);
        }
    }
    const sign = new T.MeshStandardMaterial({ map: label(site.name), roughness: 0.7 });
    mesh(g, new T.PlaneGeometry(16, 1.15), sign, 0, 2.3, -15.4);
    for (const x of [-7.5, 7.5]) box(g, metal, x, 1.15, -15.3, 0.1, 2.3, 0.1);
  }
}
