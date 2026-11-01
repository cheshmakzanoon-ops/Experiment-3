import { Random, clamp } from '../../core/math.ts';

/** Original deterministic surface authoring data shared by renderer adapters.
 * No textures, DOM, shader hooks, scene resources or simulation state are owned
 * here. Preserve sampling, PRNG, arithmetic and typed-array write order: the
 * independent cee488b oracle pins the original bytes and formatted constants.
 * Other surface kinds retain the same generator and compatibility exports. */
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

export type SurfaceKind = 'asphalt' | 'grass' | 'gravel' | 'concrete';
const palette: Record<SurfaceKind, readonly [number, number, number]> = {
  // Near-neutral binder and aggregate: sRGB #646361, B/R 0.97. The finish's
  // ASPHALT_TONE sets the rendered albedo (~0.095 linear, real race asphalt).
  asphalt: [100, 99, 97],
  grass: [89, 101, 53],
  gravel: [150, 138, 114],
  concrete: [172, 172, 162],
};
/** Original repeatable texels, not photographs or commercial-game assets.
 * A single seeded height field drives correlated albedo and roughness; the
 * material still receives actual scene illumination rather than baked shading. */
export function surfacePixels(kind: SurfaceKind, size = 512, seed = 1887) {
  if (!Number.isInteger(size) || size < 8 || size > 1024) throw new Error('Invalid surface size');
  const random = new Random(seed),
    height = new Uint8Array(size * size);
  const albedo = new Uint8ClampedArray(size * size * 4),
    roughness = new Uint8ClampedArray(albedo.length);
  const base = palette[kind];
  const aggregate = kind === 'asphalt' ? new AsphaltAggregate(seed) : null;
  const meso = aggregate ? asphaltMesoPixels(size, seed) : null;
  const stone = new Float64Array(3);
  const noise = new Float32Array(64 * 64);
  for (let i = 0; i < noise.length; i++) noise[i] = random.next();
  const field = (x: number, y: number, period: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    const u = x - ix,
      v = y - iy;
    const a = u * u * (3 - 2 * u),
      b = v * v * (3 - 2 * v);
    const at = (dx: number, dy: number) => noise[((iy + dy) % period) * 64 + ((ix + dx) % period)];
    return (at(0, 0) * (1 - a) + at(1, 0) * a) * (1 - b) + (at(0, 1) * (1 - a) + at(1, 1) * a) * b;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const at = y * size + x;
      const grain = random.next();
      // Wrapped stochastic fields tile without the visibly rectangular bumps
      // produced by multiplying horizontal and vertical sine waves.
      const broad =
        field((x / size) * 5, (y / size) * 5, 5) * 0.55 +
        field((x / size) * 17, (y / size) * 17, 17) * 0.3 +
        field((x / size) * 53, (y / size) * 53, 53) * 0.15 -
        0.5;
      if (aggregate) aggregate.sample((x + 0.5) / size, (y + 0.5) / size, stone);
      // Open-graded voids: dark pockets in the binder between chips, a few
      // millimetres across, where the mastic never filled the stone skeleton.
      const pore = aggregate
        ? (1 - stone[0]) *
          clamp(
            (field((x / size) * 61, (y / size) * 61, 61) * 0.55 +
              field((x / size) * 37, (y / size) * 37, 37) * 0.45 -
              0.5) *
              4.5,
            0,
            1,
          )
        : 0;
      const h = clamp(
        aggregate
          ? 0.2 + stone[1] * 0.54 + (grain - 0.5) * 0.035 + broad * 0.04 - pore * 0.16
          : 0.4 + grain * 0.4 + broad * 0.08,
        0,
        1,
      );
      height[at] = Math.round(h * 255);
      // Dark bituminous mastic between light, traffic-polished chips of mixed
      // mineralogy, and darker open voids. The byte span stays inside the
      // dry-nonmetal guard (red 50-120); the near-field shader converges the
      // chip contrast to the tile mean with distance.
      const variation = aggregate
        ? Math.min(
            13,
            (1 - stone[0]) * (-22 + (grain - 0.5) * 6 + broad * 4 - pore * 11) +
              stone[0] * (-8 + stone[2] * 22 + (grain - 0.5) * 5 + broad * 3),
          )
        : kind === 'grass'
          ? (grain - 0.5) * 44 + broad * 10
          : kind === 'gravel'
            ? (grain - 0.5) * 57 + broad * 9
            : (grain - 0.5) * 26 + broad * 4;
      const r = aggregate ? 188 + stone[0] * 32 + grain * 9 : 224 + grain * 24;
      for (let c = 0; c < 3; c++) {
        albedo[at * 4 + c] = base[c] + variation;
        roughness[at * 4 + c] = r;
      }
      if (meso) {
        // Linear data channels the stock shader never reads (it samples
        // roughness from G): R carries the 4.5 m meso tile, B chip coverage.
        roughness[at * 4] = Math.round(meso[at] * 255);
        roughness[at * 4 + 2] = Math.round(stone[0] * 255);
      }
      albedo[at * 4 + 3] = roughness[at * 4 + 3] = 255;
    }
  return { albedo, height, roughness };
}

