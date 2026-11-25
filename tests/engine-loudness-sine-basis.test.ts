import { describe, expect, it, vi } from 'vitest';
import { SOUND_PROFILES, type SoundProfile } from '../src/audio/sound-profiles.ts';

const profiles = Object.values(SOUND_PROFILES);
const steps = 2048;
const harmonics = 40;
const basisSines = steps * (harmonics - 1);

async function freshLoudness() {
  vi.resetModules();
  return import('../src/audio/engine-loudness.ts');
}

function random(seed = 246813579) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function customSpectrum(length: number, next: () => number) {
  return Float32Array.from({ length }, () => (next() * 2 - 1) * 2 ** (next() * 80 - 40));
}

function expectExactWave(
  actual: { peak: number; power: number },
  expected: { peak: number; power: number },
  label: string,
) {
  // Numeric toBe uses Object.is, including NaN and the sign of zero.
  expect(actual.peak, `${label} peak`).toBe(expected.peak);
  expect(actual.power, `${label} power`).toBe(expected.power);
}

function trackBasisAllocations() {
  const allocations: Float64Array[] = [];
  vi.stubGlobal(
    'Float64Array',
    new Proxy(Float64Array, {
      construct(target, args) {
        const array = Reflect.construct(target, args) as Float64Array;
        allocations.push(array);
        return array;
      },
    }),
  );
  return allocations;
}

function countSines(inspect?: (angle: number, index: number) => void) {
  const original = Math.sin;
  let calls = 0;
  // Count without retaining hundreds of thousands of spy argument/result arrays.
  Math.sin = (angle) => {
    inspect?.(angle, calls);
    calls++;
    return original(angle);
  };
  return {
    get calls() {
      return calls;
    },
    reset() {
      calls = 0;
    },
    restore() {
      Math.sin = original;
    },
  };
}

