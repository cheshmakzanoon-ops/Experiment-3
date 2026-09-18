import { clamp, lerp, smooth } from '../core/math.ts';
import type { WeatherPreset } from './config.ts';

/** SI units except rain (mm/hour) and explicit Celsius. Direction is where the
 * air travels: zero is +Z, pi/2 is +X; this is not meteorological 'wind from'. */
export interface WeatherKeyframe {
  timeSec: number;
  cloudCover01: number;
  rainRateMmHr: number;
  ambientTempC: number;
  windSpeedMS: number;
  windDirection: number;
}
export interface WeatherState {
  cloud: number;
  rain: number;
  ambient: number;
  windX: number;
  windZ: number;
}
const LIMITS: Record<keyof WeatherKeyframe, readonly [number, number]> = {
  timeSec: [0, 86400], cloudCover01: [0, 1], rainRateMmHr: [0, 100],
  ambientTempC: [-30, 60], windSpeedMS: [0, 40], windDirection: [-Math.PI * 2, Math.PI * 2],
};

/** Validated, immutable weather data. Sampling is allocation-free, seekable and
 * independent of the number or spacing of calls (including replay rewinds).
 * Smooth bounded interpolation never creates negative rain or overshoot. */
export class WeatherTimeline {
  readonly keyframes: readonly Readonly<WeatherKeyframe>[];
  constructor(frames: readonly WeatherKeyframe[]) {
    if (!Array.isArray(frames) || frames.length < 1 || frames.length > 256)
      throw new Error('Weather timeline requires 1–256 keyframes');
    this.keyframes = Object.freeze(frames.map((frame, index) => {
      if (!frame || typeof frame !== 'object') throw new Error('Invalid weather keyframe');
      const copy = {} as WeatherKeyframe;
      for (const key of Object.keys(LIMITS) as (keyof WeatherKeyframe)[]) {
        const value = frame[key], [min, max] = LIMITS[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
          throw new Error(`Invalid weather ${key}`);
        copy[key] = value;
      }
      if ((index === 0 && copy.timeSec !== 0) || (index > 0 && copy.timeSec <= frames[index - 1].timeSec))
        throw new Error('Weather times must start at zero and increase strictly');
      return Object.freeze(copy);
    }));
  }
  sample(timeSec: number, out: WeatherState): WeatherState {
    if (!Number.isFinite(timeSec)) throw new Error('Invalid weather sample time');
    const frames = this.keyframes;
    let lo = 0, hi = frames.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (frames[mid].timeSec <= timeSec) lo = mid;
      else hi = mid;
    }
    const a = frames[lo], b = frames[hi];
    const t = hi === lo ? 0 : smooth(a.timeSec, b.timeSec, timeSec);
    out.cloud = lerp(a.cloudCover01, b.cloudCover01, t);
    out.rain = lerp(a.rainRateMmHr, b.rainRateMmHr, t);
    out.ambient = lerp(a.ambientTempC, b.ambientTempC, t);
    // Interpolate direction on the short arc: 350° -> 10° crosses north, not south.
    const angle = a.windDirection + Math.atan2(
      Math.sin(b.windDirection - a.windDirection), Math.cos(b.windDirection - a.windDirection),
    ) * t;
    const speed = lerp(a.windSpeedMS, b.windSpeedMS, t);
    out.windX = Math.sin(angle) * speed;
    out.windZ = Math.cos(angle) * speed;
    return out;
  }
}

const calmSpeed = Math.hypot(1.5, 0.6), calmDirection = Math.atan2(1.5, 0.6);
/** Original scenario calibration, not a real-world meteorological forecast.
 * Clear and rain retain the previous constant conditions. The changing preset
 * now contains a complete advancing storm and retreat, not permanent rain. */
export function weatherKeyframes(preset: WeatherPreset): readonly WeatherKeyframe[] {
  const frame = (timeSec: number, cloudCover01: number, rainRateMmHr: number,
    ambientTempC: number, windSpeedMS = calmSpeed, windDirection = calmDirection): WeatherKeyframe =>
    ({ timeSec, cloudCover01, rainRateMmHr, ambientTempC, windSpeedMS, windDirection });
  if (preset === 'clear') return [frame(0, 0.12, 0, 24)];
  if (preset === 'rain') return [frame(0, 0.95, 24, 19)];
  return [
    frame(0, 0.16, 0, 25),
    frame(25, 0.16, 0, 25),
    frame(60, 0.43, 0, 25, 2.2, 1.05),
    frame(115, 0.95, 29.7, 22.4, 3.2, 0.8),
    frame(135, 0.95, 36, 20.9, 3.8, 0.65),
    frame(180, 0.95, 36, 19, 4.2, 0.55),
    frame(420, 0.95, 36, 19, 4.2, 0.55),
    frame(600, 0.8, 12, 20, 3.2, 0.2),
    frame(720, 0.58, 0, 21.5, 2.4, -0.1),
    frame(900, 0.22, 0, 24, 1.4, -0.25),
  ];
}

/** Exact constant-input first-order surface step. k is drainage/second,
 * source is rainfall minus evaporation in mm/second. Unlike forward Euler,
 * bounded water and temperature remain stable for a delayed surface update. */
export function advanceWater(waterMm: number, sourceMmSec: number, drainagePerSec: number, dt: number) {
  if (![waterMm, sourceMmSec, drainagePerSec, dt].every(Number.isFinite) ||
      waterMm < 0 || drainagePerSec < 0 || dt < 0) throw new Error('Invalid surface water step');
  if (drainagePerSec < 1e-12) return Math.max(0, waterMm + sourceMmSec * dt);
  const gain = -Math.expm1(-drainagePerSec * dt);
  return Math.max(0, waterMm * (1 - gain) + sourceMmSec * gain / drainagePerSec);
}

/** The render state is transported with each physics/replay frame, never sampled
 * from a second wall clock on the main thread. Defensive bounds are only for
 * presentation; malformed simulation state is still rejected by the worker. */
export function renderWind(value: number) {
  return Number.isFinite(value) ? clamp(value, -40, 40) : 0;
}
