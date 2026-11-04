import { describe, expect, it } from 'vitest';
import {
  BAND_HARMONICS,
  BAND_MULTIPLIER,
  EV_FLOOR,
  EV_IDLE_HUM_HZ,
  NORMALISER_RANGE,
  bandHarmonics,
  bandPower,
  designedEngineLevel,
  designedMotorLevel,
  kWeightPower,
  loudnessScale,
  lowpassPower,
  normalisedWavePower,
} from '../src/audio/engine-loudness.ts';
import {
  SOUND_PROFILES,
  engineCharacter,
  engineSignature,
  hash01,
  type SoundFamily,
} from '../src/audio/sound-profiles.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { dbToGain, gainToDb } from '../src/audio/mixer.ts';
import { ENGINE_REFERENCE_RMS } from '../src/audio/engine-voices.ts';

const db = (power: number) => 10 * Math.log10(power);

describe('engine voice harmonics and their loudness model', () => {
  it('builds the band spectra from the family brief exactly as the voices did before', () => {
    const p = SOUND_PROFILES['v6-turbo-hybrid'];
    const old = (band: number) => {
      const imag = new Float32Array(40);
      for (let k = 1; k < 40; k++)
        imag[k] =
          (band === 0 ? (k % 2 ? 1 : p.odd) : band === 1 ? (k % 3 ? p.third : 1) : 0.65) /
          k ** (p.rolloff - band * 0.35);
      return imag;
    };
    for (const band of [0, 1, 2] as const)
      expect(Array.from(bandHarmonics(p, band))).toEqual(Array.from(old(band)));
    expect(bandHarmonics(p, 0)).toHaveLength(BAND_HARMONICS);
    expect([...BAND_MULTIPLIER]).toEqual([0.5, 1, 2]);
  });
  it('normalises a PeriodicWave to a peak of 1 like Web Audio: a sine has mean square 0.5', () => {
    const sine = new Float32Array(8);
    sine[1] = 3;
    const { peak, power } = normalisedWavePower(sine);
    expect(peak).toBeCloseTo(3, 2);
    expect(power).toBeCloseTo(0.5, 9);
    // Adding a third harmonic flattens the crest: more power at the same peak.
    const flat = new Float32Array(8);
    flat[1] = 1;
    flat[3] = 1 / 3;
    expect(normalisedWavePower(flat).power).toBeGreaterThan(0.5 * 0.9);
  });
  it('applies the BS.1770 K-weighting: +4 dB shelf above 2 kHz, a steep high-pass below 40 Hz', () => {
    expect(db(kWeightPower(1000))).toBeGreaterThan(0.3);
    expect(db(kWeightPower(1000))).toBeLessThan(1.1);
    expect(db(kWeightPower(10000))).toBeGreaterThan(3.5);
    expect(db(kWeightPower(10000))).toBeLessThan(4.6);
    expect(db(kWeightPower(20))).toBeLessThan(-6);
    expect(kWeightPower(100)).toBeGreaterThan(kWeightPower(20));
  });
  it('models the voice low-pass: unity below the corner, falling away above it', () => {
    expect(lowpassPower(100, 5000)).toBeCloseTo(1, 2);
    expect(lowpassPower(20000, 1000)).toBeLessThan(0.01);
    expect(lowpassPower(4000, 2000)).toBeLessThan(lowpassPower(2500, 2000));
    expect(lowpassPower(8000, 2000)).toBeLessThan(lowpassPower(4000, 2000));
  });
  it('predicts band power from harmonics, K-weighting and the voice filter', () => {
    const p = SOUND_PROFILES['v8-na'];
    const open = bandPower(p, 1, 400, 20000),
      closed = bandPower(p, 1, 400, 600);
    expect(open).toBeGreaterThan(0.1);
    expect(open).toBeLessThan(2);
    expect(closed).toBeLessThan(open);
    // A band whose harmonics all lie above 20 kHz contributes nothing.
    expect(bandPower(p, 1, 25000, 20000)).toBe(0);
  });
});

