import { Vec3 } from '../core/math.ts';

export interface RayHit {
  distance: number;
  point: Vec3;
  normal: Vec3;
  triangle: number;
}
export const rayHit = (): RayHit => ({
  distance: Infinity,
  point: new Vec3(),
  normal: new Vec3(0, 1, 0),
  triangle: -1,
});
/** Optional ownership of a geometric contact point. Rejected candidates must
 * not shorten a query: a legitimate surface can lie behind an overlapping
 * auxiliary patch. Shape queries over this hierarchy use the same predicate. */
export type ContactOwnership = (triangle: number, x: number, y: number, z: number) => boolean;
interface Node {
  min: number[];
  max: number[];
  left: number;
  right: number;
  start: number;
  end: number;
}

/** A vertical probe tests many points against the same few static faces.
 * Store edge vectors once per resident cell. The determinant and projected
 * bounds are independent of the probe height. */
class VerticalFace {
  triangle = 0;
  ax = 0;
  ay = 0;
  az = 0;
  ex = 0;
  ey = 0;
  ez = 0;
  fx = 0;
  fy = 0;
  fz = 0;
  det = 0;
  minX = 0;
  maxX = 0;
  minZ = 0;
  maxZ = 0;
}
interface VerticalLeaf {
  node: Node;
  faces: VerticalFace[];
  count: number;
}
interface VerticalCell {
  x: number;
  z: number;
  leaves: VerticalLeaf[];
  count: number;
}

/** Horizontal barycentric coordinates of one triangle crossed by this
 * suspension line. Face data is copied because the spatial cache is bounded. */
class VerticalIntersection {
  triangle = 0;
  ay = 0;
  ex = 0;
  ey = 0;
  ez = 0;
  fx = 0;
  fy = 0;
  fz = 0;
  det = 0;
  x = 0;
  z = 0;
  u = 0;
  w = 0;
  qy = 0;
  minY = 0;
  maxY = 0;
}
/** Reusable geometry for a vertical line. The current origin height, stroke
 * limit and ownership are evaluated on every ray, including on stacked decks. */
export class VerticalRayColumn {
  owner?: TriangleBVH;
  x = NaN;
  z = NaN;
  count = 0;
  readonly hits: VerticalIntersection[] = [];
}

/** Static triangle BVH. Build-time sorting is separate from allocation-free ray queries.
 * Two-sided Möller–Trumbore intersections admit triangle seams with an explicit
 * barycentric tolerance. The returned normal opposes the incident ray.
 */
