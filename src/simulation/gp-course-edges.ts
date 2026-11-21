import { mod, smooth } from '../core/math.ts';
import { gpCornerShapes } from './gp-corner-shape.ts';
import type { Track } from './track.ts';

export const GP_KERB_WIDTH = 1.1;
/** Metres of paved shoulder beyond the edge line: service margin on the
 * straights and a full painted escape apron at a constructed kerb. */
export const apronWidth = (amount: number) => 0.4 + 3.6 * amount;

/** Surveyed inside apex and outside entry/exit kerbs. A narrow table is
 * shared by the rendered road, analytical contact and triangle collision.
 * Adjacent chicane runs join without piling two kerbs on top of each other. */
export class GpCourseEdges {
  private readonly spacing: number;
  private readonly amounts: [Float32Array, Float32Array];
  private readonly ranges: [Array<[number, number]>, Array<[number, number]>] = [[], []];

  constructor(track: Track) {
    const count = Math.ceil(track.length / 2);
    this.spacing = track.length / count;
    this.amounts = [new Float32Array(count), new Float32Array(count)];
    const envelope = (side: number, start: number, end: number) => {
      const values = this.amounts[side < 0 ? 0 : 1];
      const taper = Math.min(12, (end - start) * 0.32);
      for (let i = Math.ceil(start / this.spacing); i <= Math.floor(end / this.spacing); i++) {
        const s = i * this.spacing;
        const value = smooth(0, taper, Math.min(s - start, end - s));
        const bin = mod(i, count);
        values[bin] = Math.max(values[bin], value);
      }
    };
    gpCornerShapes(track).forEach((shape, i) => {
      if (shape.direction === 'straight') return;
      const apex = track.circuit.corners[i].s;
      const inside = shape.direction === 'left' ? 1 : -1;
      envelope(
        inside,
        apex - Math.max(17, shape.entry * 0.62),
        apex + Math.max(19, shape.exit * 0.7),
      );
      envelope(-inside, apex - shape.entry - 12, apex - shape.entry * 0.28);
      envelope(-inside, apex + shape.exit * 0.15, apex + shape.exit + 14);
    });
    for (const side of [0, 1] as const) {
      const values = this.amounts[side];
      let start = -1;
      for (let i = 0; i < count; i++) {
        const active = values[i] > 0 || values[(i + 1) % count] > 0;
        if (active && start < 0) start = i * this.spacing;
        if (!active && start >= 0) {
          this.ranges[side].push([start, i * this.spacing]);
          start = -1;
        }
      }
      if (start >= 0) this.ranges[side].push([start, track.length]);
    }
  }
  at(s: number, lateral: number): number {
    const values = this.amounts[lateral < 0 ? 0 : 1];
    const x = s / this.spacing;
    const floor = Math.floor(x);
    const i = mod(floor, values.length);
    return values[i] + (values[(i + 1) % values.length] - values[i]) * (x - floor);
  }
  runs(side: number): ReadonlyArray<readonly [number, number]> {
    return this.ranges[side < 0 ? 0 : 1];
  }
}
