import { expect, it } from 'vitest';
import * as T from 'three';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { Track } from '../src/simulation/track.ts';
import { grovePlan } from '../src/rendering/landscape.ts';
import { TERRAIN_SIZE, terrainSegments, terrainSurface } from '../src/rendering/terrain-surface.ts';
import { terrainFor } from '../src/rendering/terrain.ts';

it('seats coastal trees on the visible triangle on either side of its diagonal', () => {
  const track = new Track('clear', false, undefined, CIRCUITS['cape-wrenna']);
  const terrain = terrainFor(track),
    surface = terrainSurface(terrain);
  const step = TERRAIN_SIZE / terrainSegments(terrain);
  const cliff = { x: 725.2492, z: 432.7191 };
  const col = Math.floor((cliff.x + TERRAIN_SIZE / 2) / step),
    row = Math.floor((cliff.z + TERRAIN_SIZE / 2) / step);
  const x0 = col * step - TERRAIN_SIZE / 2,
    z0 = row * step - TERRAIN_SIZE / 2;
  // Build one actual THREE.PlaneGeometry cell. The ray is independent of the
  // planting interpolation, including the engine's choice of diagonal.
  const geometry = new T.PlaneGeometry(step, step, 1, 1)
    .rotateX(-Math.PI / 2)
    .translate(x0 + step / 2, 0, z0 + step / 2);
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, terrain.height(p.getX(i), p.getZ(i)));
  const patch = new T.Mesh(geometry, new T.MeshBasicMaterial());
  for (const [u, v] of [
    [0.21, 0.32],
    [0.81, 0.73],
    [0.72, 0.28],
    [1, 1],
    [0, 0],
  ]) {
    const x = x0 + u * step,
      z = z0 + v * step;
    const hit = new T.Raycaster(new T.Vector3(x, 500, z), new T.Vector3(0, -1, 0)).intersectObject(
      patch,
    )[0];
    expect(surface.height(x, z)).toBeCloseTo(hit.point.y, 5);
  }
  expect(terrain.height(cliff.x, cliff.z) - surface.height(cliff.x, cliff.z)).toBeGreaterThan(25);
  const trees = grovePlan(track);
  for (const tree of [...trees.groves, ...trees.treeline]) {
    expect(tree.y).toBeCloseTo(surface.height(tree.x, tree.z), 4);
    if (terrain.seaLevel !== null) expect(tree.y).toBeGreaterThanOrEqual(terrain.seaLevel + 0.6);
  }
  geometry.dispose();
  patch.material.dispose();
});
