import * as T from 'three';
import { clamp, lerp, smooth } from '../core/math.ts';
import { H } from '../simulation/protocol.ts';
import {
  effectiveVisibilityM,
  lightningFlash,
  lightningIntensity,
  liquidRain,
  snowfallMmHr,
} from '../simulation/weather.ts';
import {
  aerialUniforms,
  setAerialExtinction,
  type AerialUniforms,
} from './studio/aerial-perspective.ts';

/**
 * Atmosphere states beyond rain: fog, dust and thunderstorm.
 *
 * Everything here is a PURE function of the presented snapshot (H.EXTINCTION,
 * H.DUST, H.RAIN, H.TIME), so a paused frame, a replay and the live session
 * show the same air. It adds no render pass, texture or particle: the scene's
 * Beer-Lambert aerial perspective (studio/aerial-perspective.ts) already
 * extinguishes every lit material per fragment, so fog and dust are the SAME
 * mechanism as the sky's own haze, only denser, with
 *  - a per-channel spectrum (grey droplets, blue-absorbing dust),
 *  - a lower scale height for fog (a bank a few hundred metres deep) so
 *    towers and the sky above stay readable,
 *  - the fog / dust / storm colour of the veil the dome shows at its horizon
 *    (otherwise the dome would cut out against the near fog like a backdrop),
 *  - the lighting that goes with it: the direct sun smothered, sky light
 *    brightened by scattering, a warm sun and sky under dust, a darker
 *    exposure under a storm deck, and lightning (weather.ts) as a global flash.
 * Clear air (H.EXTINCTION = 0, no storm) leaves every number unchanged.
 */
export const WEATHER_LOOK = Object.freeze({
  /** Extinction (per km, beyond clear air) at which fog / dust is fully "on"
   * for the look (about 280 m): the extinction itself is always exact. */
  fullPerKm: 14,
  onsetPerKm: 0.4,
  /** Scale height (m) of the obscuring layer: fog bank, dust column. */
  fogScaleHeight: 240,
  dustScaleHeight: 650,
  fog: Object.freeze({
    sun: 0.45,
    fill: 1.35,
    exposure: 1.06,
    veil: 0.92,
    veilReach: 0.55,
    /** Golden hour (the circuit's sunset lighting) over a ground fog is a dawn:
     * a low sun behind a shallow bank is lit through its length, so the bank
     * glows with the sun's colour rather than closing it out. The bank still
     * smothers the disc, much less, and the haze takes the warm chroma. */
    golden: Object.freeze({
      sun: 0.92,
      fill: 1.12,
      /** Linear chroma of the lit bank, normalised to luminance 1. */
      chroma: Object.freeze([1.0, 0.76, 0.52] as const),
      brightness: 1.05,
      sunTint: Object.freeze([1.0, 0.8, 0.58] as const),
      skyTint: Object.freeze([1.0, 0.86, 0.7] as const),
    }),
  }),
  dust: Object.freeze({
    sun: 0.14,
    fill: 1.7,
    exposure: 1,
    veil: 0.9,
    veilReach: 1.4,
    /** Linear chroma of dust-laden light, normalised to luminance 1. */
    chroma: Object.freeze([1.0, 0.52, 0.22] as const),
    sunTint: Object.freeze([1.0, 0.55, 0.24] as const),
    skyTint: Object.freeze([0.92, 0.56, 0.3] as const),
    fogBrightness: 0.8,
  }),
  /** Falling snow and a settled white ground: a soft, cool, shadowless light
   * (the sun is mostly lost in the deck, the sky and the white ground fill),
   * and a bluish haze. `cover` is the settled scenery cover (0..1). */
  snow: Object.freeze({
    sun: 0.75,
    fill: 1.18,
    exposure: 1.04,
    /** Extra fill a white ground bounces back up at full cover. */
    bounce: 1.12,
    /** Exposure given back at full cover so a white road does not clip. */
    coverExposure: 0.93,
    chroma: Object.freeze([0.88, 0.97, 1.12] as const),
    fogBrightness: 0.96,
  }),
  storm: Object.freeze({
    sun: 0.8,
    exposure: 1.2,
    veil: 0.55,
    veilReach: 3,
    /** Dark steel: the underside of a convective deck (linear radiance). The
     * first capture, at 0.03, left the car and the road unreadable. */
    deck: Object.freeze([0.07, 0.078, 0.095] as const),
    /** Whole-scene gain of a lightning flash (fill, sky light, sun). */
    flashFill: 4,
    flashEnvironment: 1.4,
    flashSun: 0.9,
  }),
});

