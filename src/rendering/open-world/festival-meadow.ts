import * as T from 'three';
import { hash01 } from '../../simulation/open-world/noise.ts';
import { StructureGrid, type Structure } from '../../simulation/open-world/placement.ts';
import { ROAD_FLAG, type RoadEdge } from '../../simulation/open-world/road-network.ts';
import { gridHeight, TILE_STEP } from '../../simulation/open-world/terrain-tiles.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import { trackPoint } from '../../simulation/track.ts';
import type { GrassClump } from '../vegetation/grass.ts';

/** References 032/036/050/098: short green growth at the maintained edge,
 * broken patches of taller seedheads behind it, and an unobstructed route.
 * Authored botanical cues; no reference image is shipped as a texture. */
export const FESTIVAL_MEADOW = Object.freeze({
  chunk: 96,
  clearance: 0.8,
  range: { low: 38, medium: 82, high: 120, ultra: 155 },
  density: { low: 0.28, medium: 0.76, high: 1, ultra: 1 },
});

/** Construction-time, deterministic verge plan. Every root is sampled from
 * the same 4 m carved triangle as physics. Sharing the four heights of each
 * cell avoids rebuilding terrain for every blade in a cluster. */
export function festivalMeadowPlan(
  world: OpenWorld,
  structures: readonly Structure[],
  roads: readonly RoadEdge[] = world.network.edges,
): GrassClump[] {
  const net = world.network,
    field = world.field,
    blocked = new StructureGrid(structures),
    p = trackPoint(),
    q = trackPoint(),
    cells = new Map<string, Float32Array>(),
    out: GrassClump[] = [];
  const ground = (x: number, z: number) => {
    const x0 = Math.floor(x / TILE_STEP) * TILE_STEP,
      z0 = Math.floor(z / TILE_STEP) * TILE_STEP,
      key = `${x0},${z0}`;
    let heights = cells.get(key);
    if (!heights) {
      heights = world.carver.build(x0, z0, TILE_STEP, 1).heights;
      cells.set(key, heights);
    }
    return gridHeight(heights, 2, (x - x0) / TILE_STEP, (z - z0) / TILE_STEP, TILE_STEP);
  };
  for (const edge of roads) {
    if (edge.roadClass === 'town' || edge.roadClass === 'runway') continue;
    const circuit = edge.roadClass === 'circuit',
      step = circuit ? 4 : edge.roadClass === 'dirt' ? 8 : 12,
      candidates = circuit ? 8 : 4;
    for (let row = 0, station = 18; station < edge.length - 18; row++, station += step) {
      net.at(edge.offset + station, p);
      // Vegetation never decorates a bridge deck or its unsupported shoulder.
      net.nearest(p.x, p.z, q, p.y);
      if (net.flags[net.lastSegment] & ROAD_FLAG.BRIDGE) continue;
      for (const side of [-1, 1]) {
        const seed = edge.index * 2 + (side > 0 ? 1 : 0),
          patch = hash01(Math.floor(station / 28), seed, 0x17e2);
        // A broad gap is shared by adjacent rows rather than white-noise dots.
        if (patch < 0.12) continue;
        for (let k = 0; k < candidates; k++) {
          const h = hash01(row * 8 + k, seed, 0x4fa1),
            outer = k >= candidates / 2;
          if (outer && h > 0.72 + patch * 0.18) continue;
          const width = 0.72 + h * 0.52,
            along =
              ((k % (candidates / 2)) / (candidates / 2) - 0.5) * step * 0.95 + (h - 0.5) * 0.5,
            offset = outer ? 3.3 + h * 4.8 : 1.4 + h * 1.35,
            lateral = side * (edge.spec.halfWidth + edge.spec.shoulder + offset),
            x = p.x + p.tx * along + p.nx * lateral,
            z = p.z + p.tz * along + p.nz * lateral;
          const distance = Math.abs(net.nearest(x, z, q)),
            nearest = net.edges[net.edgeOf[net.lastSegment]],
            radius = width * 0.55;
          // Check the nearest road, including a nearby return leg or junction,
          // and the complete clump footprint instead of its centre alone.
          if (
            distance <
            nearest.spec.halfWidth + nearest.spec.shoulder + FESTIVAL_MEADOW.clearance + radius
          )
            continue;
          const natural = field.height(x, z);
          if (
            natural < field.region.seaLevel + 1.5 ||
            natural > field.snowLine(x, z) - 35 ||
            blocked.blocks(x, z, radius + 0.4) ||
            field.flatWeight('town', x, z) > 0.35 ||
            field.flatWeight('airfield', x, z) > 0.45 ||
            field.valleyAt(x, z).distance < field.region.valley.channel + 4
          )
            continue;
          const y = ground(x, z);
          if (y < field.region.seaLevel + 1.1) continue;
          out.push({
            x,
            y: y - 0.045,
            z,
            width,
            // Low cut growth leaves the corner boards and sightlines clear.
            // The high band begins several metres behind the gravel shoulder.
            height: outer ? 0.62 + patch * 0.42 + h * 0.18 : 0.24 + h * 0.22,
            yaw: hash01(row * 8 + k, seed, 0x6d3) * Math.PI * 2,
            tile: Math.floor(patch * 8),
            tint: patch * 0.72 + h * 0.28,
          });
        }
      }
    }
  }
  return out;
}

