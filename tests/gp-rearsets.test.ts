import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeModel, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import {
  GP_PEDAL_RADIUS,
  GP_REARSET_PEG,
  GPRearsets,
  gpRearsetHanger,
  gpRearsetPeg,
} from '../src/rendering/gp-rearsets.ts';
import {
  GP_BOOT_PEDAL,
  GP_BOOT_PEG,
  GP_FOOTPEG_RADIUS,
  gpBootFrame,
} from '../src/rendering/gp-rider-contact.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { meshColumnOverlap, meshColumnsFor } from './gp-mesh-clearance.ts';

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'measureText'
          ? () => ({ width: 10 })
          : key === 'createLinearGradient' || key === 'createRadialGradient'
            ? () => ({ addColorStop: () => undefined })
            : () => undefined,
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());

function meshes(root: T.Object3D) {
  const result: T.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof T.Mesh) result.push(object);
  });
  return result;
}
function pose(id: string, overrides: Partial<BikePoseValues> = {}): BikePoseValues {
  return {
    ...staticSag(VEHICLES[id]),
    steer: 0,
    frontRotation: 0,
    rearRotation: 0,
    chassisLean: 0,
    riderOffset: 0,
    tuck: 0.5,
    brake: 0,
    rearBrake: 0,
    discTemp: 180,
    compoundColour: 0xffffff,
    riding: true,
    ...overrides,
  };
}

