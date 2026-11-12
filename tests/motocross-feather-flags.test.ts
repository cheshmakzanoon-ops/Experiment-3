import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { MxCourseDressing } from '../src/rendering/offroad/mx-course-dressing.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';

const draws = (root: T.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof T.Mesh) n++;
  });
  return n;
};

describe('motocross event feather flags', () => {
  it('stands clusters of three on the outdoor turns inside the existing cloth/steel batches', () => {
    const dressing = new MxCourseDressing(rigTrack('valley-ridge-mx'));
    try {
      expect(dressing.stats.flags).toBeGreaterThanOrEqual(9);
      expect(dressing.stats.flags % 3).toBe(0);
      // Merged into the printed-cloth and galvanised-frame batches.
      const cloth = dressing.root.getObjectByName('MX printed woven barriers') as T.Mesh;
      cloth.geometry.computeBoundingBox();
      expect(cloth.geometry.boundingBox!.max.y - cloth.geometry.boundingBox!.min.y).toBeGreaterThan(
        3,
      );
      expect(draws(dressing.root)).toBeLessThanOrEqual(14);
      expect(
        Object.values(cloth.geometry.attributes).every((a) =>
          Array.from(a.array).every(Number.isFinite),
        ),
      ).toBe(true);
    } finally {
      dressing.dispose();
    }
  });

  it('leaves the indoor stadium without flags', () => {
    const dressing = new MxCourseDressing(rigTrack('arena-nord-sx'));
    try {
      expect(dressing.stats.flags).toBe(0);
    } finally {
      dressing.dispose();
    }
  });
});
