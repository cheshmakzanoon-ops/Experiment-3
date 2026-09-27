import { Random } from '../core/math.ts';

/** One 0.64 m tile of original, millimetre-scale aggregate. Cell centres and
 * stone profiles wrap, so albedo, height and roughness agree across a tile seam.
 * This is texture authoring, not new collision geometry or session deposits. */
export class AsphaltAggregate {
  private readonly cells = 64;
  private readonly stones = new Float64Array(64 * 64 * 12);
  constructor(seed: number) {
    if (!Number.isFinite(seed)) throw new Error('Invalid aggregate seed');
    const random = new Random(seed ^ 0x51a7);
    for (let i = 0; i < this.stones.length; i += 12) {
      this.stones[i] = 0.1 + random.next() * 0.8;
      this.stones[i + 1] = 0.1 + random.next() * 0.8;
      this.stones[i + 2] = 0.24 + random.next() * 0.23;
      this.stones[i + 3] = 0.75 + random.next() * 0.5;
      this.stones[i + 4] = random.next();
      this.stones[i + 5] = 0.7 + random.next() * 0.3;
      const angle = random.next() * Math.PI * 2;
      this.stones[i + 6] = Math.cos(angle);
      this.stones[i + 7] = Math.sin(angle);
      for (let facet = 8; facet < 12; facet++) this.stones[i + facet] = 0.82 + random.next() * 0.36;
    }
  }
  /** Write coverage, relief and mineral tone into caller-owned scratch. Sampling
   * the same normalized coordinate at any texture resolution preserves scale. */
  sample(u: number, v: number, out: Float64Array) {
    if (!Number.isFinite(u) || !Number.isFinite(v) || out.length < 3)
      throw new Error('Invalid aggregate sample');
    const x = (u - Math.floor(u)) * this.cells;
    const y = (v - Math.floor(v)) * this.cells;
    const ix = Math.floor(x),
      iy = Math.floor(y);
    let coverage = 0,
      relief = 0,
      tone = 0.5;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx,
          cy = iy + dy;
        const p =
          (((cy + this.cells) % this.cells) * this.cells + ((cx + this.cells) % this.cells)) * 12;
        const sx = x - cx - this.stones[p];
        const sy = y - cy - this.stones[p + 1];
        const aspect = this.stones[p + 3];
        const radius = this.stones[p + 2];
        const rx = (sx * this.stones[p + 6] + sy * this.stones[p + 7]) * aspect;
        const ry = (-sx * this.stones[p + 7] + sy * this.stones[p + 6]) / aspect;
        // Rotated, independently fractured facets avoid a field of circular dots.
        const distance = Math.max(
          Math.abs(rx) / this.stones[p + 8],
          Math.abs(ry) / this.stones[p + 9],
          Math.abs((rx + ry) * Math.SQRT1_2) / this.stones[p + 10],
          Math.abs((rx - ry) * Math.SQRT1_2) / this.stones[p + 11],
        );
        const edge = Math.max(0, Math.min(1, (radius + 0.06 - distance) / 0.12));
        const mask = edge * edge * (3 - 2 * edge);
        if (mask > coverage) {
          coverage = mask;
          // A softened shoulder and broad fractured top, not white-noise spikes.
          const q = Math.min(1, distance / radius);
          relief = (1 - q * q * q * q) * this.stones[p + 5];
          tone = this.stones[p + 4];
        }
      }
    }
    out[0] = coverage;
    out[1] = relief;
    out[2] = tone;
  }
}
