import { describe, expect, it, vi } from 'vitest';
import { clamp } from '../src/core/math.ts';
import {
  BAND_MULTIPLIER,
  EV_IDLE_HUM_HZ,
  bandPower,
  designedEngineLevel,
  designedMotorLevel,
  kWeightPower,
  loudnessScale,
  lowpassPower,
} from '../src/audio/engine-loudness.ts';
import { SOUND_PROFILES, type SoundProfile } from '../src/audio/sound-profiles.ts';

type Triple = readonly [number, number, number];
const profiles = Object.values(SOUND_PROFILES);

function random(seed = 123456789) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

// Numeric toBe uses Object.is, including NaN and the sign of zero.
describe('exact engine loudness coefficient reuse', () => {
  it('matches the original source for 4,096 seeded normalisers across every authored profile', () => {
    const next = random();
    expect(profiles).toHaveLength(24);
    for (let i = 0; i < 4096; i++) {
      const profile = profiles[i % profiles.length],
        base = 50 + next() * 1600,
        hz: Triple = [Math.max(50, base / 2), base, base * 2],
        gains: Triple = [next() * 0.4, next() * 0.4, next() * 0.15],
        cutoff = 500 + next() * 10000,
        target = 0.01 + next() * 0.09;
      expect(loudnessScale(profile, hz, gains, cutoff, target), `seeded case ${i}`).toBe(
        original.loudnessScale(profile, hz, gains, cutoff, target),
      );
    }
  });

  it('retains all family rpm/load combinations including the electric idle band', () => {
    for (const profile of profiles) {
      for (const fraction of [0, 0.2, 0.31, 0.62, 0.97, 1, 1.05]) {
        for (const load of [0, 0.03, 0.6, 1]) {
          const limiter = 10000,
            rpm = fraction * limiter,
            road = fraction * 50,
            electric = profile.firingsPerRev === 0,
            base = electric
              ? Math.max(EV_IDLE_HUM_HZ, road * profile.motorHzPerMS * 0.25)
              : (rpm / 60) * profile.firingsPerRev,
            hz = BAND_MULTIPLIER.map((multiple) =>
              Math.max(50, base * multiple),
            ) as unknown as Triple,
            gains = ([0, 1, 2] as const).map((band) => {
              const weight = electric
                ? band === 1
                  ? 1
                  : 0
                : Math.exp(
                    -(
                      ((rpm - profile.bandCentres[band] * limiter) /
                        (profile.bandWidth * limiter)) **
                      2
                    ),
                  ) * (band === 0 ? 1 + profile.burble * (1 - clamp(fraction, 0, 1)) : 1);
              return weight * (electric ? profile.motorGain * 4 : profile.bandGain[band]);
            }) as unknown as Triple,
            level = electric ? designedMotorLevel(road) : designedEngineLevel(fraction, load),
            target = 0.07 * level * 10 ** (profile.levelDb / 20);
          for (const cutoff of [1500 + load * 2300, 2500 + load * 4600]) {
            expect(
              loudnessScale(profile, hz, gains, cutoff, target),
              `${profile.family}/${fraction}/${load}/${cutoff}`,
            ).toBe(original.loudnessScale(profile, hz, gains, cutoff, target));
          }
        }
      }
    }
  });

  it('keeps public filter outputs exact for resonance, cutoff clamps and nonfinite inputs', () => {
    const frequencies = [
      -Infinity,
      -25000,
      -10,
      -0,
      0,
      Number.MIN_VALUE,
      1e-8,
      20,
      38.13547087602444,
      1000,
      1681.974450955533,
      20000 - 1e-8,
      20000,
      20000 + 1e-8,
      23999,
      24000,
      48000,
      Infinity,
      NaN,
    ];
    const cutoffs = [
      -Infinity,
      -1e12,
      -0,
      0,
      10 - 1e-8,
      10,
      10 + 1e-8,
      3000,
      23999 - 1e-8,
      23999,
      23999 + 1e-8,
      24000,
      1e12,
      Infinity,
      NaN,
    ];
    const resonances = [
      undefined,
      -Infinity,
      -400,
      -40,
      -0.5,
      -0,
      0,
      0.5,
      1,
      12,
      100,
      400,
      Infinity,
      NaN,
    ];
    for (const hz of frequencies) {
      expect(kWeightPower(hz), `K-weight ${hz}`).toBe(original.kWeightPower(hz));
      for (const cutoff of cutoffs) {
        expect(lowpassPower(hz, cutoff), `default Q ${hz}/${cutoff}`).toBe(
          original.lowpassPower(hz, cutoff),
        );
        for (const qDb of resonances) {
          expect(lowpassPower(hz, cutoff, qDb), `low-pass ${hz}/${cutoff}/${qDb}`).toBe(
            original.lowpassPower(hz, cutoff, qDb),
          );
        }
      }
    }
    const next = random(987654321);
    for (let i = 0; i < 512; i++) {
      const hz = next() * 96000 - 48000,
        cutoff = next() * 48000 - 12000,
        qDb = next() * 200 - 100;
      expect(kWeightPower(hz)).toBe(original.kWeightPower(hz));
      expect(lowpassPower(hz, cutoff, qDb)).toBe(original.lowpassPower(hz, cutoff, qDb));
    }
  });

  it('retains the inclusive 20 kHz harmonic boundary in every band and family', () => {
    const inputs = [
      [20000 / 39 - 1e-8, 3000],
      [20000 / 39, 3000],
      [20000 / 39 + 1e-8, 3000],
      [10000 - 1e-8, 10],
      [10000, 10],
      [10000 + 1e-8, 10],
      [20000 - 1e-8, 23999],
      [20000, 23999],
      [20000 + 1e-8, 23999],
      [25000, NaN],
      [Infinity, 3000],
      [-Infinity, -Infinity],
      [-100, Infinity],
      [-0, 0],
      [NaN, 3000],
    ] as const;
    for (const profile of profiles) {
      for (const band of [0, 1, 2] as const) {
        for (const [hz, cutoff] of inputs) {
          expect(
            bandPower(profile, band, hz, cutoff),
            `${profile.family}/${band}/${hz}/${cutoff}`,
          ).toBe(original.bandPower(profile, band, hz, cutoff));
        }
        expect(bandPower(profile, band, 20000, 23999)).toBeGreaterThan(0);
        expect(bandPower(profile, band, 20000 + 1e-8, 23999)).toBe(0);
      }
    }
  });

  it('preserves arbitrary profile spectra independently of their family label', () => {
    const next = random(314159265);
    const custom = profiles.map((profile) => ({
      ...profile,
      odd: next() * 3 - 1,
      third: next() * 4 - 1.5,
      rolloff: next() * 4 - 0.5,
    }));
    custom.push(
      { ...profiles[0], odd: 0, third: 0, rolloff: 0.35 },
      { ...profiles[0], odd: -2, third: 4, rolloff: -60 },
      { ...profiles[0], odd: NaN, third: Infinity, rolloff: 1.8 },
    );
    for (const profile of custom) {
      const hz: Triple = [67.25, 517.125, 5000.0625],
        gains: Triple = [0.17, 0.23, 0.07];
      for (const band of [0, 1, 2] as const) {
        expect(bandPower(profile, band, hz[band], 4321.123456789)).toBe(
          original.bandPower(profile, band, hz[band], 4321.123456789),
        );
      }
      expect(loudnessScale(profile, hz, gains, 4321.123456789, 0.037)).toBe(
        original.loudnessScale(profile, hz, gains, 4321.123456789, 0.037),
      );
      // Both APIs retain the original per-object waveform cache semantics.
      profile.odd += 0.25;
      expect(loudnessScale(profile, hz, gains, 6543.987654321, 0.071)).toBe(
        original.loudnessScale(profile, hz, gains, 6543.987654321, 0.071),
      );
    }
  });

  it('retains silent, tiny, huge and nonfinite gains and target/clamp behavior', () => {
    const gains: Triple[] = [
      [0, 0, 0],
      [-0, -1, NaN],
      [-Infinity, 0, -2],
      [1e-160, 0, 0],
      [1e-6, 0, 0],
      [0, 0.25, 0],
      [50, 0, 0],
      [1e160, 0.2, 0.1],
      [Infinity, 0, 0],
    ];
    const frequencies: Triple[] = [
      [100, 200, 400],
      [20000, 20000 + 1e-8, 25000],
      [0, -0, NaN],
    ];
    for (const profile of profiles) {
      for (const gain of gains) {
        for (const hz of frequencies) {
          for (const cutoff of [-Infinity, 10, 3000, 23999, Infinity, NaN]) {
            for (const target of [-Infinity, -1, -0, 0, 1e-9, 0.05, 100, Infinity, NaN]) {
              expect(loudnessScale(profile, hz, gain, cutoff, target)).toBe(
                original.loudnessScale(profile, hz, gain, cutoff, target),
              );
            }
          }
        }
      }
    }
  });

  it('does not inspect a fresh profile or create waves for inactive gains', () => {
    const profile = new Proxy(
      { ...profiles[0] },
      {
        get() {
          throw new Error('silent normaliser must not initialise waveform cache');
        },
      },
    );
    const sin = vi.spyOn(Math, 'sin'),
      cos = vi.spyOn(Math, 'cos');
    try {
      const inactive: Triple[] = [
        [0, 0, 0],
        [-0, -1, NaN],
        [-Infinity, 0, -2],
        [] as unknown as Triple,
      ];
      for (const gain of inactive) {
        expect(loudnessScale(profile, [NaN, Infinity, -Infinity], gain, NaN, NaN)).toBe(1);
        expect(original.loudnessScale(profile, [NaN, Infinity, -Infinity], gain, NaN, NaN)).toBe(1);
      }
      expect(sin).not.toHaveBeenCalled();
      expect(cos).not.toHaveBeenCalled();
    } finally {
      sin.mockRestore();
      cos.mockRestore();
    }
  });

  it('prepares one cutoff and evaluates one frequency cosine pair per active harmonic', () => {
    const profile = profiles[0],
      hz: Triple = [100, 200, 400],
      gains: Triple = [0.2, 0.3, 0.1];
    // Warm each independent cache before counting steady-state filter operations.
    original.loudnessScale(profile, hz, gains, 3000, 0.05);
    loudnessScale(profile, hz, gains, 3000, 0.05);
    const sin = vi.spyOn(Math, 'sin'),
      cos = vi.spyOn(Math, 'cos');
    try {
      original.loudnessScale(profile, hz, gains, 3000, 0.05);
      expect(sin).toHaveBeenCalledTimes(117);
      expect(cos).toHaveBeenCalledTimes(819);
      sin.mockClear();
      cos.mockClear();
      loudnessScale(profile, hz, gains, 3000, 0.05);
      expect(sin).toHaveBeenCalledTimes(1);
      expect(cos).toHaveBeenCalledTimes(235);
      sin.mockClear();
      cos.mockClear();
      bandPower(profile, 1, 200, 3000);
      expect(sin).toHaveBeenCalledTimes(1);
      expect(cos).toHaveBeenCalledTimes(79);
      sin.mockClear();
      cos.mockClear();
      kWeightPower(1234.56789);
      expect(sin).not.toHaveBeenCalled();
      expect(cos).toHaveBeenCalledTimes(2);
    } finally {
      sin.mockRestore();
      cos.mockRestore();
    }
  });
});

