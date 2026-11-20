import { Vec3 } from '../../core/math.ts';
import { TriangleBVH } from '../bvh.ts';
import { TireFootprint } from '../tire-footprint.ts';
import { trackPoint } from '../track.ts';
import type { RoadEdge, RoadNetwork } from './road-network.ts';
import { FOOTWAY_OFFSETS, footwayVertex, townFootways } from './town-footways.ts';

// Locally indexed, overlapping sections keep first contact construction bounded.
// One adjacent station on either end includes the complete tread at a block seam.
const BLOCK_SEGMENTS = 12;
export class FootwayContact {
  private readonly blocks = new Map<number, TireFootprint>();

  constructor(private readonly network: RoadNetwork) {}

  section(edge: RoadEdge, segment: number, side: number) {
    const start = edge.first + Math.floor((segment - edge.first) / BLOCK_SEGMENTS) * BLOCK_SEGMENTS;
    const key = 2 * start + (side > 0 ? 1 : 0);
    let footprint = this.blocks.get(key);
    if (!footprint) {
      footprint = this.build(
        edge,
        Math.max(edge.first, start - 1),
        Math.min(edge.last, start + BLOCK_SEGMENTS + 1),
        side,
      );
      this.blocks.set(key, footprint);
    }
    return footprint;
  }

  private build(edge: RoadEdge, start: number, end: number, side: number) {
    const net = this.network,
      footways = townFootways(net),
      p = trackPoint(),
      vertex = new Vec3();
    // Two lane vertices, then the gutter and stone mesh. The separate
    // asphalt and paving edges retain the actual 5 mm construction joint.
    const columns = 2 + FOOTWAY_OFFSETS.length;
    const vertices = new Float64Array((end - start + 1) * columns * 3);
    const triangles: number[] = [];
    const width = edge.spec.halfWidth;
    for (let row = start; row <= end; row++) {
      const i = Math.min(row, edge.last - 1),
        t = row - i;
      net.pointOnSegment(i, t, p);
      const strength = footways.strength(edge, i, t, side);
      const edgeY = net.surfaceHeight(p, side * width, width, edge.spec.crown);
      for (let col = 0; col < columns; col++) {
        const idx = (row - start) * columns + col;
        if (col < 2) {
          const lateral = side * (width + (col === 0 ? -1.2 : 0));
          vertex.set(
            p.x + p.nx * lateral,
            net.surfaceHeight(p, lateral, width, edge.spec.crown),
            p.z + p.nz * lateral,
          );
        } else footwayVertex(p, width, side, edgeY, FOOTWAY_OFFSETS[col - 2], strength, vertex);
        vertices[idx * 3] = vertex.x;
        vertices[idx * 3 + 1] = vertex.y;
        vertices[idx * 3 + 2] = vertex.z;
        if (row === end || col === 1 || col === columns - 1) continue;
        const next = idx + columns;
        if (side > 0) triangles.push(idx, next, idx + 1, idx + 1, next, next + 1);
        else triangles.push(idx + 1, next + 1, idx, idx, next + 1, next);
      }
    }
    return new TireFootprint(new TriangleBVH(vertices, Uint32Array.from(triangles)));
  }
}
