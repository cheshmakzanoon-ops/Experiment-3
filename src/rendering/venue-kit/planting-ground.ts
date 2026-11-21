import { clamp } from '../../core/math.ts';
import { isGpCourse } from '../../simulation/gp-corner-shape.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { drawnTerrain } from '../terrain.ts';
import { catalogueSkirtOffset } from './ground.ts';

/** Ground height of the venue kit's verge (inside the barrier) and skirt
 * (easing over 26 m onto the venue terrain, as venue-kit/ground.ts lays it,
 * with the ribbon's four straight segments across). */
export function cataloguePlantingGround(track: Track) {
  const terrain = drawnTerrain(track),
    gp = isGpCourse(track),
    p = trackPoint();
  return (s: number, l: number, x: number, z: number) => {
    track.at(s, p);
    const side = l < 0 ? -1 : 1;
    const road = (lat: number) => p.y + p.bank * clamp(lat, -12, 12);
    const a = Math.max(p.width + 4, track.boundaryAt(p, side) + 1);
    if (Math.abs(l) < a) return road(l) - 0.04;
    const t = clamp((Math.abs(l) - a) / 26, 0, 1);
    if (t >= 1) return terrain.height(x, z) - (gp ? 0 : 0.08);
    const knot = (k: number) => {
      const lat = side * (a + 26 * k);
      return road(lat) + catalogueSkirtOffset(p, terrain, lat, k);
    };
    const i = Math.min(3, Math.floor(t * 4)),
      f = t * 4 - i;
    const skirt = knot(i / 4) * (1 - f) + knot((i + 1) / 4) * f;
    return gp ? Math.max(skirt, terrain.height(x, z)) : skirt;
  };
}
