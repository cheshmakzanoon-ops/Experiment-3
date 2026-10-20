import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from 'three';
import { RoadMeshes } from '../src/rendering/open-world/roads.ts';
import { OpenWorldTrack } from '../src/simulation/open-world/open-world-track.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { makeTire, peakGrip } from '../src/simulation/tire.ts';
import { SURFACE, surfaceSample, trackPoint } from '../src/simulation/track.ts';

const world = openWorld();
const network = world.network;
const edge = network.edges.find((candidate) => candidate.road.id === 'saltmarsh-club')!;
const dry = new OpenWorldTrack(world, 'clear', undefined, 12);
const rain = new OpenWorldTrack(world, 'rain', undefined, 12);
let roads: RoadMeshes;
const aprons: T.Mesh[] = [];
const paint: T.Mesh[] = [];
let grid: T.Mesh;

beforeAll(() => {
  roads = new RoadMeshes(network, world.field);
  roads.root.updateMatrixWorld(true);
  roads.root.traverse((object) => {
    if (!(object instanceof T.Mesh) || object instanceof T.InstancedMesh) return;
    if (object.material === roads.materials.apron) aprons.push(object);
    if (object.material === roads.materials.apron || object.material === roads.materials.paint)
      paint.push(object);
    if (object.name === 'Circuit start paint saltmarsh-club-race') grid = object;
  });
}, 30000);

afterAll(() => roads.dispose());

function sample(point: T.Vector3, track = dry) {
  return track.sample(point.x, point.z, surfaceSample(), point.y + 0.7);
}

function position(station: number, lateral: number) {
  const p = network.at(station, trackPoint());
  return new T.Vector3(
    p.x + p.nx * lateral,
    network.surfaceHeight(p, lateral, edge.spec.halfWidth, edge.spec.crown),
    p.z + p.nz * lateral,
  );
}

function visiblePaint(point: T.Vector3, meshes = paint) {
  const ray = new T.Raycaster(
    point.clone().add(new T.Vector3(0, 2, 0)),
    new T.Vector3(0, -1, 0),
    0,
    4,
  );
  return ray.intersectObjects(meshes, false).length > 0;
}

/** Read the actual uploaded mesh, independently of the shared layout's
 * predicates. Triangle centroids also exercise reverse apron winding. */
function triangleCentres(mesh: T.Mesh, visit: (point: T.Vector3, lateral: number) => void) {
  const positions = mesh.geometry.getAttribute('position'),
    uv = mesh.geometry.getAttribute('uv'),
    indices = mesh.geometry.index!,
    point = new T.Vector3(),
    vertex = new T.Vector3(),
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3();
  for (let i = 0; i < indices.count; i += 3) {
    a.fromBufferAttribute(positions, indices.getX(i));
    b.fromBufferAttribute(positions, indices.getX(i + 1)).sub(a);
    c.fromBufferAttribute(positions, indices.getX(i + 2)).sub(a);
    // One end of a taper can have zero width, so the ribbon emits one
    // zero-area triangle beside a visible triangle. It paints no pixels.
    if (Math.abs(b.x * c.z - b.z * c.x) < 1e-8) continue;
    point.set(0, 0, 0);
    let lateral = 0;
    for (let corner = 0; corner < 3; corner++) {
      const index = indices.getX(i + corner);
      point.add(vertex.fromBufferAttribute(positions, index));
      lateral += uv.getX(index);
    }
    point.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
    visit(point, lateral / 3);
  }
}

