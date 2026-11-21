import { describe, it, expect } from 'vitest';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { fogPockets, pocketDensity } from '../src/rendering/local-atmosphere.ts';
describe('GP weather follows the venue terrain', () => {
  it.each(['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const)(
    '%s locates its wet haze outside the riding surface in three sectors',
    (id) => {
      const t = new Track('rain', false, undefined, CIRCUITS[id]),
        p = trackPoint(),
        pockets = fogPockets(t);
      expect(pockets).toHaveLength(3);
      expect(pockets).toEqual(fogPockets(t));
      for (const pocket of pockets) {
        const lateral = t.nearest(pocket.x, pocket.z, p);
        expect(Math.abs(lateral)).toBeGreaterThan(p.width + 2);
        expect(pocket.floor).toBeLessThan(p.y + 1);
        expect(
          pocketDensity(pocket, pocket.x, pocket.floor + pocket.scaleHeight * 3, pocket.z),
        ).toBeLessThan(0.051);
        expect(pocketDensity(pocket, pocket.x, pocket.floor, pocket.z)).toBe(1);
        if (id === 'haarveld') expect(pocket.scaleHeight).toBeLessThan(3);
      }
      for (let i = 1; i < pockets.length; i++)
        expect(
          Math.hypot(pockets[i].x - pockets[i - 1].x, pockets[i].z - pockets[i - 1].z),
        ).toBeGreaterThan(120);
      if (id === 'cape-wrenna')
        expect(pockets.some((p) => p.floor === 0.65 && p.scaleHeight === 7.5)).toBe(true);
    },
  );
});
