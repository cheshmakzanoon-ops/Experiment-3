import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { configureSky, daylightState, SkyEnvironment, SUN_OFFSET } from '../../src/rendering/daylight.ts';
import { FormulaCar } from '../../src/rendering/car.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { carBase, H } from '../../src/simulation/protocol.ts';

/** Fixed studio review of actual production geometry/materials. It does not
 * certify the complete application, handling, audio or consumer-hardware FPS. */
export function capturePhase27Hero() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1); renderer.setSize(1280, 720);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = daylightState(0, 0).exposure;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene(); scene.background = new T.Color(0x374149);
  const sky = new Sky(); configureSky(sky); const environment = new SkyEnvironment(sky);
  environment.update(renderer, scene, 0);
  scene.environmentIntensity = 0.7;
  const sun = new T.DirectionalLight(0xffead0, 3.4);
  sun.position.copy(SUN_OFFSET).multiplyScalar(0.03); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 30 });
  sun.shadow.normalBias = 0.008;
  scene.add(sun, sun.target, new T.HemisphereLight(0xc3d8f3, 0x33372e, 0.7));
  const floor = new T.Mesh(new T.PlaneGeometry(25, 25), new T.MeshStandardMaterial({ color: 0x5a6265, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.525; floor.receiveShadow = true; scene.add(floor);
  const car = new FormulaCar(0), simulation = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0, seed: 1887 });
  for (let tick = 0; tick < 120; tick++) simulation.step(1 / 120);
  const frame = simulation.makeFrame(), original = frame.slice();
  car.update(frame, frame, carBase(0), 1, 0, frame[H.TIME], false);
  car.root.position.set(0, 0, 0); car.root.quaternion.identity(); scene.add(car.root);
  const camera = new T.PerspectiveCamera(35, 1280 / 720, 0.025, 100);
  const captures: { view: string; image: string; draws: number; triangles: number }[] = [];
  try {
    for (const shot of [
      { name: 'front-three-quarter', eye: [3.4, 1.75, 5.2], at: [0, -0.1, 0.4] },
      { name: 'rear-three-quarter', eye: [-3, 1.5, -4.7], at: [0, 0.12, -0.5] },
      { name: 'driver', eye: [-0.75, 0.75, 0.72], at: [0, 0.10, -0.14] },
      { name: 'glove', eye: [0.01, 0.31, 0.005], at: [0.18, 0.1, 0.20] },
      { name: 'inlet', eye: [1.13, 0.24, 1.50], at: [0.53, 0.02, 0.30] },
      { name: 'helmet', eye: [-0.43, 0.43, 0.23], at: [0, 0.29, -0.37] },
      { name: 'wheel-carrier', eye: [1.3, 0.22, 2.13], at: [0.73, -0.17, 1.67] },
    ]) {
      camera.position.set(...(shot.eye as [number, number, number]));
      camera.lookAt(...(shot.at as [number, number, number]));
      renderer.info.reset(); renderer.render(scene, camera);
      captures.push({ view: shot.name, image: canvas.toDataURL('image/png'),
        draws: renderer.info.render.calls, triangles: renderer.info.render.triangles });
    }
    return { captures, sourceUnchanged: frame.every((v, i) => Object.is(v, original[i])),
      glError: renderer.getContext().getError(), memory: { ...renderer.info.memory } };
  } finally {
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>();
    scene.traverse((object) => {
      if (object instanceof T.InstancedMesh) object.dispose();
      if (!(object instanceof T.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
      }
    });
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); textures.forEach((t) => t.dispose());
    environment.dispose(); sun.shadow.map?.dispose(); renderer.dispose(); canvas.remove();
  }
}
