import * as T from 'three';

/**
 * Terrain tiles (D32 performance-budget). The distant terrain was one 5.5 km
 * plane, so its bounding sphere always met every frustum: the view, both
 * mirrors and the 76 m near shadow cascade each drew all of it. D17 raised
 * Aurel's grid from 160 to 320 segments (204,800 triangles per pass, about
 * +0.6 M triangles in the cold cockpit frame). Cutting the finished grid into
 * `TERRAIN_TILES` x `TERRAIN_TILES` tiles lets Three cull per tile: the near
 * cascade draws one or two tiles, the view and each mirror only those in
 * their wedge. Every vertex attribute (position, normal, uv, finish data) is
 * copied from the finished whole grid, so normals and shading at the tile
 * seams are identical to the single mesh; only the culling changes.
 */
export const TERRAIN_TILES = 4;

/** Split a finished `PlaneGeometry` grid (`segments` x `segments`) into tiles. */
export function splitTerrainGrid(
  geometry: T.BufferGeometry,
  segments: number,
  tiles = TERRAIN_TILES,
): T.BufferGeometry[] {
  const side = segments + 1;
  if (
    !Number.isInteger(segments) ||
    !Number.isInteger(tiles) ||
    tiles < 1 ||
    segments % tiles !== 0 ||
    geometry.getAttribute('position').count !== side * side
  )
    throw new Error('Invalid terrain grid split');
  const span = segments / tiles;
  const names = Object.keys(geometry.attributes);
  const out: T.BufferGeometry[] = [];
  for (let ty = 0; ty < tiles; ty++)
    for (let tx = 0; tx < tiles; tx++) {
      const g = new T.BufferGeometry();
      const n = (span + 1) * (span + 1);
      for (const name of names) {
        const source = geometry.getAttribute(name) as T.BufferAttribute;
        const size = source.itemSize;
        const array = new (source.array.constructor as Float32ArrayConstructor)(n * size);
        let k = 0;
        for (let y = 0; y <= span; y++)
          for (let x = 0; x <= span; x++) {
            const from = (ty * span + y) * side + tx * span + x;
            for (let c = 0; c < size; c++) array[k++] = source.array[from * size + c];
          }
        g.setAttribute(name, new T.BufferAttribute(array, size, source.normalized));
      }
      // PlaneGeometry's own winding: (a, b, d) and (b, c, d) per cell.
      const index: number[] = [];
      for (let y = 0; y < span; y++)
        for (let x = 0; x < span; x++) {
          const a = x + (span + 1) * y,
            b = x + (span + 1) * (y + 1),
            c = x + 1 + (span + 1) * (y + 1),
            d = x + 1 + (span + 1) * y;
          index.push(a, b, d, b, c, d);
        }
      g.setIndex(index);
      g.computeBoundingBox();
      g.computeBoundingSphere();
      out.push(g);
    }
  return out;
}
