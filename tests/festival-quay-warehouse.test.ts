import * as T from 'three';
import { expect, it } from 'vitest';
import { Buildings } from '../src/rendering/open-world/buildings.ts';
import { regionStructures, StructureGrid } from '../src/simulation/open-world/placement.ts';
import { OpenWorld, openWorld } from '../src/simulation/open-world/world.ts';
import { trackPoint } from '../src/simulation/track.ts';

it('seats the Harbour Front net loft off the live road without displacing a frontage', () => {
  const world = openWorld(),
    items = regionStructures(world);
  const site = items.find((s) => s.kind === 'warehouse' && s.x === 576)!;
  const previous = new OpenWorld({
    ...world.region,
    landmarks: world.region.landmarks.filter((s) => s.kind !== 'warehouse' || s.x !== 576),
  });
  expect(items.filter((s) => s !== site)).toEqual(regionStructures(previous));
  const grid = new StructureGrid(items),
    sample = trackPoint();
  expect(grid.blocks(site.x, site.z)).toBe(true);
  for (const x of [site.x - site.hx, site.x, site.x + site.hx]) {
    expect(grid.blocks(x, -2600, 2)).toBe(false);
    for (const z of [site.z - site.hz, site.z + site.hz]) {
      const offset = Math.abs(world.network.nearest(x, z, sample));
      const { spec } = world.network.edges[world.network.edgeOf[world.network.lastSegment]];
      expect(offset - spec.halfWidth - spec.shoulder).toBeGreaterThan(10);
      const ground = world.field.height(x, z);
      expect(ground).toBeGreaterThan(world.region.seaLevel + 1);
      expect(ground - site.base).toBeGreaterThanOrEqual(0);
      expect(ground - site.base).toBeLessThan(0.82);
    }
  }
});

it('keeps the sloped glazing, roof crests and recessed loading doors in the warehouse mesh', () => {
  const site = regionStructures(openWorld()).find((s) => s.kind === 'warehouse' && s.x === 576)!;
  const buildings = new Buildings([site]);
  try {
    const mesh = buildings.root.children.find(
      (m) => m instanceof T.Mesh,
    ) as T.Mesh<T.BufferGeometry>;
    mesh.updateMatrixWorld(true);
    const ray = (x: number, y: number, z: number, dx: number, dy: number, dz: number) => {
      const origin = new T.Vector3(site.x + x, site.base + y, site.z + z);
      const hit = new T.Raycaster(origin, new T.Vector3(dx, dy, dz), 0, 30).intersectObject(
        mesh,
      )[0];
      expect(hit).toBeDefined();
      return hit;
    };
    const { hx, hz, height } = site,
      eave = height - Math.min(2.35, height * 0.23);
    expect(ray(-hx - 1, 2, -1, 1, 0, 0).distance).toBeCloseTo(1.16, 3);
    expect(ray(-hx - 1, 2, 1, 1, 0, 0).distance).toBeCloseTo(1.22, 3);
    const sidePane = ray(-hx + 2, eave - 0.65, hz + 1, 0, 0, -1);
    expect(sidePane.distance).toBeCloseTo(1.11, 3);
    const slope = ray(-hx + 0.65, height + 2, 0.7, 0, -1, 0);
    expect(slope.point.y - site.base).toBeCloseTo((height + eave) / 2, 3);
    expect(slope.face!.normal.x).toBeLessThan(-0.6);
    expect(slope.face!.normal.y).toBeGreaterThan(0.45);
    const codes = mesh.geometry.getAttribute('facade');
    for (const pane of [slope, sidePane]) expect(codes.getZ(pane.face!.a)).toBe(-4);
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.max.y - site.base).toBeCloseTo(height, 3);
    expect(buildings.stats.triangles).toBeLessThan(1200);
  } finally {
    buildings.dispose();
  }
});
