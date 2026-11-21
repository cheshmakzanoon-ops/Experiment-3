import type { Terrain } from './terrain.ts';

export const TERRAIN_SIZE = 5500;
export const terrainSegments = (terrain: Terrain) => (terrain.kind === 'coast' ? 256 : 320);

const surfaces = new WeakMap<Terrain, TerrainSurface>();

/** The GP course mesh and its planting share the same float positions and
 * the same triangle diagonal. An analytic cliff can fall between two mesh
 * vertices, leaving trees metres above, or inside, the displayed hillside. */
export function terrainSurface(terrain: Terrain) {
  let surface = surfaces.get(terrain);
  if (!surface) {
    surface = new TerrainSurface(terrain);
    surfaces.set(terrain, surface);
  }
  return surface;
}

class TerrainSurface {
  readonly segments: number;
  private readonly step: number;
  private readonly heights: Float32Array;

  constructor(private readonly terrain: Terrain) {
    this.segments = terrainSegments(terrain);
    this.step = TERRAIN_SIZE / this.segments;
    this.heights = new Float32Array((this.segments + 1) ** 2).fill(NaN);
  }

  vertex(col: number, row: number) {
    const i = row * (this.segments + 1) + col;
    if (Number.isNaN(this.heights[i])) {
      this.heights[i] = this.terrain.height(
        col * this.step - TERRAIN_SIZE / 2,
        row * this.step - TERRAIN_SIZE / 2,
      );
    }
    return this.heights[i];
  }

  height(x: number, z: number) {
    const u = (x + TERRAIN_SIZE / 2) / this.step,
      v = (z + TERRAIN_SIZE / 2) / this.step;
    if (u < 0 || v < 0 || u > this.segments || v > this.segments) return this.terrain.height(x, z);
    const col = Math.min(this.segments - 1, Math.floor(u)),
      row = Math.min(this.segments - 1, Math.floor(v));
    const fx = u - col,
      fz = v - row;
    const east = this.vertex(col + 1, row),
      south = this.vertex(col, row + 1);
    if (fx + fz <= 1) return this.vertex(col, row) * (1 - fx - fz) + east * fx + south * fz;
    return this.vertex(col + 1, row + 1) * (fx + fz - 1) + east * (1 - fz) + south * (1 - fx);
  }
}
