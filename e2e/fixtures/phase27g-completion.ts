import * as T from 'three';
import { AdaptiveExposurePass } from '../../src/rendering/adaptive-exposure.ts';
import { LocalAtmosphere } from '../../src/rendering/local-atmosphere.ts';
import { captureRenderedCanvas } from '../../src/rendering/frame-capture.ts';
import { Track } from '../../src/simulation/track.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H } from '../../src/simulation/protocol.ts';
import { TabEvidence } from '../../src/ui/tab-evidence.ts';
function canvas() {
  const c = document.createElement('canvas');
  document.body.append(c);
  return c;
}
async function settle(pass: AdaptiveExposurePass) {
  for (let n = 0; n < 200 && pass.diagnostics().pending; n++)
    await new Promise((r) => setTimeout(r, 10));
  if (pass.diagnostics().pending) throw new Error('Async GPU fence did not settle');
}
export async function exposureGPU() {
  const c = canvas(),
    renderer = new T.WebGLRenderer({ canvas: c, alpha: false });
  renderer.setPixelRatio(2);
  renderer.setSize(96, 64, false);
  const read = new T.WebGLRenderTarget(128, 96),
    sentinel = new T.WebGLRenderTarget(32, 24);
  const scene = new T.Scene(),
    camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 2),
    material = new T.MeshBasicMaterial({
      color: new T.Color(0.015, 0.015, 0.015),
      toneMapped: false,
    });
  scene.add(new T.Mesh(new T.PlaneGeometry(2, 2), material));
  camera.position.z = 1;
  renderer.setRenderTarget(read);
  renderer.render(scene, camera);
  renderer.setRenderTarget(sentinel);
  renderer.clear();
  const before = renderer.getCurrentViewport(new T.Vector4()).toArray();
  const meter = new AdaptiveExposurePass();
  meter.prepare(0, 'dry-cockpit', 1, true);
  meter.render(renderer, sentinel, read);
  const restored =
    renderer.getRenderTarget() === sentinel &&
    renderer
      .getCurrentViewport(new T.Vector4())
      .toArray()
      .every((n, i) => n === before[i]);
  const scratch = new Uint8Array(4);
  renderer.readRenderTargetPixels(sentinel, 0, 0, 1, 1, scratch);
  const glErrorAfterSynchronousRead = renderer.getContext().getError();
  await settle(meter);
  let exposure = 1;
  for (let i = 1; i <= 40; i++) exposure = meter.prepare(i / 10, 'dry-cockpit', 1, true);
  const held = exposure;
  for (let i = 0; i < 50; i++) exposure = meter.prepare(4, 'dry-cockpit', 1, true);
  const heldExact = held === exposure;
  const sampled = meter.diagnostics();
  renderer.info.reset();
  meter.prepare(5, 'dry-cockpit', 1, false);
  meter.render(renderer, sentinel, read);
  const disabledCalls = renderer.info.render.calls;
  const stats = meter.diagnostics();
  meter.prepare(0, 'rewound', 1, true);
  const resetEV = meter.diagnostics().ev;
  meter.dispose();
  read.dispose();
  sentinel.dispose();
  scene.traverse((o) => {
    if (o instanceof T.Mesh) o.geometry.dispose();
  });
  material.dispose();
  renderer.dispose();
  c.remove();
  return {
    restored,
    glErrorAfterSynchronousRead,
    exposure,
    heldExact,
    disabledCalls,
    stats,
    sampled,
    resetEV,
  };
}
export async function atmosphereAndCaptureGPU() {
  const c = canvas(),
    renderer = new T.WebGLRenderer({ canvas: c, alpha: false });
  renderer.setSize(640, 360, false);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.setClearColor(0x203047, 1);
  const track = new Track(),
    fog = new LocalAtmosphere(track),
    p = fog.pockets[0];
  const scene = new T.Scene();
  scene.fog = new T.FogExp2(0x94acc7, 0);
  const camera = new T.PerspectiveCamera(45, 640 / 360, 0.1, 300);
  camera.position.set(p.x, p.floor + 4, p.z + 75);
  camera.lookAt(p.x, p.floor + 1, p.z);
  scene.add(new T.HemisphereLight(0xffffff, 0x566044, 2));
  const material = new T.MeshStandardMaterial({ color: 0x9e472b, roughness: 0.65 });
  const mesh = new T.Mesh(new T.BoxGeometry(8, 4, 7), material);
  mesh.position.set(p.x, p.floor + 2, p.z);
  scene.add(mesh);
  const instanced = new T.InstancedMesh(new T.BoxGeometry(3, 4, 3), material, 2);
  instanced.setMatrixAt(0, new T.Matrix4().makeTranslation(p.x + 13, p.floor + 2, p.z - 8));
  instanced.setMatrixAt(1, new T.Matrix4().makeTranslation(p.x - 13, p.floor + 2, p.z - 12));
  scene.add(instanced);
  fog.install(scene);
  const frame = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 }).makeFrame();
  frame[H.CLOUD] = 1;
  frame[H.RAIN] = 20;
  const pixels = () => {
    const result = new Uint8Array(640 * 360 * 4);
    renderer
      .getContext()
      .readPixels(
        0,
        0,
        640,
        360,
        renderer.getContext().RGBA,
        renderer.getContext().UNSIGNED_BYTE,
        result,
      );
    return result;
  };
  fog.update(frame, false);
  renderer.render(scene, camera);
  const clear = pixels();
  fog.update(frame, true);
  renderer.render(scene, camera);
  const wet = pixels();
  const png = c.toDataURL('image/png');
  const capture = captureRenderedCanvas(c);
  c.width = 1;
  c.height = 1;
  const blob = await capture;
  const bitmap = await createImageBitmap(blob);
  const dimensions = [bitmap.width, bitmap.height];
  const decoded = document.createElement('canvas');
  decoded.width = bitmap.width;
  decoded.height = bitmap.height;
  const dc = decoded.getContext('2d')!;
  dc.drawImage(bitmap, 0, 0);
  const image = dc.getImageData(0, 0, decoded.width, decoded.height).data;
  let capturedExact = true;
  for (let y = 0; y < 360; y++)
    for (let x = 0; x < 640 * 4; x++)
      if (image[y * 640 * 4 + x] !== wet[(359 - y) * 640 * 4 + x]) capturedExact = false;
  decoded.width = decoded.height = 1;
  bitmap.close();
  renderer.setSize(640, 360, false);
  fog.update(frame, false);
  renderer.render(scene, camera);
  const restored = pixels();
  let changed = 0;
  for (let i = 0; i < wet.length; i += 4)
    if (
      Math.abs(clear[i] - wet[i]) +
        Math.abs(clear[i + 1] - wet[i + 1]) +
        Math.abs(clear[i + 2] - wet[i + 2]) >
      3
    )
      changed++;
  const glError = renderer.getContext().getError(),
    exact = clear.every((v, i) => v === restored[i]);
  mesh.geometry.dispose();
  instanced.geometry.dispose();
  instanced.dispose();
  material.dispose();
  renderer.dispose();
  c.remove();
  return { png, changed, glError, exact, capturedExact, dimensions, blobBytes: blob.size };
}
let tab: TabEvidence | null = null;
export function mountTabPanel() {
  tab?.dispose();
  document.body.innerHTML = '<main id="panel"></main>';
  tab = new TabEvidence('a'.repeat(64));
  tab.mount(document.querySelector<HTMLElement>('#panel')!);
}

