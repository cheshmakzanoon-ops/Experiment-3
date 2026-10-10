import { Track, trackPoint } from '../../simulation/track.ts';
import { clamp } from '../../core/math.ts';
import { APRON_COLUMNS, grassApronLateral, grassApronOffset } from '../ground-profile.ts';

/**
 * Apron-to-terrain skirt (D17). The grass apron ends `APRON_OUTER` m from the
 * centreline at its own falloff height while the terrain mesh lies at its
 * datum, so the apron's outer edge floated or dug in around the lap. A lap-wide
 * ribbon per side runs `APRON_SKIRT_METRES` outward from that edge, starting
 * exactly on it and easing onto the terrain (sunk `SKIRT_EMBED` m so the
 * coarser terrain triangles never show a gap).
 */
export const APRON_OUTER = 38;
export const APRON_SKIRT_METRES = 12;
export const SKIRT_EMBED = 0.08;

const point = trackPoint();
/** Ribbon height offset (above p.y + bank) at lap `s`, lateral `l`, across `t`. */
export function apronSkirtHeight(
  track: Track,
  terrainHeight: (x: number, z: number) => number,
  s: number,
  l: number,
  t: number,
) {
  if (![s, l, t].every(Number.isFinite)) throw new Error('Invalid apron skirt coordinate');
  const p = track.at(s, point);
  const road = p.y + p.bank * clamp(l, -12, 12);
  const start = grassApronOffset(track, s, l);
  const ground = terrainHeight(p.x + p.nx * l, p.z + p.nz * l) - SKIRT_EMBED - road;
  const k = clamp(t, 0, 1);
  return start + (ground - start) * k * k * (3 - 2 * k);
}

/** Skirt columns per side (D17's own ribbon used 3). */
export const SKIRT_COLUMNS = 3;
/**
 * The apron and both skirts as ONE ribbon cross-section (D32 performance-
 * budget): left skirt (outer edge to apron edge), the apron's own
 * `APRON_COLUMNS`, right skirt. The skirt was two extra lap-wide ribbons, so
 * every visible 80 m chunk cost two more draws in the view and in each mirror
 * (+46 calls in the cold cockpit frame); sharing the apron's chunks costs 0.
 * Vertices, heights and uv are those of the three separate ribbons; the seam
 * columns are shared, so the normals there are smooth instead of creased.
 */
export function apronWithSkirt(
  track: Track,
  terrainHeight: (x: number, z: number) => number,
  widthAt: (s: number) => number,
) {
  const columns = APRON_COLUMNS + 2 * SKIRT_COLUMNS;
  // The ribbon samples t = j / columns; recover the column exactly.
  const part = (t: number) => {
    const j = Math.round(clamp(t, 0, 1) * columns);
    if (j < SKIRT_COLUMNS) return { side: -1, t: 1 - j / SKIRT_COLUMNS };
    if (j > SKIRT_COLUMNS + APRON_COLUMNS)
      return { side: 1, t: (j - SKIRT_COLUMNS - APRON_COLUMNS) / SKIRT_COLUMNS };
    return { side: 0, t: (j - SKIRT_COLUMNS) / APRON_COLUMNS };
  };
  return {
    columns,
    offset: (s: number, t: number) => {
      const c = part(t),
        width = widthAt(s);
      return c.side === 0
        ? grassApronLateral(track, s, c.t, width)
        : c.side * (width + APRON_OUTER + APRON_SKIRT_METRES * c.t);
    },
    height: (s: number, l: number, t: number) => {
      const c = part(t);
      return c.side === 0
        ? grassApronOffset(track, s, l)
        : apronSkirtHeight(track, terrainHeight, s, l, c.t);
    },
  };
}
