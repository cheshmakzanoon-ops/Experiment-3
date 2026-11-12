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
 *  - `haze` adds the dust a pack hangs in the air: tree lines and the far
 *    side of the course fall back instead of sitting at full contrast.
 *  - `toneMapper` null: the preset's own display transform is kept.
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
  exposureEV: 0,
  haze: 1.6,
  clearSky: null,
  toneMapper: null,
  grade: Object.freeze({
    day: Object.freeze({
      contrast: 0.21,
      saturation: 1.1,
      vibrance: 0.22,
      shadowTint: Object.freeze([0.965, 0.99, 1.045] as const),
      highlightTint: Object.freeze([1.04, 1.005, 0.95] as const),
      vignette: 0.16,
      fringe: 0,
      grain: 0,
      sharpen: 0,
    }),
    sunset: Object.freeze({
      contrast: 0.2,
      saturation: 1.1,
      vibrance: 0.18,
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