/** Frozen source from the audit baseline 350119e8 (2026-11-25).
 * The two module imports are supplied above and export keywords are removed
 * solely to isolate the snapshot in this closure. Arithmetic and control flow
 * below are copied unchanged, independent of production helper reuse. */
const original = (() => {
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
  const BAND_HARMONICS = 40;
  /** Band frequency multipliers against the firing frequency. */
  const BAND_MULTIPLIER = [0.5, 1, 2] as const;
  type BandIndex = 0 | 1 | 2;

  /** The harmonic amplitudes of band `band` of a family (index 0 unused). The
   * family brief: odd/third emphasis and roll-off, exactly as the voices build them. */
  function bandHarmonics(
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
  function normalisedWavePower(imag: Float32Array): { peak: number; power: number } {
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
      b[0] ** 2 +
      b[1] ** 2 +
      b[2] ** 2 +
      2 * (b[0] * b[1] + b[1] * b[2]) * c1 +
      2 * b[0] * b[2] * c2;
    const den =
      a[0] ** 2 +
      a[1] ** 2 +
      a[2] ** 2 +
      2 * (a[0] * a[1] + a[1] * a[2]) * c1 +
      2 * a[0] * a[2] * c2;
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
  function kWeightPower(hz: number): number {
    return (
      biquadPower(K1.b as [number, number, number], K1.a as [number, number, number], hz) *
      biquadPower(K2.b as [number, number, number], K2.a as [number, number, number], hz)
    );
  }

  /** |H|^2 of a Web Audio low-pass biquad (resonance `qDb`, in dB as the spec has it). */
  function lowpassPower(hz: number, cutoff: number, qDb = 0.5): number {
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
  function bandPower(profile: SoundProfile, band: BandIndex, hz: number, cutoff: number): number {
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
  function designedEngineLevel(rpmFraction: number, load: number): number {
    const r = clamp(rpmFraction, 0, 1.05);
    return (0.5 + 0.5 * r ** 1.3) * (0.45 + 0.55 * clamp(load, 0, 1));
  }

  /** Largest boost / cut the normaliser may apply to a band set (a safety net for
   * revs far from every band centre, where the shape weights collapse). */
  const NORMALISER_RANGE = [0.02, 8] as const;

  /** The scale that brings a voice whose raw band gains are `gains` (already
   * weighted by rpm position) to the designed level. */
  function loudnessScale(
    profile: SoundProfile,
    bandHz: readonly [number, number, number],
    gains: readonly [number, number, number],
    cutoff: number,
    target: number,
  ): number {
    let power = 0;
    for (let band = 0 as BandIndex; band < 3; band = (band + 1) as BandIndex)
      if (gains[band] > 0)
        power += gains[band] ** 2 * bandPower(profile, band, bandHz[band], cutoff);
    const rms = Math.sqrt(power);
    if (rms < 1e-9) return 1;
    return clamp(target / rms, NORMALISER_RANGE[0], NORMALISER_RANGE[1]);
  }

  /** Electric families are quiet by nature but a car that is silent at a standstill
   * reads as broken: the inverter idles with a faint hum that rises into the whine. */
  const EV_IDLE_HUM_HZ = 140;
  const EV_FLOOR = 0.3;
  function designedMotorLevel(roadSpeed: number): number {
    return EV_FLOOR + (1 - EV_FLOOR) * clamp(roadSpeed / 50, 0, 1) ** 0.8;
  }

  return {
    BAND_HARMONICS,
    BAND_MULTIPLIER,
    NORMALISER_RANGE,
    EV_IDLE_HUM_HZ,
    EV_FLOOR,
    bandHarmonics,
    normalisedWavePower,
    kWeightPower,
    lowpassPower,
    bandPower,
    designedEngineLevel,
    loudnessScale,
    designedMotorLevel,
  };
})();
