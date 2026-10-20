import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { trackPoint } from '../../simulation/track.ts';
import {
  ROAD_FLAG,
  roadCandidates,
  type RoadEdge,
  type RoadNetwork,
} from '../../simulation/open-world/road-network.ts';
import type { TerrainField } from '../../simulation/open-world/terrain-field.ts';
import { TerrainCarver } from '../../simulation/open-world/terrain-tiles.ts';
import { carvedGroundHeight } from '../../simulation/open-world/ground-height.ts';

/** Small flexible club-course markers. They describe the road, never a
 * recommended speed or an invisible collision wall. All work is at build
 * time; the result is one opaque, ordinary-material mesh per spatial cell. */
export const FESTIVAL_CIRCUIT_CUES = Object.freeze({
  chunk: 256,
  minimumCurvature: 0.004,
  cornerSeparation: 150,
  shoulderClearance: 1.2,
  distances: Object.freeze([100, 50] as const),
  boardWidth: 1.16,
  boardHeight: 0.78,
  chevronWidth: 0.72,
  chevronHeight: 0.55,
});

export interface FestivalCircuitCue {
  kind: 'distance' | 'chevron';
  edge: number;
  /** Global network station, in metres. */
  station: number;
  bendStation: number;
  /** Distance-board numerals measure from this actual curve entry. */
  entryStation: number;
  distance: number;
  /** Distance boards face this travel direction; chevrons show both sides. */
  direction: 1 | -1;
  side: 1 | -1;
  turn: 1 | -1;
  x: number;
  y: number;
  z: number;
  heading: number;
  width: number;
}

/** Keep the strongest bend within each 150 m neighbourhood. This rejects
 * duplicate curvature maxima in the same long corner and quiets spline
 * sampling noise without inventing an alternate track centreline. */
function bends(network: RoadNetwork, edge: RoadEdge) {
  const peaks: number[] = [];
  for (let i = edge.first + 1; i < edge.last; i++) {
    const k = Math.abs(network.curvature[i]);
    if (
      k >= FESTIVAL_CIRCUIT_CUES.minimumCurvature &&
      k >= Math.abs(network.curvature[i - 1]) &&
      k > Math.abs(network.curvature[i + 1])
    )
      peaks.push(i);
  }
  peaks.sort((a, b) => Math.abs(network.curvature[b]) - Math.abs(network.curvature[a]));
  const selected: number[] = [];
  for (const peak of peaks) {
    if (
      selected.some((other) => {
        const d = Math.abs(network.s[other] - network.s[peak]);
        const separation = edge.from === edge.to ? Math.min(d, edge.length - d) : d;
        return separation < FESTIVAL_CIRCUIT_CUES.cornerSeparation;
      })
    )
      continue;
    selected.push(peak);
  }
  return selected.sort((a, b) => network.s[a] - network.s[b]);
}

/** The build ignores junctions, bridge spans and any neighbouring road's
 * footprint. A marker cannot become a misleading obstacle in a crossing,
 * access lane or a parallel part of a tight circuit. */
export function festivalCircuitCueLayout(network: RoadNetwork, field: TerrainField) {
  const cues: FestivalCircuitCue[] = [];
  const point = trackPoint();
  const carver = new TerrainCarver(field, network);
  const covering = roadCandidates();
  for (const edge of network.edges) {
    if (edge.roadClass !== 'circuit' || !edge.road.closed) continue;
    const at = (station: number) => network.at(station, point);
    const allowed = (station: number) => {
      const local = station - edge.offset;
      const mouth = edge.spec.halfWidth + edge.spec.shoulder + 16;
      if (
        local < Math.max(mouth, edge.pads[0] + 6) ||
        edge.length - local < Math.max(mouth, edge.pads[1] + 6)
      )
        return false;
      const sample = Math.min(
        edge.last - 1,
        edge.first + Math.floor((local / edge.length) * (edge.last - edge.first)),
      );
      return !(
        (network.flags[sample] | network.flags[sample + 1]) &
        (ROAD_FLAG.BRIDGE | ROAD_FLAG.JUNCTION)
      );
    };
    const place = (
      kind: FestivalCircuitCue['kind'],
      station: number,
      bendStation: number,
      entryStation: number,
      distance: number,
      direction: 1 | -1,
      turn: 1 | -1,
    ) => {
      if (!allowed(station)) return;
      const p = at(station);
      const side = -turn as 1 | -1;
      const width =
        kind === 'distance' ? FESTIVAL_CIRCUIT_CUES.boardWidth : FESTIVAL_CIRCUIT_CUES.chevronWidth;
      const lateral =
        side *
        (edge.spec.halfWidth +
          edge.spec.shoulder +
          FESTIVAL_CIRCUIT_CUES.shoulderClearance +
          width * 0.5);
      const x = p.x + p.nx * lateral;
      const z = p.z + p.nz * lateral;
      const y = carvedGroundHeight(carver, x, z);
      if (!Number.isFinite(y) || y < network.region.seaLevel + 0.1) return;
      // Check both lateral panel ends, not just the stalk centre.
      for (const end of [-1, 0, 1]) {
        network.covering(
          x + p.nx * end * width * 0.5,
          z + p.nz * end * width * 0.5,
          y,
          0.8,
          covering,
        );
        if (covering.count) return;
      }
      if (cues.some((cue) => Math.hypot(cue.x - x, cue.z - z) < 5)) return;
      cues.push({
        kind,
        edge: edge.index,
        station,
        bendStation,
        entryStation,
        distance,
        direction,
        side,
        turn,
        x,
        y,
        z,
        heading: Math.atan2(-p.tx * direction, -p.tz * direction),
        width,
      });
    };
    for (const peak of bends(network, edge)) {
      const bendStation = network.s[peak];
      const curvature = network.curvature[peak];
      const turn = Math.sign(curvature) as 1 | -1;
      for (const direction of [1, -1] as const) {
        let entryStation = bendStation;
        // Walk towards the approach until the corner eases below 55% of
        // its peak. The bounded entry search keeps adjacent bends distinct.
        for (let distance = 3; distance <= 120; distance += 3) {
          const station = bendStation - distance * direction;
          if (!allowed(station)) break;
          entryStation = station;
          if (at(station).curvature * turn <= Math.abs(curvature) * 0.55) break;
        }
        for (const distance of FESTIVAL_CIRCUIT_CUES.distances)
          place(
            'distance',
            entryStation - direction * distance,
            bendStation,
            entryStation,
            distance,
            direction,
            turn,
          );
      }
      for (const offset of [-18, 0, 18]) {
        const station = bendStation + offset;
        if (at(station).curvature * turn < Math.abs(curvature) * 0.35) continue;
        place('chevron', station, bendStation, bendStation, 0, 1, turn);
      }
    }
  }
  return cues;
}

