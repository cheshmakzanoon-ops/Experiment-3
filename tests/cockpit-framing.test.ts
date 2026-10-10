import { expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import {
  cockpitEye,
  cockpitDirection,
  cockpitFov,
  tcamFov,
  COCKPIT_FRAMING,
  TCAM_FOV,
} from '../src/rendering/cockpit-framing.ts';
import { InertialCamera } from '../src/rendering/camera-dynamics.ts';
import manifest from '../src/rendering/supplied-player.manifest.json' with { type: 'json' };
import { PLAYER_SUSPENSION_DATUM } from '../src/rendering/supplied-player.ts';

it('applies seat calibration in chassis space with exactly one suspension datum', () => {
  const socket = new Vector3().fromArray(manifest.sockets.eye);
  socket.y -= PLAYER_SUSPENSION_DATUM;
  const before = socket.toArray();
  const local = cockpitEye(socket, new Vector3(), new Vector3());
  expect(local.toArray()).toEqual(before.map((v, i) => v + COCKPIT_FRAMING.eyeOffset[i]));
  expect(socket.toArray()).toEqual(before);
  const orientation = new Quaternion().setFromEuler(new Euler(0.12, 1.7, -0.08));
  const position = new Vector3(135, 4.7, -700);
  const world = local.clone().applyQuaternion(orientation).add(position);
  expect(world.sub(position).applyQuaternion(orientation.invert()).distanceTo(local)).toBeLessThan(
    1e-12,
  );
});

it.each([24, 30, 60, 120, 144])(
  'keeps the camera inside the same bounded eye volume at %i Hz',
  (fps) => {
    const spring = new InertialCamera();
    const socket = new Vector3().fromArray(manifest.sockets.eye);
    const base = cockpitEye(socket, new Vector3(), new Vector3());
    const eye = new Vector3();
    for (let i = 0; i < fps * 8; i++) {
      spring.step(
        1 / fps,
        Math.sin(i) * 20,
        Math.cos(i) * 30,
        Math.sin(i * 7) * 50,
        i % 11 === 0 ? 100 : 0,
        1,
      );
      cockpitEye(socket, spring.offset, eye);
      eye
        .toArray()
        .forEach((value, axis) =>
          expect(Math.abs(value - base.getComponent(axis))).toBeLessThanOrEqual(
            COCKPIT_FRAMING.motionLimit[axis] + 1e-12,
          ),
        );
    }
  },
);

it('bounds even an arbitrarily large impact offset without mutating the spring', () => {
  const motion = new Vector3(100, -100, 100);
  const socket = new Vector3(1, 2, 3);
  const eye = cockpitEye(socket, motion, new Vector3());
  expect(motion.toArray()).toEqual([100, -100, 100]);
  expect(eye.toArray()).toEqual([
    1 + COCKPIT_FRAMING.eyeOffset[0] + 0.02,
    2 + COCKPIT_FRAMING.eyeOffset[1] - 0.012,
    3 + COCKPIT_FRAMING.eyeOffset[2] + 0.018,
  ]);
});

it('is deterministic on pause/seek and rejects invalid socket or spring input', () => {
  const socket = new Vector3(0, 0.25, 0.43),
    motion = new Vector3(0.01, -0.002, 0.01);
  const a = cockpitEye(socket, motion, new Vector3()).toArray();
  expect(cockpitEye(socket, new Vector3(), new Vector3()).toArray()).not.toEqual(a);
  expect(cockpitEye(socket, motion, new Vector3()).toArray()).toEqual(a);
  expect(() => cockpitEye(new Vector3(NaN, 0, 0), motion, new Vector3())).toThrow();
  expect(() => cockpitEye(socket, new Vector3(0, Infinity, 0), new Vector3())).toThrow();
  expect(cockpitDirection(new Vector3()).length()).toBeCloseTo(1, 12);
  expect(COCKPIT_FRAMING.verticalFov).toBeGreaterThan(45);
  expect(COCKPIT_FRAMING.verticalFov).toBeLessThan(75);
});

it('P6/P7 lenses: the cockpitFov key and the speed-widened T-cam', () => {
  expect(COCKPIT_FRAMING.verticalFov).toBe(54);
  expect(COCKPIT_FRAMING.eyeOffset).toEqual([0, -0.03, -0.04]);
  expect(COCKPIT_FRAMING.pitchRadians).toBe(-0.035);
  expect(cockpitFov(54)).toBe(54);
  expect(cockpitFov(30)).toBe(44);
  expect(cockpitFov(90)).toBe(70);
  expect(cockpitFov(NaN)).toBe(54);
  expect(tcamFov(0)).toBe(58);
  expect(tcamFov(40)).toBe(60);
  expect(tcamFov(90)).toBe(62);
  expect(tcamFov(-90)).toBe(62);
  expect(TCAM_FOV.max).toBe(4);
});
