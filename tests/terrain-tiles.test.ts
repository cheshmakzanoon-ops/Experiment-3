import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { TERRAIN_TILES, splitTerrainGrid } from '../src/rendering/studio/terrain-tiles.ts';

function grid(segments: number) {
  const g = new T.PlaneGeometry(5500, 5500, segments, segments).rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  const extra = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, 40 * Math.sin(pos.getX(i) / 300) * Math.cos(pos.getZ(i) / 410));
    extra[i] = i;
  }
  g.setAttribute('trackDistance', new T.BufferAttribute(extra, 1));
  g.computeVertexNormals();
  return g;
}
/** Every triangle as its three vertices' full attribute values, order-free per set. */
function triangles(g: T.BufferGeometry) {
  const index = g.getIndex()!;
  const names = ['position', 'normal', 'uv', 'trackDistance'];
  const vertex = (i: number) =>
    names
      .map((n) => {
        const a = g.getAttribute(n);
        return Array.from({ length: a.itemSize }, (_, c) => a.array[i * a.itemSize + c]).join(',');
      })
      .join('|');
  const out: string[] = [];
  for (let i = 0; i < index.count; i += 3)
    out.push(
      [vertex(index.getX(i)), vertex(index.getX(i + 1)), vertex(index.getX(i + 2))].join(' / '),
    );
  return out.sort();
}

describe('terrain tiles (D32)', () => {
  it('reproduces every triangle with identical attributes, winding included', () => {
    const whole = grid(16);
    const tiles = splitTerrainGrid(whole, 16);
    expect(tiles).toHaveLength(TERRAIN_TILES * TERRAIN_TILES);
    const merged = tiles.flatMap(triangles).sort();
    expect(merged).toEqual(triangles(whole));
    // Upward faces stay upward (the winding of PlaneGeometry is kept).
    for (const tile of tiles) {
      const n = new T.Vector3();
      const tri = new T.Triangle();
      const p = tile.getAttribute('position') as T.BufferAttribute;
      const index = tile.getIndex()!;
      for (let i = 0; i < index.count; i += 3) {
        tri.setFromAttributeAndIndices(p, index.getX(i), index.getX(i + 1), index.getX(i + 2));
        expect(tri.getNormal(n).y).toBeGreaterThan(0);
      }
    }
  });
  it('gives each tile a bounding sphere a quarter of the plane across, so frusta cull it', () => {
    const whole = grid(320);
    whole.computeBoundingSphere();
    const tiles = splitTerrainGrid(whole, 320);
    expect(tiles.reduce((n, t) => n + t.getIndex()!.count / 3, 0)).toBe(2 * 320 * 320);
    for (const t of tiles)
      expect(t.boundingSphere!.radius).toBeLessThan(whole.boundingSphere!.radius / 3);
  });
  it('rejects grids that do not divide into whole tiles', () => {
    expect(() => splitTerrainGrid(grid(10), 10)).toThrow('terrain grid');
    expect(() => splitTerrainGrid(grid(16), 12)).toThrow('terrain grid');
  });
});
