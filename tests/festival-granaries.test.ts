import * as T from 'three';
import { expect, it } from 'vitest';
import { facadeLayout } from '../src/rendering/open-world/facade-layout.ts';
import { Buildings } from '../src/rendering/open-world/buildings.ts';
import { regionStructures, StructureGrid } from '../src/simulation/open-world/placement.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { trackPoint } from '../src/simulation/track.ts';

it('gives both agricultural elevators a closed loading elevation, a roof and a physical footprint clear of racing surfaces', () => {
  const w = openWorld(),
    structures = regionStructures(w);
  const elevators = structures.filter((s) => s.kind === 'granary');
  const grid = new StructureGrid(structures),
    p = trackPoint();
  expect(elevators).toHaveLength(2);
  const b = new Buildings(elevators);
  try {
    b.root.updateMatrixWorld(true);
    for (const s of elevators) {
      const c = Math.cos(s.heading),
        n = Math.sin(s.heading);
      const local = (x: number, y: number, z: number) =>
        new T.Vector3(s.x + c * x - n * z, s.base + y, s.z + n * x + c * z);
      expect(grid.blocks(s.x, s.z, 0)).toBe(true);
      for (const side of [-1, 1])
        for (const end of [-1, 1]) {
          const point = local(side * s.hx, 0, end * s.hz);
          const l = w.network.nearest(point.x, point.z, p),
            e = w.network.edges[w.network.edgeOf[w.network.lastSegment]];
          expect(Math.abs(l) - e.spec.halfWidth - e.spec.shoulder).toBeGreaterThan(15);
          expect(w.field.height(point.x, point.z) - s.base).toBeGreaterThan(0);
        }
      const wall = new T.Raycaster(
        local(0, s.height * 0.5, s.hz + 1),
        new T.Vector3(n, 0, -c),
        0,
        1.02,
      );
      expect(wall.intersectObject(b.root, true).length).toBeGreaterThan(0);
      const roof = new T.Raycaster(
        local(0, s.height + 1, s.hz * 0.25),
        new T.Vector3(0, -1, 0),
        0,
        2,
      );
      expect(roof.intersectObject(b.root, true)[0]?.point.y).toBeGreaterThan(
        s.base + s.height - 0.5,
      );
    }
  } finally {
    b.dispose();
  }
});

it('recesses the closed carriage doors on both gables and places the barn windows above working height', () => {
  const farms = regionStructures(openWorld()).filter((s) => s.kind === 'farm');
  expect(farms).toHaveLength(4);
  const buildings = new Buildings(farms);
  try {
    buildings.root.updateMatrixWorld(true);
    for (const s of farms) {
      const layout = facadeLayout(s, 2 * s.hx, 0)!;
      expect(layout.floors).toBe(1);
      expect(layout.openings.length).toBeGreaterThan(0);
      expect(layout.openings.length).toBeLessThanOrEqual(Math.floor((2 * s.hx) / 5.2));
      expect(
        layout.openings.every(
          (pane) => pane.v0 > 3 && pane.v1 - pane.v0 > 1 && pane.v1 - pane.v0 < 1.17,
        ),
      ).toBe(true);
      const c = Math.cos(s.heading),
        n = Math.sin(s.heading);
      for (const side of [-1, 1]) {
        const hit = (u: number) => {
          const x = side * (s.hx + 1),
            z = side * u;
          const ray = new T.Raycaster(
            new T.Vector3(s.x + c * x - n * z, s.base + 2.5, s.z + n * x + c * z),
            new T.Vector3(-side * c, 0, -side * n),
            0,
            1.3,
          );
          return ray.intersectObject(buildings.root, true)[0]?.distance;
        };
        expect(hit(-0.8)).toBeCloseTo(1.16, 2);
        expect(hit(0.8)).toBeCloseTo(1.2, 2);
        expect(hit(s.hz * 0.78)).toBeCloseTo(1.0, 2);
      }
    }
  } finally {
    buildings.dispose();
  }
});
