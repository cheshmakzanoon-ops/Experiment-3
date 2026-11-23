import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { gpRubberImprint } from '../src/rendering/gp-rubber-imprint.ts';

describe('GP rubber coverage', () => {
  it('contains a continuous pressure shoulder and longitudinal slip in the sampled green channel', () => {
    const map = gpRubberImprint();
    const { width, height, data } = map.image;
    const at = (x: number, y: number) => data[4 * (width * y + x) + 1] / 255;
    let core = 0,
      shoulders = 0,
      seam = 0,
      across = 0,
      along = 0;
    const densities = new Set<number>();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = at(x, y);
        densities.add(value);
        if (x >= width / 4 && x < width * 0.75) core += value;
        if (x < width / 8 || x >= width * 0.875) shoulders += value;
        if (x) across += Math.abs(at(x - 1, y) - value);
        const dv = Math.abs(at(x, (y + 1) % height) - value);
        along += dv;
        if (y === height - 1) seam += dv;
      }
    }
    expect(densities.size).toBeGreaterThan(100);
    expect(core / ((width * height) / 2)).toBeGreaterThan(0.35);
    expect(shoulders / ((width * height) / 4)).toBeLessThan(0.04);
    expect(across).toBeGreaterThan(along * 3);
    expect(along).toBeGreaterThan(width * height * 0.001);
    expect(seam / width).toBeLessThan((3 * along) / (width * height));
    expect(map.wrapT).toBe(T.RepeatWrapping);
    expect(map.generateMipmaps).toBe(true);
    expect(map.minFilter).toBe(T.LinearMipmapLinearFilter);
    map.dispose();
  });
});