export interface WeatherAtmosphere {
  extinctionPerKm: number;
  dust: number;
  rain: number;
  time: number;
  /** What the driver sees (m), rain included. */
  visibilityM: number;
  fog: number;
  dustAmount: number;
  storm: number;
  /** Falling snow 0..1 (water-equivalent rate against its onset and full). */
  snow: number;
  /** Settled snow on the scenery 0..1 (from the road-surface keyframe). */
  cover: number;
  flash: number;
  /** FogExp2 density that puts the unlit fallback at ~98 % at the visibility. */
  exp2Density: number;
  sunScale: number;
  fillScale: number;
  exposureScale: number;
  veil: T.Vector4;
  veilReach: number;
}
export const newWeatherAtmosphere = (): WeatherAtmosphere => ({
  extinctionPerKm: 0,
  dust: 0,
  rain: 0,
  time: 0,
  visibilityM: 30000,
  fog: 0,
  dustAmount: 0,
  storm: 0,
  snow: 0,
  cover: 0,
  flash: 0,
  exp2Density: 0,
  sunScale: 1,
  fillScale: 1,
  exposureScale: 1,
  veil: new T.Vector4(),
  veilReach: 1,
});

const finite = (v: number) => (Number.isFinite(v) ? v : 0);

/** Read the obscuring air from a presented snapshot. Missing or non-finite
 * channels (older recordings) read as clear air. */
export function weatherAtmosphere(
  frame: Float32Array,
  out = newWeatherAtmosphere(),
  /** Settled scenery cover 0..1 (weather-presentation.ts sceneryCover). */
  cover = 0,
) {
  const look = WEATHER_LOOK;
  out.extinctionPerKm = Math.max(0, finite(frame[H.EXTINCTION]));
  out.dust = clamp(finite(frame[H.DUST]), 0, 1);
  // Below freezing the precipitation channel is snow, not rain: rain extinction,
  // wet surfaces and lightning follow the liquid part only.
  const precipitation = Math.max(0, finite(frame[H.RAIN])),
    ambient = Number.isFinite(frame[H.AMBIENT]) ? frame[H.AMBIENT] : 20;
  out.rain = Math.max(0, liquidRain(precipitation, ambient));
  out.snow = smooth(0.05, 1.2, snowfallMmHr(precipitation, ambient));
  out.cover = clamp(finite(cover), 0, 1);
  out.time = finite(frame[H.TIME]);
  out.visibilityM = effectiveVisibilityM(out.extinctionPerKm, out.rain);
  const body = smooth(look.onsetPerKm, look.fullPerKm, out.extinctionPerKm);
  out.fog = body * (1 - out.dust);
  out.dustAmount = body * out.dust;
  out.storm = lightningIntensity(out.rain);
  out.flash = lightningFlash(out.time, out.storm);
  out.exp2Density = out.extinctionPerKm > 0 ? 1.978 / out.visibilityM : 0;
  out.sunScale =
    lerp(1, look.fog.sun, out.fog) *
    lerp(1, look.dust.sun, out.dustAmount) *
    lerp(1, look.storm.sun, out.storm) *
    lerp(1, look.snow.sun, out.snow);
  out.fillScale =
    lerp(1, look.fog.fill, out.fog) *
    lerp(1, look.dust.fill, out.dustAmount) *
    lerp(1, look.snow.fill, out.snow) *
    lerp(1, look.snow.bounce, out.cover);
  out.exposureScale =
    lerp(1, look.fog.exposure, out.fog) *
    lerp(1, look.dust.exposure, out.dustAmount) *
    lerp(1, look.storm.exposure, out.storm) *
    lerp(1, look.snow.exposure, out.snow) *
    lerp(1, look.snow.coverExposure, out.cover);
  return out;
}

/** The daylight record the renderer builds each frame (daylight.ts): scaled
 * and tinted in place for the obscuring air and the lightning flash. */
