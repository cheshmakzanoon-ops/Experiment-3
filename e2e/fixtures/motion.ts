import * as T from 'three';
import { MotionBlurPass } from '../../src/rendering/motion-blur.ts';

/** A test-only GPU oracle. Bundled in memory by Playwright, never into dist/. */
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
  const input = new T.WebGLRenderTarget(128, 128), output = new T.WebGLRenderTarget(128, 128);
  const pass = new MotionBlurPass(scene, camera, renderer.extensions.has('EXT_color_buffer_float'));
  pass.setSize(128, 128); pass.setStrength(0.6);
  const frame = (time: number) => {
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    pass.prepareFrame(1 / 60, time);
    renderer.setRenderTarget(input); renderer.render(scene, camera);
    pass.render(renderer, output, input);
  };
  const motion = () => {
    const values = new Uint16Array(4);
    renderer.readRenderTargetPixels(pass.velocityTarget, 64, 64, 1, 1, values);
    return Array.from(values, T.DataUtils.fromHalfFloat);
  };
  try {
    if (!pass.supported) throw new Error('GPU oracle requires float color buffers');
    frame(0); const first = motion();
    mesh.position.x = 0.3; frame(1 / 60); const moving = motion();
    const before = new Uint8Array(128 * 128 * 4), after = new Uint8Array(before.length);
    renderer.readRenderTargetPixels(input, 0, 0, 128, 128, before);
    renderer.readRenderTargetPixels(output, 0, 0, 128, 128, after);
    let changedPixels = 0;
    for (let i = 0; i < before.length; i += 4) if (before[i] !== after[i]) changedPixels++;
    frame(2 / 60); const stopped = motion();
    // The driver's own rigid cockpit should not smear merely because the car and
    // its attached camera translate together through the world.
    mesh.position.x += 0.3; camera.position.x += 0.3;
    frame(3 / 60); const coMoving = motion();
    mesh.position.x += 40.2; camera.position.x += 40;
    frame(4 / 60); const cut = motion();
    return { first, moving, stopped, coMoving, cut, changedPixels, diagnostics: pass.diagnostics() };
  } finally {
    pass.dispose(); input.dispose(); output.dispose(); mesh.geometry.dispose(); material.dispose(); map.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  }
}
