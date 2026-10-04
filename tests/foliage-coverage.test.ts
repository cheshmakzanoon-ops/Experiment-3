import { describe, expect, it } from 'vitest';
import { preserveCoverage, alphaCoverage } from '../src/rendering/foliage-mipmaps.ts';

const rgba = (alphas: readonly number[]) =>
  new Uint8ClampedArray(alphas.flatMap((a) => [71, 103, 40, a]));

describe('quantized foliage mip coverage', () => {
  it('does not round an excluded texel across the alpha-test threshold', () => {
    const pixels = rgba([254, 255]);
    expect(preserveCoverage(pixels, 0.5, 0.45)).toBe(0.5);
    expect(pixels[3]).toBeLessThan(Math.ceil(0.45 * 255));
    expect(pixels[7]).toBeGreaterThanOrEqual(Math.ceil(0.45 * 255));
  });

  it('matches the best representable histogram partition for sparse and dense mips', () => {
    for (let seed = 0; seed < 96; seed++) {
      const alphas = Array.from({ length: 2 + (seed % 23) }, (_, i) =>
        i % 7 === 0 ? 0 : (Math.imul(seed + 1, 73) + i * 37) % 256,
      );
      for (const target of [0, 0.07, 0.2, 0.5, 0.73, 1])
        for (const cutoff of [0.1, 0.45, 0.75, 0.99]) {
          const candidates = [0];
          for (let threshold = 1; threshold <= 255; threshold++)
            candidates.push(alphas.filter((a) => a >= threshold).length / alphas.length);
          const bestError = Math.min(...candidates.map((coverage) => Math.abs(coverage - target))),
            pixels = rgba(alphas),
            coverage = preserveCoverage(pixels, target, cutoff);
          expect(Math.abs(coverage - target)).toBeCloseTo(bestError, 12);
          expect(alphaCoverage(pixels, cutoff)).toBe(coverage);
          for (let i = 0; i < alphas.length; i++) {
            expect([...pixels.slice(i * 4, i * 4 + 3)]).toEqual([71, 103, 40]);
            if (alphas[i] === 0) expect(pixels[i * 4 + 3]).toBe(0);
          }
        }
    }
  });

  it('retains original binary coverage without unnecessarily fading solid leaf texels', () => {
    const pixels = rgba([0, 255, 0, 255, 255]);
    expect(preserveCoverage(pixels, 0.6, 0.45)).toBe(0.6);
    expect([...pixels]).toEqual([...rgba([0, 255, 0, 255, 255])]);
  });
});
