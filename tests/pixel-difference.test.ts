import { describe, expect, it } from 'vitest';
import { pixelDifference } from '../e2e/fixtures/pixel-difference.ts';

describe('RGBA8 fixture comparison', () => {
  it('distinguishes single-code rounding from a larger local shading error', () => {
    const a = new Uint8Array([80, 90, 70, 255, 50, 60, 40, 255]);
    expect(pixelDifference(a, a.slice())).toEqual({
      maxChannelDelta: 0,
      changedPixels: 0,
      coverageDifferences: 0,
    });
    const b = a.slice();
    b[2]++;
    expect(pixelDifference(a, b)).toEqual({
      maxChannelDelta: 1,
      changedPixels: 1,
      coverageDifferences: 0,
    });
    b[6] += 2;
    expect(pixelDifference(a, b)).toEqual({
      maxChannelDelta: 2,
      changedPixels: 2,
      coverageDifferences: 0,
    });
    expect(a[2]).toBe(70);
  });
  it('does not dilute one missing pixel in a large image', () => {
    const a = new Uint8Array(4096 * 4),
      b = a.slice();
    a[4000] = 60;
    expect(pixelDifference(a, b)).toEqual({
      maxChannelDelta: 60,
      changedPixels: 1,
      coverageDifferences: 1,
    });
  });
  it('leaves alpha out of the explicitly RGB-on-black comparison', () => {
    expect(
      pixelDifference(new Uint8Array([40, 50, 60, 0]), new Uint8Array([40, 50, 60, 255])),
    ).toEqual({ maxChannelDelta: 0, changedPixels: 0, coverageDifferences: 0 });
  });
  it.each([
    [0, 0],
    [3, 3],
    [4, 8],
  ])('rejects invalid byte lengths %i/%i', (a, b) => {
    expect(() => pixelDifference(new Uint8Array(a), new Uint8Array(b))).toThrow('RGBA8');
  });
});
