import { clamp, mod } from '../core/math.ts';
import { trackPoint, type Track } from './track.ts';

export type GPCornerPhase = 'none' | 'approach' | 'entry' | 'apex' | 'exit';

export interface GPCornerShape {
  /** Metres either side of the authored apex, measured along the road. */
  entry: number;
  exit: number;
  apexWindow: number;
  direction: 'left' | 'right' | 'straight';
  next: number;
  nextGap: number;
}

/** Road-shaped guide windows, built once per presented circuit. REF 015/017/
 * 027/035: make the bend readable while keeping the racing view clear. These
 * original guide thresholds describe route shape, not tyre limits or braking
 * targets. A sustained fall in same-direction curvature ends the bend; a
 * nearby next apex bounds the window so chicanes cannot hide their second turn.
 * There are no clocks, rider history, ideal speeds or simulation mutations. */
export function gpCornerShapes(track: Track): readonly GPCornerShape[] {
  const corners = track.circuit.corners,
    sample = trackPoint();
  return corners.map((corner, index) => {
    let previousGap = track.length,
      nextGap = track.length,
      next = index;
    for (let i = 0; i < corners.length; i++) {
      if (i === index) continue;
      const gap = mod(corners[i].s - corner.s, track.length);
      // Coincident labels describe one location, not a zero-length bend.
      if (gap === 0) continue;
      previousGap = Math.min(previousGap, track.length - gap);
      if (gap < nextGap) {
        nextGap = gap;
        next = i;
      }
    }
    // The short local average tolerates spline noise at the named apex. The
    // strongest sample sets the relative falloff, capped below so a sharp
    // spline peak cannot end the guide while its broader shoulder still turns.
    let turn = 0,
      peak = 0;
    const radius = Math.min(18, previousGap / 4, nextGap / 4);
    for (let i = -3; i <= 3; i++) {
      const curvature = track.at(corner.s + (i * radius) / 3, sample).curvature;
      turn += curvature;
      peak = Math.max(peak, Math.abs(curvature));
    }
    const sign = turn < 0 ? -1 : 1,
      threshold = clamp(peak * 0.26, 0.0008, 0.0025),
      direction = peak < 0.0008 ? 'straight' : sign > 0 ? 'left' : 'right';
    const extent = (side: number, gap: number, maximum: number) => {
      const limit = Math.min(maximum, gap * 0.48),
        minimum = Math.min(12, limit);
      let quiet = 0;
      for (let distance = 4; distance <= limit; distance += 4) {
        const curvature = track.at(corner.s + side * distance, sample).curvature * sign;
        if (curvature < threshold) quiet++;
        else quiet = 0;
        // Three samples reject a momentary low-curvature seam. Return the
        // start of that quiet section, keeping advice out of the next bend.
        if (quiet >= 3) return Math.max(minimum, distance - 8);
      }
      return limit;
    };
    const entry = extent(-1, previousGap, 240),
      exit = extent(1, nextGap, 280);
    return {
      entry,
      exit,
      apexWindow: Math.min(18, entry / 4, exit / 4),
      direction,
      next,
      nextGap,
    };
  });
}

/** Dedicated original motorcycle-GP venues, in menu order. */
export const GP_COURSE_IDS = Object.freeze([
  'poggio-alto',
  'cape-wrenna',
  'haarveld',
  'montejaral',
  'steinhorn',
  'zafra-night',
] as const);
export type GpCourseId = (typeof GP_COURSE_IDS)[number];

/** Dedicated original motorcycle-GP venues. Shared between their course
 * furniture and reference planning; selecting another vehicle does not change
 * the physical venue or hide its permanent braking landmarks. */
export function isGpCourse(track: Track) {
  return GP_COURSE_IDS.includes(track.circuit.id as GpCourseId);
}
