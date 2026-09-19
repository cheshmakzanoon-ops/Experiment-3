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

it('freezes actual trackside gaze and cockpit spring state at a paused presentation time', async () => {
  const { CameraClock, ViewOrientation } = await import('../src/rendering/camera-dynamics.ts');
  const { TracksideDirector } = await import('../src/rendering/trackside.ts');
  const { Track } = await import('../src/simulation/track.ts');
  const clock = new CameraClock(),
    director = new TracksideDirector(new Track('clear', true));
  const position = new Vector3(),
    velocity = new Vector3(0, 0, 30);
  const spring = new InertialCamera(),
    orientation = new ViewOrientation();
  director.update(20, position, velocity, clock.step(0));
  position.z = 1;
  const dt = clock.step(1 / 30);
  director.update(21, position, velocity, dt);
  spring.step(dt, 2, -3, 1, 0.2, 1);
  orientation.update(new Quaternion(), dt);
  const expected = {
    gaze: director.gaze.toArray(),
    fov: director.fov,
    offset: spring.offset.toArray(),
    q: orientation.rotation.toArray(),
  };
  for (let i = 0; i < 30; i++) {
    const pausedDt = clock.step(1 / 30);
    expect(pausedDt).toBe(0);
    director.update(21, position, velocity, pausedDt);
    if (pausedDt > 0) spring.step(pausedDt, 2, -3, 1, 0.2, 1);
    orientation.update(new Quaternion(), pausedDt);
  }
  expect({
    gaze: director.gaze.toArray(),
    fov: director.fov,
    offset: spring.offset.toArray(),
    q: orientation.rotation.toArray(),
  }).toEqual(expected);
});

it('camera clock resumes from recorded time and rebaselines menus, seeks and cuts', async () => {
  const { CameraClock } = await import('../src/rendering/camera-dynamics.ts');
  const clock = new CameraClock();
  expect(clock.step(2)).toBe(0);
  expect(clock.step(2.05)).toBeCloseTo(0.05);
  expect(clock.step(2.15)).toBe(0.08);
  expect(clock.step(1)).toBe(0);
  expect(clock.step(10)).toBe(0);
  expect(clock.step(10.03, true)).toBe(0);
  expect(clock.step(10.04)).toBe(0);
  expect(clock.step(10.07)).toBeCloseTo(0.03);
  clock.reset();
  expect(clock.step(10.1)).toBe(0);
  expect(() => clock.step(NaN)).toThrow();
});

it.each([0.5, 1, 2, 24, 30, 60, 90, 120, 144])(
  'keeps the filtered cockpit heading within its driver-response bound at %i FPS',
  async (hz) => {
    const { CameraClock, ViewOrientation } = await import('../src/rendering/camera-dynamics.ts');
    const clock = new CameraClock(),
      view = new ViewOrientation();
    const target = new Quaternion(),
      up = new Vector3(0, 1, 0);
    view.update(target, clock.step(0));
    for (let i = 1; i <= Math.ceil(hz * 8); i++) {
      const dt = clock.step(i / hz);
      expect(dt).toBeGreaterThan(0);
      target.setFromAxisAngle(up, Math.sin(i / hz) * 1.3);
      view.update(target, dt);
      expect(view.rotation.angleTo(target)).toBeLessThanOrEqual(0.040001);
      expect(view.rotation.lengthSq()).toBeCloseTo(1, 10);
    }
    const before = view.rotation.clone();
    for (let i = 0; i < 100; i++) view.update(target, clock.step(Math.ceil(hz * 8) / hz));
    expect(view.rotation.toArray()).toEqual(before.toArray());
  },
);

it('distinguishes a discontinuous camera seek from a frozen snapshot and validates rotations', async () => {
  const { CameraClock, ViewOrientation } = await import('../src/rendering/camera-dynamics.ts');
  const clock = new CameraClock(),
    view = new ViewOrientation();
  clock.step(0);
  expect(clock.discontinuous).toBe(true);
  clock.step(1);
  expect(clock.discontinuous).toBe(false);
  expect(clock.step(1)).toBe(0);
  expect(clock.discontinuous).toBe(false);
  expect(clock.step(10)).toBe(0);
  expect(clock.discontinuous).toBe(true);
  view.reset();
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  expect(view.update(q, 0).angleTo(q)).toBe(0);
  expect(() => view.update(q, NaN)).toThrow();
  expect(() => view.update(new Quaternion(0, 0, 0, 0), 0.01)).toThrow();
});
