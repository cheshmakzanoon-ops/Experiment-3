import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { Buildings } from '../src/rendering/open-world/buildings.ts';
import { FACADE_RECESS } from '../src/rendering/open-world/facade-layout.ts';

describe('Festival building distance geometry', () => {
  it('retains room identity and wall coverage, and restores recessed glazing when zoomed in', () => {
    const buildings = new Buildings([
      {
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
      },
    ]);
    const camera = new T.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
    const mesh = buildings.root.children.find((node) =>
      node.name.startsWith('Buildings '),
    ) as T.Mesh;
    const g = mesh.geometry,
      index = g.index!,
      vertices = g.getAttribute('position');
    const tags = g.getAttribute('facade');
    const surfaces = () => {
      const panes: number[][] = [],
        base: number[] = [],
        reveals: number[] = [];
      for (let j = g.drawRange.start; j < g.drawRange.start + g.drawRange.count; j += 6) {
        const i = index.getX(j),
          tag = tags.getZ(i);
        if (tag === -4)
          panes.push([
            tags.getX(i),
            tags.getW(i),
            vertices.getX(i),
            vertices.getY(i),
            vertices.getZ(i),
          ]);
        else if (tag === -5) reveals.push(i);
        else base.push(i);
      }
      return { panes, base, reveals, count: g.drawRange.count };
    };
    const view = (distance: number, zoom = 1) => {
      camera.position.set(0, 3, distance);
      camera.lookAt(0, 3, 0);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      buildings.update(camera, 'high', 720);
      return surfaces();
    };
    try {
      const near = view(10),
        far = view(400);
      expect(near.reveals.length).toBe(near.panes.length * 4);
      expect(far.reveals).toHaveLength(0);
      expect(far.base).toEqual(near.base);
      expect(far.panes.length).toBeGreaterThan(25);
      expect(far.panes.length).toBe(near.panes.length);
      expect(far.count).toBeLessThan(near.count);
      for (let i = 0; i < near.panes.length; i++) {
        const [room, shop, x, y, z] = near.panes[i],
          projected = far.panes[i];
        expect(projected.slice(0, 2)).toEqual([room, shop]);
        expect(projected[3]).toBe(y);
        expect(Math.hypot(projected[2] - x, projected[4] - z)).toBeCloseTo(FACADE_RECESS, 5);
      }
      expect(view(400, 4)).toEqual(near);
      expect(view(400)).toEqual(far);
      expect(view(10)).toEqual(near);
    } finally {
      buildings.dispose();
    }
  });
});