export interface DaylightRecord {
  sun: number;
  fill: number;
  environment: number;
  exposure: number;
  fogDensity: number;
  fogRed: number;
  fogGreen: number;
  fogBlue: number;
}
export function adjustDaylight(
  daylight: DaylightRecord,
  a: WeatherAtmosphere,
  night = false,
  /** Golden-hour lighting (sunset): fog becomes a warm dawn bank. */
  golden = false,
) {
  const look = WEATHER_LOOK;
  if (a.extinctionPerKm <= 0 && a.storm <= 0 && a.snow <= 0 && a.cover <= 0) return daylight;
  const dawn = golden && !night ? a.fog : 0;
  // Floodlit nights keep their authored exposure; the obscuring air still
  // extinguishes (aerial uniforms) and recolours the haze.
  daylight.sun *= night ? 1 : a.sunScale * lerp(1, look.fog.golden.sun / look.fog.sun, dawn);
  daylight.fill *= night ? 1 : a.fillScale * lerp(1, look.fog.golden.fill / look.fog.fill, dawn);
  daylight.exposure *= night ? 1 : a.exposureScale;
  daylight.fogDensity = Math.max(daylight.fogDensity, a.exp2Density);
  if (a.dustAmount > 0) {
    // Dust-laden haze: the lighting's own haze brightness in the dust hue.
    const luma = 0.2126 * daylight.fogRed + 0.7152 * daylight.fogGreen + 0.0722 * daylight.fogBlue;
    const [r, g, b] = look.dust.chroma;
    const norm = 1 / (0.2126 * r + 0.7152 * g + 0.0722 * b);
    const k = a.dustAmount * 0.92,
      target = luma * look.dust.fogBrightness * norm;
    daylight.fogRed = lerp(daylight.fogRed, target * r, k);
    daylight.fogGreen = lerp(daylight.fogGreen, target * g, k);
    daylight.fogBlue = lerp(daylight.fogBlue, target * b, k);
  }
  if (dawn > 0) {
    // The bank takes the colour of the low sun: its own haze brightness in the
    // warm chroma, so a golden-hour fog glows instead of greying.
    const luma = 0.2126 * daylight.fogRed + 0.7152 * daylight.fogGreen + 0.0722 * daylight.fogBlue;
    const [r, g, b] = look.fog.golden.chroma;
    const norm = 1 / (0.2126 * r + 0.7152 * g + 0.0722 * b);
    const k = dawn * 0.9,
      target = luma * look.fog.golden.brightness * norm;
    daylight.fogRed = lerp(daylight.fogRed, target * r, k);
    daylight.fogGreen = lerp(daylight.fogGreen, target * g, k);
    daylight.fogBlue = lerp(daylight.fogBlue, target * b, k);
  }
  if (a.snow > 0 || a.cover > 0) {
    // Cold, bluish haze over snow: the lighting's own haze brightness in a
    // cool hue (the air over a white ground reads blue-white, not brown).
    const luma = 0.2126 * daylight.fogRed + 0.7152 * daylight.fogGreen + 0.0722 * daylight.fogBlue;
    const [r, g, b] = look.snow.chroma;
    const norm = 1 / (0.2126 * r + 0.7152 * g + 0.0722 * b);
    const k = Math.max(a.snow, a.cover * 0.6) * 0.8,
      target = luma * look.snow.fogBrightness * norm;
    daylight.fogRed = lerp(daylight.fogRed, target * r, k);
    daylight.fogGreen = lerp(daylight.fogGreen, target * g, k);
    daylight.fogBlue = lerp(daylight.fogBlue, target * b, k);
  }
  if (a.flash > 0) {
    daylight.fill += look.storm.flashFill * a.flash * (night ? 0.4 : 0.15);
    daylight.environment *= 1 + look.storm.flashEnvironment * a.flash;
    daylight.sun += look.storm.flashSun * a.flash;
  }
  return daylight;
}

