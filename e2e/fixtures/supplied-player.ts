import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadSuppliedPlayer } from '../../src/rendering/supplied-player.ts';
import { drawSteeringDisplay } from '../../src/rendering/steering-display.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { controls, DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { carBase, F, W, WHEEL_BASE, WHEEL_STRIDE } from '../../src/simulation/protocol.ts';

/** Uses the shipped binary, its actual skeleton, and production simulation
 * snapshots. This studio fixture verifies fit/rig, not a full-lap FPS target. */
export async function captureSuppliedPlayer(url: string) {
  const asset = await loadSuppliedPlayer(() => false, fetch, url);
  const lcd = document.createElement('canvas');
  lcd.width = 512;
  lcd.height = 256;
  const texture = new T.CanvasTexture(lcd);
  texture.colorSpace = T.SRGBColorSpace;
  const player = asset.take(texture);
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  document.body.style.cssText = 'margin:0;background:#171c23';
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1200, 800);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  scene.background = new T.Color(0x687786);
  const pmrem = new T.PMREMGenerator(renderer),
    environment = new RoomEnvironment();
  const env = pmrem.fromScene(environment, 0.04);
  environment.dispose();
  pmrem.dispose();
  scene.environment = env.texture;
  const chassis = new T.Group();
  chassis.add(player.root);
  scene.add(chassis);
  const hemi = new T.HemisphereLight(0xd5e5ff, 0x676356, 2);
  scene.add(hemi);
  const sun = new T.DirectionalLight(0xfff3e3, 3.2);
  sun.position.set(-4, 7, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -5;
  sun.shadow.camera.right = sun.shadow.camera.top = 5;
  sun.shadow.bias = -0.0001;
  scene.add(sun);
  const floor = new T.Mesh(
    new T.PlaneGeometry(50, 50),
    new T.MeshStandardMaterial({ color: 0x424b56, roughness: 0.83 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const camera = new T.PerspectiveCamera(68, 1.5, 0.025, 100);
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    opponents: 0,
    weather: 'clear',
    seed: 711,
  });
  for (let i = 0; i < 120; i++) sim.step(1 / 120);
  const neutral = sim.makeFrame();
  sim.setInput({ ...controls(), steer: 1, brake: 1 });
  for (let i = 0; i < 180; i++) sim.step(1 / 120);
  const left = sim.makeFrame();
  sim.setInput({ ...controls(), steer: -1, brake: 1 });
  for (let i = 0; i < 180; i++) sim.step(1 / 120);
  const right = sim.makeFrame();
  const o = carBase(0),
    results = [];
  const sourceFrames = [neutral.slice(), left.slice(), right.slice()];
  const bones = new Map<string, T.Object3D>();
  player.root.traverse((o) => {
    if (o instanceof T.Bone) bones.set(o.userData.name ?? o.name, o);
  });
  const handInWheel = () => {
    const wheel = bones.get('steering')!;
    return ['L', 'R'].map((side) =>
      wheel.worldToLocal(bones.get(`hand.${side}`)!.getWorldPosition(new T.Vector3())).toArray(),
    );
  };
  for (const [name, frame, mode] of [
    ['exterior', neutral, 'exterior'],
    ['cockpit-neutral', neutral, 'cockpit'],
    ['cockpit-left', left, 'cockpit'],
    ['cockpit-right', right, 'cockpit'],
    ['cockpit-paused', right, 'cockpit'],
    ['cockpit-rewind', neutral, 'cockpit'],
    ['pod', neutral, 'pod'],
  ] as const) {
    drawSteeringDisplay(lcd.getContext('2d')!, frame, o);
    texture.needsUpdate = true;
    // Match the production renderer's chassis/asset hierarchy. Normalize only
    // terrain elevation, never overwrite the imported asset's suspension datum.
    const suspension = frame[o + WHEEL_BASE + W.LENGTH];
    const radius = frame[o + WHEEL_BASE + W.RADIUS];
    chassis.position.y = suspension + radius - 0.05;
    player.update(frame, frame, o, 1, mode === 'cockpit');
    camera.fov = mode === 'exterior' ? 44 : 68;
    camera.updateProjectionMatrix();
    if (mode === 'exterior') {
      camera.position.set(3.7, 2, 5.5);
      camera.lookAt(0, 0.43, 0);
    } else {
      camera.position.copy(mode === 'pod' ? player.pod : player.eye).add(chassis.position);
      camera.lookAt(camera.position.clone().add(new T.Vector3(0, -0.035, 1)));
    }
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    const screen = player.screenWorld(new T.Vector3()).project(camera);
    results.push({
      name,
      mode,
      image: canvas.toDataURL('image/png'),
      screen: screen.toArray(),
      suspension: [0, 1, 2, 3].map((i) => frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.LENGTH]),
      wheelWorld: player.wheels.map((wheel) => wheel.getWorldPosition(new T.Vector3()).toArray()),
      chassisY: chassis.position.y,
      steer: frame[o + F.STEER],
      diagnostics: player.diagnostics(),
      pose: player.driverPose(),
      handInWheel: handInWheel(),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  // All detail levels use the same mesh identities, material objects and rig.
  // Compare them at a demanding close exterior view before testing resource reuse.
  camera.fov = 44;
  camera.position.set(3.7, 2, 5.5);
  camera.lookAt(0, 0.43, 0);
  camera.updateProjectionMatrix();
  player.update(neutral, neutral, o, 1, false);
  const pose = player.driverPose();
  const identity = new Map<
    T.Mesh,
    {
      material: T.Material | T.Material[];
      position: T.BufferAttribute | T.InterleavedBufferAttribute;
    }
  >();
  player.root.traverse((object) => {
    if (object instanceof T.Mesh)
      identity.set(object, {
        material: object.material,
        position: object.geometry.getAttribute('position'),
      });
  });
  const size = renderer.getDrawingBufferSize(new T.Vector2());
  const readPixels = () => {
    const data = new Uint8Array(size.x * size.y * 4);
    const gl = renderer.getContext();
    gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return data;
  };
  const lodReview = [];
  let reference: Uint8Array | undefined;
  for (const [label, level, quality, exact] of [
    ['original-close', 0, 'high', false],
    ['efficient-close', 0, 'low', false],
    ['medium-detail', 1, 'medium', false],
    ['distant-detail', 2, 'low', false],
    ['original-restored', 0, 'low', true],
  ] as const) {
    player.lods!.setLevel(level, quality, exact);
    player.update(neutral, neutral, o, 1, false);
    renderer.render(scene, camera);
    const current = readPixels();
    reference ??= current;
    let sum = 0,
      max = 0;
    for (let i = 0; i < current.length; i++) {
      const delta = Math.abs(current[i] - reference[i]);
      sum += delta;
      max = Math.max(max, delta);
    }
    lodReview.push({
      label,
      lod: player.lods!.diagnostics(),
      triangles: renderer.info.render.triangles,
      calls: renderer.info.render.calls,
      meanChannelDelta: sum / current.length,
      maxChannelDelta: max,
      image: canvas.toDataURL('image/png'),
      pose: player.driverPose(),
      resources: { ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 },
      identityRetained: [...identity].every(
        ([mesh, value]) =>
          mesh.material === value.material &&
          mesh.geometry.getAttribute('position') === value.position,
      ),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const warmedResources = {
    ...renderer.info.memory,
    programs: renderer.info.programs?.length ?? 0,
  };
  for (let i = 0; i < 6; i++) {
    player.lods!.setLevel(i % 3, 'low');
    player.update(neutral, neutral, o, 1, false);
    renderer.render(scene, camera);
  }
  const reusedResources = {
    ...renderer.info.memory,
    programs: renderer.info.programs?.length ?? 0,
  };
  const poseRetained = JSON.stringify(pose) === JSON.stringify(player.driverPose());
  const glError = renderer.getContext().getError();
  const sourceUnchanged = [neutral, left, right].every((f, i) =>
    f.every((v, j) => v === sourceFrames[i][j]),
  );
  player.disposeAnimation();
  const disposalGeometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  scene.traverse((o) => {
    if (o instanceof T.Mesh) {
      disposalGeometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(m);
        for (const v of Object.values(m)) if (v instanceof T.Texture) textures.add(v);
      }
    }
  });
  disposalGeometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
  env.dispose();
  renderer.dispose();
  asset.dispose();
  return {
    results,
    lodReview,
    warmedResources,
    reusedResources,
    poseRetained,
    glError,
    sourceUnchanged,
  };
}
