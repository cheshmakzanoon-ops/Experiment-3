import { Random } from '../../core/math.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import type { TreePlacement } from '../landscape.ts';
import { TERRAIN_SIZE } from '../terrain-surface.ts';
import { drawnTerrain, terrainFor } from '../terrain.ts';

interface Woodland {
  belts: number;
  height: readonly [number, number];
  length: number;
  depth: number;
  spacing: number;
  slender: number;
}

const WOODLAND: Readonly<Record<string, Woodland>> = {
  'poggio-alto': { belts: 32, height: [8, 17], length: 153, depth: 38, spacing: 6.2, slender: .19 },
  'cape-wrenna': { belts: 27, height: [5, 11], length: 130, depth: 31, spacing: 6.4, slender: .08 },
  haarveld: { belts: 26, height: [7, 14], length: 166, depth: 13, spacing: 7.8, slender: .34 },
  montejaral: { belts: 29, height: [6, 14], length: 130, depth: 33, spacing: 7.0, slender: .36 },
};

/** Place distant copses on landforms seen from the actual race route. The
 * elevated venues have woods on shoulders and open saddles. At Haarveld,
 * level shelter belts follow the direction of the field and drainage rows.
 * The same sites feed the photographic and procedural vegetation tiers. */
export function gpRidgePlanting(track: Track, seed: number, excludes: (x: number, z: number, margin: number) => boolean) {
  const id = track.circuit.id, design = WOODLAND[id];
  if (!design) return [];
  const ground = drawnTerrain(track), sea = terrainFor(track).seaLevel;
  const centre = track.points.reduce((sum, p) => ({ x: sum.x + p.x, z: sum.z + p.z }), { x: 0, z: 0 });
  centre.x /= track.points.length;
  centre.z /= track.points.length;
  const random = new Random(seed + design.belts * 193);
  const station = trackPoint(), result: TreePlacement[] = [];
  const occupied = new Set<string>();
  const flat = id === 'haarveld', coastal = id === 'cape-wrenna';
  for (let belt = 0; belt < design.belts; belt++) {
    track.at(track.length * (belt + .18 + random.next() * .64) / design.belts, station);
    // Split broad sightlines into stands with distinct aspects. Repeated
    // angular rows leave a circular hedge around every camera.
    const bearing = Math.atan2(station.z - centre.z, station.x - centre.x)
      + (random.next() - .5) * 2.2;
    const nx = Math.cos(bearing), nz = Math.sin(bearing);
    let best = -Infinity, bx = 0, bz = 0;
    const start = (flat ? 340 : 285) + random.next() * 220;
    for (let distance = start; distance < 1580; distance += 56) {
      const x = station.x + nx * distance, z = station.z + nz * distance;
      if (Math.max(Math.abs(x), Math.abs(z)) > TERRAIN_SIZE * .47) continue;
      const y = ground.height(x, z);
      if (sea !== null && y < sea + 3) continue;
      // Get the apparent ridge, not the absolute highest vertex. A high
      // mountain behind another ridge has little influence on this view.
      const score = (y - station.y - 1.55) / distance
        + .021 * Math.sin(distance / 146 + belt * 1.7);
      if (score > best && !excludes(x, z, 26)) {
        best = score; bx = x; bz = z;
      }
    }
    if (!Number.isFinite(best)) continue;
    const h = 17;
    const dx = ground.height(bx + h, bz) - ground.height(bx - h, bz);
    const dz = ground.height(bx, bz + h) - ground.height(bx, bz - h);
    // Contour tangent on slopes; use wind-cut shore and polder orientations
    // when there is little elevation gradient to give a belt a direction.
    const tangent = flat ? .35 + (belt % 4 === 0 ? Math.PI / 2 : 0)
      : Math.hypot(dx, dz) > 2.0 ? Math.atan2(dx, -dz) : bearing + Math.PI / 2;
    const tx = Math.cos(tangent), tz = Math.sin(tangent);
    const length = design.length * (.64 + .80 * random.next());
    const rows = flat ? 2 : 3;
    for (let row = 0; row < rows; row++) {
      const delay = random.next() * design.spacing;
      for (let along = -length / 2 + delay; along < length / 2; along += design.spacing) {
        const t = along / length;
        const edge = Math.max(0, 1 - 3.8 * t * t);
        if (random.next() > .48 + edge * .46) continue;
        const u = along + (random.next() - .5) * design.spacing * .75;
        const depth = (row / (rows - 1) - .5) * design.depth * (.35 + .65 * edge);
        const v = depth + (random.next() - .5) * design.depth * (flat ? .14 : .36)
          + (flat ? 2 : 11) * Math.sin(u / 40 + belt * 1.2);
        const x = bx + tx * u - tz * v, z = bz + tz * u + tx * v;
        const cell = Math.floor(x / 4) + '/' + Math.floor(z / 4);
        if (occupied.has(cell) || excludes(x, z, 8)) continue;
        const y = ground.height(x, z);
        if (sea !== null && y < sea + 2) continue;
        const slope = Math.hypot(ground.height(x + 5, z) - ground.height(x - 5, z),
          ground.height(x, z + 5) - ground.height(x, z - 5)) / 10;
        if (slope > (coastal ? .63 : .8)) continue;
        occupied.add(cell);
        const slender = random.next() < design.slender;
        const height = (design.height[0] + random.next() * (design.height[1] - design.height[0]))
          * (.83 + .17 * edge);
        const width = height * (slender ? .31 + .12 * random.next()
          : (coastal ? .99 : .76) + .25 * random.next());
        result.push({ x, y, z, width, height, yaw: random.next() * Math.PI * 2,
          role: slender ? flat ? 'upright' : 'conifer' : coastal ? 'spreading' : 'broadleaf' });
      }
    }
  }
  // Density tiers draw the leading fraction of each spatial bucket. Mixing
  // the sites keeps each belt present when detail drops and on slow GPUs.
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
