import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, type BikePoseValues } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());

describe('motocross fore/aft weight-shift contact', () => {
  it.each(['mx250', 'mx450'])(
    '%s fork tubes pass through both cast collars and retain their lower sliding overlap',
    (id) => {
      const materials = new BikeMaterials(0),
        model = new DirtBikeModel(VEHICLES[id], 0, 'high', materials, mudUniforms()),
        steer = model.onboardControls.parent!,
        bounds = [new T.Box3(), new T.Box3()],
        point = new T.Vector3();
      try {
        model.root.updateMatrixWorld(true);
        const inverse = steer.matrixWorld.clone().invert();
        steer.traverse((object) => {
          if (!(object instanceof T.Mesh) || object.material !== materials.forkUpper) return;
          const position = object.geometry.getAttribute('position'),
            matrix = inverse.clone().multiply(object.matrixWorld);
          for (let i = 0; i < position.count; i++) {
            point.fromBufferAttribute(position, i).applyMatrix4(matrix);
            bounds[point.x > 0 ? 0 : 1].expandByPoint(point);
          }
        });
        for (const tube of bounds) {
          expect(tube.min.y).toBeCloseTo(-0.38, 6);
          expect(tube.max.y).toBeGreaterThan(0.216);
          expect(tube.max.y).toBeLessThan(0.225);
        }
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );
  it.each(['mx250', 'mx450', 'sm450'])(
    '%s keeps wrists and boots attached through body stroke, steering and independent travel',
    (id) => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0),
        model = new DirtBikeModel(definition, 0, 'high', materials, mudUniforms()),
        b = definition.bike!,
        point = new T.Vector3(),
        target = new T.Vector3();
      const hands = ['left', 'right'].map(
          (side) => model.rider.root.getObjectByName(`Motocross ${side} hand`)!,
        ),
        boots = ['left', 'right'].map(
          (side) => model.rider.root.getObjectByName(`Motocross ${side} boot`)!,
        );
      let worstHand = { error: 0, context: '' },
        worstAnkle = { error: 0, context: '' };
      try {
        for (const body of [-1, 0, 1])
          for (const standing of [0, 0.5, 1])
            for (const braking of [0, 1])
              for (const fork of [0, 0.5, 1])
                for (const shock of [0, 0.5, 1])
                  for (const steer of [-0.42, 0, 0.42]) {
                    const pose: BikePoseValues = {
                      fork: b.forkTravel * fork,
                      shock: b.shockTravel * shock,
                      steer,
                      frontRotation: 0,
                      rearRotation: 0,
                      chassisLean: 0.5,
                      riderOffset: 0,
                      tuck: 0,
                      brake: braking,
                      rearBrake: 0,
                      discTemp: 0,
                      compoundColour: 0xffffff,
                      riding: true,
                      standing,
                      body,
                      dab: 0,
                    };
                    model.pose(pose);
                    model.root.updateMatrixWorld(true);
                    for (let side = 0; side < 2; side++) {
                      const context = JSON.stringify({
                        body,
                        standing,
                        braking,
                        fork,
                        shock,
                        steer,
                        side,
                      });
                      hands[side].getWorldPosition(point);
                      target.copy(model.rider.grips[side]).applyMatrix4(model.sprung.matrixWorld);
                      const handError = point.distanceTo(target);
                      boots[side].getWorldPosition(point);
                      target.copy(model.rider.pegs[side]).applyMatrix4(model.sprung.matrixWorld);
                      const ankleError = point.distanceTo(target);
                      if (handError > worstHand.error) worstHand = { error: handError, context };
                      if (ankleError > worstAnkle.error)
                        worstAnkle = { error: ankleError, context };
                    }
                  }
        expect(worstHand.error, worstHand.context).toBeLessThan(0.03);
        expect(worstAnkle.error, worstAnkle.context).toBeLessThan(0.03);
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );
});