describe('Circuit paint agrees with rendered contact footprints', () => {
  it('gives every rendered apron and start-grid triangle the paint material', () => {
    expect(aprons.length).toBeGreaterThan(0);
    expect(grid).toBeDefined();
    let apronSamples = 0,
      gridSamples = 0;
    const sides = new Set<number>();
    const mismatches: string[] = [];
    for (const mesh of [...aprons, grid])
      triangleCentres(mesh, (point, lateral) => {
        const result = sample(point);
        if (mesh === grid) gridSamples++;
        else {
          apronSamples++;
          sides.add(Math.sign(lateral));
        }
        if (result.surface !== SURFACE.PAINT || Math.abs(result.grip - 0.93 * 0.98) > 1e-8)
          mismatches.push(
            `${mesh.name} at ${point.x.toFixed(3)},${point.z.toFixed(3)}: surface ${result.surface}, road ${dry.query.edge}, station ${result.s.toFixed(4)}, lateral ${result.lateral.toFixed(4)}, mesh lateral ${lateral.toFixed(4)}`,
          );
      });
    expect(apronSamples).toBeGreaterThan(500);
    expect(gridSamples).toBeGreaterThan(100);
    expect(sides).toEqual(new Set([-1, 1]));
    expect(mismatches).toEqual([]);
  });

  it('keeps the narrowing apron footprint painted and the adjoining bare asphalt grippy', () => {
    let tapers = 0;
    const sides = new Set<number>();
    for (const mesh of aprons) {
      const positions = mesh.geometry.getAttribute('position'),
        uv = mesh.geometry.getAttribute('uv');
      // Each quad has its actual inner/outer edge at the two road samples.
      for (let i = 0; i < positions.count; i += 4) {
        const width0 = Math.abs(uv.getX(i + 1) - uv.getX(i)),
          width1 = Math.abs(uv.getX(i + 3) - uv.getX(i + 2));
        if (
          Math.min(width0, width1) < 0.04 ||
          Math.max(width0, width1) > 0.49 ||
          Math.abs(width0 - width1) < 0.003
        )
          continue;
        const inner = new T.Vector3()
            .fromBufferAttribute(positions, i)
            .add(new T.Vector3().fromBufferAttribute(positions, i + 2))
            .multiplyScalar(0.5)
            .applyMatrix4(mesh.matrixWorld),
          outer = new T.Vector3()
            .fromBufferAttribute(positions, i + 1)
            .add(new T.Vector3().fromBufferAttribute(positions, i + 3))
            .multiplyScalar(0.5)
            .applyMatrix4(mesh.matrixWorld),
          across = outer.clone().sub(inner).normalize(),
          painted = inner.clone().lerp(outer, 0.5),
          bare = inner.clone().addScaledVector(across, -0.04);
        expect(visiblePaint(painted)).toBe(true);
        expect(visiblePaint(bare)).toBe(false);
        expect(sample(painted).surface).toBe(SURFACE.PAINT);
        expect(sample(bare).surface).toBe(SURFACE.ASPHALT);
        sides.add(Math.sign(uv.getX(i)));
        tapers++;
      }
    }
    expect(tapers).toBeGreaterThan(50);
    expect(sides).toEqual(new Set([-1, 1]));
  });

  it('uses only the white checker cells and the ten-centimetre grid outlines as paint', () => {
    const metadata = grid.userData.festivalCircuitGrid as {
      station: number;
      direction: 1 | -1;
      centres: { distance: number; lateral: number }[];
    };
    const atGrid = (distance: number, lateral: number) =>
      position(metadata.station + metadata.direction * distance, metadata.direction * lateral);
    // This eleven-metre course has 24 square-ish cells in each 40 cm row.
    // The ray checks the actual mesh, including its intentionally empty cells.
    for (let row = 0; row < 2; row++)
      for (let column = 0; column < 24; column++) {
        const point = atGrid((row + 0.5) * 0.4, -4.75 + ((column + 0.5) * 9.5) / 24),
          white = (column + row) % 2 === 0;
        expect(visiblePaint(point, [grid]), `checker ${row}:${column}`).toBe(white);
        expect(sample(point).surface, `checker ${row}:${column}`).toBe(
          white ? SURFACE.PAINT : SURFACE.ASPHALT,
        );
      }
    expect(metadata.centres).toHaveLength(4);
    for (const { distance, lateral } of metadata.centres) {
      for (const [d, l, painted] of [
        [0, 0, false],
        [-3, 0, true],
        [3, 0, true],
        [0, -1.4, true],
        [0, 1.4, true],
        [0, -1.3, false],
        [0, 1.3, false],
        [0, -1.5, false],
        [0, 1.5, false],
        [-3.1, 0, false],
        [3.1, 0, false],
      ] as const) {
        const point = atGrid(distance + d, lateral + l);
        expect(visiblePaint(point, [grid]), `slot ${distance},${lateral} offset ${d},${l}`).toBe(
          painted,
        );
        expect(sample(point).surface).toBe(painted ? SURFACE.PAINT : SURFACE.ASPHALT);
      }
    }
  });

  it('matches both 15 cm edge-line boundaries and leaves both access mouths clear', () => {
    const station = (network.s[edge.first + 80] + network.s[edge.first + 81]) / 2;
    for (const side of [-1, 1])
      for (const [offset, painted] of [
        [-0.1, false],
        [-0.05, true],
        [0, true],
        [0.05, true],
        [0.1, false],
      ] as const) {
        const point = position(station, side * (4.85 + offset));
        expect(visiblePaint(point)).toBe(painted);
        expect(sample(point).surface).toBe(painted ? SURFACE.PAINT : SURFACE.ASPHALT);
      }

    expect(edge.from).toBe(edge.to);
    const checkedEnds = new Set<string>();
    for (const [end, local] of [
      ['from', 8],
      ['to', edge.length - 8],
    ] as const)
      for (const side of [-1, 1]) {
        const point = position(edge.offset + local, side * 4.85),
          result = sample(point);
        // The access road can own one side of this overlap. Query the
        // circuit-owned half so its missing paint cannot hide in that road.
        if (dry.query.edge !== edge.index || visiblePaint(point)) continue;
        expect(result.surface, `${end} junction mouth`).toBe(SURFACE.ASPHALT);
        checkedEnds.add(end);
      }
    expect(checkedEnds).toEqual(new Set(['from', 'to']));
  });

  it('passes rain water and paint material through to the tyre wet-friction law', () => {
    const positions = aprons[0].geometry.getAttribute('position');
    const point = new T.Vector3()
      .fromBufferAttribute(positions, 0)
      .add(new T.Vector3().fromBufferAttribute(positions, 1))
      .add(new T.Vector3().fromBufferAttribute(positions, 2))
      .multiplyScalar(1 / 3)
      .applyMatrix4(aprons[0].matrixWorld);
    const dryPaint = sample(point),
      wetPaint = sample(point, rain),
      bare = position(dryPaint.s, 0),
      dryAsphalt = sample(bare),
      wetAsphalt = sample(bare, rain);
    expect(dryPaint.surface).toBe(SURFACE.PAINT);
    expect(wetPaint.surface).toBe(SURFACE.PAINT);
    expect(dryAsphalt.surface).toBe(SURFACE.ASPHALT);
    expect(wetAsphalt.surface).toBe(SURFACE.ASPHALT);
    expect(dryPaint.water).toBe(0);
    expect(wetPaint.water).toBe(0.9);
    expect(wetPaint.grip).toBeCloseTo(0.93 * 0.98, 8);
    expect(wetAsphalt.grip).toBeCloseTo(0.98, 8);
    const tyre = makeTire('wet'),
      dryRatio = peakGrip(tyre, 3000, dryPaint, 5) / peakGrip(tyre, 3000, dryAsphalt, 5),
      wetRatio = peakGrip(tyre, 3000, wetPaint, 5) / peakGrip(tyre, 3000, wetAsphalt, 5);
    expect(dryRatio).toBeCloseTo(0.93, 6);
    expect(wetRatio).toBeLessThan(dryRatio * 0.9);
    expect(wetRatio).toBeGreaterThan(0.6);
  });
});
