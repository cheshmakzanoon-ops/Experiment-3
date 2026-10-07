import { expect, it, vi } from 'vitest';
import * as T from 'three';
import { MotionBlur } from '../src/rendering/motion-blur.ts';
import { graphicsPreset } from '../src/rendering/options.ts';
import { SceneAmbientPass } from '../src/rendering/scene-ambient-pass.ts';
import {
  MOTION_BLUR,
  MotionField,
  motionCameraFor,
  shutterSeconds,
} from '../src/rendering/studio/velocity.ts';
import { StudioFrame, createStudioUniforms } from '../src/rendering/studio/studio-frame.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';

it('off by default and unavailable float buffers cannot enable a fake effect', () => {
  const pass = new MotionBlur(false);
  expect(pass.enabled).toBe(false);
  pass.setStrength(0.4);
  expect(pass.enabled).toBe(false);
  expect(pass.diagnostics().supported).toBe(false);
  expect(pass.uniforms.motionActive.value).toBe(0);
  pass.dispose();
});
it('limits shutter strength and independently resizes the motion buffer', () => {
  const pass = new MotionBlur(true);
  pass.setStrength(10);
  expect(pass.diagnostics().strength).toBe(0.6);
  pass.setSize(801.9, 450.7);
  expect(pass.diagnostics().width).toBe(801);
  expect(pass.diagnostics().height).toBe(450);
  // Streaks never exceed 3.5 % of the width (P10).
  expect(pass.diagnostics().maximumPixels).toBeCloseTo(0.035 * 801, 9);
  pass.setStrength(NaN);
  expect(pass.enabled).toBe(false);
  pass.dispose();
});
it('disposal is idempotent and cannot re-enable rendering', () => {
  const pass = new MotionBlur(true);
  pass.setStrength(0.3);
  expect(pass.enabled).toBe(true);
  pass.dispose();
  pass.dispose();
  pass.setStrength(0.4);
  expect(pass.enabled).toBe(false);
  expect(pass.uniforms.motionActive.value).toBe(0);
});
it('ships the P10 shutter presets and a 60 Hz-referenced shutter time', () => {
  expect(graphicsPreset('low').motionBlur).toBe(0);
  expect(graphicsPreset('medium').motionBlur).toBe(0.35);
  expect(graphicsPreset('high').motionBlur).toBe(0.5);
  expect(shutterSeconds(0.35)).toBeCloseTo(0.35 / 60, 12);
  expect(shutterSeconds(0.5)).toBeCloseTo(0.5 / 60, 12);
  expect(shutterSeconds(9)).toBeCloseTo(0.6 / 60, 12);
  for (const off of [0, -1, NaN]) expect(shutterSeconds(off)).toBe(0);
  // Medium fragment loops stay within 16 taps (PRODUCTION_PLAN section 3).
  expect(MOTION_BLUR.taps).toBe(12);
  expect(MOTION_BLUR.maxWidth).toBe(0.035);
  expect(motionCameraFor('cockpit')).toBe('attached');
  expect(motionCameraFor('chase')).toBe('attached');
  expect(motionCameraFor('pod')).toBe('attached');
  expect(motionCameraFor('trackside')).toBe('pan');
  for (const still of ['orbit', 'menu', '']) expect(motionCameraFor(still)).toBe('still');
});

const SPEED = 70;
const RIVAL = 60;
const SIZE = new T.Vector2(1280, 720);
/** Two cars heading +Z: the followed car at the origin, a slower rival 20 m ahead. */
function snapshot() {
  const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
  frame[H.TIME] = 10;
  frame[H.CARS] = 2;
  for (const [id, z, speed] of [
    [0, 0, SPEED],
    [1, 20, RIVAL],
  ] as const) {
    const o = carBase(id);
    frame[o + F.Y] = 0.6;
    frame[o + F.Z] = z;
    frame[o + F.QW] = 1;
    frame[o + F.VZ] = speed;
    frame[o + F.SPEED] = speed;
  }
  return frame;
}
function rig(position: T.Vector3Tuple, target: T.Vector3Tuple) {
  const camera = new T.PerspectiveCamera(50, SIZE.x / SIZE.y, 0.045, 7000);
  camera.position.set(...position);
  camera.lookAt(...target);
  camera.updateMatrixWorld(true);
  return camera;
}
function field(frame: Float32Array, camera: T.PerspectiveCamera, model: 'attached' | 'pan') {
  const uniforms = createStudioUniforms();
  const sun = new T.DirectionalLight();
  sun.position.set(-140, 235, -115);
  sun.updateMatrixWorld(true);
  sun.target.updateMatrixWorld(true);
  new StudioFrame(uniforms).update(frame, camera, sun, 'test');
  const motion = new MotionField();
  const shutter = shutterSeconds(0.35);
  motion.update(
    frame,
    camera,
    0,
    model,
    shutter,
    uniforms.studioCarNow.value,
    uniforms.studioCarPose.value,
    uniforms.studioCarCount.value,
  );
  return { motion, shutter };
}
/** Exact reference: project `point` now, and its shutter-open position through
 * the shutter-open camera. */
