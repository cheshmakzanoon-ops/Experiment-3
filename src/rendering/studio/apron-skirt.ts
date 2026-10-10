import { Track, trackPoint } from '../../simulation/track.ts';
import { clamp } from '../../core/math.ts';
import { grassApronOffset } from '../ground-profile.ts';

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