/** Asphalt texel authoring constants (texture space; the shader half lives in
 * studio/road-detail.ts). */
export const ASPHALT_TEXELS = Object.freeze({
  /** Micro aggregate tile and the second, larger meso tile, metres. */
  microTile: 0.64,
  mesoTile: 4.5,
  /** The meso tile's own seed offset, so it never repeats the micro pattern. */
  mesoSeed: 0x4d35,
  /** Sobel gain on unit height per texel at 512 px (about 1.7 mm chip relief). */
  normalStrength: 2.5,
  normalScale: 0.75,
});

function periodicLattice(random: Random, period: number) {
  const values = new Float32Array(period * period);
  for (let i = 0; i < values.length; i++) values[i] = random.next();
  return (x: number, y: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    const u = x - ix,
      v = y - iy;
    const a = u * u * (3 - 2 * u),
      b = v * v * (3 - 2 * v);
    const at = (dx: number, dy: number) =>
      values[((iy + dy) % period) * period + ((ix + dx) % period)];
    return (at(0, 0) * (1 - a) + at(1, 0) * a) * (1 - b) + (at(0, 1) * (1 - a) + at(1, 1) * a) * b;
  };
}

/** One seamless 4.5 m tile at `size`² of road-scale structure the 0.64 m chip
 * tile cannot carry: binder-rich and chip-rich regions from decimetres down to
 * a few centimetres, plus sparse dark oil/rubber specks. Normalised to mean
 * 0.5 and a fixed spread, so the shader's tone and relief gains are absolute. */
export function asphaltMesoPixels(size = 512, seed = 1887) {
  if (!Number.isInteger(size) || size < 8 || size > 1024) throw new Error('Invalid meso size');
  const random = new Random((seed ^ ASPHALT_TEXELS.mesoSeed) >>> 0 || 1);
  const octaves = (
    [
      // Weighted toward centimetre segregation: broad decimetre clouds read
      // as mottled concrete rather than laid asphalt.
      [5, 0.05],
      [11, 0.08],
      [23, 0.15],
      [47, 0.22],
      [97, 0.24],
      [193, 0.2],
    ] as const
  ).map(([period, amplitude]) => ({ period, amplitude, at: periodicLattice(random, period) }));
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size,
        v = (y + 0.5) / size;
      let f = 0;
      for (const o of octaves) f += o.amplitude * (o.at(u * o.period, v * o.period) - 0.5);
      field[y * size + x] = f;
    }
  // Dark specks 1-3 cm across: oil drips, rubber crumbs, filled pores.
  const specks = Math.round(260 * (size / 512) ** 2) + 8;
  for (let i = 0; i < specks; i++) {
    const cx = random.next() * size,
      cy = random.next() * size;
    const radius = Math.max(0.6, (0.6 + random.next() * 1.6) * (size / 512));
    const depth = 0.05 + random.next() * 0.09;
    const reach = Math.ceil(radius + 1);
    for (let dy = -reach; dy <= reach; dy++)
      for (let dx = -reach; dx <= reach; dx++) {
        const d = Math.hypot(dx + 0.5 - (cx % 1), dy + 0.5 - (cy % 1)) / radius;
        if (d >= 1) continue;
        const px = (Math.floor(cx) + dx + size) % size,
          py = (Math.floor(cy) + dy + size) % size;
        field[py * size + px] -= depth * (1 - d * d);
      }
  }
  let mean = 0;
  for (const f of field) mean += f;
  mean /= field.length;
  let variance = 0;
  for (const f of field) variance += (f - mean) ** 2;
  const spread = 0.16 / Math.sqrt(variance / field.length || 1);
  for (let i = 0; i < field.length; i++) field[i] = clamp(0.5 + (field[i] - mean) * spread, 0, 1);
  return field;
}