function roundedRectangle(width: number, height: number, radius: number) {
  const shape = new T.Shape();
  const x = width * 0.5,
    y = height * 0.5;
  shape.moveTo(-x + radius, -y);
  shape.lineTo(x - radius, -y);
  shape.quadraticCurveTo(x, -y, x, -y + radius);
  shape.lineTo(x, y - radius);
  shape.quadraticCurveTo(x, y, x - radius, y);
  shape.lineTo(-x + radius, y);
  shape.quadraticCurveTo(-x, y, -x, y - radius);
  shape.lineTo(-x, -y + radius);
  shape.quadraticCurveTo(-x, -y, -x + radius, -y);
  return shape;
}

/** Original vector numerals: no font atlas, canvas texture or fetched font. */
function digit(character: string) {
  if (character === '0') {
    const shape = roundedRectangle(0.245, 0.43, 0.05);
    shape.holes.push(roundedRectangle(0.12, 0.305, 0.025));
    return new T.ShapeGeometry(shape, 4);
  }
  if (character === '1') {
    return new T.ShapeGeometry(
      new T.Shape([
        new T.Vector2(-0.112, 0.105),
        new T.Vector2(-0.025, 0.215),
        new T.Vector2(0.055, 0.215),
        new T.Vector2(0.055, -0.155),
        new T.Vector2(0.117, -0.155),
        new T.Vector2(0.117, -0.215),
        new T.Vector2(-0.098, -0.215),
        new T.Vector2(-0.098, -0.155),
        new T.Vector2(-0.015, -0.155),
        new T.Vector2(-0.015, 0.112),
        new T.Vector2(-0.066, 0.062),
      ]),
    );
  }
  return new T.ShapeGeometry(
    new T.Shape([
      new T.Vector2(-0.1225, 0.215),
      new T.Vector2(0.1225, 0.215),
      new T.Vector2(0.1225, 0.151),
      new T.Vector2(-0.055, 0.151),
      new T.Vector2(-0.055, 0.037),
      new T.Vector2(0.083, 0.037),
      new T.Vector2(0.1225, -0.01),
      new T.Vector2(0.1225, -0.17),
      new T.Vector2(0.073, -0.215),
      new T.Vector2(-0.1225, -0.215),
      new T.Vector2(-0.1225, -0.151),
      new T.Vector2(0.055, -0.151),
      new T.Vector2(0.055, -0.032),
      new T.Vector2(-0.1225, -0.032),
    ]),
  );
}

function painted(geometry: T.BufferGeometry, hex: number) {
  const color = new T.Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  return geometry;
}

