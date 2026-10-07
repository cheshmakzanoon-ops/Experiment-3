import * as T from 'three';
import { MotionBlur } from '../../src/rendering/motion-blur.ts';
import { SceneAmbientPass } from '../../src/rendering/scene-ambient-pass.ts';
import { StudioFrame } from '../../src/rendering/studio/studio-frame.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../../src/simulation/protocol.ts';

/** A test-only GPU oracle. Bundled in memory by Playwright, never into dist/.
 * It runs the real scene-pass composite: depth reprojection of the presented
 * rigid car motion over the shutter, read back through the velocity debug view. */
export function verifyMotionGPU() {
  const canvas = document.createElement('canvas');
  const renderer = new T.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(128, 128); renderer.outputColorSpace = T.LinearSRGBColorSpace;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(60, 1, 0.1, 100);
  const data = new Uint8Array(64 * 4);
  for (let i = 0; i < 64; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = i % 8 < 4 ? 255 : 0;
    data[i * 4 + 3] = 255;
  }
  const map = new T.DataTexture(data, 64, 1);
  map.needsUpdate = true; map.minFilter = map.magFilter = T.NearestFilter;
  const material = new T.MeshBasicMaterial({ map, side: T.DoubleSide });
  const mesh = new T.Mesh(new T.PlaneGeometry(6, 6), material);
  mesh.position.z = -5; scene.add(mesh);
  const sun = new T.DirectionalLight();
  sun.position.set(-140, 235, -115); scene.add(sun, sun.target);
  // Car 0 carries the camera at the origin; car 1 is the textured plane 5 m ahead.
  const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
  frame[H.CARS] = 2;
  frame[carBase(0) + F.QW] = 1;
  frame[carBase(1) + F.QW] = 1;
  frame[carBase(1) + F.Z] = -5;
  const studio = new StudioFrame();
  const output = new T.WebGLRenderTarget(128, 128, { type: T.HalfFloatType });
  const blur = new MotionBlur(renderer.extensions.has('EXT_color_buffer_float'));
  const pass = new SceneAmbientPass(scene, camera, 0, blur);
  pass.ambientOcclusion = false;
  pass.setSize(128, 128);
  // 0.6 of a 60 Hz frame: a 30 m/s plane moves 0.3 m across the shutter.
  blur.setStrength(0.6);
  const read = (target: T.WebGLRenderTarget, x: number, y: number, w: number, h: number) => {
    const values = new Uint16Array(w * h * 4);
    renderer.readRenderTargetPixels(target, x, y, w, h, values);
    return values;
  };
  const step = (time: number, speed: number, follow: number, replayHeld = false) => {
    frame[H.TIME] = time;
    frame[carBase(1) + F.VX] = speed;
    frame[carBase(1) + F.SPEED] = speed;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    studio.update(frame, camera, sun, 'oracle');
    blur.prepareFrame(frame, camera, follow, 'cockpit', replayHeld, replayHeld ? 0 : 1 / 60);
    pass.setDebugVelocity(true);
    pass.render(renderer, output);
    const motion = Array.from(read(output, 64, 64, 1, 1), T.DataUtils.fromHalfFloat);
    pass.setDebugVelocity(false);
    pass.render(renderer, output);
    return motion;
  };
  try {
    if (!blur.supported) throw new Error('GPU oracle requires float color buffers');
    const first = step(0, 0, 0);
    const moving = step(1 / 60, 30, 0);
    const before = read(pass.target, 0, 0, 128, 128), after = read(output, 0, 0, 128, 128);
    let changedPixels = 0;
    for (let i = 0; i < before.length; i += 4) if (before[i] !== after[i]) changedPixels++;
    const stopped = step(2 / 60, 0, 0);
    // The driver's own rigid car does not smear merely because it and its
    // attached camera travel together through the world.
    const coMoving = step(3 / 60, 30, 1);
    // A paused (held) replay frame never streaks, whatever the cars were doing.
    const cut = step(4 / 60, 30, 0, true);
    return { first, moving, stopped, coMoving, cut, changedPixels, diagnostics: blur.diagnostics() };
  } finally {
    pass.dispose(); blur.dispose(); output.dispose(); mesh.geometry.dispose(); material.dispose(); map.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  }
}
