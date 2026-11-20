import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoadMeshes } from '../src/rendering/open-world/roads.ts';
import { OpenWorldTrack } from '../src/simulation/open-world/open-world-track.ts';
import { ROAD_FLAG, roadBarrierFace } from '../src/simulation/open-world/road-network.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { surfaceSample, trackPoint } from '../src/simulation/track.ts';

const world = openWorld(),
  net = world.network,
  track = new OpenWorldTrack(world);
const edge = net.edges.find(
  (e) =>
    e.roadClass === 'highway' &&
    Array.from(net.flags.subarray(e.first, e.last)).some((flag) => flag & ROAD_FLAG.BRIDGE),
)!;
const deck: T.Mesh[] = [],
  concrete: T.Mesh[] = [];
let roads: RoadMeshes;
beforeAll(() => {
  roads = new RoadMeshes(net, world.field);
  roads.root.updateMatrixWorld(true);
  roads.root.traverse((mesh) => {
    if (!(mesh instanceof T.Mesh) || mesh instanceof T.InstancedMesh) return;
    if (mesh.material === roads.materials.concrete) concrete.push(mesh);
    if (mesh.material === roads.materials.asphaltMajor) deck.push(mesh);
  });
}, 30000);
afterAll(() => roads.dispose());
function roadSample(junction = false) {
  let best = edge.first,
    clearance = -Infinity;
  for (let i = edge.first + 1; i < edge.last - 1; i++) {
    if (!(net.flags[i - 1] & net.flags[i] & net.flags[i + 1] & ROAD_FLAG.BRIDGE)) continue;
    const both = ROAD_FLAG.BARRIER_LEFT | ROAD_FLAG.BARRIER_RIGHT;
    if (((net.flags[i] & net.flags[i + 1] & both) === both) === junction) continue;
    const gap = net.y[i] - net.ground[i];
    if (gap > clearance) {
      clearance = gap;
      best = i;
    }
  }
  expect(clearance).toBeGreaterThan(4);
  return net.pointOnSegment(best, 0.5, trackPoint());
}
describe('Festival bridge carriageway and substructure', () => {
  it('carries all three Port Ilse streets level across the excavated canal with road and river on their own layers', () => {
    const p = trackPoint();
    for (const z of [-2600, -2400, -2200]) {
      // Intersect the canal centreline from the region definition.
      const [start, end] = world.region.valley.points.slice(-2);
      const x = start[0] + ((end[0] - start[0]) * (z - start[1])) / (end[1] - start[1]);
      net.nearest(x - 40, z, p);
      const west = p.y;
      net.nearest(x + 40, z, p);
      const east = p.y;
      for (const offset of [-7, 0, 7]) {
        net.nearest(x + offset, z, p);
        expect(net.flags[net.lastSegment] & ROAD_FLAG.BRIDGE).toBeTruthy();
        expect(p.y).toBeCloseTo((east + west) / 2, 1);
        expect(Math.abs(p.gradient)).toBeLessThan(0.015);
        const roadHeight = track.groundHeight(x + offset, z, p.y + 0.65);
        expect(roadHeight).toBeCloseTo(p.y, 1);
        expect(roadHeight - world.field.height(x + offset, z)).toBeGreaterThan(1.2);
      }
    }
  });

  it('supports both shoulders all the way to the rendered collision face', () => {
    const p = roadSample(),
      hw = edge.spec.halfWidth;
    const face = roadBarrierFace(edge.spec, true);
    const down = new T.Vector3(0, -1, 0);
    for (const side of [-1, 1]) {
      for (const l of [hw + 0.1, (hw + face) / 2, face - 0.025]) {
        const x = p.x + side * l * p.nx,
          z = p.z + side * l * p.nz;
        const height = track.sample(x, z, surfaceSample(), p.y + 0.8).height;
        const hit = new T.Raycaster(new T.Vector3(x, height + 2, z), down, 0, 4).intersectObjects(
          deck,
          false,
        )[0];
        expect(hit, `side ${side}, offset ${l}`).toBeDefined();
        expect(Math.abs(hit.point.y - height)).toBeLessThan(0.022);
      }
      track.nearest(p.x, p.z, trackPoint(), p.y);
      const boundary = track.boundaryAt(p, side);
      expect(boundary).toBeCloseTo(face, 6);
      const edgeY = net.surfaceHeight(p, side * hw, hw, edge.spec.crown);
      const from = new T.Vector3(p.x, edgeY + 0.31, p.z);
      const ray = new T.Raycaster(from, new T.Vector3(side * p.nx, 0, side * p.nz), 0, face + 1);
      expect(ray.intersectObjects(concrete, false)[0].distance).toBeCloseTo(boundary, 1);
    }
  });
  it('keeps the bridge side open at a joining road where the physics allows passage', () => {
    const p = roadSample(true);
    track.nearest(p.x, p.z, trackPoint(), p.y);
    const face = roadBarrierFace(edge.spec, true);
    for (const side of [-1, 1]) {
      expect(track.boundaryAt(p, side)).toBeGreaterThan(1000);
      const y = net.surfaceHeight(
        p,
        side * edge.spec.halfWidth,
        edge.spec.halfWidth,
        edge.spec.crown,
      );
      const hit = new T.Raycaster(
        new T.Vector3(p.x, y + 0.35, p.z),
        new T.Vector3(side * p.nx, 0, side * p.nz),
        face - 0.35,
        face + 0.5,
      ).intersectObjects(concrete, false);
      expect(hit).toHaveLength(0);
    }
  });
  it('tapers the underside from the central box girder into the thinner cantilevers', () => {
    const p = roadSample(),
      half = edge.spec.halfWidth + edge.spec.shoulder;
    const depths = [0, 0.7, 0.95].map((u) => {
      const l = u * half,
        x = p.x + p.nx * l,
        z = p.z + p.nz * l;
      const y = net.surfaceHeight(p, l, edge.spec.halfWidth, edge.spec.crown);
      const hits = new T.Raycaster(
        new T.Vector3(x, y - 2.1, z),
        new T.Vector3(0, 1, 0),
        0,
        2.5,
      ).intersectObjects(concrete, false);
      const underside = hits.find((hit) => hit.face!.normal.y < -0.25);
      expect(underside).toBeDefined();
      return y - underside!.point.y;
    });
    expect(depths[0]).toBeGreaterThan(1.4);
    expect(depths[1]).toBeLessThan(depths[0] - 0.6);
    expect(depths[2]).toBeLessThan(depths[1]);
  });
});
