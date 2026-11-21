import { clamp } from '../../core/math.ts';
import { isGpCourse } from '../../simulation/gp-corner-shape.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { terrainFor } from '../terrain.ts';
import { terrainSurface } from '../terrain-surface.ts';

/** Ground height of the venue kit's verge (inside the barrier) and skirt
 * (easing over 26 m onto the venue terrain, as venue-kit/ground.ts lays it,
 * with the ribbon's four straight segments across). */
export function cataloguePlantingGround(track: Track) {
  const terrain = terrainFor(track),
    mesh = isGpCourse(track) ? terrainSurface(terrain) : undefined,
    p = trackPoint();
  return (s: number, l: number, x: number, z: number) => {
    track.at(s, p);
    const side = l < 0 ? -1 : 1;
    const road = (lat: number) => p.y + p.bank * clamp(lat, -12, 12);
    const a = Math.max(p.width + 4, track.boundaryAt(p, side) + 1);
    if (Math.abs(l) < a) return road(l) - 0.04;
    const t = clamp((Math.abs(l) - a) / 26, 0, 1);
    if (t >= 1) return mesh ? mesh.height(x, z) : terrain.height(x, z) - 0.08;
    const knot = (k: number) => {
      const lat = side * (a + 26 * k),
        tt = k * k * (3 - 2 * k),
        ground = terrain.height(p.x + p.nx * lat, p.z + p.nz * lat) - 0.08 - road(lat);
      return road(lat) - 0.05 + (ground + 0.05) * tt;
    };
    const i = Math.min(3, Math.floor(t * 4)),
      f = t * 4 - i;
    const skirt = knot(i / 4) * (1 - f) + knot((i + 1) / 4) * f;
    return mesh ? Math.max(skirt, mesh.height(x, z)) : skirt;
  };
}
