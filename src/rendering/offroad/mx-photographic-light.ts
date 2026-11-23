import { GP_CLEAR_SKY } from '../assets/sky-catalogue.ts';
import type { GradeProfile } from '../broadcast-grade.ts';
import type { GpPhotographicLook } from '../gp-photographic-light.ts';
import type { LightingMode } from '../daylight.ts';

/**
 * Motocross daylight look: the light balance, air and grade of an outdoor
 * national on a dry afternoon, applied only while the followed machine is a
 * motocross bike on a live terrain venue by day or golden hour. It reuses the
 * GP photographic-look terms (gp-photographic-light.ts) and nothing else in
 * the shared renderer: Formula, GP, road bikes, the festival, every
 * showroom/studio and the floodlit stadium keep the light they had.
 *
 *  - `sun` / `hemisphereFill`: a stronger key over a slightly lower bias fill.
 *    Worked soil is all small relief; ruts, braking bumps and jump faces only
 *    read when the key separates their lit and shaded sides.
 *  - `sunTint` warms the key toward a low sun over ochre ground, leaving the
 *    open shade in the ruts and behind the berms cool.
 *  - `haze` adds the dust a pack hangs in the air (2.3x the clear-day
 *    aerosol): tree lines, the far side of the course and the hills behind
 *    fall back in warm-grey depth instead of sitting at full contrast.
 *  - `toneMapper` AgX (as the GP look): a soft toe that keeps detail in the
 *    ruts, under the bike and in the kit's dark panels, and a filmic roll-off
 *    on sunlit plastics and sky instead of ACES's crushed shadows. The grade
 *    adds back the mid-chroma AgX takes out.
 *  - `grade`: a firmer S-curve and more vibrance than the shared grade (soil,
 *    grass and kit colours are all mid-saturation), a warm key / cool shade
 *    split and a light optical vignette. No grain, fringe or sharpening.
 *
 * Pure data and a pure predicate of the presented lighting: no time source.
 */
export const MX_PHOTOGRAPHIC: Readonly<GpPhotographicLook> = Object.freeze({
  skyFill: 1,
  hemisphereFill: 0.9,
  sun: 1.12,
  sunTint: Object.freeze([1, 0.95, 0.85] as const),
  exposureEV: 0.08,
  haze: 2.3,
  // The outdoor reference valley has open sky above its own wooded ridges.
  // The shared clear-noon stop masks the photographed terrain below 9 degrees.
  clearSky: GP_CLEAR_SKY,
  toneMapper: 'agx',
  grade: Object.freeze({
    day: Object.freeze({
      contrast: 0.2,
      saturation: 1.16,
      vibrance: 0.2,
      shadowTint: Object.freeze([0.965, 0.99, 1.045] as const),
      highlightTint: Object.freeze([1.04, 1.005, 0.95] as const),
      vignette: 0.16,
      fringe: 0,
      grain: 0,
      sharpen: 0,
    }),
    sunset: Object.freeze({
      contrast: 0.19,
      saturation: 1.15,
      vibrance: 0.16,
      shadowTint: Object.freeze([0.95, 0.98, 1.06] as const),
      highlightTint: Object.freeze([1.06, 1.0, 0.92] as const),
      vignette: 0.18,
      fringe: 0,
      grain: 0,
      sharpen: 0,
    }),
  }),
});

/** Whether the motocross look applies this frame: a followed motocross bike
 * on a terrain venue's live view by day or golden hour (never a showroom,
 * the photo studio backdrop, a paved circuit or a floodlit night). */
export function mxPhotographicActive(
  classId: string | undefined,
  studio: boolean,
  lighting: LightingMode,
  terrainVenue: boolean,
) {
  return classId === 'motocross' && terrainVenue && !studio && lighting !== 'night';
}

/** Evening supercross broadcast inside the stadium: the arena falls dark and
 * the floodlit floor carries the picture. The directional key stands for the
 * dominant floodlight bank and is strengthened so riders cast crisp shadows
 * on the dirt; the bias fill and the sky share drop so the stands sit well
 * below the track, lit only by spill; exposure comes down so the floor pools
 * keep their texture; the haze (dust hanging under the roof) thickens so the
 * floodlight shafts and roost read in the air. AgX with a firm, slightly cool
 * broadcast grade. Applied only to a followed motocross bike on a supercross
 * venue at night (the stadium's only lighting); nothing else changes. */
export const MX_ARENA_PHOTOGRAPHIC: Readonly<GpPhotographicLook> = Object.freeze({
  skyFill: 0.55,
  hemisphereFill: 0.5,
  sun: 1.55,
  sunTint: Object.freeze([0.96, 0.98, 1] as const),
  exposureEV: -0.3,
  haze: 2.6,
  clearSky: null,
  toneMapper: 'agx',
  grade: Object.freeze({
    day: Object.freeze({
      contrast: 0.27,
      saturation: 1.2,
      vibrance: 0.22,
      shadowTint: Object.freeze([0.93, 0.97, 1.09] as const),
      highlightTint: Object.freeze([1.03, 1.0, 0.96] as const),
      vignette: 0.26,
      fringe: 0,
      grain: 0,
      sharpen: 0,
    }),
    sunset: Object.freeze({
      contrast: 0.27,
      saturation: 1.2,
      vibrance: 0.22,
      shadowTint: Object.freeze([0.93, 0.97, 1.09] as const),
      highlightTint: Object.freeze([1.03, 1.0, 0.96] as const),
      vignette: 0.26,
      fringe: 0,
      grain: 0,
      sharpen: 0,
    }),
  }),
});
/** The arena grade (the stadium is always lit for the evening programme). */
export const MX_ARENA_GRADE: Readonly<GradeProfile> = MX_ARENA_PHOTOGRAPHIC.grade.day;

/** Whether the arena look applies: a followed motocross bike on a supercross
 * venue's live view at night (never a showroom or photo studio backdrop). */
export function mxArenaActive(
  classId: string | undefined,
  studio: boolean,
  lighting: LightingMode,
  supercross: boolean,
) {
  return classId === 'motocross' && supercross && !studio && lighting === 'night';
}
