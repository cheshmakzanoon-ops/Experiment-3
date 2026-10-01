import { describe, it, expect } from 'vitest';
import {
  DOWNSAMPLE_TAPS,
  LENS_BLOOM,
  LensBloomPass,
  TENT_TAPS,
  bloomLimitScale,
  bloomThresholdScale,
  emulateLensBloom,
} from '../src/rendering/lens-bloom.ts';

const W = 160,
  H = 160,
  C = 80;
/** A dark night background with one bright block (or pixel) at the centre. */
function scene(value: number, size = 1) {
  const image = new Float32Array(W * H).fill(0.02);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) image[(C + j) * W + C + i] = value;
  return image;
}
const sum = (data: Float32Array) => data.reduce((a, b) => a + b, 0);

describe('lens bloom', () => {
  it('uses normalised 13-tap downsample and tent upsample filters', () => {
    expect(DOWNSAMPLE_TAPS.reduce((a, t) => a + t[2], 0)).toBeCloseTo(1, 12);
    expect(TENT_TAPS.reduce((a, t) => a + t[2], 0)).toBeCloseTo(1, 12);
  });
  it('limits fireflies smoothly and drops non-finite radiance', () => {
    const limited = (l: number) => l * bloomLimitScale(l);
    for (const l of [0, 1, 3.6, 12, LENS_BLOOM.limitKnee]) expect(limited(l)).toBeCloseTo(l, 9);
    let previous = 0;
    for (let l = 1; l < 70000; l *= 1.3) {
      expect(limited(l)).toBeGreaterThanOrEqual(previous);
      expect(limited(l)).toBeLessThan(LENS_BLOOM.limit);
      previous = limited(l);
    }
    for (const bad of [NaN, Infinity, -Infinity, -1, 70000]) expect(bloomLimitScale(bad)).toBe(0);
  });
  it('blooms only above the soft-kneed threshold', () => {
    const t = LENS_BLOOM.threshold,
      k = LENS_BLOOM.knee;
    expect(bloomThresholdScale(t - k - 0.01)).toBe(0);
    expect(bloomThresholdScale(1)).toBe(0);
    // Above the knee the excess over the threshold passes unchanged.
    expect(20 * bloomThresholdScale(20)).toBeCloseTo(20 - t, 3);
    // Continuous through the knee.
    for (let l = t - k; l < t + k + 0.5; l += 0.01)
      expect(Math.abs((l + 0.01) * bloomThresholdScale(l + 0.01) - l * bloomThresholdScale(l))).toBeLessThan(0.02);
  });
  it('turns a single wet-metal firefly into a small round glint, not squares', () => {
    // 9,000 and 15,500 linear are single-pixel values measured in a wet night
    // T-cam frame (floodlight on a wheel rim). Both limit to the same glint.
    const glint = emulateLensBloom(scene(9000), W, H),
      brighter = emulateLensBloom(scene(15500), W, H);
    expect(Math.max(...glint)).toBeLessThan(1.5);
    expect(sum(brighter) / sum(glint)).toBeCloseTo(1, 1);
    const at = (data: Float32Array, dx: number, dy: number) => data[(C + dy) * W + C + dx];
    // Equal Euclidean distances along the axis and off it (3-4-5 triangles):
    // a box kernel leaves a hard-edged square, a round falloff agrees.
    for (const s of [2, 3, 4, 6]) {
      const axis = at(glint, 5 * s, 0),
        oblique = at(glint, 3 * s, 4 * s);
      expect(Math.abs(oblique - axis) / axis).toBeLessThan(0.2);
    }
    // Monotonic falloff with distance, reaching the dark background level.
    const profile = [2, 4, 8, 16, 32, 64].map((r) => at(glint, r, 0));
    for (let i = 1; i < profile.length; i++) expect(profile[i]).toBeLessThan(profile[i - 1]);
    expect(profile.at(-1)!).toBeLessThan(0.002);
  });
  it('keeps the glow of lamps and other bright areas', () => {
    // A lamp face several pixels across blooms far more than a firefly.
    const lamp = emulateLensBloom(scene(30, 6), W, H),
      firefly = emulateLensBloom(scene(9000), W, H);
    expect(sum(lamp)).toBeGreaterThan(4 * sum(firefly));
    // A uniformly bright field returns `strength` times the radiance above the
    // threshold at every level, so the normalised pyramid adds exactly that.
    const field = emulateLensBloom(new Float32Array(W * H).fill(10), W, H);
    expect(field[C * W + C]).toBeCloseTo(LENS_BLOOM.strength * (10 - LENS_BLOOM.threshold), 4);
    // Sub-threshold content (sunlit paint, smoke) does not bloom at all.
    expect(Math.max(...emulateLensBloom(new Float32Array(W * H).fill(1.8), W, H))).toBe(0);
  });
  it('sizes a half-resolution pyramid and composites without swapping buffers', () => {
    const pass = new LensBloomPass();
    pass.setSize(1600, 900);
    expect(pass.needsSwap).toBe(false);
    expect(pass.levels).toHaveLength(LENS_BLOOM.levels + 1);
    expect([pass.levels[0].width, pass.levels[0].height]).toEqual([800, 450]);
    expect([pass.levels.at(-1)!.width, pass.levels.at(-1)!.height]).toEqual([13, 8]);
    let normalization = 0;
    for (let i = 0; i <= LENS_BLOOM.levels; i++) normalization += LENS_BLOOM.scatter ** i;
    expect(pass.normalization).toBeCloseTo(normalization, 12);
    pass.dispose();
  });
});