describe('exact bounded engine waveform sine basis', () => {
  it('retains all 72 authored profile/band peaks and powers exactly', async () => {
    const loudness = await freshLoudness();
    expect(profiles).toHaveLength(24);
    for (const profile of profiles) {
      for (const band of [0, 1, 2] as const) {
        const imag = loudness.bandHarmonics(profile, band);
        expectExactWave(
          loudness.normalisedWavePower(imag),
          baselineWavePower(imag),
          `${profile.family}/${band}`,
        );
      }
    }
  });

  it('retains seeded custom spectra, including lengths above the authored basis', async () => {
    const loudness = await freshLoudness();
    const next = random();
    const lengths = [0, 1, 2, 3, 7, 8, 16, 31, 39, 40, 41, 42, 63, 80, 127, 256];
    for (let i = 0; i < 192; i++) {
      const imag = customSpectrum(lengths[i % lengths.length], next);
      const unchanged = imag.slice();
      expectExactWave(loudness.normalisedWavePower(imag), baselineWavePower(imag), `seeded ${i}`);
      expect(imag).toEqual(unchanged);
      // The reusable basis is independent of coefficient values and array identity.
      for (let k = 0; k < imag.length; k++) imag[k] = imag[k] * -0.75 + (next() - 0.5);
      expectExactWave(loudness.normalisedWavePower(imag), baselineWavePower(imag), `mutated ${i}`);
    }
  });

  it('preserves empty, silent, signed-zero, extreme and nonfinite inputs', async () => {
    const loudness = await freshLoudness();
    const spectra: Float32Array[] = [];
    for (const length of [0, 1, 2, 8, 39, 40, 41, 257]) {
      spectra.push(new Float32Array(length), new Float32Array(length).fill(-0));
      const ignoredDc = new Float32Array(length);
      ignoredDc[0] = NaN;
      spectra.push(ignoredDc);
      if (length < 2) continue;
      for (const value of [
        NaN,
        Infinity,
        -Infinity,
        2 ** -149,
        -(2 ** -149),
        3.4028234663852886e38,
      ]) {
        const imag = new Float32Array(length);
        imag[0] = Infinity; // DC remains unused even when nonfinite.
        imag[length - 1] = value;
        spectra.push(imag);
      }
      spectra.push(Float32Array.from({ length }, (_, k) => (k % 2 ? -1 : 1) / (k || 1)));
    }
    for (let i = 0; i < spectra.length; i++) {
      const imag = spectra[i];
      expectExactWave(loudness.normalisedWavePower(imag), baselineWavePower(imag), `edge ${i}`);
    }
    // Revisit short inputs after the 40-coefficient case has initialised the basis.
    for (let i = spectra.length - 1; i >= 0; i--) {
      const imag = spectra[i];
      expectExactWave(
        loudness.normalisedWavePower(imag),
        baselineWavePower(imag),
        `warm edge ${i}`,
      );
    }
  });

  it('does no eager wave work on import, inactive gains or cold short inputs', async () => {
    const allocations = trackBasisAllocations();
    const sin = countSines();
    try {
      const loudness = await freshLoudness();
      expect(allocations).toHaveLength(0);
      expect(sin.calls).toBe(0);
      const profile = new Proxy({} as SoundProfile, {
        get() {
          throw new Error('inactive gains must not read a profile');
        },
      });
      for (const gains of [
        [0, 0, 0],
        [-0, -1, NaN],
        [-Infinity, 0, -2],
      ] as const) {
        expect(loudness.loudnessScale(profile, [NaN, Infinity, -Infinity], gains, NaN, NaN)).toBe(
          1,
        );
      }
      expect(allocations).toHaveLength(0);
      expect(sin.calls).toBe(0);
      for (const length of [0, 1, 2, 8, 39]) {
        sin.reset();
        const imag = new Float32Array(length);
        imag[0] = NaN;
        if (length > 1) imag[1] = 3;
        expectExactWave(
          loudness.normalisedWavePower(imag),
          length > 1 ? { peak: 3, power: 0.5 } : { peak: 0, power: 0 },
          `cold length ${length}`,
        );
        expect(sin.calls).toBe(steps * Math.max(0, length - 1));
        expect(allocations).toHaveLength(0);
      }
    } finally {
      sin.restore();
      vi.unstubAllGlobals();
    }
  });

  it('builds exactly the original sine inputs once and retains one 640 KiB payload', async () => {
    const loudness = await freshLoudness();
    const allocations = trackBasisAllocations();
    let originalInputs = true;
    const sin = countSines((angle, index) => {
      const i = Math.floor(index / (harmonics - 1));
      const k = (index % (harmonics - 1)) + 1;
      const theta = (i / steps) * Math.PI * 2;
      originalInputs &&= Object.is(angle, k * theta);
    });
    try {
      const first = loudness.bandHarmonics(profiles[0], 0);
      loudness.normalisedWavePower(first);
      expect(sin.calls).toBe(basisSines);
      expect(originalInputs).toBe(true);
      expect(allocations).toHaveLength(1);
      const basis = allocations[0];
      expect(basis.length).toBe(steps * harmonics);
      expect(basis.byteLength).toBe(655360);
      sin.reset();
      for (const profile of profiles) {
        for (const band of [0, 1, 2] as const) {
          loudness.normalisedWavePower(loudness.bandHarmonics(profile, band));
        }
      }
      loudness.normalisedWavePower(first);
      for (const length of [0, 1, 2, 8, 39]) {
        loudness.normalisedWavePower(new Float32Array(length));
      }
      expect(sin.calls).toBe(0);
      // New profile objects keep using the same basis; their existing waveform
      // cache remains a WeakMap and does not own additional sine tables.
      for (let i = 0; i < 48; i++) {
        const profile = { ...profiles[i % profiles.length], odd: i / 7, third: i / 13 };
        loudness.bandPower(profile, 1, 200, 3000);
      }
      expect(sin.calls).toBe(48); // One cutoff sine per public bandPower call.
      expect(allocations).toHaveLength(1);
      expect(allocations[0]).toBe(basis);
      expect(allocations.reduce((bytes, array) => bytes + array.byteLength, 0)).toBe(655360);
    } finally {
      sin.restore();
      vi.unstubAllGlobals();
    }
  });

  it('uses the original full scan above 40 coefficients before and after basis creation', async () => {
    const loudness = await freshLoudness();
    const next = random(975318642);
    const spectra = [41, 64, 257].map((length) => customSpectrum(length, next));
    const expected = spectra.map(baselineWavePower);
    const allocations = trackBasisAllocations();
    const sin = countSines();
    try {
      for (const warm of [false, true]) {
        if (warm) loudness.normalisedWavePower(loudness.bandHarmonics(profiles[0], 0));
        for (let i = 0; i < spectra.length; i++) {
          sin.reset();
          const imag = spectra[i];
          expectExactWave(
            loudness.normalisedWavePower(imag),
            expected[i],
            `${warm}/${imag.length}`,
          );
          expect(sin.calls).toBe(steps * (imag.length - 1));
          expect(allocations).toHaveLength(warm ? 1 : 0);
        }
      }
      expect(allocations[0].byteLength).toBe(655360);
    } finally {
      sin.restore();
      vi.unstubAllGlobals();
    }
  });

  it('shares the first scan across a family and every later family without changing warm filters', async () => {
    const loudness = await freshLoudness();
    const sin = countSines();
    const cos = vi.spyOn(Math, 'cos');
    try {
      loudness.loudnessScale(profiles[0], [100, 200, 400], [0.2, 0.3, 0.1], 3000, 0.05);
      expect(sin.calls).toBe(basisSines + 1);
      expect(cos).toHaveBeenCalledTimes(235);
      for (const profile of [profiles[1], profiles[0], { ...profiles[0] }]) {
        sin.reset();
        cos.mockClear();
        loudness.loudnessScale(profile, [100, 200, 400], [0.2, 0.3, 0.1], 3000, 0.05);
        expect(sin.calls).toBe(1);
        expect(cos).toHaveBeenCalledTimes(235);
      }
    } finally {
      sin.restore();
      cos.mockRestore();
    }
  });
});

/** Verbatim function from baseline 350119e8 src/audio/engine-loudness.ts.
 * Only the exported function name is adapted to keep this oracle independent. */
function baselineWavePower(imag: Float32Array): { peak: number; power: number } {
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
