import type { TrackPoint } from '../track.ts';

/** A four-metre square fits exactly inside one of Track's 32 m search cells.
 * The stadium can fold several hundred centreline segments into one such
 * coarse cell. Wheel, chassis and collision queries revisit the same squares. */
const LANE_CELL = 4;

export class MotocrossLaneIndex {
  private readonly cells = new Map<string, readonly number[]>();

  constructor(private readonly points: readonly TrackPoint[]) {}

  candidates(x: number, z: number, coarse: readonly number[]): readonly number[] {
    const ix = Math.floor(x / LANE_CELL),
      iz = Math.floor(z / LANE_CELL),
      key = `${ix},${iz}`;
    const cached = this.cells.get(key);
    if (cached) return cached;

    const left = ix * LANE_CELL,
      top = iz * LANE_CELL,
      right = left + LANE_CELL,
      bottom = top + LANE_CELL,
      cx = left + LANE_CELL / 2,
      cz = top + LANE_CELL / 2;
    let nearestVertexSq = Infinity;
    for (const i of coarse) {
      const p = this.points[i];
      nearestVertexSq = Math.min(nearestVertexSq, (p.x - cx) ** 2 + (p.z - cz) ** 2);
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
    this.cells.set(key, local);
    return local;
  }
}
