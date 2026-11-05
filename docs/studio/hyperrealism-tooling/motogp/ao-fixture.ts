// Scratch A/B fixture for GP bike-space occlusion on the production BikeModel.
import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BikeMaterials,
  BikeModel,
  staticSag,
  type BikePoseValues,
} from '/home/user/Experiment-3/.claude/worktrees/agent-a98ba1889308b2f68/src/rendering/bike.ts';
import {
  bindGpOcclusion,
  gpOcclusionTexture,
  installGpOcclusion,
  setGpOcclusionStrength,
} from '/home/user/Experiment-3/.claude/worktrees/agent-a98ba1889308b2f68/src/rendering/gp-occlusion.ts';
import {
  chainShaderHook,
  injectAfter,
} from '/home/user/Experiment-3/.claude/worktrees/agent-a98ba1889308b2f68/src/rendering/studio/shader-hooks.ts';
import { VEHICLES } from '/home/user/Experiment-3/.claude/worktrees/agent-a98ba1889308b2f68/src/simulation/vehicles.ts';

const VIEWS: Record<string, { pos: [number, number, number]; at: [number, number, number]; fov: number }> = {
  'three-quarter': { pos: [-2.8, 1.65, 3.35], at: [0, 0.68, 0], fov: 38 },
  side: { pos: [3.7, 1.35, 0.1], at: [0, 0.68, 0], fov: 38 },
  'side-low': { pos: [2.2, 0.75, 0.2], at: [0, 0.55, 0.05], fov: 40 },
  'front-q': { pos: [1.5, 0.9, 2.2], at: [0, 0.55, 0.55], fov: 36 },
  'rear-chassis': { pos: [1.35, 0.8, -1.62], at: [0, 0.53, -0.37], fov: 35 },
  'rear-q': { pos: [-1.9, 1.2, -2.4], at: [0, 0.6, -0.2], fov: 36 },
};

export function capture(views: string[], lean = 0, debug = 0, width = 960, height = 600) {
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  scene.background = new T.Color('#aab9c6');
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
  scene.environmentIntensity = 0.55;
  const sun = new T.DirectionalLight(0xfff0d9, 3.1);
  sun.position.set(3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.1, far: 15 });
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.012;
  scene.add(sun, new T.HemisphereLight(0xc9e4ff, 0x514737, 1.3));
  const def = VEHICLES.gpr1,
    materials = new BikeMaterials(0),
    bike = new BikeModel(def, 0, 'high', materials, true);
  const t0 = performance.now();
  const grid = bike.occlusionGrid();
  const bakeMs = performance.now() - t0;
  bindGpOcclusion(materials.occlusion, { grid, texture: gpOcclusionTexture(grid) });
  const owned = new Set<T.Material>([...materials.list, ...bike.rider.ownedMaterials]);
  let hooked = 0;
  for (const m of owned)
    if (m instanceof T.MeshStandardMaterial && !m.transparent && m.colorWrite) {
      installGpOcclusion(m, materials.occlusion);
      if (debug)
        chainShaderHook(m, 'gp-occlusion-debug-v1', (shader) =>
          injectAfter(
            shader,
            'dithering_fragment',
            debug === 1
              ? 'gl_FragColor = vec4( vec3( gpOccDiffuse ), 1.0 );'
              : 'gl_FragColor = vec4( vec3( gpOccMirror ), 1.0 );',
            'fragment',
          ),
        );
      hooked++;
    }
  const sag = staticSag(def);
  const pose: BikePoseValues = {
    fork: sag.fork,
    shock: sag.shock,
    steer: 0,
    frontRotation: 0,
    rearRotation: 0,
    chassisLean: lean,
    riderOffset: lean ? 0.18 : 0,
    tuck: 0.75,
    brake: 0.05,
    rearBrake: 0,
    discTemp: 280,
    compoundColour: 0xffffff,
    riding: true,
    speed: 42,
    gear: 4,
    rpm: 12200,
  };
  bike.pose(pose);
  bike.root.position.y = def.bike!.cgHeight;
  if (lean) {
    bike.root.rotation.z = -lean;
    bike.root.position.y *= Math.cos(lean);
  }
  scene.add(bike.root);
  const floor = new T.Mesh(
    new T.PlaneGeometry(200, 200),
    new T.MeshStandardMaterial({ color: 0x45494d, roughness: 0.91 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  bike.root.traverse((o) => {
    if (o instanceof T.Mesh) o.castShadow = o.receiveShadow = true;
  });
  const camera = new T.PerspectiveCamera(38, width / height, 0.03, 80);
  const out: { view: string; on: boolean; image: string }[] = [];
  for (const view of views) {
    const v = VIEWS[view];
    camera.position.set(...v.pos);
    camera.fov = v.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(...v.at);
    for (const on of [false, true]) {
      setGpOcclusionStrength(materials.occlusion, on);
      scene.updateMatrixWorld(true);
      bike.sprung.updateWorldMatrix(true, false);
      materials.occlusion.gpOccFromWorld.value.copy(bike.sprung.matrixWorld).invert();
      renderer.render(scene, camera);
      out.push({ view, on, image: renderer.domElement.toDataURL('image/png') });
    }
  }
  const gl = renderer.getContext();
  return {
    out,
    bakeMs,
    hooked,
    dims: grid.dims,
    filled: grid.filled,
    glError: gl.getError(),
    programs: renderer.info.programs?.length ?? 0,
  };
}
