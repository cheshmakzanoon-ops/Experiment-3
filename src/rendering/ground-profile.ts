import type { Track } from '../simulation/track.ts';

/** Keep reachable grass close to the actual contact plane. The shallow visual
 * falloff belongs OUTSIDE the wall, not beneath drivable wheels. This separation
 * only prevents coplanar overlap with road/runoff ribbons; it is not a new bump. */
export const APRON_SEPARATION_M = 0.04;
const OUTSIDE_WALL_MARGIN_M = 1;
const SCENERY_FALLOFF = 0.045;
export function grassApronOffset(track: Track, s: number, lateral: number) {
  if (![s, lateral].every(Number.isFinite)) throw new Error('Invalid apron coordinate');
  const boundary = track.boundary(s, lateral < 0 ? -1 : 1);
  return (
    -APRON_SEPARATION_M -
    Math.max(0, Math.abs(lateral) - boundary - OUTSIDE_WALL_MARGIN_M) * SCENERY_FALLOFF
  );
}

/** Explicit vertices at the bank clamp and the falloff boundary prevent a broad
 * triangle from interpolating the outside drop back under the drivable apron. */
export const APRON_COLUMNS = 8;
export function grassApronLateral(track: Track, s: number, t: number, width: number) {
  if (![s, t, width].every(Number.isFinite) || t < 0 || t > 1 || width <= 0 || width >= 12)
    throw new Error('Invalid apron cross-section');
  const outer = width + 38;
  const left = track.boundary(s, -1) + OUTSIDE_WALL_MARGIN_M;
  const right = track.boundary(s, 1) + OUTSIDE_WALL_MARGIN_M;
  const knots = [-outer, -left, -12, -width, 0, width, 12, right, outer];
  const index = Math.min(APRON_COLUMNS - 1, Math.floor(t * APRON_COLUMNS));
  return knots[index] + (knots[index + 1] - knots[index]) * (t * APRON_COLUMNS - index);
}
