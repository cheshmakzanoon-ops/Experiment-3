import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { SOLVANE } from '../src/simulation/open-world/region-data.ts';
import { TerrainField } from '../src/simulation/open-world/terrain-field.ts';
import { RoadNetwork, ROAD_FLAG } from '../src/simulation/open-world/road-network.ts';
import { TerrainCarver } from '../src/simulation/open-world/terrain-tiles.ts';
import { carvedGroundHeight } from '../src/simulation/open-world/ground-height.ts';
import { trackPoint } from '../src/simulation/track.ts';
import {
  buildFestivalCircuitCues,
  festivalCircuitCueLayout,
  FESTIVAL_CIRCUIT_CUES,
} from '../src/rendering/open-world/festival-circuit-cues.ts';

const field = new TerrainField(SOLVANE);
const network = new RoadNetwork(SOLVANE, field);

describe('Permanent club-course approach cues', () => {
  it('prints true distances to each curve entry and faces both driving approaches', () => {
    const cues = festivalCircuitCueLayout(network, field);
    const point = trackPoint();
    const carver = new TerrainCarver(field, network);
    const boards = cues.filter((cue) => cue.kind === 'distance');
    expect(boards.length).toBeGreaterThan(12);
    expect(new Set(boards.map((cue) => cue.direction))).toEqual(new Set([1, -1]));
    expect(new Set(boards.map((cue) => cue.distance))).toEqual(new Set([50, 100]));
    expect(new Set(cues.map((cue) => cue.bendStation)).size).toBeLessThanOrEqual(8);
    for (const cue of cues) {
      const edge = network.edges[cue.edge];
      expect(edge.roadClass).toBe('circuit');
      expect(edge.road.closed).toBe(true);
      expect(cue.station).toBeGreaterThan(edge.offset + edge.pads[0]);
      expect(cue.station).toBeLessThan(edge.offset + edge.length - edge.pads[1]);
      network.at(cue.station, point);
      const outward = (cue.x - point.x) * point.nx + (cue.z - point.z) * point.nz;
      expect(Math.sign(outward)).toBe(cue.side);
      expect(
        Math.abs(outward) - cue.width * 0.5 - edge.spec.halfWidth - edge.spec.shoulder,
      ).toBeCloseTo(FESTIVAL_CIRCUIT_CUES.shoulderClearance, 7);
      expect(cue.y).toBeCloseTo(carvedGroundHeight(carver, cue.x, cue.z), 7);
      const towardDriver = Math.sin(cue.heading) * point.tx + Math.cos(cue.heading) * point.tz;
      expect(towardDriver * cue.direction).toBeCloseTo(-1, 7);
      network.at(cue.bendStation, point);
      expect(Math.sign(point.curvature)).toBe(cue.turn);
      expect(cue.side).toBe(-cue.turn);
      if (cue.kind === 'distance') {
        expect((cue.entryStation - cue.station) * cue.direction).toBeCloseTo(cue.distance, 7);
        expect((cue.bendStation - cue.entryStation) * cue.direction).toBeGreaterThanOrEqual(0);
        expect(Math.abs(cue.bendStation - cue.entryStation)).toBeLessThanOrEqual(120);
      }
    }
    for (let i = 0; i < cues.length; i++)
      for (let j = i + 1; j < cues.length; j++)
        expect(Math.hypot(cues[i].x - cues[j].x, cues[i].z - cues[j].z)).toBeGreaterThanOrEqual(5);
  });

  it('omits all signage from bridge spans instead of planting boards in empty air', () => {
    const flags = network.flags.slice();
    try {
      for (const edge of network.edges)
        if (edge.roadClass === 'circuit')
          for (let i = edge.first; i <= edge.last; i++) network.flags[i] |= ROAD_FLAG.BRIDGE;
      expect(festivalCircuitCueLayout(network, field)).toEqual([]);
    } finally {
      network.flags.set(flags);
    }
  });

  it('keeps the complete printed assemblies clear of every road and gives every face finite, correctly wound normals', () => {
    const material = new T.MeshStandardMaterial({ vertexColors: true });
    const built = buildFestivalCircuitCues(network, field, material);
    const nearest = trackPoint();
    const a = new T.Vector3(),
      b = new T.Vector3(),
      c = new T.Vector3();
    const p = new T.Vector3(),
      n = new T.Vector3(),
      face = new T.Vector3();
    let minimumClearance = Infinity;
    let minimumNormalAlignment = 1;
    let normalLengthError = 0;
    let bufferBytes = 0;
    let triangleCount = 0;
    const buffers = new Set<ArrayBufferLike>();
    try {
      expect(built.stats.boards).toBeGreaterThan(20);
      expect(built.stats.chevrons).toBeGreaterThan(12);
      expect(built.root.children.length).toBe(built.stats.chunks);
      for (const object of built.root.children) {
        const mesh = object as T.Mesh;
        expect(mesh.material).toBe(material);
        expect(mesh.frustumCulled).toBe(true);
        expect(mesh.matrixAutoUpdate).toBe(false);
        const geometry = mesh.geometry;
        const positions = geometry.getAttribute('position');
        const normals = geometry.getAttribute('normal');
        const colors = geometry.getAttribute('color');
        const indices = geometry.index!;
        expect(colors.count).toBe(positions.count);
        expect(geometry.boundingSphere!.radius).toBeLessThan(185);
        const [cx, cz] = String(mesh.userData.circuitCueChunk).split(',').map(Number);
        const size = FESTIVAL_CIRCUIT_CUES.chunk;
        expect(mesh.position.x).toBe((cx + 0.5) * size);
        expect(mesh.position.z).toBe((cz + 0.5) * size);
        expect(geometry.boundingBox!.min.x).toBeGreaterThan(-size * 0.5 - 1);
        expect(geometry.boundingBox!.min.z).toBeGreaterThan(-size * 0.5 - 1);
        expect(geometry.boundingBox!.max.x).toBeLessThan(size * 0.5 + 1);
        expect(geometry.boundingBox!.max.z).toBeLessThan(size * 0.5 + 1);
        for (let i = 0; i < positions.count; i++) {
          p.fromBufferAttribute(positions, i).add(mesh.position);
          n.fromBufferAttribute(normals, i);
          expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
          normalLengthError = Math.max(normalLengthError, Math.abs(n.length() - 1));
          const lateral = network.nearest(p.x, p.z, nearest, p.y);
          const edge = network.edgeAt(nearest.s);
          minimumClearance = Math.min(
            minimumClearance,
            Math.abs(lateral) - edge.spec.halfWidth - edge.spec.shoulder,
          );
        }
        for (let i = 0; i < indices.count; i += 3) {
          const i0 = indices.getX(i),
            i1 = indices.getX(i + 1),
            i2 = indices.getX(i + 2);
          a.fromBufferAttribute(positions, i0);
          b.fromBufferAttribute(positions, i1).sub(a);
          c.fromBufferAttribute(positions, i2).sub(a);
          face.crossVectors(b, c).normalize();
          if (face.lengthSq() < 0.5) continue;
          minimumNormalAlignment = Math.min(
            minimumNormalAlignment,
            face.dot(n.fromBufferAttribute(normals, i0)),
          );
        }
        for (const attribute of [...Object.values(geometry.attributes), indices])
          buffers.add(attribute.array.buffer);
        triangleCount += indices.count / 3;
      }
      for (const buffer of buffers) bufferBytes += buffer.byteLength;
      expect(minimumClearance).toBeGreaterThan(1.18);
      expect(normalLengthError).toBeLessThan(1e-6);
      // Chunk-local vertices keep fine printed glyphs accurately planar
      // even when the world-space road sits kilometres from zero.
      expect(minimumNormalAlignment).toBeGreaterThan(0.995);
      expect(triangleCount).toBe(built.stats.triangles);
      expect(triangleCount).toBeLessThan(6000);
      expect(bufferBytes).toBeLessThan(650_000);
    } finally {
      built.root.traverse((object) => {
        if (object instanceof T.Mesh) object.geometry.dispose();
      });
      material.dispose();
    }
  });
});
