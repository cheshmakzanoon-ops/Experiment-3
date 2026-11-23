import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { GP_AISLE_HALF_WIDTH, gpTerraceGeometry } from '../src/rendering/venue-kit/gp-terrace.ts';

describe.each([-1, 1] as const)('GP spectator terrace facing side %i', (side) => {
  const geometry = gpTerraceGeometry(64, side);
  const terrace = new T.Mesh(geometry, new T.MeshBasicMaterial());
  const cast = (u: number, y: number, z: number, along: number, up: number, cross = 0) =>
    new T.Raycaster(new T.Vector3(u * side, y, z), new T.Vector3(along * side, up, cross))
      .intersectObject(terrace, false)[0];

  it('closes every seating riser toward the circuit and leaves a continuous underside', () => {
    for (let row = 1; row <= 7; row++) {
      const u = 1.19 + 0.98 * row;
      const face = cast(u - 0.25, 0.2 + 0.49 * (row - 0.5), 0, 1, 0);
      expect(face?.point.x).toBeCloseTo(side * u, 5);
      expect(face?.face?.normal.x).toBeCloseTo(-side, 5);
      const lower = cast(u - 0.1, -2, 0, 0, 1);
      expect(lower?.face?.normal.y).toBeLessThan(-0.8);
    }
    expect(cast(4, 1.1, -33, 0, 0, 1)?.face?.normal.z).toBeCloseTo(-1, 5);
    expect(cast(4, 1.1, 33, 0, 0, -1)?.face?.normal.z).toBeCloseTo(1, 5);
  });

  it('divides each row rise into three level treads in both aisles with closed cheeks', () => {
    for (const centre of [-16, 16]) {
      for (let row = 0; row < 7; row++) {
        for (let stair = 0; stair < 3; stair++) {
          const u = 1.19 + 0.98 * (row + (stair + 0.5) / 3);
          const base = 0.2 + row * 0.49;
          const top = cast(u, 6, centre, 0, -1);
          expect(top?.point.y).toBeCloseTo(base + stair * 0.49 / 3, 5);
          expect(top?.face?.normal.y).toBeCloseTo(1, 5);
          for (const edge of [-1, 1]) {
            const out = centre + edge * (GP_AISLE_HALF_WIDTH + 0.12);
            expect(cast(u, 6, out, 0, -1)?.point.y).toBeCloseTo(base, 5);
            if (!stair) continue;
            const cheek = cast(u, base + 0.07, out, 0, 0, -edge);
            expect(cheek?.point.z).toBeCloseTo(centre + edge * GP_AISLE_HALF_WIDTH, 5);
            expect(cheek?.face?.normal.z).toBeCloseTo(edge, 5);
          }
        }
      }
    }
  });
});