function markerTemplate(kind: FestivalCircuitCue['kind'], distance: number, turn: number) {
  const distanceBoard = kind === 'distance';
  const width = distanceBoard
    ? FESTIVAL_CIRCUIT_CUES.boardWidth
    : FESTIVAL_CIRCUIT_CUES.chevronWidth;
  const height = distanceBoard
    ? FESTIVAL_CIRCUIT_CUES.boardHeight
    : FESTIVAL_CIRCUIT_CUES.chevronHeight;
  const centre = distanceBoard ? 1.12 : 0.95;
  const parts = [painted(new T.BoxGeometry(width, height, 0.04).translate(0, centre, 0), 0x303a37)];
  for (const x of [-width * 0.28, width * 0.28])
    parts.push(
      painted(
        new T.BoxGeometry(0.045, centre + 0.1, 0.055).translate(x, centre * 0.5 - 0.05, -0.048),
        0x343c38,
      ),
    );
  // Numerals face the approach only. Reverse traffic sees a quiet dark
  // back; a bend chevron has one physical plate with two printed faces.
  for (const face of distanceBoard ? [1] : [1, -1]) {
    parts.push(
      painted(
        new T.ShapeGeometry(roundedRectangle(width - 0.045, height - 0.045, 0.028), 3)
          .rotateY(face < 0 ? Math.PI : 0)
          .translate(0, centre, face * 0.021),
        0xe6e4d8,
      ),
    );
    if (distanceBoard) {
      const label = String(distance);
      for (let i = 0; i < label.length; i++)
        parts.push(
          painted(
            digit(label[i]).translate((i - (label.length - 1) * 0.5) * 0.315, centre, 0.023),
            0x162426,
          ),
        );
    } else {
      const arrow = new T.ShapeGeometry(
        new T.Shape([
          new T.Vector2(-0.24, -0.19),
          new T.Vector2(-0.075, -0.19),
          new T.Vector2(0.23, 0),
          new T.Vector2(-0.075, 0.19),
          new T.Vector2(-0.24, 0.19),
          new T.Vector2(0.065, 0),
        ]),
      );
      // Local +x is screen-right. Positive route curvature turns left;
      // turning the plate round reverses the printed arrow as well.
      // Reflect the in-plane glyph with a proper rotation, preserving its
      // front-facing triangle winding rather than using a negative scale.
      if (-turn * face < 0) arrow.rotateZ(Math.PI);
      if (face < 0) arrow.rotateY(Math.PI);
      parts.push(painted(arrow.translate(0, centre, face * 0.023), 0x162426));
    }
  }
  const geometry = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  return geometry;
}

/** The caller owns the supplied material and resulting geometry. */
export function buildFestivalCircuitCues(
  network: RoadNetwork,
  field: TerrainField,
  material: T.Material,
) {
  const root = new T.Group();
  root.name = 'Circuit approach markers';
  const cues = festivalCircuitCueLayout(network, field);
  const templates = new Map<string, T.BufferGeometry>();
  const chunks = new Map<string, T.BufferGeometry[]>();
  try {
    for (const cue of cues) {
      const templateKey = `${cue.kind}:${cue.distance}:${cue.kind === 'chevron' ? cue.turn : 0}`;
      let template = templates.get(templateKey);
      if (!template) {
        template = markerTemplate(cue.kind, cue.distance, cue.turn);
        templates.set(templateKey, template);
      }
      const key = `${Math.floor(cue.x / FESTIVAL_CIRCUIT_CUES.chunk)},${Math.floor(cue.z / FESTIVAL_CIRCUIT_CUES.chunk)}`;
      let chunk = chunks.get(key);
      if (!chunk) chunks.set(key, (chunk = []));
      // Keep thin printed faces close to their chunk origin. Baking
      // kilometre coordinates into Float32 vertices kinks the smallest
      // rounded glyph triangles. The static transform restores placement.
      const [cx, cz] = key.split(',').map(Number);
      const originX = (cx + 0.5) * FESTIVAL_CIRCUIT_CUES.chunk;
      const originZ = (cz + 0.5) * FESTIVAL_CIRCUIT_CUES.chunk;
      const matrix = new T.Matrix4()
        .makeRotationY(cue.heading)
        .setPosition(cue.x - originX, cue.y, cue.z - originZ);
      chunk.push(template.clone().applyMatrix4(matrix));
    }
    let triangles = 0;
    for (const [key, pieces] of chunks) {
      const geometry = mergeGeometries(pieces, false)!;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      triangles += geometry.index!.count / 3;
      const mesh = new T.Mesh(geometry, material);
      mesh.name = `Circuit approach markers ${key}`;
      mesh.userData.circuitCueChunk = key;
      const [cx, cz] = key.split(',').map(Number);
      mesh.position.set(
        (cx + 0.5) * FESTIVAL_CIRCUIT_CUES.chunk,
        0,
        (cz + 0.5) * FESTIVAL_CIRCUIT_CUES.chunk,
      );
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      root.add(mesh);
    }
    return {
      root,
      cues,
      stats: {
        boards: cues.filter((cue) => cue.kind === 'distance').length,
        chevrons: cues.filter((cue) => cue.kind === 'chevron').length,
        chunks: chunks.size,
        triangles,
      },
    };
  } finally {
    for (const template of templates.values()) template.dispose();
    for (const pieces of chunks.values()) for (const piece of pieces) piece.dispose();
  }
}
