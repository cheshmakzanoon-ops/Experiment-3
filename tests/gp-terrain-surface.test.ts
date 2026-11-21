import { expect, it } from 'vitest';
import * as T from 'three';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { grovePlan } from '../src/rendering/landscape.ts';
import { TERRAIN_SIZE, terrainSegments, terrainSurface } from '../src/rendering/terrain-surface.ts';
import { catalogueSkirtOffset } from '../src/rendering/venue-kit/ground.ts';
import { drawnTerrain, terrainFor } from '../src/rendering/terrain.ts';

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

it('embeds the outer edge of the GP verge into the actual hillside across both pit sides', () => {
  for (const id of ['cape-wrenna', 'poggio-alto', 'haarveld', 'montejaral'] as const) {
    const track = new Track('clear', false, undefined, CIRCUITS[id]),
      ground = drawnTerrain(track),
      visible = terrainSurface(terrainFor(track)),
      p = trackPoint();
    let highest = -Infinity,
      lowest = Infinity;
    for (let s = 0; s < track.length; s += 2) {
      track.at(s, p);
      for (const side of [-1, 1]) {
        const lat = side * (Math.max(p.width + 4, track.boundaryAt(p, side) + 1) + 26);
        const road = p.y + p.bank * Math.max(-12, Math.min(12, lat));
        const edge = road + catalogueSkirtOffset(p, ground, lat, 1);
        const gap = edge - visible.height(p.x + p.nx * lat, p.z + p.nz * lat);
        highest = Math.max(highest, gap);
        lowest = Math.min(lowest, gap);
      }
    }
    expect(highest).toBeCloseTo(-0.08, 6);
    expect(lowest).toBeCloseTo(-0.08, 6);
  }
});

it('keeps the four GP landscapes distinct behind their surveyed road corridors', () => {
  for (const [id, minimum, maximum] of [
    ['poggio-alto', 165, 245], ['montejaral', 240, 335],
    ['cape-wrenna', 96, 145], ['haarveld', 4, 9],
  ] as const) {
    const track = new Track('clear', false, undefined, CIRCUITS[id]);
    const terrain = terrainFor(track);
    let highest = -Infinity, lowest = Infinity;
    for (let z = -2400; z <= 2400; z += 70) {
      for (let x = -2400; x <= 2400; x += 70) {
        const height = terrain.height(x, z);
        highest = Math.max(highest, height);
        lowest = Math.min(lowest, height);
      }
    }
    expect(highest, id).toBeGreaterThan(minimum);
    expect(highest, id).toBeLessThan(maximum);
    if (id === 'cape-wrenna') {
      expect(lowest).toBeLessThan(terrain.seaLevel! - 30);
      for (let z = -1600; z <= 700; z += 115)
        expect(terrain.height(2450, z)).toBeLessThan(terrain.seaLevel!);
    }
    const p = trackPoint();
    for (let s = 0; s < track.length; s += 41) {
      track.at(s, p);
      // The distant terrain stays below the surveyed centreline, even over a crest.
      expect(terrain.height(p.x, p.z), id).toBeLessThan(p.y + 0.1);
    }
  }
});

it.each(['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'])(
  '%s distributes distant planting over its actual landforms and keeps the racing corridor clear',
  id => {
    const track = new Track('clear', false, undefined, CIRCUITS[id]);
    const ground = terrainSurface(terrainFor(track));
    const { treeline } = grovePlan(track), p = trackPoint();
    const bearings = new Set<number>(), habitats = new Set<string>();
    const cx = track.points.reduce((sum, q) => sum + q.x, 0) / track.points.length;
    const cz = track.points.reduce((sum, q) => sum + q.z, 0) / track.points.length;
    let highest = -Infinity, lowest = Infinity, farthest = 0, closest = Infinity;
    expect(treeline.length).toBeGreaterThan(350);
    expect(treeline.length).toBeLessThan(2200);
    for (const tree of treeline) {
      expect(tree.y).toBeCloseTo(ground.height(tree.x, tree.z), 4);
      track.nearest(tree.x, tree.z, p);
      const distance = Math.hypot(p.x - tree.x, p.z - tree.z);
      farthest = Math.max(farthest, distance);
      closest = Math.min(closest, distance);
      lowest = Math.min(lowest, tree.y);
      highest = Math.max(highest, tree.y);
      bearings.add(Math.floor((Math.atan2(tree.z - cz, tree.x - cx) + Math.PI) / (Math.PI / 4)));
      habitats.add(tree.role!);
    }
    expect(closest).toBeGreaterThan(90);
    expect(farthest - closest).toBeGreaterThan(500);
    expect(bearings.size).toBeGreaterThan(5);
    expect(habitats.size).toBeGreaterThan(1);
    if (id === 'haarveld') expect(highest - lowest).toBeLessThan(16);
    if (id === 'poggio-alto' || id === 'montejaral') expect(highest - lowest).toBeGreaterThan(90);
  },
);
