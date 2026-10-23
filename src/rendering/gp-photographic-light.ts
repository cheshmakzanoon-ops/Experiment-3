import { GP_CLEAR_SKY } from './assets/sky-catalogue.ts';
import type { GradeProfile } from './broadcast-grade.ts';
import type { LightingMode } from './daylight.ts';
import type { ToneMapper } from './options.ts';

/**
 * GP photographic light (W1 hyperrealism): the light balance, air, sky,
 * display transform and grade of a MotoGP broadcast, applied only while the
 * followed machine is a GP prototype on a live circuit view by day or golden
 * hour. Formula, motocross, road bikes, the festival, every studio/showroom
 * and floodlit nights keep the shared circuit light.
 *
 * Measured, not assumed (median display-linear Rec.709 luminance of front-lit
 * tarmac against the bike's cast shadow on the same tarmac, and sRGB colour):
 *
 * | | lit : shadow | lit R/B | shadow B/R |
 * | --- | --- | --- | --- |
 * | REF_019 / REF_006 / REF_020 | 2.9 / 3.8 / 3.0 | 1.14-1.16 | 1.10-1.59 |
 * | Shared light, ACES, Poggio Alto grid / 27 s | 5.9 / 8.8 (mean) | 1.02 | 1.2-1.5 |
 * | Fill cut to 0.5 (first GP draft) | 13-16 | 0.99 | 1.8-2.4 |
 * | ACES, fill 1.0 / 1.6 (clear sky) | 7.7 / 4.8 | 0.93 / 0.88 | 2.0 / 1.9 |
 * | AgX, fill 1.0 / 1.4 (clear sky) | 4.1 / 3.1 | 0.96 / 0.93 | 1.8 / 1.7 |
 *
 * So the shared light's cast shadows are already DEEPER than the references,
 * mostly because ACES's toe crushes the shadow band; what read as flat and
 * cartoony was the cumulus sky, the cool neutral key, the small, high-framed
 * subject and the lack of depth (see gp-photographic-camera.ts). The GP look:
 *
 *  - `toneMapper`: AgX (soft toe and highlight roll-off; three 0.180), with
 *    the grade's filmic black point, instead of ACES on Low-High. It opens the
 *    shadow band to the reference ratio without washing out the key.
 *  - `sun` / `hemisphereFill`: the 3x aerosol haze (`haze`) takes a little of
 *    the direct beam (0.85) and the bias fill rises 1.3x; the diffuse sky
 *    share stays at the dome (`skyFill` <= 1: the IBL split keeps specular
 *    sky at the dome's radiance and cannot go below a gain of 1).
 *  - `sunTint` warms the key over the shared ~5000 K sun (lit tarmac R/B
 *    toward 1.1 under a blue open shade).
 *  - `exposureEV` re-centres the authored exposure for the dimmer beam (the
 *    adaptive meter keys on the bright 90th percentile).
 *  - `haze` multiplies the aerosol term of the aerial perspective: distant
 *    ridges and tree lines go blue-grey at 1-3 km (REF_003/044/045/046)
 *    instead of the shared clear sky's 40 km visibility.
 *  - `clearSky` puts a clear photographed day sky ahead of venue ramps that
 *    open with cumulus (assets/sky-catalogue.ts withClearSky), as every
 *    lighting reference is shot under a clear sky; null keeps the venue's.
 *  - `grade` is the GP broadcast grade over AgX (broadcast-grade.ts): a light
 *    S-curve, saturation that offsets AgX's mid-chroma desaturation, warm key
 *    and cool shade split toning, a subtle optical vignette and grain below
 *    one code value.
 *
 * Pure data and pure functions of the presented lighting: no time source.
 */
export interface GpPhotographicLook {
  skyFill: number;
  hemisphereFill: number;
  sun: number;
  /** Key colour multiplier (linear RGB, peak 1) over the shared sun colour. */
  sunTint: readonly [number, number, number];
  exposureEV: number;
  haze: number;
  clearSky: string | null;
  /** Display transform for GP frames (null: the preset's own). */
  toneMapper: ToneMapper | null;
  grade: Readonly<Record<'day' | 'sunset', Readonly<GradeProfile>>>;
}

export const GP_PHOTOGRAPHIC: Readonly<GpPhotographicLook> = Object.freeze({
  skyFill: 1,
  hemisphereFill: 1.3,
  sun: 0.85,
  sunTint: Object.freeze([1, 0.955, 0.86] as const),
  exposureEV: 0.12,
  haze: 3,
  clearSky: GP_CLEAR_SKY,
  toneMapper: 'agx',
  grade: Object.freeze({
    day: Object.freeze({
      contrast: 0.14,
      saturation: 1.12,
      vibrance: 0.12,
      shadowTint: Object.freeze([0.97, 0.99, 1.04] as const),
      highlightTint: Object.freeze([1.045, 1.0, 0.94] as const),
      vignette: 0.18,
      fringe: 0,
      grain: 0.01,
      sharpen: 0,
    }),
    sunset: Object.freeze({
      contrast: 0.13,
      saturation: 1.1,
      vibrance: 0.1,
      shadowTint: Object.freeze([0.95, 0.98, 1.06] as const),
      highlightTint: Object.freeze([1.06, 1.0, 0.92] as const),
      vignette: 0.2,
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
  // Diffuse share only down: the specular IBL gain cannot fall below 1.
  light.environment *= Math.min(1, Math.max(0.05, positive(look.skyFill, 1)));
  light.exposure *= 2 ** (Number.isFinite(look.exposureEV) ? look.exposureEV : 0);
  light.haze *= positive(look.haze, 1);
  return light;
}

/** Multiply `color` (the shared key colour, linear RGB) by the look's sun
 * tint; a non-finite or negative channel leaves that channel unchanged. */
export function tintGpSun(
  color: { r: number; g: number; b: number },
  look: Readonly<GpPhotographicLook> = GP_PHOTOGRAPHIC,
) {
  const t = look.sunTint ?? [1, 1, 1];
  const ok = (v: number) => (Number.isFinite(v) && v >= 0 ? v : 1);
  color.r *= ok(t[0]);
  color.g *= ok(t[1]);
  color.b *= ok(t[2]);
  return color;
}

/** The GP grade for a lighting profile, or null where the shared grade stays. */
export function gpGradeProfile(
  profile: LightingMode | 'studio',
  look: Readonly<GpPhotographicLook> = GP_PHOTOGRAPHIC,
): Readonly<GradeProfile> | null {
  return profile === 'day' || profile === 'sunset' ? look.grade[profile] : null;
}
