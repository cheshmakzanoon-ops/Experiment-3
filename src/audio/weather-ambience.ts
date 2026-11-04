import { clamp, smooth } from '../core/math.ts';
import { H } from '../simulation/protocol.ts';
import { lightningIntensity, snowfallMmHr, thunderLevel } from '../simulation/weather.ts';

/** Ambient bed of the atmosphere states (fog, dust, thunderstorm), as pure
 * functions of the presented snapshot so a paused frame, a replay and the live
 * session sound alike. The engine (audio/engine.ts) feeds the numbers to its
 * noise beds; nothing here owns an audio node.
 *
 *  - gale: a strong or gusting wind howls even when the car is stationary
 *    (the engine's own wind bed follows the car's airspeed, which is nothing
 *    at a standstill). The gust surges are already inside H.WIND_X/Z, so the
 *    howl swells with them. Silent below a breeze (3 m/s).
 *  - grit: wind-borne sand on the bodywork, a band of noise near 2.8 kHz,
 *    scaled by how much dust is in the air and how hard it is blown.
 *  - thunder: weather.ts thunderLevel at the session time, delayed by the
 *    distance of the strike (the flash is seen first).
 *  - fog: cold, damp, still air hushes the world: the master low-pass closes
 *    and the level falls a little.
 *  - snow: falling snow absorbs the highs (the air is full of soft, porous
 *    flakes): a further low-pass closing to ~55 % of its corner and a slight
 *    level drop while it falls. The crunch of tyres on a snow-covered road is
 *    the contact bed's `snow` layer (surface-audio.ts, driven by the wheel's
 *    reported surface), not this master bus.
 * Clear air and ordinary rain return the neutral values (no gale below 3 m/s,
 * no grit, no thunder below 40 mm/h, the master open at 18 kHz). */
export interface WeatherAmbience {
  gale: number;
  galeHz: number;
  grit: number;
  thunder: number;
  masterLowpassHz: number;
  masterGain: number;
}
export const newWeatherAmbience = (): WeatherAmbience => ({
  gale: 0,
  galeHz: 700,
  grit: 0,
  thunder: 0,
  masterLowpassHz: 18000,
  masterGain: 1,
});
const finite = (v: number) => (Number.isFinite(v) ? v : 0);

export function weatherAmbience(frame: Float32Array, out = newWeatherAmbience()): WeatherAmbience {
  const wind = Math.hypot(finite(frame[H.WIND_X]), finite(frame[H.WIND_Z])),
    extinction = Math.max(0, finite(frame[H.EXTINCTION])),
    dust = clamp(finite(frame[H.DUST]), 0, 1),
    body = smooth(0.4, 14, extinction),
    rain = Math.max(0, finite(frame[H.RAIN])),
    time = finite(frame[H.TIME]);
  const blow = smooth(3, 16, wind);
  out.gale = blow * blow * 0.2;
  // The howl brightens as the wind rises (a stronger gust is a higher note).
  out.galeHz = 420 + 60 * Math.min(wind, 20);
  out.grit = body * dust * smooth(4, 14, wind) * 0.1;
  out.thunder = thunderLevel(time, lightningIntensity(rain)) * 0.45;
  const fog = body * (1 - dust),
    ambient = Number.isFinite(frame[H.AMBIENT]) ? frame[H.AMBIENT] : 20,
    snow = smooth(0.05, 1.2, snowfallMmHr(rain, ambient));
  out.masterLowpassHz = (18000 - 11500 * fog) * (1 - 0.45 * snow);
  out.masterGain = (1 - 0.15 * fog) * (1 - 0.1 * snow);
  return out;
}
