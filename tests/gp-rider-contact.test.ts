import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeModel, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import {
  GP_BOOT_ANKLE,
  GP_BOOT_PEG,
  GP_FOOTPEG_RADIUS,
  GP_GLOVE_GRIP,
  GP_GLOVE_WRIST,
} from '../src/rendering/gp-rider-contact.ts';
import { RIDER } from '../src/rendering/rider.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'createLinearGradient' || key === 'createRadialGradient'
          ? () => ({ addColorStop: () => undefined })
          : key === 'measureText'
            ? () => ({ width: 10 })
            : () => undefined,
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());

function pose(id: string, value: Partial<BikePoseValues> = {}): BikePoseValues {
  const sag = staticSag(VEHICLES[id]);
  return {
    fork: sag.fork,
    shock: sag.shock,
    steer: 0,
    frontRotation: 0,
    rearRotation: 0,
    chassisLean: 0,
    riderOffset: 0,
    tuck: 0.75,
    brake: 0.05,
    rearBrake: 0,
    discTemp: 280,
    compoundColour: 0xffffff,
    riding: true,
    ...value,
  };
}

function inventory(root: T.Object3D) {
  const meshes: string[] = [],
    geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    meshes.push(object.uuid);
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      materials.add(material);
    triangles +=
      ((object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3) *
      (object instanceof T.InstancedMesh ? object.count : 1);
  });
  return { meshes, geometries, materials, triangles };
}

function matrices(root: T.Object3D) {
  root.updateMatrixWorld(true);
  const result: number[][] = [];
  root.traverse((object) => result.push([...object.matrixWorld.elements]));
  return result;
}