describe('designed engine loudness', () => {
  it('swells with revs and load: idle well under redline, redline at full load is the reference', () => {
    expect(designedEngineLevel(1, 1)).toBeCloseTo(1, 9);
    expect(gainToDb(designedEngineLevel(0.31, 0.03))).toBeLessThan(-9);
    expect(gainToDb(designedEngineLevel(0.62, 0.6))).toBeGreaterThan(-6);
    expect(gainToDb(designedEngineLevel(0.62, 0.6))).toBeLessThan(-2.5);
    for (let load = 0; load <= 1; load += 0.1) {
      let previous = 0;
      for (let rpm = 0.1; rpm <= 1.0001; rpm += 0.05) {
        const level = designedEngineLevel(rpm, load);
        expect(level).toBeGreaterThanOrEqual(previous);
        previous = level;
      }
    }
    for (let rpm = 0.2; rpm <= 1; rpm += 0.2) {
      let previous = 0;
      for (let load = 0; load <= 1.0001; load += 0.1) {
        const level = designedEngineLevel(rpm, load);
        expect(level).toBeGreaterThan(previous);
        previous = level;
      }
    }
  });
  it('gives an electric car a hum at a standstill instead of silence, rising with speed to 1', () => {
    expect(designedMotorLevel(0)).toBeCloseTo(EV_FLOOR, 9);
    expect(designedMotorLevel(0)).toBeGreaterThan(0);
    expect(designedMotorLevel(50)).toBe(1);
    expect(designedMotorLevel(200)).toBe(1);
    expect(designedMotorLevel(20)).toBeGreaterThan(designedMotorLevel(5));
    expect(EV_IDLE_HUM_HZ).toBeGreaterThan(100); // audible on small speakers, not a sub-bass tone
  });
  it('scales a band set to exactly the target loudness (self-consistent by construction)', () => {
    const p = SOUND_PROFILES['i4-turbo'];
    const hz = [200, 400, 800] as const,
      gains = [0.1, 0.25, 0.05] as const,
      cutoff = 3000;
    const target = 0.05;
    const scale = loudnessScale(p, hz, gains, cutoff, target);
    let power = 0;
    for (const band of [0, 1, 2] as const)
      power += (gains[band] * scale) ** 2 * bandPower(p, band, hz[band], cutoff);
    expect(Math.sqrt(power)).toBeCloseTo(target, 9);
  });
  it('bounds the boost and returns a neutral scale for silence', () => {
    const p = SOUND_PROFILES['v8-na'];
    expect(loudnessScale(p, [100, 200, 400], [0, 0, 0], 3000, 0.05)).toBe(1);
    expect(loudnessScale(p, [100, 200, 400], [1e-6, 0, 0], 3000, 0.05)).toBe(NORMALISER_RANGE[1]);
    expect(loudnessScale(p, [100, 200, 400], [50, 0, 0], 3000, 1e-9)).toBe(NORMALISER_RANGE[0]);
  });
  it('never leans on the safety clamp at idle, mid or redline in any family (the bands always cover the rev range)', () => {
    const idle = [0.2, 0.05],
      mid = [0.62, 0.6],
      red = [0.97, 1];
    for (const family of Object.keys(SOUND_PROFILES) as SoundFamily[]) {
      const p = SOUND_PROFILES[family];
      if (p.firingsPerRev === 0) continue; // electric: one band, handled by designedMotorLevel
      for (const [fraction, load] of [idle, mid, red]) {
        const limiter = 10000,
          rpm = fraction * limiter,
          f = (rpm / 60) * p.firingsPerRev;
        const hz = [0, 1, 2].map((b) => Math.max(50, f * BAND_MULTIPLIER[b])) as [
          number,
          number,
          number,
        ];
        const gains = [0, 1, 2].map(
          (b) =>
            Math.exp(-(((rpm - p.bandCentres[b] * limiter) / (p.bandWidth * limiter)) ** 2)) *
            p.bandGain[b],
        ) as [number, number, number];
        const target = ENGINE_REFERENCE_RMS * designedEngineLevel(fraction, load);
        const scale = loudnessScale(p, hz, gains, 3000, target);
        expect(scale, `${family} at ${fraction}`).toBeGreaterThan(NORMALISER_RANGE[0] * 1.001);
        expect(scale, `${family} at ${fraction}`).toBeLessThan(NORMALISER_RANGE[1] * 0.999);
      }
    }
  });
  it('lets a family trim be a deliberate offset: electric families are quieter, the truck louder', () => {
    expect(SOUND_PROFILES.electric.levelDb).toBeLessThan(0);
    expect(SOUND_PROFILES['fuel-cell'].levelDb).toBeLessThan(0);
    expect(SOUND_PROFILES['v8-truck'].levelDb).toBeGreaterThan(0);
    for (const [family, profile] of Object.entries(SOUND_PROFILES))
      if (!['electric', 'fuel-cell', 'v8-truck'].includes(family))
        expect(profile.levelDb, family).toBe(0);
    expect(dbToGain(SOUND_PROFILES.electric.levelDb)).toBeLessThan(1);
  });
});

