import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  facadeLayout,
  facadeFinish,
  addRecessedFacade,
  type FacadePlacement,
} from '../src/rendering/open-world/facade-layout.ts';
import type { Structure } from '../src/simulation/open-world/placement.ts';
import { carvedGroundHeight } from '../src/simulation/open-world/ground-height.ts';
import { regionStructures, streetDoorPosition } from '../src/simulation/open-world/placement.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
const sample: Structure = {
  kind: 'shop',
  x: 0,
  z: 0,
  heading: 0,
  hx: 8,
  hz: 5,
  height: 10.2,
  base: 0,
  floors: 3,
  style: 41711,
};
const area = (r: readonly number[]) => (r[2] - r[0]) * (r[3] - r[1]);
describe('Real recessed facade partition', () => {
  it('assigns metric surface courses by material identity rather than pixel hue', () => {
    expect(facadeFinish(0x8c4f3a)).toBe(1);
    expect(facadeFinish(0xb3a891)).toBe(2);
    for (const color of [0xd8d2c4, 0xa9b7bf, 0xc9a66b, 0xb86a4b])
      expect(facadeFinish(color)).toBe(0);
  });
  it('seats Port Ilse doors above the graded frontage and keeps a buried foundation on the downslope', () => {
    const world = openWorld(),
      shops = regionStructures(world).filter((s) => s.frontSide);
    expect(shops.length).toBeGreaterThan(30);
    let deeper = 0;
    for (const s of shops) {
      const p = streetDoorPosition(s, s.frontSide!);
      const street = carvedGroundHeight(world.carver, p.x, p.z);
      expect(s.base + 0.515 - street).toBeCloseTo(0.018, 5);
      if (s.foundationBase !== undefined) {
        expect(s.foundationBase).toBeLessThan(s.base);
        deeper++;
      }
    }
    expect(deeper).toBeGreaterThan(10);
  });
  it.each([false, true])('covers the facade exactly once with street frontage %s', (front) => {
    for (const kind of ['house', 'shop', 'block', 'farm', 'terminal'] as const) {
      const s = { ...sample, kind },
        layout = facadeLayout(s, 16, 0, front)!;
      const holes = layout.openings.map((o) => [o.u0, o.v0, o.u1, o.v1]);
      const all = [...layout.wall, ...holes];
      expect(all.reduce((sum, r) => sum + area(r), 0)).toBeCloseTo(16 * s.height, 8);
      for (let a = 0; a < all.length; a++) {
        expect(area(all[a])).toBeGreaterThan(0);
        for (let b = a + 1; b < all.length; b++) {
          const overlap =
            Math.max(0, Math.min(all[a][2], all[b][2]) - Math.max(all[a][0], all[b][0])) *
            Math.max(0, Math.min(all[a][3], all[b][3]) - Math.max(all[a][1], all[b][1]));
          expect(overlap).toBeLessThan(1e-8);
        }
      }
    }
  });
  it('seats the commercial pull, threshold and central door in the actual recessed opening', () => {
    const layout = facadeLayout(sample, 16, 2, true)!;
    const doors = layout.openings.filter((o) => o.entrance);
    expect(doors).toHaveLength(1);
    const door = doors[0],
      centre = (door.u0 + door.u1) / 2;
    expect(door.v0).toBeCloseTo(0.515, 5);
    const vertices: number[] = [],
      indices: number[] = [];
    const placements: FacadePlacement[] = [];
    addRecessedFacade(
      {
        quad(p, n, uv, color, tag) {
          if (tag[2] !== -6) return;
          const a = vertices.length / 3;
          for (const q of p) vertices.push(...q);
          indices.push(a, a + 1, a + 2, a, a + 2, a + 3);
        },
      },
      layout,
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
      0xffffff,
      0.2,
      1,
      placements,
    );
    expect(placements).toHaveLength(layout.openings.length - 1);
    const g = new T.BufferGeometry().setAttribute(
      'position',
      new T.Float32BufferAttribute(vertices, 3),
    );
    g.setIndex(indices);
    const m = new T.Mesh(g, new T.MeshBasicMaterial());
    const probe = (x: number, y: number) =>
      new T.Raycaster(new T.Vector3(x, y, 1), new T.Vector3(0, 0, -1)).intersectObject(m)[0]?.point
        .z;
    expect(probe(centre, door.v0 + 0.026)).toBeCloseTo(0.014, 3);
    expect(probe(centre + 0.54 - 0.105, door.v0 + 1.075)).toBeCloseTo(-0.0705, 3);
    expect(probe(centre, door.v0 + 1.12)).toBeUndefined();
    g.dispose();
    m.material.dispose();
  });
  it('keeps every actual regional opening clear of corners, floor bands and parapets', () => {
    let openings = 0;
    for (const s of regionStructures(openWorld()))
      for (let side = 0; side < 4; side++) {
        const length = side % 2 ? s.hz * 2 : s.hx * 2,
          layout = facadeLayout(s, length, side);
        if (!layout) continue;
        const sum =
          layout.wall.reduce((n, r) => n + area(r), 0) +
          layout.openings.reduce((n, o) => n + (o.u1 - o.u0) * (o.v1 - o.v0), 0);
        expect(sum).toBeCloseTo(length * s.height, 5);
        for (const o of layout.openings) {
          expect(o.u0).toBeGreaterThan(0.28);
          expect(length - o.u1).toBeGreaterThan(0.28);
          expect(o.v0 - o.row0).toBeGreaterThan(0.5);
          expect(o.row1 - o.v1).toBeGreaterThan(0.29);
          expect(o.u1 - o.u0).toBeGreaterThan(0.9);
          expect(o.v1 - o.v0).toBeGreaterThan(1);
          expect(o.v1).toBeLessThan(s.height - 0.59);
          const assemblyHalf = (o.u1 - o.u0) * (o.kind === 'shuttered' ? 0.94 : 0.57);
          const centre = (o.u0 + o.u1) / 2;
          expect(centre - assemblyHalf - o.cell0).toBeGreaterThanOrEqual(0.14);
          expect(o.cell1 - centre - assemblyHalf).toBeGreaterThanOrEqual(0.14);
          openings++;
        }
      }
    expect(openings).toBeGreaterThan(1000);
  });
  it('is deterministic and does not turn unsupported towers or invalid walls into grids', () => {
    expect(facadeLayout(sample, 16)).toEqual(facadeLayout(sample, 16));
    expect(facadeLayout(sample, 16, 0)).not.toEqual(facadeLayout(sample, 16, 1));
    for (const s of [
      { ...sample, kind: 'lighthouse' as const },
      { ...sample, height: NaN },
      { ...sample, height: 1 },
      { ...sample, floors: NaN },
    ])
      expect(facadeLayout(s, 16)).toBeNull();
    expect(facadeLayout(sample, 1)).toBeNull();
    expect(facadeLayout(sample, Infinity)).toBeNull();
  });
  it('has outward triangle winding and no wall triangle hiding its inset glass', () => {
    for (const angle of [0, 0.3, Math.PI / 2, Math.PI, 4.2]) {
      const layout = facadeLayout(sample, 16)!,
        placements: FacadePlacement[] = [],
        position: number[] = [],
        normals: number[] = [],
        indices: number[] = [];
      const tangent = [Math.cos(angle), 0, Math.sin(angle)] as const,
        normal = [-Math.sin(angle), 0, Math.cos(angle)] as const;
      addRecessedFacade(
        {
          quad: (corners, n) => {
            const base = position.length / 3;
            for (const p of corners) {
              position.push(...p);
              normals.push(...n);
            }
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          },
        },
        layout,
        [14, 6, -31],
        tangent,
        normal,
        0xffffff,
        0.4,
        1,
        placements,
      );
      const geometry = new T.BufferGeometry().setAttribute(
        'position',
        new T.Float32BufferAttribute(position, 3),
      );
      geometry.setIndex(indices);
      const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial());
      mesh.updateMatrixWorld();
      for (let i = 0; i < indices.length; i += 3) {
        const a = new T.Vector3().fromArray(position, indices[i] * 3),
          b = new T.Vector3().fromArray(position, indices[i + 1] * 3),
          c = new T.Vector3().fromArray(position, indices[i + 2] * 3);
        const actual = b.sub(a).cross(c.sub(a)).normalize(),
          expected = new T.Vector3().fromArray(normals, indices[i] * 3);
        expect(actual.dot(expected)).toBeGreaterThan(0.99999);
      }
      for (const p of placements) {
        const direction = new T.Vector3(...p.normal).negate(),
          origin = new T.Vector3(...p.centre).addScaledVector(direction, -0.5);
        const hits = new T.Raycaster(origin, direction, 0, 2).intersectObject(mesh);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].distance).toBeCloseTo(0.71, 4);
      }
      geometry.dispose();
      (mesh.material as T.Material).dispose();
    }
  });
});
