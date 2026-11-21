import { smoothstep, valueNoise } from './noise.ts';
import type { RockSpurSpec } from './region-data.ts';

interface Spur {
  x: number;
  z: number;
  dx: number;
  dz: number;
  length: number;
  width: number;
  height: number;
  seed: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Bedded spurs on the Varda massif. A steep scarp faces the pass and a long
 * dip slope returns to the natural hillside. Erosion cuts through the crest in
 * places. Sampling the landform in metres keeps near tiles, distant tiles,
 * road survey, tree roots and wheel contact on the same rock. */
export class AlpineSpurs {
  private readonly spurs: Spur[];
  private x0 = Infinity;
  private x1 = -Infinity;
  private z0 = Infinity;
  private z1 = -Infinity;

  constructor(specs: readonly RockSpurSpec[], seed: number) {
    this.spurs = specs.map(({ from, to, width, height }, k) => {
      const dx = to[0] - from[0],
        dz = to[1] - from[1];
      const length = Math.hypot(dx, dz);
      const margin = width * 1.24;
      const x0 = Math.min(from[0], to[0]) - margin,
        x1 = Math.max(from[0], to[0]) + margin;
      const z0 = Math.min(from[1], to[1]) - margin,
        z1 = Math.max(from[1], to[1]) + margin;
      this.x0 = Math.min(this.x0, x0);
      this.x1 = Math.max(this.x1, x1);
      this.z0 = Math.min(this.z0, z0);
      this.z1 = Math.max(this.z1, z1);
      return {
        x: from[0],
        z: from[1],
        dx: dx / length,
        dz: dz / length,
        length,
        width,
        height,
        seed: seed + 479 * k,
        x0,
        x1,
        z0,
        z1,
      };
    });
  }
  relief(x: number, z: number, minWavelength = 0) {
    if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1) return 0;
    let relief = 0;
    for (const spur of this.spurs) {
      if (x < spur.x0 || x > spur.x1 || z < spur.z0 || z > spur.z1) continue;
      const along = (x - spur.x) * spur.dx + (z - spur.z) * spur.dz;
      if (along <= 0 || along >= spur.length) continue;
      const ends = smoothstep(
        0,
        Math.min(spur.length * 0.23, spur.width * 1.4),
        Math.min(along, spur.length - along),
      );
      const bend = 0.22 * valueNoise(along / 104, 0.4, spur.seed);
      const cross = ((z - spur.z) * spur.dx - (x - spur.x) * spur.dz) / spur.width - bend;
      const run = cross < 0 ? -cross / 0.62 : cross;
      if (run >= 1) continue;
      const scarp =
        cross < 0 ? 1 - smoothstep(0.12, 1, run) : (1 - run) * (1 - run) * (1 + 0.62 * run);
      const shoulder = 0.82 + 0.18 * valueNoise(along / 97, 0.3, spur.seed + 1);
      // Fractures taper away at coarse spacing. The large buttress and its
      // silhouette are retained as the streamer changes resolution.
      const joint = Math.abs(valueNoise(along / 33, cross * 0.85, spur.seed + 2));
      const notch = (1 - smoothstep(0.02, 0.25, joint)) * (1 - smoothstep(16, 62, minWavelength));
      relief = Math.max(relief, ends * scarp * spur.height * (shoulder - 0.22 * notch));
    }
    return relief;
  }
}