/** Warm the key and sky light under dust (after applyCircuitLightPalette). */
export function tintLights(
  sun: { color: T.Color },
  hemisphere: { color: T.Color },
  a: WeatherAtmosphere,
  /** Golden-hour lighting: a fog bank warms the key and the sky light. */
  golden = false,
) {
  if (golden && a.fog > 0) {
    const [sr, sg, sb] = WEATHER_LOOK.fog.golden.sunTint,
      [kr, kg, kb] = WEATHER_LOOK.fog.golden.skyTint,
      s = a.fog * 0.8,
      k = a.fog * 0.7;
    sun.color.r = lerp(sun.color.r, sun.color.r * sr, s);
    sun.color.g = lerp(sun.color.g, sun.color.g * sg, s);
    sun.color.b = lerp(sun.color.b, sun.color.b * sb, s);
    hemisphere.color.r = lerp(hemisphere.color.r, hemisphere.color.r * kr, k);
    hemisphere.color.g = lerp(hemisphere.color.g, hemisphere.color.g * kg, k);
    hemisphere.color.b = lerp(hemisphere.color.b, hemisphere.color.b * kb, k);
  }
  if (a.dustAmount <= 0) return;
  const [sr, sg, sb] = WEATHER_LOOK.dust.sunTint,
    [kr, kg, kb] = WEATHER_LOOK.dust.skyTint,
    s = a.dustAmount * 0.85,
    k = a.dustAmount * 0.75;
  sun.color.r = lerp(sun.color.r, sun.color.r * sr, s);
  sun.color.g = lerp(sun.color.g, sun.color.g * sg, s);
  sun.color.b = lerp(sun.color.b, sun.color.b * sb, s);
  hemisphere.color.r = lerp(hemisphere.color.r, hemisphere.color.r * kr, k);
  hemisphere.color.g = lerp(hemisphere.color.g, hemisphere.color.g * kg, k);
  hemisphere.color.b = lerp(hemisphere.color.b, hemisphere.color.b * kb, k);
}

/** The dome's horizon veil for the current air: fog colour, dust colour and the
 * storm deck blended by their weights (rgb radiance, alpha amount). */
export function skyVeil(
  a: WeatherAtmosphere,
  fogRed: number,
  fogGreen: number,
  fogBlue: number,
  out = new T.Vector4(),
) {
  const look = WEATHER_LOOK,
    wf = a.fog * look.fog.veil,
    wd = a.dustAmount * look.dust.veil,
    ws = a.storm * look.storm.veil,
    total = wf + wd + ws;
  if (total <= 1e-5) {
    a.veilReach = 1;
    return out.set(0, 0, 0, 0);
  }
  const [dr, dg, db] = look.storm.deck;
  a.veilReach =
    (wf * look.fog.veilReach + wd * look.dust.veilReach + ws * look.storm.veilReach) / total;
  // Fog and dust veils are the haze itself; the storm deck is the dark slate.
  const air = wf + wd;
  const r = (air * fogRed + ws * dr) / (air + ws),
    g = (air * fogGreen + ws * dg) / (air + ws),
    b = (air * fogBlue + ws * db) / (air + ws);
  return out.set(r, g, b, 1 - (1 - wf) * (1 - wd) * (1 - ws));
}

/** Bind the air to the shared aerial-perspective uniforms, the scene fog and the
 * sky dome. `aerial` defaults to the circuit renderer's shared uniforms; the
 * festival renderer passes its own. */
export function bindWeatherAtmosphere(
  a: WeatherAtmosphere,
  targets: {
    haze: number;
    studio: boolean;
    fog: { density: number; color: T.Color };
    sky: T.ShaderMaterial;
    aerial?: AerialUniforms;
    /** Default scale height (m) of the clear-sky aerosol layer. */
    baseScaleHeight: number;
  },
) {
  const aerial = targets.aerial ?? aerialUniforms;
  const quiet = targets.studio;
  setAerialExtinction(
    targets.haze,
    quiet ? 0 : a.rain,
    aerial,
    quiet ? 0 : a.extinctionPerKm,
    quiet ? 0 : a.dust,
  );
  // Fog is a bank a couple of hundred metres deep; dust fills a deeper
  // column. Blend by weight so a lifting fog hands the sky back smoothly.
  const bank = quiet ? 0 : Math.min(1, a.fog + a.dustAmount);
  const scale =
    bank > 0
      ? (a.fog * WEATHER_LOOK.fogScaleHeight + a.dustAmount * WEATHER_LOOK.dustScaleHeight) /
        (a.fog + a.dustAmount)
      : targets.baseScaleHeight;
  aerial.apexAerialFalloff.value.y = 1 / lerp(targets.baseScaleHeight, scale, bank);
  const u = targets.sky.uniforms;
  if (u.apexSkyVeil) {
    skyVeil(
      quiet ? { ...a, fog: 0, dustAmount: 0, storm: 0 } : a,
      targets.fog.color.r,
      targets.fog.color.g,
      targets.fog.color.b,
      u.apexSkyVeil.value as T.Vector4,
    );
    (u.apexSkyVeilShape.value as T.Vector2).set(a.veilReach, quiet ? 0 : a.flash);
  }
}
