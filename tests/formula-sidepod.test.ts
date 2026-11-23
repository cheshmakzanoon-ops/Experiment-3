import * as T from 'three';
import { expect, it } from 'vitest';
import { DEFAULT_LIVERY } from '../src/storage/livery.ts';
import { bodyLook } from '../src/rendering/vehicle-bodies/colourways.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { bodySheetFor } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { buildVehicleBody } from '../src/rendering/vehicle-bodies/index.ts';
import { sharedMaterials } from '../src/rendering/vehicle-bodies/materials.ts';

it.each(['fr3', 'fx26', 'jf2'])(
  'opens both %s cooling ducts to oncoming air at all distances',
  (id) => {
    const def = VEHICLES[id];
    const sheet = bodySheetFor(def)!;
    if (sheet.kind !== 'open-wheel') throw Error('Expected an open-wheel car');
    const car = buildVehicleBody(0, def, sheet);
    expect(car.materials.board.userData.formulaNumber).toBe(true);
    for (const [level, lod] of car.lods.entries()) {
      lod.group.updateWorldMatrix(true, true);
      const noseBoard = lod.group.children.find(
        (m) => m instanceof T.Mesh && m.material === car.materials.board,
      );
      expect(!!noseBoard).toBe(level < 2);
      for (const side of [-1, 1]) {
        const eye = new T.Vector3(
          side * (sheet.sidepod + 0.246) * 0.5,
          car.frame.y(0.332),
          car.frame.frontAxle - 0.53,
        );
        const ray = new T.Raycaster(eye, new T.Vector3(0, 0, -1), 0, 0.43);
        const hit = ray.intersectObject(lod.group)[0];
        expect(hit?.object).toBeInstanceOf(T.Mesh);
        expect((hit.object as T.Mesh).material).toBe(sharedMaterials.grille());
        expect(hit.face!.normal.z).toBeGreaterThan(0.91);
        expect(hit.distance).toBeGreaterThan(0.24);
      }
    }
  },
);

it.each(['fr3', 'fx26', 'jf2'])(
  'changes the %s entrant number without changing factory paint or a rival',
  (id) => {
    const sheet = bodySheetFor(VEHICLES[id])!;
    const factory = bodyLook(id, 0, sheet);
    const entry = { ...DEFAULT_LIVERY, number: 27 };
    expect(bodyLook(id, 0, sheet, DEFAULT_LIVERY)).toEqual({
      ...factory,
      number: DEFAULT_LIVERY.number,
    });
    expect(bodyLook(id, 0, sheet, entry)).toEqual({ ...factory, number: 27 });
    expect(bodyLook(id, 3, sheet, entry)).toEqual(bodyLook(id, 3, sheet));
  },
);
