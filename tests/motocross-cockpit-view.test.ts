import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeShells, bikeOnboardFov, staticSag } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import {
  B,
  BIKE_BASE,
  CAR_STRIDE,
  F,
  HEADER,
  O,
  OFFROAD_BASE,
  carBase,
} from '../src/simulation/protocol.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { inspectMotocrossCockpit } from '../e2e/fixtures/motocross-cockpit-contract.ts';

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

describe('Motocross production onboard visibility', () => {
  it('keeps a readable helmet horizon through banks and landings and restores an exact frame on a seek', () => {
    const shell = new BikeShells(),
      root = new T.Object3D();
    const eye = new T.Vector3(),
      direction = new T.Vector3(),
      up = new T.Vector3();
    const sample = (roll: number, pitch: number, reduced = false, tail = false) => {
      root.rotation.set(pitch, 0.72, roll, 'YXZ');
      shell.onboard(root, eye, direction, tail, VEHICLES.mx450, up, reduced);
      expect(Math.abs(direction.length() - 1)).toBeLessThan(1e-8);
      expect(Math.abs(up.length() - 1)).toBeLessThan(1e-8);
      return [...direction.toArray(), ...up.toArray(), ...eye.toArray()];
    };
    const original = sample(0.7, 0);
    expect(Math.acos(up.y)).toBeCloseTo(0.7 * 0.56, 7);
    sample(-0.7, 0);
    expect(Math.acos(up.y)).toBeCloseTo(0.7 * 0.56, 7);
    sample(0.7, 0, true);
    expect(up.y).toBeCloseTo(1, 8);
    sample(0, -0.23);
    expect(Math.asin(direction.y)).toBeCloseTo(-0.4 + 0.23 * 0.68, 7);
    sample(0.7, 0, true, true);
    expect(Math.acos(up.y)).toBeCloseTo(0.7, 7);
    for (const pitch of [-Math.PI / 2, Math.PI / 2]) {
      const left = sample(Math.PI - 1e-6, pitch),
        right = sample(-Math.PI + 1e-6, pitch);
      expect(Math.max(...left.map((value, i) => Math.abs(value - right[i])))).toBeLessThan(0.00001);
    }
    expect(sample(0.7, 0)).toEqual(original);
  });

  it('moves the helmet with the displayed rider, looks into a whip and repeats the eye on a seek', () => {
    const shells = new BikeShells(),
      root = new T.Object3D();
    const eye = new T.Vector3(),
      gaze = new T.Vector3(),
      up = new T.Vector3();
    const frame = new Float32Array(HEADER + 2 * CAR_STRIDE),
      slot = carBase(1);
    const sample = (
      stance: number,
      weight: number,
      speedX: number,
      reduced = false,
      tail = false,
    ) => {
      frame[slot + OFFROAD_BASE + O.STANDING] = stance;
      frame[slot + OFFROAD_BASE + O.BODY] = weight;
      frame[slot + F.VX] = speedX;
      frame[slot + F.VZ] = 14;
      shells.onboard(root, eye, gaze, tail, VEHICLES.mx450, up, reduced, frame, 1);
      return [...eye.toArray(), ...gaze.toArray(), ...up.toArray()];
    };
    const seated = sample(0, 0, 0);
    const forward = sample(1, 1, 8);
    expect(eye.y - seated[1]).toBeCloseTo(0.058, 7);
    expect(eye.z - seated[2]).toBeGreaterThan(0.05);
    expect(gaze.x).toBeGreaterThan(0.04);
    const aft = sample(1, -1, -8);
    expect(aft[2]).toBeLessThan(forward[2] - 0.05);
    expect(gaze.x).toBeLessThan(-0.04);
    expect(sample(1, 1, 8)).toEqual(forward);
    expect(sample(1, 1, 8, true)).toEqual(seated);
    expect(sample(1, 1, 8, false, true)).toEqual(sample(0, 0, 0, false, true));
    frame[slot + BIKE_BASE + B.STATE] = 3;
    expect(sample(1, 1, 8)).toEqual(seated);
  });

  for (const id of ['mx250', 'mx450', 'sm450'])
    it(`${id}: clears the number plate and rider while keeping real controls in view`, () => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0),
        model = new DirtBikeModel(definition, 0, 'high', materials, mudUniforms()),
        sag = staticSag(definition),
        shells = new BikeShells(),
        direction = new T.Vector3(),
        camera = new T.PerspectiveCamera(58, 16 / 10, 0.03, 1000);
      model.rider.setFirstPerson(true, true);
      try {
        const frame = new Float32Array(HEADER + CAR_STRIDE),
          slot = carBase(0);
        for (const aspect of [4 / 3, 16 / 10, 21 / 9])
          for (const pose of [
            { standing: 0, body: 0, brake: 0, lean: 0, steer: 0, load: 0, speed: 0 },
            { standing: 1, body: 0.7, brake: 0, lean: 0, steer: 0.12, load: -0.035, speed: 25 },
            {
              standing: 1,
              body: -0.8,
              brake: 0.9,
              lean: 0.35,
              steer: -0.18,
              load: 0.09,
              speed: 30,
            },
            { standing: 0.4, body: 0, brake: 0.2, lean: -0.55, steer: 0.3, load: 0.025, speed: 30 },
          ]) {
            model.pose({
              fork: sag.fork + pose.load,
              shock: sag.shock - pose.load * 0.25,
              steer: pose.steer,
              frontRotation: 1,
              rearRotation: 2,
              chassisLean: pose.lean,
              riderOffset: 0,
              tuck: 0,
              brake: pose.brake,
              rearBrake: 0,
              discTemp: 200,
              compoundColour: 0xffffff,
              riding: true,
              standing: pose.standing,
              body: pose.body,
            });
            model.root.position.set(17, 0.86, -11);
            model.root.rotation.set(0.06, 0.7, -pose.lean, 'YXZ');
            frame[slot + OFFROAD_BASE + O.STANDING] = pose.standing;
            frame[slot + OFFROAD_BASE + O.BODY] = pose.body;
            shells.onboard(
              model.root,
              camera.position,
              direction,
              false,
              definition,
              camera.up,
              false,
              frame,
            );
            camera.lookAt(camera.position.clone().add(direction));
            camera.aspect = aspect;
            camera.fov = bikeOnboardFov(pose.speed, definition);
            camera.updateProjectionMatrix();
            const result = inspectMotocrossCockpit(model, camera),
              context = JSON.stringify({ id, aspect, pose, result });
            expect(result.visibleControls, context).toBe(3);
            expect(result.clearForwardSamples, context).toBe(15);
            expect(result.headVisible).toBe(false);
            expect(result.torsoVisible).toBe(false);
            expect(result.handsVisible).toEqual([true, true]);
            for (const [x, y] of result.sleeveEntries)
              expect(y < -0.95 || Math.abs(x) > 0.98, context).toBe(true);
            for (const control of result.controls) {
              const [x, y, z] = control.ndc;
              expect(Math.abs(x), context).toBeLessThan(0.95);
              expect(Math.abs(y), context).toBeLessThan(0.95);
              expect(z).toBeGreaterThan(-1);
              expect(z).toBeLessThan(1);
            }
          }
        // The old GP socket is a negative control: these rays must detect
        // its opaque MX number-board obstruction, not merely camera state.
        if (id !== 'sm450') {
          shells.onboard(model.root, camera.position, direction, false, VEHICLES.gpr1, camera.up);
          camera.lookAt(camera.position.clone().add(direction));
          expect(inspectMotocrossCockpit(model, camera).clearForwardSamples).toBeLessThan(15);
        }
        model.rider.setFirstPerson(false);
        expect(model.rider.root.getObjectByName('Rider head and helmet')!.visible).toBe(true);
        expect(model.rider.root.getObjectByName('Rider torso')!.visible).toBe(true);
        const arms = ['left', 'right'].flatMap((side) =>
            ['upper arm', 'forearm'].map(
              (part) => model.rider.root.getObjectByName(`Motocross ${side} ${part}`)!,
            ),
          ),
          exterior = arms.map((arm) => [...arm.position.toArray(), ...arm.quaternion.toArray()]);
        model.rider.setFirstPerson(true, true);
        expect(
          arms.map((arm) => [...arm.position.toArray(), ...arm.quaternion.toArray()]),
        ).not.toEqual(exterior);
        model.rider.setFirstPerson(false);
        expect(arms.map((arm) => [...arm.position.toArray(), ...arm.quaternion.toArray()])).toEqual(
          exterior,
        );
        for (const side of ['left', 'right'])
          expect(model.rider.root.getObjectByName(`Motocross ${side} upper arm`)!.visible).toBe(
            true,
          );
      } finally {
        model.dispose();
        materials.dispose();
      }
    });
});
