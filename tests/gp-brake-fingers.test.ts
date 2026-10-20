import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeModel, staticSag } from '../src/rendering/bike.ts';
import { GpBrakeFingers } from '../src/rendering/gp-brake-fingers.ts';
import { gpFrontBrakeGeometry } from '../src/rendering/gp-front-brake.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { GP_GLOVE_GRIP } from '../src/rendering/gp-rider-contact.ts';

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'createLinearGradient' || key === 'createRadialGradient'
          ? () => ({ addColorStop() {} })
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

function input(id: string, brake = 0, steer = 0) {
  return {
    ...staticSag(VEHICLES[id]),
    steer,
    frontRotation: 0,
    rearRotation: 0,
    chassisLean: 0.7,
    riderOffset: 0.15,
    tuck: 0.7,
    brake,
    rearBrake: 0,
    discTemp: 300,
    compoundColour: 0xffffff,
    riding: true,
    speed: 45,
  };
}

describe('GP control fingers solve the actual moving blade', () => {
  it('preserves bone lengths at coincident and vertical IK targets', () => {
    const parent = new T.Group(),
      material = new T.MeshStandardMaterial(),
      fingers = new GpBrakeFingers(parent, material),
      grip = new T.Vector3(),
      frame = new T.Quaternion();
    try {
      for (const offset of [
        new T.Vector3(),
        new T.Vector3(0, 0.04, 0),
        new T.Vector3(0, -0.04, 0),
      ]) {
        fingers.update(0);
        const contacts = fingers.joints.map((j, i) =>
          j[0]
            .clone()
            .add(offset)
            .addScaledVector(new T.Vector3(0, -0.8, 0.6), i ? 0.019 : 0.018)
            .sub(new T.Vector3(...GP_GLOVE_GRIP)),
        ) as [T.Vector3, T.Vector3];
        fingers.update(1, contacts, grip, frame);
        for (const [i, joints] of fingers.joints.entries()) {
          const lengths = i ? [0.036, 0.027, 0.019] : [0.034, 0.025, 0.018];
          for (let part = 0; part < 3; part++)
            expect(joints[part].distanceTo(joints[part + 1])).toBeCloseTo(lengths[part], 7);
        }
      }
    } finally {
      fingers.dispose();
      fingers.mesh.geometry.dispose();
      material.dispose();
    }
  });
  it.each(['gpr1', 'gpr2'])(
    '%s keeps fixed phalanx lengths and fingertip contact across steering/braking',
    (id) => {
      const materials = new BikeMaterials(0),
        model = new BikeModel(VEHICLES[id], 0, 'high', materials, true);
      try {
        const mesh = model.root.getObjectByName(
          'GP continuous brake-finger leather',
        ) as T.SkinnedMesh;
        expect(mesh).toBeInstanceOf(T.SkinnedMesh);
        const positions = mesh.geometry.getAttribute('position') as T.BufferAttribute,
          original = Array.from(positions.array),
          version = positions.version,
          target = new T.Vector3();
        let largestError = 0;
        for (const steer of [-0.35, 0, 0.35])
          for (const brake of [0.08, 0.25, 0.5, 0.75, 1]) {
            model.pose(input(id, brake, steer));
            model.root.updateMatrixWorld(true);
            for (let finger = 0; finger < 2; finger++) {
              const [a, b, c] = finger === 0 ? [0.034, 0.025, 0.018] : [0.036, 0.027, 0.019],
                bones = mesh.skeleton.bones,
                p0 = bones[finger * 5].getWorldPosition(new T.Vector3()),
                p1 = bones[finger * 5 + 2].getWorldPosition(new T.Vector3()),
                p2 = bones[finger * 5 + 4].getWorldPosition(new T.Vector3()),
                tip = bones[finger * 5 + 4].localToWorld(new T.Vector3(0, 0, c));
              expect(p0.distanceTo(p1)).toBeCloseTo(a, 6);
              expect(p1.distanceTo(p2)).toBeCloseTo(b, 6);
              expect(p2.distanceTo(tip)).toBeCloseTo(c, 6);
              model.rider.root.localToWorld(target.copy(model.rider.brakeFingerTargets![finger]));
              largestError = Math.max(largestError, tip.distanceTo(target));
            }
          }
        expect(largestError, 'fingertip centre must meet the real blade pad target').toBeLessThan(
          0.001,
        );
        expect(positions.version).toBe(version);
        expect(Array.from(positions.array)).toEqual(original);
        expect(mesh.skeleton.bones).toHaveLength(10);
        expect(mesh.geometry.index!.count / 3).toBeLessThan(800);
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );

  it('holds and restores exact skin frames, leaves the other fingers planted, and ignores rear braking', () => {
    const materials = new BikeMaterials(0),
      model = new BikeModel(VEHICLES.gpr1, 0, 'high', materials, true);
    try {
      const hand = model.root.getObjectByName('GP right hand')!,
        mesh = model.root.getObjectByName('GP continuous brake-finger leather') as T.SkinnedMesh,
        state = () => {
          model.root.updateMatrixWorld(true);
          return mesh.skeleton.bones.map((b) => b.matrixWorld.toArray());
        };
      model.pose(input('gpr1'));
      const released = state();
      const gripMatrices = hand.children
        .filter((o) => o.name !== 'GP right brake fingers')
        .map((o) => o.matrix.toArray());
      model.pose(input('gpr1', 1));
      const squeezed = state();
      expect(squeezed).not.toEqual(released);
      model.pose(input('gpr1', 1));
      expect(state()).toEqual(squeezed);
      expect(
        hand.children
          .filter((o) => o.name !== 'GP right brake fingers')
          .map((o) => o.matrix.toArray()),
      ).toEqual(gripMatrices);
      model.pose(input('gpr1', 0.32, -0.28));
      state();
      model.pose(input('gpr1', 1));
      expect(state()).toEqual(squeezed);
      model.pose({ ...input('gpr1'), rearBrake: 1 });
      expect(state()).toEqual(released);
    } finally {
      model.dispose();
      materials.dispose();
    }
  });

  it('uses finite normalized skinning, keeps a safe fallback, and releases its skeleton', () => {
    const parent = new T.Group(),
      material = new T.MeshStandardMaterial(),
      fingers = new GpBrakeFingers(parent, material);
    try {
      const geometry = fingers.mesh.geometry,
        weights = geometry.getAttribute('skinWeight');
      for (const attribute of Object.values(geometry.attributes))
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      for (let i = 0; i < weights.count; i++)
        expect(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)).toBeCloseTo(
          1,
          6,
        );
      for (const input of [NaN, Infinity, -1, 2, 0]) {
        fingers.update(input);
        parent.updateMatrixWorld(true);
        expect(
          fingers.joints.flatMap((j) => j.flatMap((v) => v.toArray())).every(Number.isFinite),
        ).toBe(true);
      }
      const dispose = vi.spyOn(fingers.mesh.skeleton, 'dispose');
      fingers.dispose();
      expect(dispose).toHaveBeenCalledOnce();
    } finally {
      fingers.mesh.geometry.dispose();
      material.dispose();
    }
  });

  it('closes the swept blade without degenerate or inward faces', () => {
    const geometry = gpFrontBrakeGeometry();
    try {
      const p = geometry.getAttribute('position'),
        n = geometry.getAttribute('normal'),
        index = geometry.index!;
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i),
          b = index.getX(i + 1),
          c = index.getX(i + 2),
          face = new T.Vector3()
            .fromBufferAttribute(p, b)
            .sub(new T.Vector3().fromBufferAttribute(p, a))
            .cross(
              new T.Vector3()
                .fromBufferAttribute(p, c)
                .sub(new T.Vector3().fromBufferAttribute(p, a)),
            );
        expect(face.lengthSq()).toBeGreaterThan(1e-16);
        expect(face.dot(new T.Vector3().fromBufferAttribute(n, a))).toBeGreaterThan(0);
      }
    } finally {
      geometry.dispose();
    }
  });
});
