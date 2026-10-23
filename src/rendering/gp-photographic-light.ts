import { GP_CLEAR_SKY } from './assets/sky-catalogue.ts';
import type { GradeProfile } from './broadcast-grade.ts';
import type { LightingMode } from './daylight.ts';

/**
 * GP photographic light (W1 hyperrealism): the light balance, air and grade a
 * MotoGP broadcast/photograph is made of, applied only while the followed
 * machine is a GP prototype on a live circuit view. Formula, motocross, road
 * bikes, the festival and every studio/showroom keep the shared circuit light.
 *
 * Reference measurements (MotoGP 26 pack; display-linear Rec.709 luminance of
 * front-lit tarmac against the bike's own cast shadow on the same tarmac):
 * REF_019 2.91, REF_006 3.60, REF_020 2.87 (REF_001 is back-lit: 1.47). Lit
 * tarmac is warm (sRGB R/B 1.16), open shadow cool (B/R 1.14-1.6). The
 * physical circuit light put the whole visible dome into the shadows at full
 * strength (environment 1) plus a hemisphere fill, which left cast shadows
 * at about half the lit level: the flat, high-ambient read of the game.
 *
 *  - `skyFill` scales only the DIFFUSE sky light (scene.environmentIntensity).
 *    The specular sky stays at the dome's on-screen radiance because the IBL
 *    split (studio/ibl-energy.ts) raises its gain to 1 / environment, so paint,
 *    visors and glass still mirror the real sky.
 *  - `hemisphereFill` scales the small hemisphere bias light.
 *  - `exposureEV` re-centres the authored exposure for the darker fill (the
 *    adaptive meter keys on the bright 90th percentile, so the sunlit side
 *    stays put while shadows fall).
 *  - `haze` multiplies the aerosol term of the aerial perspective: distant
 *    ridges and tree lines go blue-grey at 1-3 km (REF_003/044/045/046)
 *    instead of the 40 km visibility of the shared clear sky.
 *  - `shadowSaturation` keeps more of the sky's blue in the diffuse fill
 *    (cool open shade under a warm key; 0.75 is the shared day value).
 *  - `clearSky` puts a clear photographed day sky ahead of venue ramps that
 *    open with cumulus (assets/sky-catalogue.ts withClearSky), as every
 *    lighting reference is shot under a clear sky; null keeps the venue's.
 *  - `grade` is the GP broadcast grade over ACES (broadcast-grade.ts).
 *
 * Pure data and pure functions of the presented lighting: no time source.
 */
export interface GpPhotographicLook {
  skyFill: number;
  hemisphereFill: number;
  sun: number;
  exposureEV: number;
  haze: number;
  shadowSaturation: number;
  clearSky: string | null;
  grade: Readonly<Record<'day' | 'sunset', Readonly<GradeProfile>>>;
}

export const GP_PHOTOGRAPHIC: Readonly<GpPhotographicLook> = Object.freeze({
  skyFill: 0.5,
  hemisphereFill: 0.5,
  sun: 1,
  exposureEV: 0.25,
  haze: 3,
  shadowSaturation: 0.9,
  clearSky: GP_CLEAR_SKY,
  grade: Object.freeze({
    day: Object.freeze({
      contrast: 0.24,
      saturation: 1.08,
      vibrance: 0.2,
      shadowTint: Object.freeze([0.955, 0.99, 1.06] as const),
      highlightTint: Object.freeze([1.04, 1.005, 0.95] as const),
      vignette: 0.2,
      fringe: 0,
      grain: 0.01,
      sharpen: 0,
    }),
    sunset: Object.freeze({
      contrast: 0.22,
      saturation: 1.08,
      vibrance: 0.16,
      shadowTint: Object.freeze([0.94, 0.98, 1.08] as const),
      highlightTint: Object.freeze([1.06, 1.0, 0.92] as const),
      vignette: 0.22,
      fringe: 0,
      grain: 0.01,
      sharpen: 0,
    }),
  }),
});

/** Whether the GP look applies this frame: a followed GP prototype on a live
 * circuit view by day or golden hour (never the menu showroom, photo studio
 * backdrop or a floodlit night, whose venue light is authored separately). */
export function gpPhotographicActive(
  classId: string | undefined,
  studio: boolean,
  lighting: LightingMode,
) {
  return classId === 'gp-bike' && !studio && lighting !== 'night';
}

/** The daylight terms the look rebalances (daylight.ts circuitLightState). */
export interface GpDaylightTerms {
  sun: number;
  fill: number;
  environment: number;
  exposure: number;
  haze: number;
}

/** Rebalance `light` in place for a GP frame; returns it. Every term stays
 * finite and positive for any finite look. */
export function applyGpDaylight<L extends GpDaylightTerms>(
  light: L,
  look: Readonly<GpPhotographicLook> = GP_PHOTOGRAPHIC,
): L {
  const positive = (value: number, fallback: number) =>
    Number.isFinite(value) && value >= 0 ? value : fallback;
  light.sun *= positive(look.sun, 1);
  light.fill *= positive(look.hemisphereFill, 1);
  light.environment *= Math.max(0.05, positive(look.skyFill, 1));
  light.exposure *= 2 ** (Number.isFinite(look.exposureEV) ? look.exposureEV : 0);
  light.haze *= positive(look.haze, 1);
  return light;
}

/** The GP grade for a lighting profile, or null where the shared grade stays. */
export function gpGradeProfile(
  profile: LightingMode | 'studio',
  look: Readonly<GpPhotographicLook> = GP_PHOTOGRAPHIC,
): Readonly<GradeProfile> | null {
  return profile === 'day' || profile === 'sunset' ? look.grade[profile] : null;
}
