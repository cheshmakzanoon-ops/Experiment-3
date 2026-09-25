import { expect, it } from 'vitest';
import * as T from 'three';
import { buildGantrySolids, buildControlTowerSolids } from '../src/rendering/race-structures.ts';
import { BroadcastSightlines } from '../src/rendering/broadcast-sightlines.ts';
import { TracksideDirector } from '../src/rendering/trackside.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

it('registers the real three gantry solids but keeps its road aperture clear', () => {
  const root = new T.Group(),
    m = new T.MeshStandardMaterial(),
    sight = new BroadcastSightlines();
  root.position.set(18, 2, -9);
  root.rotation.y = 0.7;
  buildGantrySolids(root, m, m, sight);
  root.updateMatrixWorld(true);
  const at = (x: number, y: number, z: number) =>
    new T.Vector3(x, y, z).applyMatrix4(root.matrixWorld);
  expect(sight.count).toBe(3);
  expect(root.children.length).toBe(3);
  expect(sight.blocked(at(0, 6, -8), at(0, 6, 8))).toBe(true);
  expect(sight.blocked(at(10.8, 2, -8), at(10.8, 2, 8))).toBe(true);
  expect(sight.blocked(at(0, 1, -8), at(0, 1, 8))).toBe(false);
  expect(sight.blocked(at(0, 6, -8), at(0, 6, -2))).toBe(false);
  // Captured world bounds must survive scene batching/disposal/reparenting.
  root.clear();
  expect(sight.blocked(at(0, 6, -8), at(0, 6, 8))).toBe(true);
});
it('registers the tower base and roof without treating the glazed room as opaque', () => {
  const g = new T.Group(),
    m = new T.MeshStandardMaterial(),
    sight = new BroadcastSightlines();
  buildControlTowerSolids(g, m, m, m, sight);
  expect(sight.count).toBe(2);
  expect(g.children).toHaveLength(3);
  expect(sight.blocked(new T.Vector3(-10, 8, 0), new T.Vector3(10, 8, 0))).toBe(true);
  expect(sight.blocked(new T.Vector3(-10, 17, 0), new T.Vector3(10, 17, 0))).toBe(true);
  expect(sight.blocked(new T.Vector3(-10, 16.4, 0), new T.Vector3(10, 16.4, 0))).toBe(false);
});
it('cuts to an existing unblocked rig when actual gantry structure obstructs its sightline', () => {
  const track = new Track(),
    plain = new TracksideDirector(track),
    p = track.at(0, trackPoint());
  const target = new T.Vector3(p.x, p.y + 0.5, p.z),
    velocity = new T.Vector3(p.tx * 20, 0, p.tz * 20);
  const g = new T.Group(),
    m = new T.MeshStandardMaterial(),
    sight = new BroadcastSightlines();
  // A gantry support is put across this isolated fixture's first camera ray.
  // The production builder and the real director are used, not an always-true stub.
  const midpoint = plain.rigs[0].position.clone().lerp(target, 0.5);
  g.position.copy(midpoint).add(new T.Vector3(-10.8, -3, 0));
  buildGantrySolids(g, m, m, sight);
  expect(sight.blocked(plain.rigs[0].position, target)).toBe(true);
  const director = new TracksideDirector(track, (from, to) => sight.blocked(from, to));
  director.update(0, target, velocity, 1 / 60);
  expect(director.activeId).not.toBe(0);
  expect(director.occluded).toBe(false);
  expect(director.position.equals(director.rigs[director.activeId].position)).toBe(true);
});
