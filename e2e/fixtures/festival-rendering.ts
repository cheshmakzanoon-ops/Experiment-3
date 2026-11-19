import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BroadcastGradePass } from '../../src/rendering/broadcast-grade.ts';
import { lightingDirection } from '../../src/rendering/daylight.ts';
import { LensBloomPass } from '../../src/rendering/lens-bloom.ts';
import { FestivalFramePipeline } from '../../src/rendering/open-world/festival-frame-pipeline.ts';
import { FestivalShadows } from '../../src/rendering/open-world/festival-shadows.ts';
import {
  graphicsPreset,
  type GraphicsOptions,
  type QualityPreset,
} from '../../src/rendering/options.ts';
import { UltraPipeline } from '../../src/rendering/ultra/pipeline.ts';
import { WetRoadReflection } from '../../src/rendering/wet-reflection.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../../src/simulation/protocol.ts';

/** Exercise the very same frame pipeline and streamed-shadow owner used by
 * FestivalRenderer on a small deterministic scene. This keeps GPU validation
 * independent of downloading photographic assets or streaming the full town. */
export async function capture() {
  const width = 320,
    height = 180;
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const context = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!context) throw new Error('WebGL2 unavailable');
  const renderer = new T.WebGLRenderer({ canvas, context });
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.shadowMap.enabled = true;
  const scene = new T.Scene();
  scene.background = new T.Color(0x93b4c8);
  const camera = new T.PerspectiveCamera(57, width / height, 0.3, 26000);
  camera.position.set(0, 2, -6);
  camera.lookAt(0, 0.6, 14);
  camera.updateMatrixWorld();
  const sun = new T.DirectionalLight(0xffeedc, 3);
  sun.castShadow = true;
  sun.position.copy(lightingDirection('day')).normalize().multiplyScalar(400);
  Object.assign(sun.shadow.camera, {
    left: -70,
    right: 70,
    top: 70,
    bottom: -70,
    near: 20,
    far: 900,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.mapSize.set(512, 512);
  scene.add(new T.HemisphereLight(0xa2c4e5, 0x504a36, 0.6), sun, sun.target);
  const shadows = new FestivalShadows(renderer, scene, sun);
  const terrain = new T.Group();
  const roadMaterial = new T.MeshStandardMaterial({ color: 0x3c3c3b, roughness: 0.8 });
  const ground = new T.Mesh(new T.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), roadMaterial);
  ground.receiveShadow = true;
  ground.geometry.computeBoundingBox();
  terrain.add(ground);
  scene.add(terrain);
  const markerMaterial = new T.MeshStandardMaterial({ color: 0xe3dccb });
  for (let z = 3; z < 110; z += 3) {
    const stripe = new T.Mesh(new T.BoxGeometry(0.16, 0.012, 1.8), markerMaterial);
    stripe.position.set(2.8, 0.02, z);
    stripe.receiveShadow = true;
    scene.add(stripe);
  }
  const staticMaterial = new T.MeshStandardMaterial({ color: 0x69754b });
  for (const [x, z] of [
    [9, 16],
    [-12, 28],
    [30, 110],
    [80, 230],
  ]) {
    const tree = new T.Mesh(new T.BoxGeometry(5, 16, 5), staticMaterial);
    tree.position.set(x, 8, z);
    tree.castShadow = true;
    tree.receiveShadow = true;
    scene.add(tree);
  }
  const body = new T.Mesh(
    new T.BoxGeometry(1.7, 0.8, 3.5),
    new T.MeshStandardMaterial({ color: 0x9c2519 }),
  );
  body.position.set(0, 0.6, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  scene.add(body);
  const composer = new EffectComposer(renderer);
  let graphics: GraphicsOptions = { ...graphicsPreset('medium'), shadowSize: 512 };
  const image = new FestivalFramePipeline(renderer, camera, sun, scene, composer, graphics);
  const bloom = new LensBloomPass();
  const grade = new BroadcastGradePass();
  const output = new OutputPass();
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);
  const wet = new WetRoadReflection();
  const ultra = new UltraPipeline({
    renderer,
    scene,
    camera,
    composer,
    scenePass: image.scenePass,
    bloom,
    grade,
    sun,
    farShadow: shadows.far,
    wetReflection: wet,
    roadMaterial,
  });
  // Full cascade behavior at bounded fixture resolution on the software GPU.
  ultra.mid.light.shadow.mapSize.set(512, 512);
  const configure = (preset: QualityPreset) => {
    graphics = { ...graphicsPreset(preset), shadowSize: preset === 'low' ? 0 : 512 };
    renderer.shadowMap.enabled = graphics.shadowSize > 0;
    sun.castShadow = graphics.shadowSize > 0;
    image.configure(graphics);
    shadows.configure(graphics.shadowSize);
    ultra.configure(preset, graphics);
    bloom.enabled = graphics.bloom;
    grade.enabled = graphics.filmGrade;
  };
  composer.setSize(width, height);
  configure('medium');
  const presented = new Float32Array(HEADER + CAR_STRIDE);
  presented[H.CARS] = 1;
  presented[carBase(0) + F.Y] = 0.6;
  presented[carBase(0) + F.QW] = 1;
  presented[carBase(0) + F.VZ] = 80;
  presented[carBase(0) + F.SPEED] = 80;
  let terrainRevision = 1;
  const settleMeter = async () => {
    const deadline = performance.now() + 20000;
    while (image.exposure.diagnostics().pending) {
      if (performance.now() > deadline) throw new Error('Festival meter readback did not settle');
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  };
  const draw = async (time: number, photo = false, reduced = false, cut = false) => {
    presented[H.TIME] = time;
    scene.updateMatrixWorld(true);
    image.prepare(presented, graphics, 'day', 'chase', 0, photo, cut, 1, reduced);
    shadows.update({
      subject: body.position,
      lighting: 'day',
      terrainRevision,
      dt: 0.05,
      terrain,
      planting: [],
      hidden: [body],
    });
    grade.apply('day');
    ultra.prepareFrame({
      presented,
      cars: [],
      subject: body.position,
      cameraMode: 'chase',
      lighting: 'day',
      studio: false,
      menu: false,
      photo,
      replay: false,
      otherDof: false,
      cut,
    });
    composer.render();
    ultra.afterFrame();
    await settleMeter();
  };
  const pixels = () => {
    const data = new Uint8Array(width * height * 4);
    context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, data);
    return data;
  };
  for (let i = 0; i < 20; i++) {
    if (i === 3) terrainRevision++; // A newly displayed streamed tile.
    await draw(1 + i * 0.05, false, false, i === 0);
  }
  const medium = {
    ...image.diagnostics(),
    shadows: shadows.diagnostics(),
    ultra: ultra.diagnostics(),
  };
  await draw(2);
  const moving = pixels();
  await draw(2, false, true);
  const still = pixels();
  let motionChangedPixels = 0;
  for (let i = 0; i < moving.length; i += 4)
    if (
      Math.abs(moving[i] - still[i]) +
        Math.abs(moving[i + 1] - still[i + 1]) +
        Math.abs(moving[i + 2] - still[i + 2]) >
      2
    )
      motionChangedPixels++;
  const reduced = image.diagnostics();
  await draw(2, true);
  const photo = image.diagnostics();
  configure('ultra');
  for (let i = 0; i < 8; i++) await draw(3 + i * 0.05, false, false, i === 0);
  const high = {
    ...image.diagnostics(),
    shadows: shadows.diagnostics(),
    ultra: ultra.diagnostics(),
  };
  configure('low');
  await draw(4, false, false, true);
  const off = { ...image.diagnostics(), ultra: ultra.diagnostics() };
  configure('medium');
  await draw(5, false, false, true);
  await draw(5.05);
  const restored = { ...image.diagnostics(), ultra: ultra.diagnostics() };
  const glErrors: number[] = [];
  for (
    let error = context.getError();
    error !== context.NO_ERROR && glErrors.length < 8;
    error = context.getError()
  )
    glErrors.push(error);
  const screenshot = canvas.toDataURL('image/png');
  image.dispose();
  image.dispose();
  shadows.dispose();
  ultra.dispose();
  bloom.dispose();
  grade.dispose();
  output.dispose();
  wet.dispose();
  composer.dispose();
  const sharedContextAlive = !context.isContextLost();
  renderer.dispose();
  canvas.remove();
  return {
    medium,
    reduced,
    photo,
    high,
    off,
    restored,
    glErrors,
    motionChangedPixels,
    sharedContextAlive,
    screenshot,
  };
}