describe('GP machined rearsets and independent rear-brake articulation', () => {
  it.each(['high', 'mid'] as const)(
    '%s has a real relieved hanger and retains the peg envelope',
    (detail) => {
      const material = new T.MeshBasicMaterial(),
        hanger = new T.Mesh(gpRearsetHanger(detail), material),
        peg = gpRearsetPeg(detail),
        ray = new T.Raycaster(new T.Vector3(-1, 0.033, 0.065), new T.Vector3(1, 0, 0));
      hanger.updateMatrixWorld(true);
      try {
        expect(ray.intersectObject(hanger)).toHaveLength(0);
        ray.ray.origin.set(-1, 0, 0);
        expect(ray.intersectObject(hanger).length).toBeGreaterThan(0);
        expect(peg.boundingBox!.min.x).toBeCloseTo(-0.04, 6);
        expect(peg.boundingBox!.max.x).toBeCloseTo(0.04, 6);
        expect(peg.boundingBox!.min.y).toBeCloseTo(-GP_FOOTPEG_RADIUS, 6);
        expect(peg.boundingBox!.max.y).toBeCloseTo(GP_FOOTPEG_RADIUS, 6);
        for (const geometry of [hanger.geometry, peg]) {
          const position = geometry.getAttribute('position'),
            normal = geometry.getAttribute('normal');
          for (let i = 0; i < position.count; i++) {
            expect(Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i))).toBe(
              true,
            );
            expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 4);
          }
        }
      } finally {
        hanger.geometry.dispose();
        peg.dispose();
        material.dispose();
      }
    },
  );

  it.each(['gpr1', 'gpr2'])(
    '%s keeps the physical toe spindle on the boot sole throughout pedal travel',
    (id) => {
      const materials = new BikeMaterials(0),
        model = new BikeModel(VEHICLES[id], 0, 'high', materials, true),
        pedal = model.root.getObjectByName('GP rear-brake pedal pivot')!,
        surface = model.root.getObjectByName('GP articulated rear-brake pedal') as T.Mesh,
        foot = model.root.getObjectByName('GP right foot')!,
        left = model.root.getObjectByName('GP left foot')!,
        frame = gpBootFrame(new T.Quaternion()),
        spindle = new T.Vector3()
          .fromArray(GP_BOOT_PEDAL)
          .sub(new T.Vector3().fromArray(GP_BOOT_PEG))
          .applyQuaternion(frame)
          .addScaledVector(new T.Vector3(0, 1, 0).applyQuaternion(frame), GP_PEDAL_RADIUS);
      spindle.x = -GP_REARSET_PEG[0] - pedal.position.x;
      const geometry = surface.geometry,
        positions = Array.from(geometry.getAttribute('position').array);
      try {
        let previousToeY = Infinity;
        for (const rearBrake of [0, 0.25, 0.5, 0.75, 1]) {
          model.pose(pose(id, { rearBrake, steer: 0.24, chassisLean: 0.8, riderOffset: 0.16 }));
          model.root.updateMatrixWorld(true);
          const sole = foot.localToWorld(new T.Vector3(...GP_BOOT_PEDAL)),
            centre = pedal.localToWorld(spindle.clone()),
            outward = new T.Vector3(0, 1, 0).transformDirection(foot.matrixWorld),
            contact = centre.clone().addScaledVector(outward, -GP_PEDAL_RADIUS),
            localSole = model.sprung.worldToLocal(sole.clone());
          expect(sole.distanceTo(contact)).toBeLessThan(1e-7);
          expect(localSole.y).toBeLessThan(previousToeY);
          previousToeY = localSole.y;
          const ray = new T.Raycaster(
            sole.clone().addScaledVector(outward, -0.015),
            outward.clone(),
          );
          const hit = ray.intersectObject(surface)[0];
          expect(hit).toBeDefined();
          expect(hit.point.distanceTo(sole)).toBeLessThan(0.0005);
          for (const [index, boot] of [left, foot].entries()) {
            const actual = model.sprung.worldToLocal(
                boot.localToWorld(new T.Vector3(...GP_BOOT_PEG)),
              ),
              wanted = model.rider.pegs[index].clone().add(new T.Vector3(0, GP_FOOTPEG_RADIUS, 0));
            expect(actual.distanceTo(wanted)).toBeLessThan(1e-7);
          }
        }
        model.pose(pose(id, { rearBrake: 0.6 }));
        model.root.updateMatrixWorld(true);
        const held = pedal.matrixWorld.elements.slice();
        model.pose(pose(id, { rearBrake: 0.6 }));
        model.root.updateMatrixWorld(true);
        expect(pedal.matrixWorld.elements).toEqual(held);
        model.pose(pose(id, { brake: 1, rearBrake: 0 }));
        expect(pedal.rotation.x).toBe(0);
        for (const invalid of [NaN, Infinity, -1]) {
          model.pose(pose(id, { rearBrake: invalid }));
          expect(pedal.rotation.x).toBe(0);
        }
        expect(surface.geometry).toBe(geometry);
        expect(Array.from(geometry.getAttribute('position').array)).toEqual(positions);
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );

  it.each(['gpr1', 'gpr2'])(
    '%s keeps the hangers and heel guards out of the planted boots',
    (id) => {
      const materials = new BikeMaterials(0),
        model = new BikeModel(VEHICLES[id], 0, 'high', materials, true),
        rearsets = new GPRearsets('high', materials),
        fixed = meshes(rearsets.root).filter((mesh) => /hanger|heel guard/.test(mesh.name));
      model.sprung.add(rearsets.root);
      try {
        for (const lean of [-0.95, 0, 0.95])
          for (const rearBrake of [0, 1]) {
            model.pose(
              pose(id, {
                chassisLean: lean,
                riderOffset: lean * 0.18,
                rearBrake,
                fork: rearBrake ? VEHICLES[id].bike!.forkTravel : 0,
                shock: rearBrake ? 0 : VEHICLES[id].bike!.shockTravel,
              }),
            );
            rearsets.update(rearBrake);
            model.root.updateMatrixWorld(true);
            for (const label of ['left', 'right']) {
              const foot = meshes(model.root.getObjectByName(`GP ${label} foot`)!);
              const overlap = meshColumnOverlap(foot, fixed, meshColumnsFor(foot, 0.003));
              expect(overlap.firstColumns).toBeGreaterThan(100);
              expect(
                overlap.maximumOverlap,
                JSON.stringify({ id, lean, rearBrake, label, ...overlap }),
              ).toBeLessThan(0.001);
            }
          }
      } finally {
        rearsets.root.removeFromParent();
        meshes(rearsets.root).forEach((mesh) => mesh.geometry.dispose());
        model.dispose();
        materials.dispose();
      }
    },
    30000,
  );

  it('uses existing shared finishes and limits new articulation to the close GP prototypes', () => {
    for (const [id, detail] of [
      ['gpr1', 'high'],
      ['gpr2', 'mid'],
      ['gpr1', 'far'],
      ['sbk1000', 'high'],
    ] as const) {
      const materials = new BikeMaterials(0),
        model = new BikeModel(VEHICLES[id], 0, detail, materials, true);
      try {
        const pedal = model.root.getObjectByName('GP rear-brake pedal pivot');
        expect(Boolean(pedal)).toBe(id === 'gpr1' && detail === 'high');
        if (pedal) {
          expect(meshes(pedal)).toHaveLength(1);
          expect(meshes(pedal)[0].material).toBe(materials.aluminium);
        }
        const kit = new GPRearsets(detail, materials);
        const kitMeshes = meshes(kit.root);
        expect(new Set(kitMeshes.map((mesh) => mesh.material))).toEqual(
          new Set(
            detail === 'far'
              ? [materials.aluminium]
              : [materials.aluminium, materials.steel, materials.carbon],
          ),
        );
        const triangles = kitMeshes.reduce(
          (total, mesh) =>
            total +
            (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3,
          0,
        );
        expect(triangles).toBeLessThan(detail === 'high' ? 5000 : detail === 'mid' ? 2500 : 500);
        kitMeshes.forEach((mesh) => mesh.geometry.dispose());
      } finally {
        model.dispose();
        materials.dispose();
      }
    }
  });
});
