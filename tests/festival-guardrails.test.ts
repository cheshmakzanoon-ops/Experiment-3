import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { trackPoint } from '../src/simulation/track.ts';
import { SOLVANE, type RoadClass } from '../src/simulation/open-world/region-data.ts';
import { RoadNetwork, ROAD_FLAG } from '../src/simulation/open-world/road-network.ts';
import type { TerrainField } from '../src/simulation/open-world/terrain-field.ts';
import {
  buildFestivalGuardrails,
  festivalGuardrailRuns,
  FESTIVAL_GUARDRAIL,
} from '../src/rendering/open-world/festival-guardrails.ts';
import { RoadMeshes } from '../src/rendering/open-world/roads.ts';

/** A climbing, changing-radius road on analytic terrain. It exercises the
 * real network grading/banking, carving and mesh builders in a small region,
 * with an explicit bridge span splitting the two collision-backed rails. */
function fixture(roadClass: RoadClass = 'mountain') {
  const field = {
    height: (x: number, z: number) => 50 + z * 0.045 + Math.sin(x * 0.006) * 2,
    valleyAt: () => ({ channel: false, water: -100 }),
  } as unknown as TerrainField;
  const network = new RoadNetwork(
    {
      ...SOLVANE,
      id: `guardrail-${roadClass}-fixture`,
      half: 600,
      overpasses: [],
      seaLevel: -100,
      roads: [
        {
          id: 'bending-grade',
          name: 'Bending grade',
          roadClass,
          points: [
            [-280, -440],
            [-255, -250],
            [-165, -90],
            [5, 15],
            [90, 180],
            [40, 390],
          ],
        },
      ],
    },
    field,
  );
  const edge = network.edges[0];
  network.flags.fill(0);
  for (let i = edge.first + 10; i <= edge.last - 10; i++)
    network.flags[i] = ROAD_FLAG.BARRIER_LEFT | ROAD_FLAG.BARRIER_RIGHT;
  const bridge = Math.floor((edge.first + edge.last) * 0.5);
  for (let i = bridge - 8; i <= bridge + 8; i++) network.flags[i] |= ROAD_FLAG.BRIDGE;
  return { network, field };
}

function disposeGeometry(root: T.Object3D) {
  root.traverse((object) => {
    if (object instanceof T.Mesh) object.geometry.dispose();
  });
}