export class TriangleBVH {
  readonly nodes: Node[] = [];
  private order: number[];
  private centroids: Float64Array;
  private stack = new Int32Array(128);
  private hitU = 0;
  private hitW = 0;
  private readonly verticalCells: (VerticalCell | undefined)[] = [];
  private readonly down = new Vec3(0, -1, 0);
  private readonly verticalColumn = new VerticalRayColumn();
  trianglesTested = 0;
  constructor(
    readonly vertices: Float64Array,
    readonly indices: Uint32Array,
    readonly normals?: Float64Array,
    readonly ownsContact?: ContactOwnership,
  ) {
    if (vertices.length % 3 || indices.length % 3 || !indices.length)
      throw new Error('BVH requires nonempty triangle geometry');
    if (normals && normals.length !== vertices.length) throw new Error('Invalid vertex normals');
    for (const value of vertices) if (!Number.isFinite(value)) throw new Error('Invalid vertex');
    for (const index of indices)
      if (index * 3 >= vertices.length) throw new Error('Triangle index outside vertex array');
    this.order = Array.from({ length: indices.length / 3 }, (_, i) => i);
    this.centroids = new Float64Array(this.order.length * 3);
    for (const t of this.order)
      for (let axis = 0; axis < 3; axis++)
        this.centroids[t * 3 + axis] =
          (vertices[indices[t * 3] * 3 + axis] +
            vertices[indices[t * 3 + 1] * 3 + axis] +
            vertices[indices[t * 3 + 2] * 3 + axis]) /
          3;
    this.build(0, this.order.length);
    // Centroids are never used by the hot path.
    this.centroids = new Float64Array(0);
  }
  private build(start: number, end: number, sortedAxis = -1, leafAxis = -1): number {
    const node: Node = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
      left: -1,
      right: -1,
      start,
      end,
    };
    const id = this.nodes.push(node) - 1;
    for (let j = start; j < end; j++)
      for (let k = 0; k < 3; k++) {
        const p = this.indices[this.order[j] * 3 + k] * 3;
        for (let a = 0; a < 3; a++) {
          node.min[a] = Math.min(node.min[a], this.vertices[p + a]);
          node.max[a] = Math.max(node.max[a], this.vertices[p + a]);
        }
      }
    if (end - start > 8) {
      let axis = 0;
      for (let a = 1; a < 3; a++)
        if (node.max[a] - node.min[a] > node.max[axis] - node.min[axis]) axis = a;
      const middle = (start + end) >>> 1;
      // The centroid/ID comparator is a total order, so selecting its median
      // gives exactly the same child sets as fully sorting a copied range.
      // Small partitions are fully sorted; children on that axis reuse it.
      if (sortedAxis !== axis) sortedAxis = this.partition(start, end, middle, axis) ? axis : -1;
      node.left = this.build(start, middle, sortedAxis, axis);
      node.right = this.build(middle, end, sortedAxis, axis);
    } else if (leafAxis >= 0 && sortedAxis !== leafAxis) {
      // Leaf visitation breaks equal-distance ties. Restore the complete
      // order its parent's old sort produced; a root leaf keeps input order.
      this.insertionSort(start, end, leafAxis);
    }
    return id;
  }
  private compare(a: number, b: number, axis: number): number {
    return this.centroids[a * 3 + axis] - this.centroids[b * 3 + axis] || a - b;
  }
  /** In-place median selection, with a bounded sorting fallback for hostile
   * centroid arrangements. Only the active interval is revisited. */
  private partition(start: number, end: number, middle: number, axis: number): boolean {
    const order = this.order;
    if (end - start > 16) {
      // Ordered and equal-centroid geometry often keeps one split axis for
      // many levels. Recognize either direction once and reuse that order.
      const ascending = this.compare(order[start], order[start + 1], axis) < 0;
      let i = start + 2;
      while (i < end && this.compare(order[i - 1], order[i], axis) < 0 === ascending) i++;
      if (i === end) {
        if (!ascending)
          for (let left = start, right = end - 1; left < right; left++, right--) {
            const value = order[left];
            order[left] = order[right];
            order[right] = value;
          }
        return true;
      }
    }
    let low = start,
      high = end - 1,
      budget = 2 * Math.floor(Math.log2(end - start));
    while (high - low > 15) {
      if (budget-- === 0) {
        this.heapSort(low, high + 1, axis);
        return low === start && high + 1 === end;
      }
      // Median of three avoids one-sided partitions for ordered geometry.
      const a = order[low],
        b = order[(low + high) >>> 1],
        c = order[high];
      const pivot =
        this.compare(a, b, axis) < 0
          ? this.compare(b, c, axis) < 0
            ? b
            : this.compare(a, c, axis) < 0
              ? c
              : a
          : this.compare(a, c, axis) < 0
            ? a
            : this.compare(b, c, axis) < 0
              ? c
              : b;
      let left = low,
        right = high;
      while (left <= right) {
        while (this.compare(order[left], pivot, axis) < 0) left++;
        while (this.compare(order[right], pivot, axis) > 0) right--;
        if (left <= right) {
          const value = order[left];
          order[left++] = order[right];
          order[right--] = value;
        }
      }
      if (middle <= right) high = right;
      else if (middle >= left) low = left;
      else return false;
    }
    this.insertionSort(low, high + 1, axis);
    return low === start && high + 1 === end;
  }
  private insertionSort(start: number, end: number, axis: number) {
    const order = this.order;
    for (let i = start + 1; i < end; i++) {
      const value = order[i];
      let j = i;
      while (j > start && this.compare(order[j - 1], value, axis) > 0) {
        order[j] = order[j - 1];
        j--;
      }
      order[j] = value;
    }
  }
  private heapSort(start: number, end: number, axis: number) {
    const order = this.order,
      length = end - start;
    for (let root = (length >>> 1) - 1; root >= 0; root--) this.siftDown(start, root, length, axis);
    for (let size = length - 1; size > 0; size--) {
      const value = order[start];
      order[start] = order[start + size];
      order[start + size] = value;
      this.siftDown(start, 0, size, axis);
    }
  }
  private siftDown(start: number, root: number, length: number, axis: number) {
    const order = this.order,
      value = order[start + root];
    while (root * 2 + 1 < length) {
      let child = root * 2 + 1;
      if (
        child + 1 < length &&
        this.compare(order[start + child], order[start + child + 1], axis) < 0
      )
        child++;
      if (this.compare(value, order[start + child], axis) >= 0) break;
      order[start + root] = order[start + child];
      root = child;
    }
    order[start + root] = value;
  }
  private intersects(node: Node, o: Vec3, d: Vec3, max: number) {
    let near = 0,
      far = max;
    for (let axis = 0; axis < 3; axis++) {
      const origin = axis === 0 ? o.x : axis === 1 ? o.y : o.z;
      const direction = axis === 0 ? d.x : axis === 1 ? d.y : d.z;
      if (Math.abs(direction) < 1e-12) {
        if (origin < node.min[axis] - 1e-8 || origin > node.max[axis] + 1e-8) return false;
      } else {
        const a = (node.min[axis] - origin) / direction;
        const b = (node.max[axis] - origin) / direction;
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
        if (near > far + 1e-8) return false;
      }
    }
    return true;
  }
  /** Triangle at a leaf's ordered position. Shape queries share this static
   * hierarchy without copying its geometry or build-time permutation. */
  orderedTriangle(position: number): number {
    return this.order[position];
  }
  raycast(origin: Vec3, direction: Vec3, maximum: number, out: RayHit): boolean {
    if (!origin.finite() || !direction.finite() || !Number.isFinite(maximum) || maximum < 0)
      throw new Error('Invalid ray');
    const magnitude = direction.length();
    if (Math.abs(magnitude - 1) > 1e-5) throw new Error('Ray direction must have unit length');
    out.distance = maximum;
    out.triangle = -1;
    this.trianglesTested = 0;
    // Preserve the existing behavior even when callers reuse an output vector
    // as a ray input: those queries must keep resolving intermediate hits.
    const deferDetails =
      origin !== out.point &&
      origin !== out.normal &&
      direction !== out.point &&
      direction !== out.normal;
    let size = 1;
    this.stack[0] = 0;
    while (size) {
      const node = this.nodes[this.stack[--size]];
      if (!this.intersects(node, origin, direction, out.distance)) continue;
      if (node.left >= 0) {
        if (size + 2 > this.stack.length) throw new Error('BVH traversal stack overflow');
        this.stack[size++] = node.left;
        this.stack[size++] = node.right;
        continue;
      }
      for (let j = node.start; j < node.end; j++)
        this.triangle(this.order[j], origin, direction, out, deferDetails);
    }
    if (out.triangle === -1) return false;
    // As in the vertical path, only the final winner needs a contact point and
    // normal. Keep traversal order: tolerated edge hits can precede their AABB.
    if (deferDetails) this.resolveHit(origin, direction, out);
    return true;
  }
  /** Suspension samples on the paved ribbon are vertical. Nearby probes can
   * share the horizontally eligible leaves, even across different road decks.
   * Check each exact ray against its leaves in the original BVH traversal
   * order so coincident edges and contact ownership behave identically. */
  private verticalCell(origin: Vec3): VerticalCell {
    const x = Math.floor(origin.x / 4),
      z = Math.floor(origin.z / 4);
    // Direct-mapped cells bound storage regardless of circuit length or laps.
    const slot = (Math.imul(x, 31) + z) & 63;
    let cell = this.verticalCells[slot];
    if (!cell || cell.x !== x || cell.z !== z) {
      cell ??= { x, z, leaves: [], count: 0 };
      cell.x = x;
      cell.z = z;
      cell.count = 0;
      this.verticalCells[slot] = cell;
      const left = x * 4,
        right = left + 4,
        bottom = z * 4,
        top = bottom + 4;
      let size = 1;
      this.stack[0] = 0;
      while (size) {
        const node = this.nodes[this.stack[--size]];
        if (
          right < node.min[0] - 1e-8 ||
          left > node.max[0] + 1e-8 ||
          top < node.min[2] - 1e-8 ||
          bottom > node.max[2] + 1e-8
        )
          continue;
        if (node.left < 0) {
          // Refill the evicted cell's storage in place. A travelling wheel
          // should stop allocating once it has visited a comparable stretch.
          const leaf = (cell.leaves[cell.count] ??= { node, faces: [], count: 0 });
          leaf.node = node;
          leaf.count = 0;
          for (let j = node.start; j < node.end; j++) {
            const face = (leaf.faces[leaf.count] ??= new VerticalFace());
            this.verticalFace(this.order[j], face);
            if (
              Math.abs(face.det) >= 1e-12 &&
              face.minX <= right &&
              face.maxX >= left &&
              face.minZ <= top &&
              face.maxZ >= bottom
            )
              leaf.count++;
          }
          if (leaf.count) cell.count++;
        } else {
          if (size + 2 > this.stack.length) throw new Error('BVH traversal stack overflow');
          this.stack[size++] = node.left;
          this.stack[size++] = node.right;
        }
      }
    }
    return cell;
  }
  private projectVertical(origin: Vec3, column: VerticalRayColumn) {
    const cell = this.verticalCell(origin);
    column.owner = this;
    column.x = origin.x;
    column.z = origin.z;
    column.count = 0;
    for (let i = 0; i < cell.count; i++) {
      const leaf = cell.leaves[i],
        node = leaf.node;
      if (
        origin.x < node.min[0] - 1e-8 ||
        origin.x > node.max[0] + 1e-8 ||
        origin.z < node.min[2] - 1e-8 ||
        origin.z > node.max[2] + 1e-8
      )
        continue;
      for (let j = 0; j < leaf.count; j++) {
        const f = leaf.faces[j];
        if (origin.x < f.minX || origin.x > f.maxX || origin.z < f.minZ || origin.z > f.maxZ)
          continue;
        this.trianglesTested++;
        const x = origin.x - f.ax,
          z = origin.z - f.az;
        const u = (-x * f.fz + z * f.fx) / f.det;
        if (u < -1e-8 || u > 1 + 1e-8) continue;
        const qy = z * f.ex - x * f.ez,
          w = -qy / f.det;
        if (w < -1e-8 || u + w > 1 + 1e-8) continue;
        const hit = (column.hits[column.count++] ??= new VerticalIntersection());
        hit.triangle = f.triangle;
        hit.ay = f.ay;
        hit.ex = f.ex;
        hit.ey = f.ey;
        hit.ez = f.ez;
        hit.fx = f.fx;
        hit.fy = f.fy;
        hit.fz = f.fz;
        hit.det = f.det;
        hit.x = x;
        hit.z = z;
        hit.u = u;
        hit.w = w;
        hit.qy = qy;
        hit.minY = node.min[1];
        hit.maxY = node.max[1];
      }
    }
  }
  raycastVertical(
    origin: Vec3,
    maximum: number,
    out: RayHit,
    column = this.verticalColumn,
  ): boolean {
    if (!origin.finite() || !Number.isFinite(maximum) || maximum < 0)
      throw new Error('Invalid ray');
    this.trianglesTested = 0;
    if (column.owner !== this || origin.x !== column.x || origin.z !== column.z)
      this.projectVertical(origin, column);
    else this.trianglesTested = column.count;
    out.distance = maximum;
    out.triangle = -1;
    let hitFace: VerticalIntersection | undefined;
    for (let i = 0; i < column.count; i++) {
      const f = column.hits[i];
      if (Math.max(0, origin.y - f.maxY) > Math.min(out.distance, origin.y - f.minY) + 1e-8)
        continue;
      const y = origin.y - f.ay,
        qx = y * f.ez - f.z * f.ey,
        qz = f.x * f.ey - y * f.ex;
      const distance = (f.fx * qx + f.fy * f.qy + f.fz * qz) / f.det;
      if (!(distance >= 0 && distance <= out.distance)) continue;
      if (
        this.ownsContact &&
        !this.ownsContact(f.triangle, origin.x, origin.y - distance, origin.z)
      )
        continue;
      out.distance = distance;
      out.triangle = f.triangle;
      hitFace = f;
    }
    if (!hitFace) return false;
    // Only the winning face supplies the contact point and interpolated normal.
    out.point.copy(origin).addScaled(this.down, out.distance);
    const f = hitFace,
      hitU = f.u,
      hitW = f.w,
      n = this.normals;
    if (n) {
      const a = this.indices[f.triangle * 3] * 3,
        b = this.indices[f.triangle * 3 + 1] * 3,
        c = this.indices[f.triangle * 3 + 2] * 3;
      out.normal
        .set(
          n[a] * (1 - hitU - hitW) + n[b] * hitU + n[c] * hitW,
          n[a + 1] * (1 - hitU - hitW) + n[b + 1] * hitU + n[c + 1] * hitW,
          n[a + 2] * (1 - hitU - hitW) + n[b + 2] * hitU + n[c + 2] * hitW,
        )
        .normalize();
    } else
      out.normal
        .set(f.ey * f.fz - f.ez * f.fy, f.ez * f.fx - f.ex * f.fz, f.ex * f.fy - f.ey * f.fx)
        .normalize();
    if (out.normal.dot(this.down) > 0) out.normal.scale(-1);
    return true;
  }
  private verticalFace(triangle: number, face: VerticalFace) {
    const a = this.indices[triangle * 3] * 3,
      b = this.indices[triangle * 3 + 1] * 3,
      c = this.indices[triangle * 3 + 2] * 3,
      v = this.vertices;
    const ax = v[a],
      ay = v[a + 1],
      az = v[a + 2],
      ex = v[b] - ax,
      ey = v[b + 1] - ay,
      ez = v[b + 2] - az,
      fx = v[c] - ax,
      fy = v[c + 1] - ay,
      fz = v[c + 2] - az;
    const det = -ex * fz + ez * fx;
    // Two barycentric coordinates can each overshoot an edge by 1e-8.
    // Admit their complete tolerance band before the exact three edge tests.
    const padX = 1e-7 * (1 + Math.abs(ex) + Math.abs(fx)),
      padZ = 1e-7 * (1 + Math.abs(ez) + Math.abs(fz));
    face.triangle = triangle;
    face.ax = ax;
    face.ay = ay;
    face.az = az;
    face.ex = ex;
    face.ey = ey;
    face.ez = ez;
    face.fx = fx;
    face.fy = fy;
    face.fz = fz;
    face.det = det;
    face.minX = Math.min(ax, v[b], v[c]) - padX;
    face.maxX = Math.max(ax, v[b], v[c]) + padX;
    face.minZ = Math.min(az, v[b + 2], v[c + 2]) - padZ;
    face.maxZ = Math.max(az, v[b + 2], v[c + 2]) + padZ;
  }
  private triangle(t: number, o: Vec3, d: Vec3, hit: RayHit, deferDetails: boolean) {
    this.trianglesTested++;
    const v = this.vertices,
      idx = this.indices;
    const a = idx[t * 3] * 3,
      b = idx[t * 3 + 1] * 3,
      c = idx[t * 3 + 2] * 3;
    const ex = v[b] - v[a],
      ey = v[b + 1] - v[a + 1],
      ez = v[b + 2] - v[a + 2];
    const fx = v[c] - v[a],
      fy = v[c + 1] - v[a + 1],
      fz = v[c + 2] - v[a + 2];
    const px = d.y * fz - d.z * fy,
      py = d.z * fx - d.x * fz,
      pz = d.x * fy - d.y * fx;
    const determinant = ex * px + ey * py + ez * pz;
    if (Math.abs(determinant) < 1e-12) return;
    const x = o.x - v[a],
      y = o.y - v[a + 1],
      z = o.z - v[a + 2];
    const u = (x * px + y * py + z * pz) / determinant;
    if (u < -1e-8 || u > 1 + 1e-8) return;
    const qx = y * ez - z * ey,
      qy = z * ex - x * ez,
      qz = x * ey - y * ex;
    const w = (d.x * qx + d.y * qy + d.z * qz) / determinant;
    if (w < -1e-8 || u + w > 1 + 1e-8) return;
    const distance = (fx * qx + fy * qy + fz * qz) / determinant;
    if (distance < 0 || distance > hit.distance) return;
    if (
      this.ownsContact &&
      !this.ownsContact(t, o.x + d.x * distance, o.y + d.y * distance, o.z + d.z * distance)
    )
      return;
    hit.distance = distance;
    hit.triangle = t;
    this.hitU = u;
    this.hitW = w;
    if (!deferDetails) this.resolveHit(o, d, hit);
  }
  private resolveHit(o: Vec3, d: Vec3, hit: RayHit) {
    const t = hit.triangle,
      a = this.indices[t * 3] * 3,
      b = this.indices[t * 3 + 1] * 3,
      c = this.indices[t * 3 + 2] * 3,
      u = this.hitU,
      w = this.hitW;
    hit.point.copy(o).addScaled(d, hit.distance);
    if (this.normals) {
      const n = this.normals;
      hit.normal
        .set(
          n[a] * (1 - u - w) + n[b] * u + n[c] * w,
          n[a + 1] * (1 - u - w) + n[b + 1] * u + n[c + 1] * w,
          n[a + 2] * (1 - u - w) + n[b + 2] * u + n[c + 2] * w,
        )
        .normalize();
    } else {
      const v = this.vertices,
        ex = v[b] - v[a],
        ey = v[b + 1] - v[a + 1],
        ez = v[b + 2] - v[a + 2],
        fx = v[c] - v[a],
        fy = v[c + 1] - v[a + 1],
        fz = v[c + 2] - v[a + 2];
      hit.normal.set(ey * fz - ez * fy, ez * fx - ex * fz, ex * fy - ey * fx).normalize();
    }
    if (hit.normal.dot(d) > 0) hit.normal.scale(-1);
  }
}
