import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FormulaCar } from '../../src/rendering/car.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { carBase, H } from '../../src/simulation/protocol.ts';

/** Production car/materials in a fixed studio, not a substitute for full-lap review. */
export function captureAeroSurfaces() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(1280, 720);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  const scene = new T.Scene();
  scene.background = new T.Color(0x273138);
  const room = new RoomEnvironment();
  const generator = new T.PMREMGenerator(renderer);
  const environment = generator.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.add(new T.HemisphereLight(0xddeeff, 0x29313a, 2));
  const sun = new T.DirectionalLight(0xffe8cc, 3);
  sun.position.set(-3, 5, 4);
  scene.add(sun);
  const car = new FormulaCar(0);
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    weather: 'clear',
    opponents: 0,
    seed: 1887,
  });
  const frame = simulation.makeFrame();
  const original = frame.slice();
  car.update(frame, frame, carBase(0), 1, 0, frame[H.TIME], false);
  car.root.position.set(0, 0, 0);
  car.root.quaternion.identity();
  scene.add(car.root);
  const camera = new T.PerspectiveCamera(35, 1280 / 720, 0.05, 30);
  const captures: { view: string; image: string; draws: number; triangles: number }[] = [];
  try {
    for (const view of [
      { name: 'front-three-quarter', eye: [3.4, 1.75, 5.2], at: [0, -0.1, 0.4] },
      { name: 'front-wing', eye: [1.8, 0.55, 3.7], at: [0, -0.22, 2.3] },
      { name: 'rear-three-quarter', eye: [-3, 1.5, -4.7], at: [0, 0.12, -0.5] },
      { name: 'rear-wing', eye: [1.9, 1, -3.6], at: [0, 0.5, -2.06] },
    ]) {
      camera.position.set(...(view.eye as [number, number, number]));
      camera.lookAt(...(view.at as [number, number, number]));
      renderer.render(scene, camera);
      captures.push({
        view: view.name,
        image: canvas.toDataURL('image/png'),
        draws: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      });
    }
    return {
      captures,
      sourceUnchanged: frame.every((value, index) => Object.is(value, original[index])),
      glError: renderer.getContext().getError(),
    };
  } finally {
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    car.root.traverse((object) => {
      if (object instanceof T.InstancedMesh) object.dispose();
      if (!(object instanceof T.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof T.Texture) textures.add(value);
      }
    });
    for (const value of [...geometries, ...materials, ...textures]) value.dispose();
    environment.dispose();
    room.dispose();
    generator.dispose();
    renderer.dispose();
    canvas.remove();
  }
}