describe('Festival roadside barrier construction', () => {
  it('starts and ends each run at the actual flagged segments, excluding full bridge decks', () => {
    const { network } = fixture();
    const runs = festivalGuardrailRuns(network);
    expect(runs).toHaveLength(4);
    const owned = new Set<string>();
    for (const run of runs) {
      const edge = network.edges[run.edge];
      expect(run.first).toBeGreaterThanOrEqual(edge.first);
      expect(run.last).toBeLessThanOrEqual(edge.last);
      expect(run.last).toBeGreaterThan(run.first);
      for (let i = run.first; i < run.last; i++) {
        const key = `${i}:${run.side}`;
        expect(owned.has(key)).toBe(false);
        owned.add(key);
      }
    }
    for (const edge of network.edges)
      for (let i = edge.first; i < edge.last; i++)
        for (const [side, bit] of [
          [-1, ROAD_FLAG.BARRIER_LEFT],
          [1, ROAD_FLAG.BARRIER_RIGHT],
        ]) {
          const active =
            !!(network.flags[i] & bit) &&
            !!(network.flags[i + 1] & bit) &&
            !(network.flags[i] & ROAD_FLAG.BRIDGE && network.flags[i + 1] & ROAD_FLAG.BRIDGE);
          expect(owned.has(`${i}:${side}`)).toBe(active);
        }
  });

  it('keeps every hardware vertex beyond the shoulder, follows bank/grade and has correctly facing finite normals', () => {
    const { network, field } = fixture();
    const metal = new T.MeshStandardMaterial();
    const reflectors = new T.MeshStandardMaterial();
    const built = buildFestivalGuardrails(network, field, metal, reflectors);
    const edge = network.edges[0];
    const point = trackPoint();
    let smallestClearance = Infinity,
      largestClearance = 0,
      lengthError = 0,
      lowestAlignment = 1,
      lowestBeamAlignment = 1,
      largestHeightError = 0,
      railVertices = 0,
      bankedVertices = 0,
      invalidPositions = 0,
      triangles = 0;
    const p = new T.Vector3(),
      a = new T.Vector3(),
      b = new T.Vector3(),
      c = new T.Vector3(),
      n = new T.Vector3(),
      face = new T.Vector3();
    try {
      for (const object of built.root.children) {
        expect(object).toBeInstanceOf(T.Mesh);
        const mesh = object as T.Mesh;
        const geometry = mesh.geometry;
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        const uv = geometry.getAttribute('uv');
        for (let i = 0; i < position.count; i++) {
          p.fromBufferAttribute(position, i);
          n.fromBufferAttribute(normal, i);
          if (!Number.isFinite(p.x + p.y + p.z)) invalidPositions++;
          lengthError = Math.max(lengthError, Math.abs(n.length() - 1));
          network.nearest(p.x, p.z, point, p.y);
          const lateral = (p.x - point.x) * point.nx + (p.z - point.z) * point.nz;
          const clearance = Math.abs(lateral) - edge.spec.halfWidth - edge.spec.shoulder;
          smallestClearance = Math.min(smallestClearance, clearance);
          largestClearance = Math.max(largestClearance, clearance);
          // Ribbon UVs preserve the exact authored station and height; the
          // short 0..1 template UVs cannot be mistaken for a beam surface.
          if (uv.getX(i) > 2 && uv.getY(i) >= 0.584 && uv.getY(i) <= 0.926) {
            railVertices++;
            network.at(uv.getX(i), point);
            const side = Math.sign((p.x - point.x) * point.nx + (p.z - point.z) * point.nz);
            const roadY = network.surfaceHeight(
              point,
              side * edge.spec.halfWidth,
              edge.spec.halfWidth,
              edge.spec.crown,
            );
            largestHeightError = Math.max(largestHeightError, Math.abs(p.y - roadY - uv.getY(i)));
            if (Math.abs(point.bank) > 0.015) bankedVertices++;
          }
        }
        const indices = geometry.index!;
        triangles += indices.count / 3;
        for (let i = 0; i < indices.count; i += 3) {
          const i0 = indices.getX(i),
            i1 = indices.getX(i + 1),
            i2 = indices.getX(i + 2);
          a.fromBufferAttribute(position, i0);
          b.fromBufferAttribute(position, i1).sub(a);
          c.fromBufferAttribute(position, i2).sub(a);
          face.crossVectors(b, c);
          if (face.lengthSq() < 1e-16) continue;
          face.normalize();
          for (const v of [i0, i1, i2]) {
            const alignment = face.dot(n.fromBufferAttribute(normal, v));
            lowestAlignment = Math.min(lowestAlignment, alignment);
            if (uv.getX(v) > 2 && uv.getY(v) >= 0.584 && uv.getY(v) <= 0.926)
              lowestBeamAlignment = Math.min(lowestBeamAlignment, alignment);
          }
        }
        const [ix, iz] = String(mesh.userData.guardrailChunk).split(',').map(Number);
        const box = geometry.boundingBox!;
        expect(box.min.x).toBeGreaterThan(ix * FESTIVAL_GUARDRAIL.chunk - 4);
        expect(box.max.x).toBeLessThan((ix + 1) * FESTIVAL_GUARDRAIL.chunk + 4);
        expect(box.min.z).toBeGreaterThan(iz * FESTIVAL_GUARDRAIL.chunk - 4);
        expect(box.max.z).toBeLessThan((iz + 1) * FESTIVAL_GUARDRAIL.chunk + 4);
        expect(geometry.boundingSphere!.radius).toBeLessThan(380);
        expect(mesh.frustumCulled).toBe(true);
      }
      // The direct lateral measurement allows 2 mm for spline projection
      // and Float32 storage, while enforcing the entire physical shoulder.
      expect(smallestClearance).toBeGreaterThan(0.288);
      expect(largestClearance).toBeLessThan(0.61);
      expect(invalidPositions).toBe(0);
      expect(lengthError).toBeLessThan(1e-6);
      // Smooth normals on the five-sided marker stems lie up to 36° from
      // their polygon face (cos 36° ≈ 0.809). Folded beam faces are tested
      // separately at much tighter agreement, including the changing bank.
      expect(lowestAlignment).toBeGreaterThan(0.8);
      expect(lowestBeamAlignment).toBeGreaterThan(0.995);
      expect(largestHeightError).toBeLessThan(0.0001);
      expect(railVertices).toBeGreaterThan(10000);
      expect(bankedVertices).toBeGreaterThan(2000);
      expect(built.stats.endCaps).toBe(2 * built.stats.runs);
      expect(built.stats.posts).toBeGreaterThan(200);
      expect(built.stats.reflectors).toBeGreaterThan(50);
      expect(built.stats.reflectors).toBeLessThan(built.stats.posts / 3);
      expect(built.root.children.length).toBeLessThanOrEqual(built.stats.chunks * 2);
      expect(built.stats.triangles).toBe(triangles);
      const length = built.runs.reduce(
        (sum, run) => sum + network.s[run.last] - network.s[run.first],
        0,
      );
      expect(triangles / length).toBeLessThan(75);
    } finally {
      disposeGeometry(built.root);
      metal.dispose();
      reflectors.dispose();
    }
  });
});

