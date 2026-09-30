import type { Track } from '../simulation/track.ts';

/** Coarse world grid of distance to the circuit centreline and the road height
 * at the nearest centreline point. Built by rasterising each centreline segment
 * into the cells within `reach` metres (O(segments × local cells)), not by a
 * brute-force nearest search per cell. Used for terrain blending and planting,
 * never for physics (the contact ribbon remains authoritative). */
export class TrackDistanceField {
  readonly size: number;
  readonly cell: number;
  readonly half: number;
  readonly distance: Float32Array;
  readonly height: Float32Array;
  constructor(
    track: Track,
    readonly extent = 2750,
    cell = 20,
    readonly reach = 420,
  ) {
    this.cell = cell;
    this.half = extent;
    this.size = Math.ceil((2 * extent) / cell) + 1;
    const n = this.size * this.size;
    this.distance = new Float32Array(n).fill(Infinity);
    this.height = new Float32Array(n).fill(NaN);
    const points = track.points,
      radius = Math.ceil(reach / cell);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1];
      const cx = Math.round((a.x + extent) / cell),
        cz = Math.round((a.z + extent) / cell);
      const dx = b.x - a.x,
        dz = b.z - a.z,
        len2 = dx * dx + dz * dz || 1;
      for (let gz = Math.max(0, cz - radius); gz <= Math.min(this.size - 1, cz + radius); gz++)
        for (let gx = Math.max(0, cx - radius); gx <= Math.min(this.size - 1, cx + radius); gx++) {
          const x = gx * cell - extent,
            z = gz * cell - extent;
          const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2));
          const px = a.x + dx * t,
            pz = a.z + dz * t;
          const d = Math.hypot(x - px, z - pz),
            k = gz * this.size + gx;
          if (d < this.distance[k]) {
            this.distance[k] = d;
            this.height[k] = a.y + (b.y - a.y) * t;
          }
        }
    }
  }
  /** Bilinear sample; Infinity/NaN outside the rasterised reach. */
  sample(x: number, z: number, out: { distance: number; height: number }) {
    const fx = (x + this.half) / this.cell,
      fz = (z + this.half) / this.cell;
    const ix = Math.floor(fx),
      iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= this.size - 1 || iz >= this.size - 1) {
      out.distance = Infinity;
      out.height = NaN;
      return out;
    }
    const u = fx - ix,
      v = fz - iz;
    const k = iz * this.size + ix;
    const corners = [k, k + 1, k + this.size, k + this.size + 1];
    const weights = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
    let d = 0,
      h = 0,
      w = 0,
      far = false;
    for (let c = 0; c < 4; c++) {
      const dc = this.distance[corners[c]];
      if (!Number.isFinite(dc)) {
        far = true;
        continue;
      }
      d += dc * weights[c];
      h += this.height[corners[c]] * weights[c];
      w += weights[c];
    }
    if (far && w < 1e-6) {
      out.distance = Infinity;
      out.height = NaN;
      return out;
    }
    out.distance = far ? Math.max(d / w, this.reach * 0.75) : d;
    out.height = h / w;
    return out;
  }
}