describe('the trophy truck voice and the per-machine signature', () => {
  it('gives the trophy truck its own big-bore family instead of the historic F1 V8 voice', () => {
    expect(engineCharacter(VEHICLES.dx8).profile.family).toBe('v8-truck');
    const truck = SOUND_PROFILES['v8-truck'],
      f1 = SOUND_PROFILES['v8-na'];
    expect(truck.burble).toBeGreaterThan(f1.burble);
    expect(truck.rolloff).toBeGreaterThan(f1.rolloff); // darker
    expect(truck.bandCentres[0]).toBeLessThan(f1.bandCentres[0]);
  });
  it('derives a stable signature per machine from its torque and id', () => {
    expect(hash01('apx01')).toBe(hash01('apx01'));
    expect(hash01('apx01')).not.toBe(hash01('fx26'));
    for (const id of ['a', 'b', 'tc1', 'mx450']) {
      expect(hash01(id)).toBeGreaterThanOrEqual(0);
      expect(hash01(id)).toBeLessThan(1);
    }
    const a = engineSignature('tc1', 350),
      again = engineSignature('tc1', 350);
    expect(a).toEqual(again);
    // A larger engine leans to the low band and a darker voice, on average over ids.
    let small = 0,
      big = 0,
      smallB = 0,
      bigB = 0;
    for (let i = 0; i < 200; i++) {
      small += engineSignature(`m${i}`, 120).tiltDb;
      big += engineSignature(`m${i}`, 1100).tiltDb;
      smallB += engineSignature(`m${i}`, 120).brightness;
      bigB += engineSignature(`m${i}`, 1100).brightness;
    }
    expect(big).toBeGreaterThan(small);
    expect(bigB).toBeLessThan(smallB);
  });
  it('keeps every signature inside its bounds, and separates machines of one family', () => {
    for (const d of Object.values(VEHICLES)) {
      const { signature, profile } = engineCharacter(d);
      expect(Math.abs(signature.tiltDb), d.id).toBeLessThanOrEqual(6);
      expect(signature.brightness, d.id).toBeGreaterThanOrEqual(0.7);
      expect(signature.brightness, d.id).toBeLessThanOrEqual(1.4);
      expect(profile.family).toBeTruthy();
    }
    const twins = ['fe4', 'hh2', 'rh3', 'tc2', 'tc3'].map(
      (id) => engineCharacter(VEHICLES[id]).signature,
    );
    expect(new Set(twins.map((s) => s.tiltDb.toFixed(2))).size).toBe(twins.length);
  });
});
