import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { bodySheetFor, type ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { ClosedBodyModel, Greenhouse } from '../src/rendering/vehicle-bodies/closed-body.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';
import { buildVehicleBody } from '../src/rendering/vehicle-bodies/index.ts';
import { loftRings } from '../src/rendering/vehicle-bodies/loft.ts';
import {
  FESTIVAL_GLAZING,
  recessFestivalGlazing,
} from '../src/rendering/vehicle-bodies/festival-detail.ts';

function paneFor(id: string, detail: 0 | 1) {
  const def = VEHICLES[id],
    sheet = bodySheetFor(def) as ClosedSheet,
    model = new ClosedBodyModel(bodyFrame(def), sheet, [
      sheet.wheels.width[0] / 2,
      sheet.wheels.width[1] / 2,
    ]),
    house = new Greenhouse(model);
  const pane = loftRings(house.rings(detail), { closed: false, material: house.material(detail) });
  pane.groups = pane.groups.filter((group) => group.materialIndex === 1);
  return pane;
}

describe('Festival bonded glazing', () => {
  it('recesses every used pane vertex while retaining the original body surface and normals', () => {
    for (const id of ['rh3', 'eh3', 'rs5', 'sc7', 'rp6', 'hy9', 'gt10m'])
      for (const detail of [0, 1] as const) {
        const pane = paneFor(id, detail),
          original = pane.getAttribute('position'),
          retained = original.array.slice(),
          normal = pane.getAttribute('normal'),
          originalNormals = normal.array.slice(),
          result = recessFestivalGlazing(pane),
          moved = pane.getAttribute('position'),
          used = new Set<number>();
        try {
          for (const group of pane.groups)
            for (let i = group.start; i < group.start + group.count; i++)
              used.add(pane.index!.getX(i));
          expect(moved, `${id} LOD${detail} position ownership`).not.toBe(original);
          expect(original.array, `${id} opaque shell remains fixed`).toEqual(retained);
          expect(normal.array, `${id} reflective surface normals`).toEqual(originalNormals);
          for (const vertex of used) {
            const displacement = new T.Vector3()
              .fromBufferAttribute(original, vertex)
              .sub(new T.Vector3().fromBufferAttribute(moved, vertex));
            expect(displacement.length(), `${id} pane recess`).toBeCloseTo(
              FESTIVAL_GLAZING.recessM,
              6,
            );
            expect(
              displacement.dot(new T.Vector3().fromBufferAttribute(normal, vertex)),
            ).toBeCloseTo(FESTIVAL_GLAZING.recessM, 6);
          }
          let addedTriangles = 0;
          for (const geometry of [result.rubber, result.frit]) {
            for (const name of ['position', 'normal'])
              expect(
                [...geometry.getAttribute(name).array].every(Number.isFinite),
                `${id} LOD${detail} ${name}`,
              ).toBe(true);
            addedTriangles += geometry.index!.count / 3;
          }
          // Two simple indexed bands, bounded well below another body LOD.
          expect(addedTriangles).toBeGreaterThan(0);
          expect(addedTriangles).toBeLessThan(2500);
        } finally {
          pane.dispose();
          result.rubber.dispose();
          result.frit.dispose();
        }
      }
  });

  it('closes a curved pane edge without painting across its central sightline', () => {
    const pane = new T.PlaneGeometry(1.2, 0.6, 18, 10),
      p = pane.getAttribute('position');
    for (let i = 0; i < p.count; i++)
      p.setZ(i, 0.09 * (p.getX(i) / 0.6) ** 2 + 0.025 * (p.getY(i) / 0.3) ** 2);
    pane.computeVertexNormals();
    pane.addGroup(0, pane.index!.count, 1);
    const { rubber, frit } = recessFestivalGlazing(pane),
      material = new T.MeshBasicMaterial({ side: T.DoubleSide }),
      bands = new T.Group(),
      glass = new T.Mesh(pane, [material, material]);
    bands.add(new T.Mesh(rubber, material), new T.Mesh(frit, material));
    const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, 0, -1));
    try {
      for (const x of [-0.4, 0, 0.4]) {
        ray.ray.origin.set(x, 0, 1);
        expect(ray.intersectObject(bands, true), 'clear interior view').toHaveLength(0);
        expect(ray.intersectObject(glass, false).length, 'recessed glass remains').toBeGreaterThan(
          0,
        );
        for (const side of [-1, 1]) {
          ray.ray.origin.set(x, side * 0.297, 1);
          expect(
            ray.intersectObject(bands, true).length,
            'continuous rubber reveal',
          ).toBeGreaterThan(0);
          ray.ray.origin.set(x, side * 0.289, 1);
          const fritHit = ray.intersectObject(bands.children[1], false)[0],
            glassHit = ray.intersectObject(glass, false)[0];
          expect(fritHit, 'bonded frit edge').toBeDefined();
          expect(glassHit.distance, 'glass reflections remain in front of ceramic').toBeLessThan(
            fritHit.distance,
          );
        }
      }
      ray.ray.origin.set(0, 0, 1);
      expect(ray.intersectObject(glass, false)[0].point.z).toBeCloseTo(
        -FESTIVAL_GLAZING.recessM,
        5,
      );
    } finally {
      pane.dispose();
      rubber.dispose();
      frit.dispose();
      material.dispose();
    }
  });

  it('uses detached glass only on Festival near/mid bodies and retains the existing material roles', () => {
    for (const id of ['rh3', 'sc7', 'rl2']) {
      const body = buildVehicleBody(0, VEHICLES[id], bodySheetFor(VEHICLES[id])!);
      for (const detail of [0, 1, 2] as const) {
        const root = body.lods[detail].group,
          glass = root.getObjectByName('Cabin glass') as T.Mesh,
          opaque = root.getObjectByName('Greenhouse') as T.Mesh,
          improved = id !== 'rl2' && detail < 2;
        expect(!!glass.geometry.userData.festivalGlazing).toBe(improved);
        expect(
          glass.geometry.getAttribute('position') === opaque.geometry.getAttribute('position'),
        ).toBe(!improved);
        const materials = new Set<T.Material>();
        root.traverse((node) => {
          if (node instanceof T.Mesh)
            for (const material of Array.isArray(node.material) ? node.material : [node.material])
              if (material.name.startsWith('Festival ')) materials.add(material);
        });
        expect(materials.size).toBe(improved ? 3 : 0);
      }
    }
  });
});