/** Curved basal leaves and two branched seedheads, all opaque geometry.
 * A single shared mesh supplies green low growth and taller dry patches
 * through instance scale and colour; no per-clump draw or alpha overdraw. */
export function festivalMeadowGeometry() {
  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  const ribbon = (
    points: readonly (readonly [number, number, number, number])[],
    angle: number,
    seed: boolean,
  ) => {
    const offset = positions.length / 3,
      dx = Math.cos(angle),
      dz = -Math.sin(angle),
      n = new T.Vector3(Math.sin(angle) * 0.4, 0.7, Math.cos(angle) * 0.4).normalize();
    points.forEach(([x, y, z, halfWidth], row) => {
      const t = row / Math.max(1, points.length - 1);
      for (const side of [-1, 1]) {
        positions.push(x + dx * halfWidth * side, y, z + dz * halfWidth * side);
        normals.push(n.x, n.y, n.z);
        if (seed) colors.push(0.28 + t * 0.08, 0.23 + t * 0.07, 0.115 + t * 0.07);
        else colors.push(0.055 + t * 0.11, 0.125 + t * 0.12, 0.025 + t * 0.055);
      }
      if (row) {
        const i = offset + row * 2;
        indices.push(i - 2, i, i - 1, i - 1, i, i + 1);
      }
    });
  };
  for (let blade = 0; blade < 17; blade++) {
    const angle = blade * 2.399963,
      h = 0.38 + hash01(blade, 2, 916) * 0.38,
      radius = 0.025 + hash01(blade, 3, 916) * 0.19,
      bend = 0.16 + hash01(blade, 4, 916) * 0.18;
    const points: [number, number, number, number][] = [];
    for (let row = 0; row <= 3; row++) {
      const t = row / 3,
        spread = radius + bend * t * t;
      points.push([
        Math.sin(angle) * spread,
        h * t,
        Math.cos(angle) * spread,
        (1 - t) * (0.019 + hash01(blade, 5, 916) * 0.018),
      ]);
    }
    ribbon(points, angle, false);
  }
  for (let stem = 0; stem < 2; stem++) {
    const angle = 1.2 + stem * 2.4,
      sx = Math.sin(angle),
      sz = Math.cos(angle),
      height = 0.94 + stem * 0.14;
    ribbon(
      [
        [sx * 0.035, 0, sz * 0.035, 0.008],
        [sx * 0.12, height, sz * 0.12, 0.005],
      ],
      angle,
      true,
    );
    // The alternating ears form a branched silhouette from both viewpoints.
    for (let ear = 0; ear < 3; ear++) {
      const y = height - 0.21 + ear * 0.075,
        x = sx * 0.12,
        z = sz * 0.12,
        reach = 0.045 - ear * 0.009;
      for (const turn of [0, Math.PI / 2]) {
        const a = angle + turn;
        ribbon(
          [
            [x, y - 0.02, z, 0.004],
            [x + sx * 0.025, y + 0.025, z + sz * 0.025, reach],
            [x + sx * 0.055, y + 0.07, z + sz * 0.055, 0],
          ],
          a,
          true,
        );
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
