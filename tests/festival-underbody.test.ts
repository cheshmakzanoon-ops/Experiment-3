import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { bodySheetFor, type ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { ClosedBodyModel } from '../src/rendering/vehicle-bodies/closed-body.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';
import { sharedMaterials } from '../src/rendering/vehicle-bodies/materials.ts';
import { Parts } from '../src/rendering/vehicle-bodies/parts.ts';
import {
  roadSplitter,
  roadSplitterStation,
  addRoadUndertray,
} from '../src/rendering/vehicle-bodies/road-underbody.ts';

function modelFor(id: string) {
  const def = VEHICLES[id],
    s = bodySheetFor(def) as ClosedSheet;
  return new ClosedBodyModel(bodyFrame(def), s, [s.wheels.width[0] / 2, s.wheels.width[1] / 2]);
}
describe('Festival lower body construction', () => {
  it('forms a closed front pressing with a rolled edge that follows the lower bumper', () => {
    for (const id of ['eh3', 'sc7', 'rh3', 'rm8', 'lx12']) {
      const m = modelFor(id),
        centre = roadSplitterStation(m, 0),
        corner = roadSplitterStation(m, 1);
      expect(centre.lip).toBeGreaterThan(m.zFront);
      expect(corner.lip).toBeLessThan(centre.lip - 0.18);
      expect(corner.y).toBeGreaterThan(centre.y + 0.018);
      expect(centre.attachment).toBeGreaterThan(m.control(centre.root)[0][1]);
      for (const d of [0, 1, 2] as const) {
        const geo = roadSplitter(m, d);
        geo.computeBoundingBox();
        const mat = new T.MeshBasicMaterial(),
          mesh = new T.Mesh(geo, mat);
        const station = roadSplitterStation(m, 0);
        const z = station.lip - 0.012;
        const top = new T.Raycaster(
          new T.Vector3(0, 1, z),
          new T.Vector3(0, -1, 0),
        ).intersectObject(mesh)[0];
        const bottom = new T.Raycaster(
          new T.Vector3(0, -2, z),
          new T.Vector3(0, 1, 0),
        ).intersectObject(mesh)[0];
        expect(top?.face?.normal.y).toBeGreaterThan(0.2);
        expect(bottom?.face?.normal.y).toBeLessThan(-0.7);
        expect(top.point.y - bottom.point.y).toBeGreaterThan(0.008);
        expect(top.point.y - bottom.point.y).toBeLessThan(0.04);
        expect(geo.boundingBox!.min.y).toBeGreaterThan(m.f.ground + 0.04);
        expect(geo.index!.count / 3).toBeLessThan(420);
        geo.dispose();
        mat.dispose();
      }
    }
  });
  it('keeps each longitudinal strake attached to the same expanding outlet at both racing distances', () => {
    for (const id of ['sc7', 'eh3', 'rs5', 'rh3', 'rd2', 'rg63', 'rp6']) {
      const m = modelFor(id);
      for (const d of [0, 1] as const) {
        const p = new Parts(),
          group = new T.Group();
        addRoadUndertray(p, m, d);
        p.build(group, false);
        const carbon = group.children.find(
          (o) => (o as T.Mesh).material === sharedMaterials.carbonSatin(),
        ) as T.Mesh | undefined;
        if (m.s.diffuser > 0) {
          expect(carbon).toBeDefined();
          const ray = new T.Raycaster(undefined, new T.Vector3(0, 1, 0));
          const span = m.halfWidth(m.zRear) * 0.87 * (m.s.diffuser >= 0.15 ? 0.8 : 0.66);
          const z = m.zRear + 0.012;
          const sample = (x: number) => {
            ray.ray.origin.set(x, m.f.ground - 1, z);
            const h = ray.intersectObject(carbon!)[0];
            expect(h, id).toBeDefined();
            return h.point.y;
          };
          const bottom = sample(0),
            tunnel = sample(span * (m.s.diffuser >= 0.15 ? 0.25 : 0.5));
          expect(tunnel - bottom).toBeGreaterThan(m.s.diffuser >= 0.15 ? 0.045 : 0.01);
          expect(bottom).toBeGreaterThan(m.f.ground + 0.03);
        } else expect(carbon).toBeUndefined();
        for (const node of group.children) (node as T.Mesh).geometry.dispose();
      }
    }
  });
});
