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
interface Node {
  min: number[];
  max: number[];
  left: number;
  right: number;
  start: number;
  end: number;
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
  trianglesTested = 0;
  constructor(
    readonly vertices: Float64Array,
    readonly indices: Uint32Array,
    readonly normals?: Float64Array,
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
  private build(start: number, end: number): number {
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
      const part = this.order.slice(start, end);
      part.sort((a, b) => this.centroids[a * 3 + axis] - this.centroids[b * 3 + axis] || a - b);
      for (let j = 0; j < part.length; j++) this.order[start + j] = part[j];
      const middle = (start + end) >>> 1;
      node.left = this.build(start, middle);
      node.right = this.build(middle, end);
    }
    return id;
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
  raycast(origin: Vec3, direction: Vec3, maximum: number, out: RayHit): boolean {
    if (!origin.finite() || !direction.finite() || !Number.isFinite(maximum) || maximum < 0)
      throw new Error('Invalid ray');
    const magnitude = direction.length();
    if (Math.abs(magnitude - 1) > 1e-5) throw new Error('Ray direction must have unit length');
    out.distance = maximum;
    out.triangle = -1;
    this.trianglesTested = 0;
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
        this.triangle(this.order[j], origin, direction, out);
    }
    return out.triangle !== -1;
  }
  private triangle(t: number, o: Vec3, d: Vec3, hit: RayHit) {
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
    hit.distance = distance;
    hit.triangle = t;
    hit.point.copy(o).addScaled(d, distance);
    if (this.normals) {
      const n = this.normals;
      hit.normal
        .set(
          n[a] * (1 - u - w) + n[b] * u + n[c] * w,
          n[a + 1] * (1 - u - w) + n[b + 1] * u + n[c + 1] * w,
          n[a + 2] * (1 - u - w) + n[b + 2] * u + n[c + 2] * w,
        )
        .normalize();
    } else hit.normal.set(ey * fz - ez * fy, ez * fx - ex * fz, ex * fy - ey * fx).normalize();
    if (hit.normal.dot(d) > 0) hit.normal.scale(-1);
  }
}