describe('GP rider contact pose on the actual production machine', () => {
  it.each(
    ['gpr1', 'gpr2'].flatMap((id) =>
      (['high', 'mid', 'far'] as const).map((detail) => ({ id, detail })),
    ),
  )(
    '$id $detail retains grip, forefoot and cuff contact through the riding envelope',
    ({ id, detail }) => {
      const materials = new BikeMaterials(0),
        bike = new BikeModel(VEHICLES[id], 0, detail, materials, true),
        rider = bike.rider;
      const original = inventory(bike.root);
      try {
        for (const lean of [-1.05, 0, 1.05])
          for (const tuck of [0, 1])
            for (const brake of [0, 1]) {
              const value = Object.freeze(
                pose(id, {
                  chassisLean: lean,
                  riderOffset: lean * 0.2,
                  steer: lean * 0.3,
                  tuck,
                  brake,
                  fork: 0.025 + brake * 0.075,
                  shock: 0.05 - brake * 0.025,
                }),
              );
              bike.pose(value);
              bike.root.updateMatrixWorld(true);
              const intoRider = rider.root.matrixWorld.clone().invert();
              const point = (object: T.Object3D, local: readonly [number, number, number]) =>
                object.localToWorld(new T.Vector3(...local)).applyMatrix4(intoRider);
              const axis = (object: T.Object3D, local: readonly [number, number, number]) =>
                new T.Vector3(...local)
                  .transformDirection(object.matrixWorld)
                  .transformDirection(intoRider);
              for (const [i, label] of ['left', 'right'].entries()) {
                const hand = rider.root.getObjectByName(`GP ${label} hand`)!,
                  foot = rider.root.getObjectByName(`GP ${label} foot`)!,
                  cuff = foot.getObjectByName('GP ankle-hinged boot cuff')!,
                  arm = rider.root.getObjectByName(`GP ${label} upper arm`)!,
                  forearm = rider.root.getObjectByName(`GP ${label} forearm`)!,
                  thigh = rider.root.getObjectByName(`GP ${label} thigh`)!,
                  shin = rider.root.getObjectByName(`GP ${label} shin`)!;
                expect(point(hand, GP_GLOVE_GRIP).distanceTo(rider.grips[i])).toBeLessThan(1e-7);
                expect(axis(hand, [1, 0, 0]).dot(rider.gripAxes[i])).toBeCloseTo(1, 10);
                expect(axis(hand, [0, 1, 0]).y).toBeGreaterThan(0.9);
                const torso = rider.root.getObjectByName('Rider torso')!,
                  nominalShoulder = point(torso, [
                    i === 0 ? RIDER.shoulderWidth : -RIDER.shoulderWidth,
                    RIDER.spine - 0.04,
                    0,
                  ]);
                expect(point(arm, [0, 0, 0]).distanceTo(nominalShoulder)).toBeLessThan(0.05);

                const pegTop = rider.pegs[i].clone();
                pegTop.y += GP_FOOTPEG_RADIUS;
                expect(point(foot, GP_BOOT_PEG).distanceTo(pegTop)).toBeLessThan(1e-7);
                expect(axis(foot, [0, 0, 1]).z).toBeGreaterThan(0.97);
                expect(axis(foot, [0, 1, 0]).y).toBeLessThan(-0.97);
                expect(axis(cuff, [0, 1, 0]).dot(axis(shin, [0, 1, 0]))).toBeCloseTo(1, 10);
                expect(point(cuff, [0, 0, 0]).distanceTo(point(foot, GP_BOOT_ANKLE))).toBeLessThan(
                  1e-7,
                );

                // Check anatomical segment lengths against the actual rendered
                // joint landmarks. Pinning a detached glove to the bar cannot pass.
                expect(point(arm, [0, 0, 0]).distanceTo(point(forearm, [0, 0, 0]))).toBeCloseTo(
                  RIDER.upperArm,
                  8,
                );
                expect(
                  point(forearm, [0, 0, 0]).distanceTo(point(hand, GP_GLOVE_WRIST)),
                ).toBeCloseTo(RIDER.forearm, 8);
                expect(point(thigh, [0, 0, 0]).distanceTo(point(shin, [0, 0, 0]))).toBeCloseTo(
                  RIDER.thigh,
                  8,
                );
                expect(point(shin, [0, 0, 0]).distanceTo(point(foot, GP_BOOT_ANKLE))).toBeCloseTo(
                  RIDER.shin,
                  8,
                );

                // Intersect the existing sole from beneath the physical peg top.
                // This checks real mesh contact, not just matching helper landmarks.
                const worldPeg = rider.root.localToWorld(pegTop.clone()),
                  up = new T.Vector3(0, 1, 0).transformDirection(rider.root.matrixWorld),
                  ray = new T.Raycaster(worldPeg.clone().addScaledVector(up, -0.04), up);
                const intersections = ray.intersectObject(foot, true);
                expect(intersections.length).toBeGreaterThan(0);
                expect(intersections[0].point.distanceTo(worldPeg)).toBeLessThan(0.003);
              }
              expect(matrices(bike.root).flat().every(Number.isFinite)).toBe(true);
            }
        const final = inventory(bike.root);
        expect(final).toEqual(original);
        expect(final.triangles).toBeLessThan(110000);
      } finally {
        bike.dispose();
        materials.dispose();
      }
    },
  );

  it('restores exact held, steered and recovery transforms without allocating render resources', () => {
    const materials = new BikeMaterials(0),
      bike = new BikeModel(VEHICLES.gpr1, 0, 'high', materials, true);
    try {
      const initial = inventory(bike.root),
        a = pose('gpr1'),
        b = pose('gpr1', {
          chassisLean: -0.95,
          riderOffset: -0.19,
          steer: -0.25,
          tuck: 0.3,
          brake: 0.8,
        });
      bike.pose(a);
      const first = matrices(bike.root);
      bike.pose(a);
      expect(matrices(bike.root)).toEqual(first);
      bike.pose(b);
      expect(matrices(bike.root)).not.toEqual(first);
      bike.pose(a);
      expect(matrices(bike.root)).toEqual(first);
      for (const phase of [0, 1, 2]) {
        bike.rider.separated(phase, 0.6, 3);
        const recovery = matrices(bike.rider.root);
        const torso = bike.rider.root.getObjectByName('Rider torso')!,
          intoTorso = torso.matrixWorld.clone().invert();
        for (const label of ['left', 'right']) {
          const foot = bike.rider.root.getObjectByName(`GP ${label} foot`)!,
            shin = bike.rider.root.getObjectByName(`GP ${label} shin`)!,
            cuff = foot.getObjectByName('GP ankle-hinged boot cuff')!,
            ankle = foot.localToWorld(new T.Vector3(...GP_BOOT_ANKLE)),
            endpoint = shin.localToWorld(new T.Vector3(0, RIDER.shin, 0)),
            cuffAxis = new T.Vector3(0, 1, 0).transformDirection(cuff.matrixWorld),
            shinAxis = new T.Vector3(0, 1, 0).transformDirection(shin.matrixWorld);
          expect(ankle.distanceTo(endpoint)).toBeLessThan(1e-7);
          expect(cuff.getWorldPosition(new T.Vector3()).distanceTo(ankle)).toBeLessThan(1e-7);
          expect(cuffAxis.dot(shinAxis)).toBeCloseTo(1, 10);
          const toe = new T.Vector3(0, 0, 1)
              .transformDirection(foot.matrixWorld)
              .transformDirection(intoTorso),
            sole = new T.Vector3(0, 1, 0)
              .transformDirection(foot.matrixWorld)
              .transformDirection(intoTorso);
          expect(toe.z).toBeGreaterThan(0.97);
          expect(sole.y).toBeLessThan(-0.97);
        }
        bike.pose(b);
        bike.rider.separated(phase, 0.6, 3);
        expect(matrices(bike.rider.root)).toEqual(recovery);
        bike.pose(a);
        expect(matrices(bike.root)).toEqual(first);
      }
      expect(inventory(bike.root)).toEqual(initial);
    } finally {
      bike.dispose();
      materials.dispose();
    }
  });
});
