import * as T from 'three';
import { terrainHeight } from './terrain-profile.ts';
import type { DistrictSite } from './venue-districts.ts';

/** Interior deck remains level under structures. A three-metre graded perimeter
 * returns to the actual distant terrain, rather than exposing a floating slab. */
export function plazaHeight(site: DistrictSite, x: number, z: number) {
  if (
    ![site.x, site.y, site.z, site.yaw, site.width, site.length, x, z].every(Number.isFinite) ||
    site.width < 8 ||
    site.length < 8 ||
    site.width > 100 ||
    site.length > 100
  )
    throw new Error('Invalid venue plaza footprint');
  if (Math.abs(x) > site.width / 2 + 1e-7 || Math.abs(z) > site.length / 2 + 1e-7)
    throw new Error('Plaza sample outside its protected footprint');
  const wx = site.x + Math.cos(site.yaw) * x + Math.sin(site.yaw) * z,
    wz = site.z - Math.sin(site.yaw) * x + Math.cos(site.yaw) * z,
    ground = terrainHeight(wx, wz) + 0.008,
    t = Math.min(
      1,
      Math.max(0, Math.min(site.width / 2 - Math.abs(x), site.length / 2 - Math.abs(z)) / 3),
    ),
    blend = t * t * (3 - 2 * t);
  return ground + (site.y - ground) * blend;
}

/** One bounded, indexed patch per district. The original track, collision mesh,
 * grass apron and distant terrain are never moved to accommodate architecture. */
export function districtPlazaGeometry(site: DistrictSite) {
  plazaHeight(site, 0, 0);
  const columns = Math.ceil(site.width),
    rows = Math.ceil(site.length),
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= columns; i++) {
      const x = -site.width / 2 + (site.width * i) / columns,
        z = -site.length / 2 + (site.length * j) / rows;
      positions.push(x, plazaHeight(site, x, z) - site.y, z);
      uv.push(x, z);
      if (i < columns && j < rows) {
        const a = j * (columns + 1) + i,
          b = a + columns + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