describe('Festival circuit rendering', () => {
  it('keeps one permanent checker stripe and four grade-conforming grid boxes at the race start', () => {
    const { network, field } = fixture('circuit');
    const edge = network.edges[0];
    const point = trackPoint();
    network.at(edge.offset + 100, point);
    const start = [point.x, point.z] as const;
    network.at(edge.offset + 300, point);
    const next = [point.x, point.z] as const;
    const race = {
      id: 'race-grid',
      name: 'Race grid',
      kind: 'circuit' as const,
      waypoints: [start, next],
      laps: 2,
      rivals: 3,
      blurb: 'Grid placement fixture',
    };
    network.region.events = [
      race,
      { ...race, id: 'practice-grid', rivals: 0 },
      { ...race, id: 'another-race-at-same-start' },
    ];
    const roads = new RoadMeshes(network, field);
    const grids = roads.root.children.filter((object) =>
      object.name.startsWith('Circuit start paint '),
    );
    let geometryDisposals = 0,
      paintDisposals = 0;
    try {
      expect(grids).toHaveLength(1);
      expect(roads.stats.circuitGrids).toBe(1);
      const grid = grids[0] as T.Mesh;
      expect(grid.name).toBe('Circuit start paint race-grid');
      expect(grid.parent).toBe(roads.root);
      expect(grid.material).toBe(roads.materials.paint);
      expect(grid.visible).toBe(true);
      const data = grid.userData.festivalCircuitGrid;
      expect(data.centres).toEqual([
        { distance: 22, lateral: -2.6 },
        { distance: 22, lateral: 2.6 },
        { distance: 13, lateral: -2.6 },
        { distance: 13, lateral: 2.6 },
      ]);
      expect(data.station).toBeCloseTo(edge.offset + 100, 5);
      expect(data.direction).toBe(1);
      const geometry = grid.geometry;
      const position = geometry.getAttribute('position');
      const uv = geometry.getAttribute('uv');
      let error = 0,
        checkVertices = 0,
        first = Infinity,
        last = -Infinity;
      for (let i = 0; i < position.count; i++) {
        const l = uv.getX(i),
          s = edge.offset + uv.getY(i),
          d = s - data.station;
        network.at(s, point);
        expect(Math.abs(l)).toBeLessThanOrEqual(edge.spec.halfWidth - 0.7499);
        error = Math.max(
          error,
          Math.abs(
            position.getY(i) -
              0.012 -
              network.surfaceHeight(point, l, edge.spec.halfWidth, edge.spec.crown),
          ),
        );
        first = Math.min(first, d);
        last = Math.max(last, d);
        if (d < 1) checkVertices++;
      }
      expect(error).toBeLessThan(0.0001);
      expect(first).toBeCloseTo(0, 4);
      expect(last).toBeCloseTo(25.05, 4);
      expect(checkVertices).toBe(96);
      expect(geometry.index!.count / 3).toBeLessThan(160);
      expect(geometry.boundingSphere!.radius).toBeLessThan(15);
      geometry.addEventListener('dispose', () => geometryDisposals++);
      roads.materials.paint.addEventListener('dispose', () => paintDisposals++);
    } finally {
      roads.dispose();
    }
    expect(geometryDisposals).toBe(1);
    expect(paintDisposals).toBe(1);
  });

  it('paints only the inside asphalt edge of actual corners and disposes its new resources once', () => {
    const { network, field } = fixture('circuit');
    const edge = network.edges[0];
    const roads = new RoadMeshes(network, field);
    const point = trackPoint();
    const geometries = new Set<T.BufferGeometry>();
    const materials = new Set<T.Material>();
    let apronVertices = 0,
      whiteVertices = 0,
      asphaltVertices = 0,
      error = 0,
      smallestWidth = Infinity,
      greatestWidth = 0;
    try {
      roads.root.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          materials.add(material);
        const position = object.geometry.getAttribute('position');
        const uv = object.geometry.getAttribute('uv');
        if (object.material === roads.materials.asphaltMajor) {
          const profile = object.geometry.getAttribute('festivalRoadData');
          for (let i = 0; i < profile.count; i++) {
            expect(profile.getY(i)).toBe(0);
            asphaltVertices++;
          }
        }
        if (object.material === roads.materials.paint)
          for (let i = 0; i < uv.count; i++) {
            expect(Math.abs(uv.getX(i))).toBeGreaterThan(edge.spec.halfWidth - 0.74);
            expect(Math.abs(uv.getX(i))).toBeLessThan(edge.spec.halfWidth - 0.56);
            whiteVertices++;
          }
        if (object.material !== roads.materials.apron) return;
        for (let i = 0; i < position.count; i++) {
          apronVertices++;
          const lateral = uv.getX(i);
          network.at(edge.offset + uv.getY(i), point);
          expect(Math.abs(lateral)).toBeGreaterThanOrEqual(edge.spec.halfWidth - 0.5001);
          expect(Math.abs(lateral)).toBeLessThanOrEqual(edge.spec.halfWidth + 0.0001);
          if (edge.spec.halfWidth - Math.abs(lateral) > 0.002)
            expect(Math.sign(lateral)).toBe(Math.sign(point.curvature));
          const width = edge.spec.halfWidth - Math.abs(lateral);
          smallestWidth = Math.min(smallestWidth, width);
          greatestWidth = Math.max(greatestWidth, width);
          error = Math.max(
            error,
            Math.abs(
              position.getY(i) -
                0.011 -
                network.surfaceHeight(point, lateral, edge.spec.halfWidth, edge.spec.crown),
            ),
          );
        }
      });
      expect(apronVertices).toBeGreaterThan(300);
      expect(whiteVertices).toBeGreaterThan(500);
      expect(asphaltVertices).toBeGreaterThan(2000);
      expect(smallestWidth).toBeCloseTo(0, 4);
      expect(greatestWidth).toBeGreaterThan(0.45);
      expect(error).toBeLessThan(0.0001);
    } finally {
      // Observe all owned material slots as well as those used in this small
      // scene. The barriers share their parent's metal and reflector assets.
      for (const material of Object.values(roads.materials)) materials.add(material);
      materials.add(roads.lampMaterial);
      materials.add(roads.reflectorMaterial);
      const counts = new Map<T.BufferGeometry | T.Material, number>();
      for (const resource of [...geometries, ...materials]) {
        counts.set(resource, 0);
        resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource)! + 1));
      }
      roads.dispose();
      expect([...counts.values()].every((count) => count === 1)).toBe(true);
    }
  });
});
