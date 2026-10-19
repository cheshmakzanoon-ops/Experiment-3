import type * as T from 'three';

/** The two edge rows of one indexed course strip. Keep their unnormalised
 * face sums separate from the uploaded normals: a neighbouring strip can
 * change later, and averaging already stitched unit normals loses both
 * triangle area and the original contribution on a repeated update.
 *
 * Only the two boundary face rings are retained. Refreshing an edge is
 * proportional to course width, with no per-frame allocation, new GPU
 * attributes, draw calls or changes to the physical/rendered terrain. */
export class MxTerrainNormalEdges {
  private readonly first: Float64Array;
  private readonly last: Float64Array;
  private readonly faces: Uint32Array;
  private readonly lastStart: number;

  constructor(
    private readonly geometry: T.BufferGeometry,
    private readonly rowSize: number,
  ) {
    const index = geometry.getIndex()!,
      count = geometry.getAttribute('position').count,
      faces: number[] = [];
    this.lastStart = count - rowSize;
    this.first = new Float64Array(rowSize * 3);
    this.last = new Float64Array(rowSize * 3);
    for (let face = 0; face < index.count; face += 3) {
      const a = index.getX(face),
        b = index.getX(face + 1),
        c = index.getX(face + 2);
      if (Math.min(a, b, c) < rowSize || Math.max(a, b, c) >= this.lastStart) faces.push(a, b, c);
    }
    this.faces = new Uint32Array(faces);
    this.refresh();
  }

  /** Call after this strip's authoritative positions have been uploaded. */
  refresh() {
    const position = this.geometry.getAttribute('position'),
      faces = this.faces;
    this.first.fill(0);
    this.last.fill(0);
    for (let face = 0; face < faces.length; face += 3) {
      const a = faces[face],
        b = faces[face + 1],
        c = faces[face + 2],
        abx = position.getX(b) - position.getX(a),
        aby = position.getY(b) - position.getY(a),
        abz = position.getZ(b) - position.getZ(a),
        acx = position.getX(c) - position.getX(a),
        acy = position.getY(c) - position.getY(a),
        acz = position.getZ(c) - position.getZ(a),
        nx = aby * acz - abz * acy,
        ny = abz * acx - abx * acz,
        nz = abx * acy - aby * acx;
      for (let corner = 0; corner < 3; corner++) {
        const vertex = faces[face + corner];
        if (vertex < this.rowSize) {
          const offset = vertex * 3;
          this.first[offset] += nx;
          this.first[offset + 1] += ny;
          this.first[offset + 2] += nz;
        }
        if (vertex >= this.lastStart) {
          const offset = (vertex - this.lastStart) * 3;
          this.last[offset] += nx;
          this.last[offset + 1] += ny;
          this.last[offset + 2] += nz;
        }
      }
    }
  }

  /** All changed strips must refresh before joining any pair. Faces removed
   * at overlapping hairpin legs contribute nothing, just as on one welded
   * mesh; an unused vertex remains zero instead of acquiring a false slope. */
  join(next: MxTerrainNormalEdges) {
    const left = this.geometry.getAttribute('normal') as T.BufferAttribute,
      right = next.geometry.getAttribute('normal') as T.BufferAttribute;
    for (let column = 0; column < this.rowSize; column++) {
      const offset = column * 3,
        nx = this.last[offset] + next.first[offset],
        ny = this.last[offset + 1] + next.first[offset + 1],
        nz = this.last[offset + 2] + next.first[offset + 2],
        inverse = 1 / (Math.hypot(nx, ny, nz) || 1);
      left.setXYZ(this.lastStart + column, nx * inverse, ny * inverse, nz * inverse);
      right.setXYZ(column, nx * inverse, ny * inverse, nz * inverse);
    }
    left.needsUpdate = true;
    right.needsUpdate = true;
  }
}