/** Tangent-space normals (RGBA bytes, +V up as the flipped canvas uploads)
 * from a wrapped height field by a 3×3 Sobel operator. `strength` is the gain
 * at 512 px per tile; other sizes keep the same physical slope. */
export function surfaceNormalPixels(
  height: ArrayLike<number>,
  size: number,
  strength: number = ASPHALT_TEXELS.normalStrength,
) {
  if (!Number.isInteger(size) || size < 2 || height.length !== size * size)
    throw new Error('Invalid normal source');
  if (!Number.isFinite(strength) || strength < 0) throw new Error('Invalid normal strength');
  const out = new Uint8ClampedArray(size * size * 4);
  const gain = (strength * (size / 512)) / (8 * 255);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const gx =
        h(x + 1, y - 1) +
        2 * h(x + 1, y) +
        h(x + 1, y + 1) -
        h(x - 1, y - 1) -
        2 * h(x - 1, y) -
        h(x - 1, y + 1);
      const gy =
        h(x - 1, y + 1) +
        2 * h(x, y + 1) +
        h(x + 1, y + 1) -
        h(x - 1, y - 1) -
        2 * h(x, y - 1) -
        h(x + 1, y - 1);
      // Canvas rows run down the image while texture V runs up it.
      const nx = -gx * gain,
        ny = gy * gain,
        inverse = 1 / Math.hypot(nx, ny, 1);
      const at = (y * size + x) * 4;
      out[at] = Math.round((nx * inverse * 0.5 + 0.5) * 255);
      out[at + 1] = Math.round((ny * inverse * 0.5 + 0.5) * 255);
      out[at + 2] = Math.round((inverse * 0.5 + 0.5) * 255);
      out[at + 3] = 255;
    }
  return out;
}
/** Linear-light mean albedo and mean roughness of the chip tile: the value
 * the shader converges to once the micro tile fades out with distance. */
export function asphaltTexelMeans(data: {
  albedo: ArrayLike<number>;
  roughness: ArrayLike<number>;
}) {
  const decode = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const albedo = [0, 0, 0];
  let roughness = 0;
  const texels = data.albedo.length / 4;
  for (let i = 0; i < texels; i++) {
    for (let c = 0; c < 3; c++) albedo[c] += decode(data.albedo[i * 4 + c]);
    roughness += data.roughness[i * 4 + 1] / 255;
  }
  return {
    albedo: albedo.map((v) => v / texels) as [number, number, number],
    roughness: roughness / texels,
  };
}

/** Linear tone gain of the racing asphalt over its byte-limited texels (P4
 * allows tone in the shader; the bytes stay inside the R<120 guard). Race
 * asphalt is a dark, near-neutral grey: effective linear albedo ~0.095 (real
 * surfaces 0.08-0.12), below the turf beside it (~0.11) and 6-8x below the
 * line paint, so the road is the darkest large surface in a sunlit frame.
 * The slightly cooler G/B gains keep the near-neutral texels from reading
 * warm under the sun. */
export const ASPHALT_TONE = Object.freeze([1.01, 1.04, 1.08] as const);

/** Original shader-side asphalt constants. Renderer hooks retain ownership of
 * formatting, shader composition and material/scan lifetime. */
export const ASPHALT_DETAIL = Object.freeze({
  /** Distance band over which the chip tile converges to its mean, metres. */
  microFade: [15, 40] as const,
  /** Near-field chip contrast gain over the texels (1 = as authored). The
   * chip tile now spans binder voids to polished chips, so only a light lift. */
  microContrast: 1.15,
  /** Meso tile size, metres; albedo, roughness and relief gains per unit field. */
  mesoTile: 4.5,
  mesoTone: 0.4,
  mesoRoughness: 0.12,
  /** Relief of the meso field, metres per unit (about +-0.6 mm at one sigma). */
  mesoRelief: 0.0035,
  /** Glints: range from the camera (m), facet grid (m), share of cells holding
   * a fractured facet, facet radius (share of a cell) and facet roughness. */
  glintRange: 6,
  glintCell: 0.025,
  glintShare: 0.14,
  glintRadius: 0.3,
  glintRoughness: 0.26,
});
