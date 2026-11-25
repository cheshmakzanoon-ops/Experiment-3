import type { TrackPoint } from './track.ts';

/** Repeated wheel and chassis queries share the centreline segments that
 * can be closest anywhere within a four-metre square of a 32 m search cell. */
const LANE_CELL = 4;

export class TrackLaneIndex {
  private readonly cells = new Map<string, { segments: readonly number[]; witness: number }>();
  private readonly fifoKeys: string[] | null;
  private fifoCursor = 0;

  constructor(
    private readonly points: readonly TrackPoint[],
    private readonly capacity = Infinity,
  ) {
    // Grow only with resident cells; unbounded and unusual capacities retain
    // their existing Map policy without allocating a queue.
    this.fifoKeys = Number.isInteger(capacity) && capacity > 0 ? [] : null;
  }

  candidates(
    x: number,
    z: number,
    coarse: readonly number[],
    height?: number,
    layerGap = 0,
  ): readonly number[] {
    const ix = Math.floor(x / LANE_CELL),
      iz = Math.floor(z / LANE_CELL),
      key = `${ix},${iz}`;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = this.build(ix, iz, coarse);
      if (this.fifoKeys) {
        if (this.fifoKeys.length < this.capacity) this.fifoKeys.push(key);
        else {
          // Hits never change insertion order. Reuse the oldest key slot so
          // eviction does not restart a Map iterator through deleted entries.
          this.cells.delete(this.fifoKeys[this.fifoCursor]);
          this.fifoKeys[this.fifoCursor] = key;
          if (++this.fifoCursor === this.capacity) this.fifoCursor = 0;
        }
      } else if (this.cells.size >= this.capacity)
        this.cells.delete(this.cells.keys().next().value!);
      this.cells.set(key, cell);
    }
    if (height !== undefined && Number.isFinite(height)) {
      // The horizontal bound requires at least one eligible road segment.
      // Its interpolated centre height lies between the two endpoints. If
      // this layer cannot be proved, scan the original list, including decks.
      const a = this.points[cell.witness],
        b = this.points[cell.witness + 1];
      if (!a || !b || Math.max(Math.abs(height - a.y), Math.abs(height - b.y)) >= layerGap - 1e-7)
        return coarse;
    }
    return cell.segments;
  }

  private build(ix: number, iz: number, coarse: readonly number[]) {
    const left = ix * LANE_CELL,
      top = iz * LANE_CELL,
      right = left + LANE_CELL,
      bottom = top + LANE_CELL,
      cx = left + LANE_CELL / 2,
      cz = top + LANE_CELL / 2;
    let nearestVertexSq = Infinity,
      witness = -1;
    for (const i of coarse) {
      const p = this.points[i];
      const squared = (p.x - cx) ** 2 + (p.z - cz) ** 2;
      if (squared < nearestVertexSq) {
        nearestVertexSq = squared;
        witness = i;
      }
    }
    // That vertex belongs to a candidate segment. Its distance to any query
    // inside the square is at most the centre distance plus half a diagonal.
    const upperSq = (Math.sqrt(nearestVertexSq) + LANE_CELL * Math.SQRT1_2 + 1e-7) ** 2;
    const local = coarse.filter((i) => {
      const a = this.points[i],
        b = this.points[i + 1];
      // A segment can't be closer than its bounding box. Keep equality and
      // the original order so exact ties still resolve to the same station.
      const dx = Math.max(0, left - Math.max(a.x, b.x), Math.min(a.x, b.x) - right),
        dz = Math.max(0, top - Math.max(a.z, b.z), Math.min(a.z, b.z) - bottom);
      return dx * dx + dz * dz <= upperSq;
    });
    return { segments: local, witness };
  }
}
