import { clamp } from '../core/math.ts';
import type { SoundProfile } from './sound-profiles.ts';

/** Engine loudness, designed instead of inherited. The harmonic bands of
 * engine-voices.ts give each family its TIMBRE; how loud a voice is used to be a
 * by-product of its band weights, its waveform's crest factor and its rev range,
 * so engines ranged over 8 dB at mid revs and fell 7 dB towards the limiter
 * (docs/studio/reports/audio.md, rig numbers). This module predicts the
 * K-weighted loudness of a voice from the same numbers the graph is built from
 * and lets the graph scale its bands to a DESIGNED loudness curve: idle low,
 * louder with revs and load, equal across families unless a family is trimmed
 * on purpose.
 *
 * Everything here is pure arithmetic (no Web Audio): the PeriodicWave
 * amplitudes, the voice low-pass and the ITU-R BS.1770 K-weighting are
 * evaluated analytically, so the maths is unit-tested without a browser and
 * the rig (scripts/studio/tools/audio-render.mjs) measures the result. */

const SAMPLE_RATE = 48000;
/** Harmonics a band's PeriodicWave carries (engine-voices.ts). */
export const BAND_HARMONICS = 40;
/** Band frequency multipliers against the firing frequency. */
export const BAND_MULTIPLIER = [0.5, 1, 2] as const;
export type BandIndex = 0 | 1 | 2;

/** The harmonic amplitudes of band `band` of a family (index 0 unused). The
 * family brief: odd/third emphasis and roll-off, exactly as the voices build them. */
export function bandHarmonics(
  profile: Pick<SoundProfile, 'odd' | 'third' | 'rolloff'>,
  band: BandIndex,
): Float32Array {
  const imag = new Float32Array(BAND_HARMONICS);
  for (let k = 1; k < BAND_HARMONICS; k++)
    imag[k] =
      (band === 0 ? (k % 2 ? 1 : profile.odd) : band === 1 ? (k % 3 ? profile.third : 1) : 0.65) /
      k ** (profile.rolloff - band * 0.35);
  return imag;
}

/** Web Audio normalises a PeriodicWave to a peak of 1; so does this. Returns the
 * mean-square of that peak-normalised waveform (a unit sine is 0.5). */
export function normalisedWavePower(imag: Float32Array): { peak: number; power: number } {
  let peak = 0;
  const steps = 2048;
  for (let i = 0; i < steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    let sum = 0;
    for (let k = 1; k < imag.length; k++) sum += imag[k] * Math.sin(k * theta);
    peak = Math.max(peak, Math.abs(sum));
  }
  let power = 0;
  for (let k = 1; k < imag.length; k++) power += (imag[k] / (peak || 1)) ** 2 / 2;
  return { peak, power };
}

function biquadPower(
  b: readonly [number, number, number],
  a: readonly [number, number, number],
  hz: number,
): number {
  const w = (2 * Math.PI * hz) / SAMPLE_RATE,
    c1 = Math.cos(w),
    c2 = Math.cos(2 * w);
  const num =
    b[0] ** 2 + b[1] ** 2 + b[2] ** 2 + 2 * (b[0] * b[1] + b[1] * b[2]) * c1 + 2 * b[0] * b[2] * c2;
  const den =
    a[0] ** 2 + a[1] ** 2 + a[2] ** 2 + 2 * (a[0] * a[1] + a[1] * a[2]) * c1 + 2 * a[0] * a[2] * c2;
  return num / den;
}

/** |H|^2 of the two BS.1770-4 K-weighting stages at `hz` (48 kHz coefficients). */
const K1 = (() => {
  const g = 3.999843853973347,
    q = 0.7071752369554196,
    fc = 1681.974450955533;
  const k = Math.tan((Math.PI * fc) / SAMPLE_RATE),
    vh = 10 ** (g / 20),
    vb = vh ** 0.4996667741545416,
    a0 = 1 + k / q + k * k;
  return {
    b: [
      (vh + (vb * k) / q + k * k) / a0,
      (2 * (k * k - vh)) / a0,
      (vh - (vb * k) / q + k * k) / a0,
    ],
    a: [1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0],
  } as const;
})();
const K2 = (() => {
  const q = 0.5003270373238773,
    fc = 38.13547087602444;
  const k = Math.tan((Math.PI * fc) / SAMPLE_RATE),
    a0 = 1 + k / q + k * k;
  return { b: [1, -2, 1], a: [1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0] } as const;
})();
export function kWeightPower(hz: number): number {
  return (
    biquadPower(K1.b as [number, number, number], K1.a as [number, number, number], hz) *
    biquadPower(K2.b as [number, number, number], K2.a as [number, number, number], hz)
  );
}

