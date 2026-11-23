import * as T from 'three';
import { expect, it } from 'vitest';
import { DEFAULT_LIVERY } from '../src/storage/livery.ts';
import { bodyLook } from '../src/rendering/vehicle-bodies/colourways.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { carBase, R, RACE_BASE } from '../src/simulation/protocol.ts';
import { bodySheetFor } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { buildVehicleBody, VehicleBodies } from '../src/rendering/vehicle-bodies/index.ts';
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

it('binds each feeder car’s actual paint to the venue probe and releases it on a replay cut', () => {
  const bodies = new VehicleBodies();
  const world = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  const frame = world.makeFrame(),
    slot = { root: new T.Group(), lodLevel: 0 };
  const pose = (id: string) => {
    frame[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex(id);
    bodies.update(frame, frame, 1, [slot], false);
    return bodies.formulaProbeFor(0);
  };
  try {
    const first = pose('fx26')!;
    expect(first.root.parent).toBe(bodies.root);
    expect([first.materials.paint, first.materials.accent]).toMatchObject([
      { isMeshPhysicalMaterial: true },
      { isMeshPhysicalMaterial: true },
    ]);
    const next = pose('fr3')!;
    expect(next.root).not.toBe(first.root);
    expect(next.materials.paint).not.toBe(first.materials.paint);
    expect(pose('apx01')).toBeNull();
    expect(pose('jf2')!.root.visible).toBe(true);
    expect(pose('tc1')).toBeNull();
  } finally {
    bodies.clear();
  }
});
