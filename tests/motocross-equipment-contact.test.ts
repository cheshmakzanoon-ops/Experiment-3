import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { inspectMotocrossRiderContacts } from '../e2e/fixtures/motocross-rider-contact-contract.ts';

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());

function pose(model: DirtBikeModel, changes: Partial<BikePoseValues> = {}): BikePoseValues {
  const sag = staticSag(model.definition);
  return {
    fork: sag.fork,
    shock: sag.shock,
    steer: 0,
    frontRotation: 0,
    rearRotation: 0,
    chassisLean: 0,
    riderOffset: 0,
    tuck: 0,
    brake: 0,
    rearBrake: 0,
    discTemp: 0,
    compoundColour: 0xffffff,
    riding: true,
    ...changes,
  };
}

describe('motocross equipment contact and continuous ankle articulation', () => {
  for (const id of ['mx250', 'mx450'])
    it.each(['high', 'mid', 'far'] as const)(
      `${id} %s keeps real soles, wrists and calves attached in both camera presentations`,
      (detail) => {
        const material = new BikeMaterials(0),
          model = new DirtBikeModel(VEHICLES[id], 0, detail, material, mudUniforms());
        model.root.position.set(307, 2.4, -118);
        model.root.rotation.set(0.3, 1.14, -0.43);
        try {
          for (const sample of [
            { standing: 0, body: 0, steer: 0, dab: 0 },
            { standing: 1, body: -1, steer: -0.42, dab: 0 },
            {
              standing: 1,
              body: 1,
              steer: 0.42,
              dab: 0,
              fork: model.definition.bike!.forkTravel,
              shock: model.definition.bike!.shockTravel,
            },
            { standing: 0, body: 0.5, steer: 0.24, dab: 1 },
            { standing: 0.4, body: -0.5, steer: -0.24, dab: -1 },
          ]) {
            model.pose(pose(model, sample));
            for (const onboard of [false, true, false]) {
              model.rider.setFirstPerson(onboard, true);
              const contacts = inspectMotocrossRiderContacts(model, sample.dab),
                context = JSON.stringify({ id, detail, sample, onboard, contacts });
              for (const contact of contacts) {
                expect(contact.handError, context).toBeLessThan(1e-6);
                expect(contact.wristJointError, context).toBeLessThan(1e-6);
                expect(contact.ankleJointError, context).toBeLessThan(1e-6);
                expect(contact.soleContactFound, context).toBe(true);
                expect(contact.ankleError, context).toBeLessThan(0.009);
                expect(contact.calfSamples, context).toBeGreaterThan(10);
                expect(contact.calfAttachmentError, context).toBeLessThan(1e-6);
                expect(contact.skinMeshes).toBe(detail === 'far' ? 2 : 3);
              }
              // The palm's transverse axis must follow the real steered grip,
              // not the changing forearm frame, in exterior and cockpit views.
              const expected = new T.Vector3(1, 0, 0).transformDirection(
                model.onboardControls.matrixWorld,
              );
              for (const side of ['left', 'right']) {
                const hand = model.rider.root.getObjectByName(`Motocross ${side} hand`)!;
                const axis = new T.Vector3(1, 0, 0).transformDirection(hand.matrixWorld);
                expect(axis.dot(expected), context).toBeGreaterThan(1 - 1e-9);
              }
            }
          }
          // Negative control: moving only the rendered boot must fail even
          // though the simulation peg and all assigned IK targets are unchanged.
          const boot = model.rider.root.getObjectByName('Motocross right boot')!;
          boot.position.y += 0.08;
          const displaced = inspectMotocrossRiderContacts(model, -1)[1];
          expect(displaced.ankleJointError).toBeGreaterThan(0.075);
          expect(displaced.ankleError).toBeGreaterThan(0.03);
        } finally {
          model.dispose();
          material.dispose();
        }
      },
    );

  it('replays identical skinned geometry after riding, camera switches and recovery without reallocating buffers', () => {
    const material = new BikeMaterials(0),
      model = new DirtBikeModel(VEHICLES.mx450, 0, 'mid', material, mudUniforms()),
      bootMeshes: T.SkinnedMesh[] = [];
    for (const side of ['left', 'right'])
      model.rider.root.getObjectByName(`Motocross ${side} boot`)!.traverse((object) => {
        if (object instanceof T.SkinnedMesh) bootMeshes.push(object);
      });
    const buffers = bootMeshes.map((skin) => skin.geometry.getAttribute('position').array),
      skeletons = new Set(bootMeshes.map((skin) => skin.skeleton));
    let disposed = 0;
    for (const skeleton of skeletons) {
      skeleton.computeBoneTexture();
      skeleton.boneTexture!.addEventListener('dispose', () => disposed++);
    }
    const sample = () => {
      model.root.updateMatrixWorld(true);
      const point = new T.Vector3();
      return bootMeshes.flatMap((skin) => {
        const vertices: number[] = [];
        for (let i = 0; i < skin.geometry.getAttribute('position').count; i += 13) {
          skin.getVertexPosition(i, point).applyMatrix4(skin.matrixWorld);
          vertices.push(...point.toArray());
        }
        return vertices;
      });
    };
    const handTransforms = () =>
      ['left', 'right'].flatMap((side) => {
        const hand = model.rider.root.getObjectByName(`Motocross ${side} hand`)!;
        return [...hand.position.toArray(), ...hand.quaternion.toArray()];
      });
    try {
      const original = pose(model, { standing: 1, body: -0.7, steer: 0.3, brake: 0.9 });
      model.pose(original);
      const before = sample();
      model.pose(pose(model, { standing: 0, body: 1, steer: -0.3, dab: 1 }));
      model.rider.setFirstPerson(true, true);
      model.rider.separated(1, 0, 0.53);
      const recoveryHands = handTransforms(),
        recoveryBoots = sample();
      model.rider.setFirstPerson(false, true);
      expect(handTransforms()).toEqual(recoveryHands);
      expect(sample()).toEqual(recoveryBoots);
      model.rider.setFirstPerson(true, true);
      model.rider.setFirstPerson(false, true);
      expect(handTransforms()).toEqual(recoveryHands);
      model.pose(original);
      expect(sample()).toEqual(before);
      for (let i = 0; i < bootMeshes.length; i++)
        expect(bootMeshes[i].geometry.getAttribute('position').array).toBe(buffers[i]);
      expect(skeletons.size).toBe(2);
    } finally {
      model.dispose();
      material.dispose();
    }
    expect(disposed).toBe(2);
  });
});