/** |H|^2 of a Web Audio low-pass biquad (resonance `qDb`, in dB as the spec has it). */
export function lowpassPower(hz: number, cutoff: number, qDb = 0.5): number {
  const w0 = (2 * Math.PI * clamp(cutoff, 10, SAMPLE_RATE / 2 - 1)) / SAMPLE_RATE,
    alpha = Math.sin(w0) / (2 * 10 ** (qDb / 20)),
    c = Math.cos(w0);
  return biquadPower([(1 - c) / 2, 1 - c, (1 - c) / 2], [1 + alpha, -2 * c, 1 - alpha], hz);
}

const waveCache = new WeakMap<object, { imag: Float32Array; power: number; peak: number }[]>();
function waves(profile: SoundProfile) {
  let entry = waveCache.get(profile);
  if (!entry) {
    entry = ([0, 1, 2] as const).map((band) => {
      const imag = bandHarmonics(profile, band);
      return { imag, ...normalisedWavePower(imag) };
    });
    waveCache.set(profile, entry);
  }
  return entry;
}

/** K-weighted power of one band at unit gain, after the voice low-pass: the mean
 * square the listener's loudness meter sees from that band's oscillator. */
export function bandPower(
  profile: SoundProfile,
  band: BandIndex,
  hz: number,
  cutoff: number,
): number {
  const { imag, peak } = waves(profile)[band];
  let total = 0;
  for (let k = 1; k < imag.length; k++) {
    const f = k * hz;
    if (f > 20000) break; // band-limited: nothing above the audible range is synthesised
    const a = imag[k] / (peak || 1);
    total += (a * a * kWeightPower(f) * lowpassPower(f, cutoff)) / 2;
  }
  return total;
}

/** Designed engine loudness: the K-weighted RMS amplitude a voice should present,
 * relative to a full-load redline voice (1). Idle sits about 10 dB down, mid revs
 * with part load about 4 dB down, so the engine swells as the driver pushes.
 * `rpmFraction` is rpm over the limiter, `load` 0..1 (airborne already folded in). */
export function designedEngineLevel(rpmFraction: number, load: number): number {
  const r = clamp(rpmFraction, 0, 1.05);
  return (0.5 + 0.5 * r ** 1.3) * (0.45 + 0.55 * clamp(load, 0, 1));
}

/** Largest boost / cut the normaliser may apply to a band set (a safety net for
 * revs far from every band centre, where the shape weights collapse). */
export const NORMALISER_RANGE = [0.02, 8] as const;

/** The scale that brings a voice whose raw band gains are `gains` (already
 * weighted by rpm position) to the designed level. */
export function loudnessScale(
  profile: SoundProfile,
  bandHz: readonly [number, number, number],
  gains: readonly [number, number, number],
  cutoff: number,
  target: number,
): number {
  let power = 0;
  for (let band = 0 as BandIndex; band < 3; band = (band + 1) as BandIndex)
    if (gains[band] > 0) power += gains[band] ** 2 * bandPower(profile, band, bandHz[band], cutoff);
  const rms = Math.sqrt(power);
  if (rms < 1e-9) return 1;
  return clamp(target / rms, NORMALISER_RANGE[0], NORMALISER_RANGE[1]);
}

/** Electric families are quiet by nature but a car that is silent at a standstill
 * reads as broken: the inverter idles with a faint hum that rises into the whine. */
export const EV_IDLE_HUM_HZ = 140;
export const EV_FLOOR = 0.3;
export function designedMotorLevel(roadSpeed: number): number {
  return EV_FLOOR + (1 - EV_FLOOR) * clamp(roadSpeed / 50, 0, 1) ** 0.8;
}
