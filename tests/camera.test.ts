import { it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { InertialCamera } from '../src/rendering/camera-dynamics.ts';
import { carLod } from '../src/rendering/lod.ts';

it.each([24, 30, 60, 90, 120, 144])(
  'keeps eyes in the cockpit at constant 300 km/h at %i FPS',
  (fps) => {
    const rig = new InertialCamera(),
      position = new Vector3(),
      q = new Quaternion(),
      eye = new Vector3();
    for (let i = 0; i < fps * 5; i++) {
      position.z += 300 / 3.6 / fps;
      rig.step(1 / fps, 0, 0, 0, 0, 1);
      rig.eye(position, q, false, eye);
      expect(eye.z - position.z).toBeCloseTo(-0.48, 8);
      expect(eye.y - position.y).toBeCloseTo(0.41, 8);
    }
  },
);
it('converges to the same inertial displacement across render rates', () => {
  const results = [24, 60, 144].map((fps) => {
    const rig = new InertialCamera();
    for (let i = 0; i < fps; i++) rig.step(1 / fps, 3, -4, 0, 0, 1);
    return rig.offset.clone();
  });
  expect(results[0].distanceTo(results[2])).toBeLessThan(1e-9);
  expect(results[1].length()).toBeLessThan(0.06);
});
it('rejects invalid state and disables camera motion at zero gain', () => {
  const rig = new InertialCamera();
  expect(() => rig.step(NaN, 0, 0, 0, 0, 1)).toThrow();
  rig.step(0.1, 20, -30, 10, 1, 0);
  expect(rig.offset.length()).toBe(0);
});
it('uses LOD hysteresis and never reduces the player cockpit', () => {
  expect(carLod(58, 0, 'medium', false)).toBe(0);
  expect(carLod(58, 1, 'medium', false)).toBe(1);
  expect(carLod(120, 2, 'medium', false)).toBe(1);
  expect(carLod(126, 2, 'medium', false)).toBe(2);
  expect(carLod(1000, 2, 'low', true)).toBe(0);
});
