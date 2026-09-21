import * as T from 'three';
import { SprayClouds } from '../../src/rendering/spray-clouds.ts';
import { CrowdCluster } from '../../src/rendering/crowd.ts';
import { CAR_STRIDE, HEADER, H, F, carBase } from '../../src/simulation/protocol.ts';
import { disposePhase27Scene } from './phase27c-resources.ts';

/** Synthetic single-emitter oracle of the real production shader, not a claimed
 * race image. Read back the GPU so missing material hooks cannot pass unnoticed. */
export function verifySprayContinuityGPU() {
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(512, 512);
  renderer.outputColorSpace = T.SRGBColorSpace;
  const scene = new T.Scene();
  scene.background = new T.Color(0x080a10);
  const camera = new T.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 8;
  const light = new T.AmbientLight(0xffffff, 1);
  scene.add(light);
  const positions = new Float32Array(3),
    sizes = new Float32Array([2]);
  const opacity = new Float32Array([0.65]),
    velocities = new Float32Array(3),
    kinds = new Uint8Array([0]);
  const spray = new SprayClouds(positions, velocities, sizes, opacity, kinds);
  scene.add(spray.mesh);
  const target = new T.WebGLRenderTarget(512, 512),
    blank = new Uint8Array(512 * 512 * 4),
    pixels = new Uint8Array(blank.length);
  const images: { view: string; image: string }[] = [];
  const measure = (name: string) => {
    spray.mesh.visible = false;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 512, 512, blank);
    spray.mesh.visible = true;
    spray.upload();
    renderer.info.reset();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 512, 512, pixels);
    let changed = 0,
      energy = 0,
      minX = 512,
      maxX = -1,
      minY = 512,
      maxY = -1;
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        const p = (y * 512 + x) * 4;
        const delta =
          Math.abs(pixels[p] - blank[p]) +
          Math.abs(pixels[p + 1] - blank[p + 1]) +
          Math.abs(pixels[p + 2] - blank[p + 2]);
        energy += delta;
        if (delta > 3) {
          changed++;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    const metrics = {
      changed,
      energy,
      width: Math.max(0, maxX - minX + 1),
      height: Math.max(0, maxY - minY + 1),
      draws: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
    if (['distant', 'nearby', 'dim'].includes(name)) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      images.push({ view: `spray-${name}`, image: renderer.domElement.toDataURL('image/png') });
    }
    return metrics;
  };
  try {
    const distant = measure('distant'),
      initial = pixels.slice();
    const held = measure('held'),
      pauseExact = pixels.every((v, i) => v === initial[i]);
    camera.position.z = 4;
    const nearby = measure('nearby');
    camera.position.z = 8;
    measure('rewound');
    const rewindExact = pixels.every((v, i) => v === initial[i]);
    light.intensity = 0.08;
    const dim = measure('dim');
    light.intensity = 1;
    scene.fog = new T.Fog(0x080a10, 1, 2);
    const fogged = measure('fogged');
    scene.fog = null;
    const block = new T.Mesh(
      new T.PlaneGeometry(10, 10),
      new T.MeshBasicMaterial({ color: 0x080a10 }),
    );
    block.position.z = 1;
    scene.add(block);
    const occluded = measure('occluded');
    scene.remove(block);
    block.geometry.dispose();
    block.material.dispose();
    positions[2] = 7.96;
    const nearPlane = measure('near-plane');
    positions[2] = 9;
    const behind = measure('behind');
    positions[2] = 0;
    kinds[0] = 3;
    const nonSpray = measure('non-spray');
    kinds[0] = 0;
    opacity[0] = 0;
    spray.clear();
    const cleared = measure('cleared');
    scene.remove(spray.mesh);
    spray.geometry.dispose();
    spray.material.dispose();
    renderer.render(scene, camera);
    const memoryBefore = { ...renderer.info.memory };
    for (let i = 0; i < 5; i++) {
      const next = new SprayClouds(positions, velocities, sizes, opacity, kinds);
      scene.add(next.mesh);
      renderer.render(scene, camera);
      scene.remove(next.mesh);
      next.geometry.dispose();
      next.material.dispose();
    }
    renderer.render(scene, camera);
    const memoryAfter = { ...renderer.info.memory };
    return {
      distant,
      held,
      nearby,
      dim,
      fogged,
      occluded,
      nearPlane,
      behind,
      nonSpray,
      cleared,
      pauseExact,
      rewindExact,
      memoryBefore,
      memoryAfter,
      images,
      glError: renderer.getContext().getError(),
    };
  } finally {
    disposePhase27Scene(scene);
    target.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/** Controlled animation/LOD inputs exercise production colour, custom depth and
 * analytic card shaders. Close-up forced-LOD images are diagnostic, not in-game
 * claims: the production card starts at 420 m and is exclusive beyond 480 m. */
export function verifySpectatorContinuityGPU() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(960, 540);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  scene.background = new T.Color(0x77858b);
  const sunlight = new T.DirectionalLight(0xffe8cb, 3);
  sunlight.position.set(-4, 7, 3);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024);
  Object.assign(sunlight.shadow.camera, {
    left: -5,
    right: 5,
    top: 5,
    bottom: -5,
    near: 0.5,
    far: 30,
  });
  sunlight.shadow.normalBias = 0.01;
  scene.add(sunlight, sunlight.target, new T.HemisphereLight(0xc4d8eb, 0x323329, 0.7));
  const floor = new T.Mesh(
    new T.PlaneGeometry(30, 30),
    new T.MeshStandardMaterial({ color: 0x999586, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.32;
  floor.receiveShadow = true;
  scene.add(floor);
  const matrices: T.Matrix4[] = [],
    colors: T.Color[] = [];
  for (let row = 0; row < 2; row++)
    for (let seat = 0; seat < 8; seat++) {
      matrices.push(new T.Matrix4().makeTranslation(row * 0.9, row * 0.55, (seat - 3.5) * 0.62));
      colors.push(new T.Color([0x983b29, 0x326c5d, 0xb49b74, 0x30475c][seat % 4]));
    }
  const material = new T.MeshStandardMaterial({ roughness: 0.88, vertexColors: true });
  const crowd = new CrowdCluster(matrices, colors, 61, material);
  scene.add(crowd.root);
  const camera = new T.PerspectiveCamera(40, 960 / 540, 0.1, 1200);
  camera.position.set(-5, 3.0, 5);
  camera.lookAt(0.45, 0.45, 0);
  // Explicit synthetic snapshots are sufficient for shader response invariants;
  // full simulation snapshots are separately used by the venue/race fixtures.
  const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
  frame[H.CARS] = 2;
  frame[carBase(0) + F.X] = -10;
  frame[carBase(1) + F.X] = -10;
  frame[carBase(1) + F.Z] = 4;
  const captures: {
    view: string;
    image: string;
    draws: number;
    triangles: number;
    activeLevels: number;
  }[] = [];
  const capture = (view: string, time: number, lodCamera = camera.position) => {
    crowd.update(time, lodCamera, 0, frame);
    renderer.info.reset();
    renderer.render(scene, camera);
    const image = canvas.toDataURL('image/png');
    captures.push({
      view,
      image,
      draws: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      activeLevels: crowd.levels.filter((l) => l.visible).length,
    });
    return image;
  };
  try {
    const quiet = capture('spectators-quiet', 12);
    frame[carBase(0) + F.SPEED] = 45;
    frame[carBase(1) + F.SPEED] = 45;
    const state = frame.slice(),
      battle = capture('spectators-battle', 12);
    const held = capture('spectators-held', 12);
    frame[carBase(0) + F.IMPACT] = 1;
    const flinch = capture('spectators-flinch', 14);
    frame.set(state);
    const rewind = capture('spectators-rewind', 12);
    const blend = capture('spectators-mesh-card-handoff', 12, new T.Vector3(450.45, 0.275, 0));
    const card = capture('spectators-forced-card', 12, new T.Vector3(600.45, 0.275, 0));
    capture('spectators-return-handoff', 12, new T.Vector3(450.45, 0.275, 0));
    const returning = captures.at(-1)!.image;
    const memoryBefore = { ...renderer.info.memory };
    capture('spectators-repeat-card', 12, new T.Vector3(600.45, 0.275, 0));
    const memoryAfter = { ...renderer.info.memory };
    return {
      captures,
      pauseExact: battle === held,
      rewindExact: battle === rewind,
      reactionVisible: quiet !== battle,
      flinchVisible: battle !== flinch,
      handoffExact: blend === returning,
      cardVisible: card !== blend,
      sourceUnchanged: frame.every((v, i) => Object.is(v, state[i])),
      memoryBefore,
      memoryAfter,
      glError: renderer.getContext().getError(),
    };
  } finally {
    disposePhase27Scene(scene);
    material.dispose();
    sunlight.shadow.map?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }
}