function reference(
  camera: T.PerspectiveCamera,
  previousCamera: T.PerspectiveCamera,
  point: T.Vector3,
  previousPoint: T.Vector3,
) {
  const now = point.clone().project(camera);
  const before = previousPoint.clone().project(previousCamera);
  return new T.Vector2(
    ((now.x - before.x) * SIZE.x) / 2,
    ((now.y - before.y) * SIZE.y) / 2,
  );
}

it('streaks static world against an attached camera and keeps the followed car locked', () => {
  const frame = snapshot();
  const camera = rig([0, 1.65, -4.9], [0, 0.9, 13]);
  const { motion, shutter } = field(frame, camera, 'attached');
  const back = SPEED * shutter;
  const previousCamera = camera.clone();
  previousCamera.position.z -= back;
  previousCamera.updateMatrixWorld(true);
  // Followed car: bodywork, wing and tyres are locked to the camera.
  for (const local of [
    [0, 0.2, 1.5],
    [0.9, -0.25, -1.6],
    [0, 0.4, -2.3],
  ] as const) {
    const pixels = motion.pixels(new T.Vector3(local[0], 0.6 + local[1], local[2]), camera, SIZE);
    expect(pixels.length()).toBeLessThan(0.5);
  }
  // Near road and barrier: the full rigid-camera reprojection, metres-exact.
  for (const world of [
    new T.Vector3(3.5, 0, 4),
    new T.Vector3(-6, 0.8, 9),
    new T.Vector3(0.4, 0.0, 1), // asphalt under the followed car is static world
  ]) {
    const expected = reference(camera, previousCamera, world, world);
    const measured = motion.pixels(world, camera, SIZE);
    expect(measured.x).toBeCloseTo(expected.x, 2);
    expect(measured.y).toBeCloseTo(expected.y, 2);
    expect(expected.length()).toBeGreaterThan(1);
  }
  // The near road streaks far more than the road 60 m ahead.
  const near = motion.pixels(new T.Vector3(3.5, 0, 4), camera, SIZE).length();
  const far = motion.pixels(new T.Vector3(3.5, 0, 60), camera, SIZE).length();
  expect(near).toBeGreaterThan(8 * far);
  // A slower rival ahead moves rigidly with its own velocity.
  const rival = new T.Vector3(0.3, 0.9, 20.5);
  const rivalBefore = rival.clone();
  rivalBefore.z -= RIVAL * shutter;
  const expected = reference(camera, previousCamera, rival, rivalBefore);
  const measured = motion.pixels(rival, camera, SIZE);
  expect(measured.x).toBeCloseTo(expected.x, 2);
  expect(measured.y).toBeCloseTo(expected.y, 2);
  // Pure translation leaves the horizon (far plane) still.
  expect(motion.pixels(new T.Vector3(0, 0.9, 6900), camera, SIZE).length()).toBeLessThan(0.01);
});
it('turns a yawing car rigidly about its presented angular velocity', () => {
  const frame = snapshot();
  const o = carBase(1);
  frame[o + F.WY] = 1.5; // rad/s, world frame
  const camera = rig([0, 1.65, -4.9], [0, 0.9, 13]);
  const { motion, shutter } = field(frame, camera, 'attached');
  const previousCamera = camera.clone();
  previousCamera.position.z -= SPEED * shutter;
  previousCamera.updateMatrixWorld(true);
  const nose = new T.Vector3(0, 0.9, 22.5);
  const turn = new T.Matrix4().makeRotationY(-1.5 * shutter);
  const before = nose
    .clone()
    .sub(new T.Vector3(0, 0.6, 20))
    .applyMatrix4(turn)
    .add(new T.Vector3(0, 0.6, 20 - RIVAL * shutter));
  const expected = reference(camera, previousCamera, nose, before);
  const measured = motion.pixels(nose, camera, SIZE);
  expect(measured.x).toBeCloseTo(expected.x, 2);
  expect(measured.y).toBeCloseTo(expected.y, 2);
});
it('pans about a fixed trackside eye: the car holds its place and the background streaks', () => {
  const frame = snapshot();
  const camera = rig([18, 3, 2], [0, 0.6, 0]);
  const { motion } = field(frame, camera, 'pan');
  expect(motion.pixels(new T.Vector3(0, 0.7, 0.4), camera, SIZE).length()).toBeLessThan(0.5);
  const fence = new T.Vector3(-12, 1, -3);
  const streak = motion.pixels(fence, camera, SIZE);
  expect(streak.length()).toBeGreaterThan(3);
  // The car runs toward +Z, which is screen-left from this eye: the panned
  // background slides the other way (screen-right).
  const ahead = new T.Vector3(0, 0.6, 5).project(camera).x;
  expect(ahead).toBeLessThan(0);
  expect(streak.x).toBeGreaterThan(0);
});
it('menu, photo, disabled and paused-replay frames are exactly still; held frames repeat', () => {
  const frame = snapshot();
  const camera = rig([0, 1.65, -4.9], [0, 0.9, 13]);
  const blur = new MotionBlur(true);
  blur.setSize(1280, 720);
  blur.setStrength(0.35);
  blur.prepareFrame(frame, camera, 0, 'chase', false, 1 / 60);
  expect(blur.uniforms.motionActive.value).toBe(1);
  const live = blur.uniforms.motionWorldPrev.value.clone();
  const rival = blur.uniforms.motionPrev.value[1].clone();
  // A paused live session presents the same snapshot: identical uniforms.
  blur.prepareFrame(frame, camera, 0, 'chase', false, 0);
  expect(blur.uniforms.motionWorldPrev.value.equals(live)).toBe(true);
  expect(blur.uniforms.motionPrev.value[1].equals(rival)).toBe(true);
  // Paused (held) or cut replay frames do not streak; playing replay does.
  blur.prepareFrame(frame, camera, 0, 'chase', true, 0);
  expect(blur.uniforms.motionActive.value).toBe(0);
  blur.prepareFrame(frame, camera, 0, 'chase', true, 1 / 60);
  expect(blur.uniforms.motionActive.value).toBe(1);
  blur.prepareFrame(frame, camera, 0, 'orbit', false, 1 / 60);
  expect(blur.uniforms.motionActive.value).toBe(0);
  // Photo and menu: the renderer passes strength 0.
  blur.setStrength(0);
  blur.prepareFrame(frame, camera, 0, 'chase', false, 1 / 60);
  expect(blur.uniforms.motionActive.value).toBe(0);
  expect(blur.diagnostics()).toMatchObject({ active: false, camera: 'still', extraDraws: 0 });
  blur.dispose();
});
it('gathers inside the existing composite: no extra draw, AO on or off', () => {
  const scene = new T.Scene();
  const camera = rig([0, 1.65, -4.9], [0, 0.9, 13]);
  const blur = new MotionBlur(true);
  const pass = new SceneAmbientPass(scene, camera, 0, blur);
  pass.setSize(1280, 720);
  expect(blur.diagnostics().maximumPixels).toBeCloseTo(0.035 * 1280, 9);
  const draws: unknown[] = [];
  let fail = false;
  const renderer = {
    autoClear: false,
    setRenderTarget: vi.fn(),
    render: (object: unknown) => {
      if (fail) throw new Error('GPU draw failed');
      draws.push(object);
    },
  } as unknown as T.WebGLRenderer;
  const write = new T.WebGLRenderTarget(4, 4);
  for (const [ambient, strength, expected] of [
    [true, 0, 5],
    [true, 0.35, 5],
    [false, 0, 2],
    [false, 0.35, 2],
  ] as const) {
    draws.length = 0;
    pass.ambientOcclusion = ambient;
    blur.setStrength(strength);
    pass.render(renderer, write);
    expect(draws.length).toBe(expected);
    expect(draws[0]).toBe(scene);
  }
  expect(blur.diagnostics().velocityFrames).toBe(2);
  expect(pass.diagnostics().motionBlur).toBe(true);
  fail = true;
  expect(() => pass.render(renderer, write)).toThrow('GPU draw failed');
  expect(renderer.autoClear).toBe(false);
  expect(blur.diagnostics().velocityFrames).toBe(2);
  pass.dispose();
  write.dispose();
});
