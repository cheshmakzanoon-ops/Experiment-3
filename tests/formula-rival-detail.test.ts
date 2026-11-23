import { expect, it } from 'vitest';
import { carLod } from '../src/rendering/lod.ts';
import { detailDistance, formulaRivalDistance } from '../src/rendering/view-detail.ts';

it('chooses a rival sculpt from the current lens and framebuffer while preserving the followed car', () => {
  const lod = (m: number, fov: number, height: number, previous = 0, followed = false) =>
    carLod(formulaRivalDistance(m, fov, 16 / 9, height), previous, 'low', followed);
  expect(formulaRivalDistance(54, 42, 16 / 9, 1080)).toBe(detailDistance(54, 42, 16 / 9));
  expect(lod(28, 58, 1080)).toBe(0);
  expect(lod(28, 58, 390)).toBe(1);
  expect(lod(28, 19, 390)).toBe(0);
  expect(lod(95, 58, 390)).toBe(2);
  expect(lod(95, 58, 390, 2, true)).toBe(0);
  expect(lod(48, 58, 2160)).toBe(0);
  expect(lod(1, 80, 240)).toBe(0);
  for (const invalid of [0, -1, NaN, Infinity])
    expect(() => formulaRivalDistance(8, 58, 1.6, invalid)).toThrow();
});
