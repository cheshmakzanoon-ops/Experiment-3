import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { gpAxleCarrier, gpAxleFasteners } from '../src/rendering/gp-axle-carrier.ts';
describe('forged GP fork bottoms', () => {
  it.each(['high', 'mid', 'far'] as const)(
    'keeps a working axle bore and matching tapered forgings at %s',
    (detail) => {
      const l = gpAxleCarrier(1, detail),
        r = gpAxleCarrier(-1, detail);
      const lp = l.getAttribute('position'),
        rp = r.getAttribute('position');
      for (let i = 0; i < lp.count; i++) {
        expect(lp.getX(i)).toBeCloseTo(-rp.getX(i), 7);
        expect(lp.getY(i)).toBe(rp.getY(i));
        expect(lp.getZ(i)).toBe(rp.getZ(i));
      }
      for (const side of [-1, 1]) {
        const geo = side < 0 ? r : l;
        const shell = new T.Mesh(geo, new T.MeshBasicMaterial());
        const ray = new T.Raycaster(new T.Vector3(side * 0.1, 0, 0), new T.Vector3(-side, 0, 0));
        expect(ray.intersectObject(shell)).toHaveLength(0);
        ray.ray.origin.y = 0.019;
        const hit = ray.intersectObject(shell)[0];
        expect(hit.point.x * side).toBeGreaterThan(0.015);
        expect(hit.face!.normal.x * side).toBeGreaterThan(0.7);
        geo.computeBoundingBox();
        expect(geo.boundingBox!.max.y).toBeGreaterThan(0.085);
        expect(geo.boundingBox!.min.y).toBeGreaterThan(-0.04);
        expect(geo.index!.count / 3).toBeLessThanOrEqual(280);
        geo.dispose();
        shell.material.dispose();
      }
    },
  );
  it('seats the axle nut axially outside the carrier on both fork legs', () => {
    for (const side of [-1, 1]) {
      const g = gpAxleFasteners(side);
      g.computeBoundingBox();
      expect(side > 0 ? g.boundingBox!.max.x : -g.boundingBox!.min.x).toBeCloseTo(0.028, 4);
      expect(g.index!.count / 3).toBeLessThan(150);
      const m = new T.Mesh(g, new T.MeshBasicMaterial());
      const ray = new T.Raycaster(new T.Vector3(side * 0.09, 0, 0), new T.Vector3(-side, 0, 0));
      expect(ray.intersectObject(m)).toHaveLength(0);
      ray.ray.origin.y = 0.001;
      ray.ray.origin.z = 0.01;
      expect(ray.intersectObject(m).length).toBeGreaterThan(0);
      g.dispose();
      m.material.dispose();
    }
  });
});
