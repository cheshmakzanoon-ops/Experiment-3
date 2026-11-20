import * as T from 'three';
import { expect, it } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { bodySheetFor, type ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';
import { ClosedBodyModel, Greenhouse } from '../src/rendering/vehicle-bodies/closed-body.ts';
import { buildVehicleBody } from '../src/rendering/vehicle-bodies/index.ts';
import { festivalFaceLamps } from '../src/rendering/vehicle-bodies/festival-face-lamps.ts';
import { festivalNoseZ } from '../src/rendering/vehicle-bodies/festival-nose.ts';
import { festivalFasciaOpenings } from '../src/rendering/vehicle-bodies/festival-detail.ts';

it('separates the upright headlamps from the grille and keeps active optics visible across all distances', () => {
  for (const id of ['rp6', 'rg63', 'rm8', 'rs5', 'rr4', 'lx12', 'rd2']) {
    const def = VEHICLES[id],
      s = bodySheetFor(def) as ClosedSheet;
    const m = new ClosedBodyModel(bodyFrame(def), s, [
      s.wheels.width[0] / 2,
      s.wheels.width[1] / 2,
    ]);
    const lamp = festivalFaceLamps(m),
      grille = festivalFasciaOpenings(m)[0];
    expect(lamp).toHaveLength(2);
    for (const pocket of lamp)
      expect(Math.abs(pocket.x) - pocket.width / 2 - grille.width / 2).toBeGreaterThan(0.03);
    const body = buildVehicleBody(0, def, s);
    for (const detail of [0, 1, 2] as const) {
      const root = body.lods[detail].group;
      root.updateMatrixWorld(true);
      for (const l of lamp) {
        const x =
          l.x +
          (s.lamps.front === 'twin'
            ? l.width * 0.202
            : s.lamps.front === 'slim'
              ? l.side * l.width * 0.71 * 0.25
              : 0);
        const y = l.y,
          z = festivalNoseZ(m, x, m.zFront);
        const ray = new T.Raycaster(
          new T.Vector3(x, y, z + 0.15),
          new T.Vector3(0, 0, -1),
          0,
          0.29,
        );
        if (detail < 2)
          expect(ray.intersectObject(root.getObjectByName('Sculpted front fascia')!)).toHaveLength(
            0,
          );
        const hits = ray.intersectObject(root, true);
        const lampHit = hits.find((h) => {
          const mat = (h.object as T.Mesh).material;
          return (Array.isArray(mat) ? mat[h.face!.materialIndex] : mat) === body.materials.head;
        });
        expect(lampHit, id + ' LOD ' + detail).toBeDefined();
        expect(lampHit!.face!.normal.z).toBeGreaterThan(0.6);
        if (detail < 2) {
          expect(lampHit!.point.z).toBeLessThan(z - 0.008);
          expect(
            hits.some(
              (h) =>
                (h.object as T.Mesh<T.BufferGeometry, T.Material>).material.userData
                  ?.vehicleLampLens,
            ),
          ).toBe(true);
        }
      }
    }
    body.root.traverse((n) => {
      if (n instanceof T.Mesh) n.geometry.dispose();
    });
  }
}, 120000);

it('shows individually forward-facing RP-6 roof projectors and a solid unlit housing from behind', () => {
  const def = VEHICLES.rp6,
    s = bodySheetFor(def) as ClosedSheet;
  const m = new ClosedBodyModel(bodyFrame(def), s, [s.wheels.width[0] / 2, s.wheels.width[1] / 2]);
  const gh = new Greenhouse(m),
    z = gh.zRF - 0.09;
  const y = gh.control(z)[3][1] + 0.093;
  const body = buildVehicleBody(0, def, s);
  for (const detail of [0, 1, 2] as const) {
    const group = body.lods[detail].group;
    group.updateMatrixWorld(true);
    const cells = detail === 2 ? 8 : 16;
    const pitch = (s.width * 0.58 - 0.078) / cells;
    const at = (x: number, forward: boolean) => {
      const ray = new T.Raycaster(
        new T.Vector3(x, y, z + (forward ? 0.19 : -0.19)),
        new T.Vector3(0, 0, forward ? -1 : 1),
        0,
        0.4,
      );
      const hit = ray.intersectObject(group, true)[0];
      expect(hit).toBeDefined();
      const mat = (hit.object as T.Mesh).material;
      return Array.isArray(mat) ? mat[hit.face!.materialIndex] : mat;
    };
    expect(at(pitch / 2, true)).toBe(body.materials.head);
    expect(at(0, true)).not.toBe(body.materials.head);
    expect(at(pitch / 2, false)).not.toBe(body.materials.head);
  }
}, 30000);
