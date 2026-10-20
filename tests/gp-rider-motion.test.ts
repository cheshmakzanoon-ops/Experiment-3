import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Quat } from '../src/core/math.ts';
import { bikeOrientation } from '../src/simulation/bike-vehicle.ts';
import {
  GP_BOOT_ANKLE,
  GP_BOOT_PEDAL,
  GP_BOOT_PEG,
  GP_FOOTPEG_RADIUS,
} from '../src/rendering/gp-rider-contact.ts';
import { RIDER, Rider, type RiderPose } from '../src/rendering/rider.ts';

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

const colours = { primary: 0xc12437, secondary: 0x18212a, accent: 0xf2e9d7 };
const base: RiderPose = { lean: 0, offset: 0, tuck: 0.65, braking: 0, steer: 0, speed: 50 };

function transforms(root: T.Object3D) {
  root.updateMatrixWorld(true);
  const result: number[][] = [];
  root.traverse((object) => result.push(object.matrixWorld.toArray()));
  return result;
}

describe('GP riding motion on the actual articulated rider', () => {
  it('looks through either corner on sloping roads without tuck, braking or suspension tipping the sight into the road', () => {
    const rider = new Rider(colours, 'mid', 'leathers', 2, true),
      road = new T.Group(),
      sprung = new T.Group(),
      head = rider.root.getObjectByName('Rider head and helmet')!,
      forward = new T.Vector3(),
      up = new T.Vector3(),
      orientation = new Quat(),
      roadFrame = new T.Quaternion(),
      worldToRoad = new T.Matrix4();
    road.add(sprung);
    sprung.add(rider.root);
    try {
      for (const [heading, grade] of [
        [0, 0],
        [0.73, 0.18],
        [-2.8, -0.14],
      ]) {
        bikeOrientation(orientation, heading, grade, 0);
        roadFrame.set(orientation.x, orientation.y, orientation.z, orientation.w);
        worldToRoad.makeRotationFromQuaternion(roadFrame).invert();
        for (const lean of [-1.05, 0, 1.05])
          for (const tuck of [0, 1])
            for (const braking of [0, 1])
              for (const suspensionPitch of [-0.08, 0.09]) {
                bikeOrientation(orientation, heading, grade, lean);
                road.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
                sprung.rotation.x = suspensionPitch;
                rider.ride({
                  ...base,
                  lean,
                  offset: lean * 0.2,
                  // Countersteer must not turn the face away from the apex.
                  steer: -lean * 0.3,
                  tuck,
                  braking,
                  suspensionPitch,
                });
                road.updateMatrixWorld(true);
                forward
                  .set(0, 0, 1)
                  .transformDirection(head.matrixWorld)
                  .transformDirection(worldToRoad);
                up.set(0, 1, 0)
                  .transformDirection(head.matrixWorld)
                  .transformDirection(worldToRoad);
                expect(forward.z).toBeGreaterThan(0.85);
                expect(forward.y).toBeGreaterThan(-0.16);
                expect(forward.y).toBeLessThan(0);
                expect(up.y).toBeGreaterThan(0.8);
                if (lean) expect(forward.x * Math.sign(lean)).toBeGreaterThan(0.3);
                else expect(Math.abs(forward.x)).toBeLessThan(1e-12);
              }
      }
    } finally {
      rider.dispose();
    }
  });

  it('uses slow-speed steering to look into manoeuvres and closes/reopens the knees continuously', () => {
    const rider = new Rider(colours, 'mid', 'leathers', 2, true),
      head = rider.root.getObjectByName('Rider head and helmet')!,
      knees = ['left', 'right'].map((side) => rider.root.getObjectByName(`GP ${side} shin`)!),
      point = new T.Vector3();
    try {
      for (const steer of [-0.4, 0.4]) {
        rider.ride({ ...base, speed: 2, steer });
        rider.root.updateMatrixWorld(true);
        point.set(0, 0, 1).transformDirection(head.matrixWorld);
        expect(point.x * Math.sign(steer)).toBeGreaterThan(0.2);
      }
      rider.ride({ ...base, lean: -1e-7, offset: -1e-7 });
      rider.root.updateMatrixWorld(true);
      const before = knees.map((knee) => knee.getWorldPosition(new T.Vector3()));
      rider.ride({ ...base, lean: 1e-7, offset: 1e-7 });
      rider.root.updateMatrixWorld(true);
      for (let i = 0; i < 2; i++)
        expect(knees[i].getWorldPosition(point).distanceTo(before[i])).toBeLessThan(1e-5);

      let previous: T.Vector3[] | undefined;
      for (let step = 0; step <= 240; step++) {
        const t = step / 240,
          lean = T.MathUtils.lerp(-0.8, 0.8, t);
        rider.ride({ ...base, lean, offset: lean * 0.2, steer: -lean * 0.1 });
        rider.root.updateMatrixWorld(true);
        const current = knees.map((knee) => knee.getWorldPosition(new T.Vector3()));
        if (previous)
          for (let i = 0; i < 2; i++)
            expect(current[i].distanceTo(previous[i])).toBeLessThan(0.006);
        previous = current;
      }
    } finally {
      rider.dispose();
    }
  });

  it.each(['high', 'mid', 'far'] as const)(
    '%s presses only the right rear-brake toe with the forefoot and ankle still connected',
    (detail) => {
      const rider = new Rider(colours, detail, 'leathers', 2, true),
        feet = ['left', 'right'].map((side) => rider.root.getObjectByName(`GP ${side} foot`)!),
        shins = ['left', 'right'].map((side) => rider.root.getObjectByName(`GP ${side} shin`)!);
      const point = (object: T.Object3D, local: readonly [number, number, number]) =>
        object.localToWorld(new T.Vector3(...local));
      try {
        rider.ride(base);
        rider.root.updateMatrixWorld(true);
        const neutralToe = feet.map((foot) => point(foot, GP_BOOT_PEDAL));
        for (const rearBraking of [0.25, 0.6, 1, 0]) {
          rider.ride({ ...base, rearBraking });
          rider.root.updateMatrixWorld(true);
          expect(point(feet[0], GP_BOOT_PEDAL).distanceTo(neutralToe[0])).toBeLessThan(1e-12);
          if (rearBraking > 0)
            expect(point(feet[1], GP_BOOT_PEDAL).y).toBeLessThan(neutralToe[1].y - 0.002);
          for (let i = 0; i < 2; i++) {
            const pegTop = rider.pegs[i].clone();
            pegTop.y += GP_FOOTPEG_RADIUS;
            expect(point(feet[i], GP_BOOT_PEG).distanceTo(pegTop)).toBeLessThan(1e-7);
            expect(
              point(feet[i], GP_BOOT_ANKLE).distanceTo(point(shins[i], [0, RIDER.shin, 0])),
            ).toBeLessThan(1e-7);
            const cuff = feet[i].getObjectByName('GP ankle-hinged boot cuff')!,
              cuffAxis = new T.Vector3(0, 1, 0).transformDirection(cuff.matrixWorld),
              shinAxis = new T.Vector3(0, 1, 0).transformDirection(shins[i].matrixWorld);
            expect(cuffAxis.dot(shinAxis)).toBeCloseTo(1, 10);
          }
        }
        // The hand lever alone must not cause a right ankle pedal press.
        rider.ride({ ...base, braking: 1 });
        rider.root.updateMatrixWorld(true);
        expect(point(feet[1], GP_BOOT_PEDAL).distanceTo(neutralToe[1])).toBeLessThan(1e-7);
      } finally {
        rider.dispose();
      }
    },
  );

  it('restores a held riding pose exactly after a seek or recovery without adding render resources', () => {
    const rider = new Rider(colours, 'mid', 'leathers', 2, true),
      resources = new Set<object>();
    rider.root.traverse((object) => {
      if (object instanceof T.Mesh) {
        resources.add(object.geometry);
        resources.add(object.material);
      }
    });
    const riding = { ...base, lean: 0.9, offset: 0.18, rearBraking: 0.7, suspensionPitch: 0.05 };
    try {
      rider.ride(riding);
      const expected = transforms(rider.root);
      for (const phase of [0, 1, 2]) {
        rider.ride({ ...riding, lean: -1, offset: -0.2, rearBraking: 0 });
        rider.separated(phase, 1.7, 0.43);
        rider.ride(riding);
        expect(transforms(rider.root)).toEqual(expected);
      }
      rider.ride(riding);
      expect(transforms(rider.root)).toEqual(expected);
      rider.root.traverse((object) => {
        if (object instanceof T.Mesh) {
          expect(resources.has(object.geometry)).toBe(true);
          expect(resources.has(object.material)).toBe(true);
        }
      });
    } finally {
      rider.dispose();
    }
  });

  it.each(['leathers', 'motocross'] as const)(
    'isolates non-GP %s motion from GP-only suspension and rear-pedal inputs',
    (kit) => {
      const rider = new Rider(colours, 'mid', kit);
      try {
        // Speed is shared riding information: MX uses it to blend slow
        // steering into corner gaze. Hold it fixed while varying GP inputs.
        for (const speed of [1, 6, 50]) {
          const value = { ...base, speed, lean: 0.6, offset: 0.12, standing: 0.5, body: 0.2 };
          rider.ride(value);
          const before = transforms(rider.root);
          rider.ride({ ...value, suspensionPitch: 0.12, rearBraking: 1 });
          expect(transforms(rider.root)).toEqual(before);
        }
      } finally {
        rider.dispose();
      }
    },
  );

  it('retains speed-independent motion for non-GP leathers', () => {
    const rider = new Rider(colours, 'mid', 'leathers');
    try {
      const value = { ...base, lean: 0.6, offset: 0.12, standing: 0.5, body: 0.2 };
      rider.ride(value);
      const before = transforms(rider.root);
      for (const speed of [1, 6, 50]) {
        rider.ride({ ...value, speed });
        expect(transforms(rider.root)).toEqual(before);
      }
    } finally {
      rider.dispose();
    }
  });
});
