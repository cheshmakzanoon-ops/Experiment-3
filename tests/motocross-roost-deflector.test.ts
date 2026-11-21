import * as T from 'three';
import { expect, it } from 'vitest';
import { motocrossRoostDeflector } from '../src/rendering/offroad/mx-roost-deflector.ts';

it.each(['high', 'mid', 'far'] as const)(
  'fits the %s chest and leaves both the rear race number and armholes clear',
  (detail) => {
    const g = motocrossRoostDeflector(detail, 0x99ce48, true);
    const mat = new T.MeshBasicMaterial(),
      shell = new T.Mesh(g, mat);
    const ray = new T.Raycaster(),
      direction = new T.Vector3(),
      origin = new T.Vector3();
    const intersects = (x: number, y: number, back: boolean) => {
      ray.set(origin.set(x, y, back ? -0.45 : 0.45), direction.set(0, 0, back ? 1 : -1));
      ray.far = 0.44;
      return ray.intersectObject(shell, false);
    };
    try {
      const pos = g.getAttribute('position');
      expect(g.boundingBox!.max.x).toBeLessThan(0.203);
      for (const x of [-0.06, 0.06]) {
        expect(intersects(x, 0.32, true)).toHaveLength(0);
        expect(intersects(x, 0.28, false).length).toBeGreaterThan(0);
      }
      // The aperture must expose actual space, not a dark polygon across it.
      if (detail !== 'far') {
        const holes = [];
        for (let j = 0; j < 40; j++)
          holes.push(intersects(0.09, 0.3 + j * 0.002, false).length === 0);
        expect(holes).toContain(true);
        expect(holes).toContain(false);
      }
      expect(pos.count).toBe(g.getAttribute('color').count);
      expect(g.index!.count / 3).toBeLessThan(detail === 'far' ? 240 : 1200);
    } finally {
      g.dispose();
      mat.dispose();
    }
  },
);