import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { DEFAULT_PHOTO } from '../../src/rendering/photo-camera.ts';
import { W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../../src/simulation/protocol.ts';
export async function nativePhotoAndLodGPU() {
  const c = canvas();
  c.style.cssText = 'width:640px;height:360px';
  const track = new Track(),
    r = new RacingRenderer(c, track);
  r.setQuality('high', { ...graphicsPreset('high'), resolutionScale: 1 });
  const frame = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 }).makeFrame(),
    before = frame.slice();
  const results = [];
  try {
    for (const mode of ['cockpit', 'pod', 'chase', 'trackside'] as const) {
      r.setPhoto(null);
      r.reset();
      r.changeCamera(mode);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      r.draw(frame, frame, 1, 0, false, false);
      const eye = r.camera.position.clone(),
        fov = r.camera.fov;
      r.setPhoto({ ...DEFAULT_PHOTO, view: mode });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      r.draw(frame, frame, 1, 0, false, false);
      results.push({
        mode,
        eyeError: eye.distanceTo(r.camera.position),
        fovError: Math.abs(fov - r.camera.fov),
        helmetVisible: r.cars[0].helmet.visible,
      });
    }
    const car = r.cars[0],
      o = carBase(0);
    const posed = frame.slice();
    for (let i = 0; i < 4; i++) {
      const b = o + WHEEL_BASE + i * WHEEL_STRIDE;
      posed[b + W.STEER] = 0.12;
      posed[b + W.CAMBER] = -0.03;
    }
    const poses: number[][] = [];
    const visible: number[] = [];
    for (const distance of [0, 100, 1000]) {
      car.setLod(distance, 'medium', false);
      car.update(posed, posed, o, 1, 0, posed[H.TIME], false);
      const links = car.root.getObjectByName('Shared articulated suspension') as T.InstancedMesh;
      poses.push(Array.from(links.instanceMatrix.array));
      let active = true;
      for (let node: T.Object3D | null = links; node; node = node.parent)
        active = active && node.visible;
      visible.push(active ? 1 : 0);
    }
    const reduced = car.root.children.filter((x) =>
      x.getObjectByName('Upright-owned reduced brake'),
    );
    const rotorOwnership = reduced.every((root) => {
      const brakes: T.Object3D[] = [];
      root.traverse((o) => {
        if (o.name === 'Upright-owned reduced brake') brakes.push(o);
      });
      return (
        brakes.length === 4 &&
        brakes.every(
          (b) =>
            b.position.x === 0 &&
            b.parent?.children.some((child) => child !== b && child instanceof T.Group),
        )
      );
    });
    return {
      results,
      visible,
      posesEqual: poses.every((p) => p.every((v, i) => v === poses[0][i])),
      rotorOwnership,
      reducedCount: reduced.length,
      sourceUnchanged: frame.every((v, i) => v === before[i]),
      glError: r.renderer.getContext().getError(),
    };
  } finally {
    r.dispose();
    c.remove();
  }
}
