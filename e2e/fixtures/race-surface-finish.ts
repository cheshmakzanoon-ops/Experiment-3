import * as T from 'three';
import { FormulaCar } from '../../src/rendering/car.ts';
import { HeroShells } from '../../src/rendering/hero-shells.ts';
import { F, H, W, HEADER, CAR_STRIDE, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../../src/simulation/protocol.ts';
import { installVenueFinish } from '../../src/rendering/venue-materials.ts';
import { disposePhase27Scene } from './phase27c-resources.ts';

/** Controlled production component pixels, not a full driven race or GPU benchmark. */
export async function raceSurfaceGPU(heroBytes: number[]) {
  const hero = await HeroShells.decode(new Uint8Array(heroBytes));
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(384, 256);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  document.body.append(renderer.domElement);
  const scene = new T.Scene(); scene.background = new T.Color(0);
  const camera = new T.PerspectiveCamera(38, 1.5, .05, 100);
  const sun = new T.DirectionalLight(0xffffff, 5); sun.position.set(2, 3, 4);
  const fill = new T.HemisphereLight(0xffffff, 0x444444, 2);
  scene.add(sun, fill);
  const car = new FormulaCar(1, hero); scene.add(car.root);
  // Retain the real hierarchies, travel, material owners and LOD geometry. Hide
  // unrelated meshes only in this isolated inspection fixture, not in the game.
  car.root.traverse((object) => {
    if (object instanceof T.Mesh && !car.treads.some((t) => t.material === object.material))
      object.visible = false;
  });
  const b = new Float32Array(HEADER + CAR_STRIDE), o = carBase(0);
  b[H.CARS] = 1; b[o + F.QW] = 1; b[o + F.GEAR] = 1;
  b[o + F.FRONT_HEALTH] = b[o + F.REAR_HEALTH] = 1;
  for (let i = 0; i < 4; i++) {
    const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
    b[p + W.LENGTH] = .3; b[p + W.RADIUS] = .335; b[p + W.PRESSURE] = 155;
  }
  const captures: { name: string; image: string; hash: number; energy: number; nonzero: number; calls: number; triangles: number }[] = [];
  const data = new Uint8Array(384 * 256 * 4);
  const capture = (name: string) => {
    renderer.render(scene, camera);
    const gl = renderer.getContext(); gl.readPixels(0, 0, 384, 256, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let hash = 2166136261, energy = 0, nonzero = 0;
    for (let i = 0; i < data.length; i += 4) {
      const sum = data[i] + data[i + 1] + data[i + 2]; energy += sum; if (sum > 3) nonzero++;
      for (let c = 0; c < 3; c++) hash = Math.imul(hash ^ data[i + c], 16777619);
    }
    captures.push({ name, image: renderer.domElement.toDataURL('image/png'), hash: hash >>> 0,
      energy, nonzero, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
  };
  const resources = () => ({ geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0 });
  const materials: T.Material[] = [];
  let plane: T.Mesh<T.PlaneGeometry, T.MeshStandardMaterial> | undefined;
  try {
    car.update(b, b, o, 1, 0, 0, false); car.root.updateMatrixWorld(true);
    const target = car.wheelPivots[0].getWorldPosition(new T.Vector3());
    camera.position.copy(target).add(new T.Vector3(1.2, .6, 1.2)); camera.lookAt(target);
    for (const distance of [0, 90, 220]) {
      car.setLod(distance, 'high', false); car.update(b, b, o, 1, 0, 0, false);
      renderer.render(scene, camera);
    }
    const before = resources();
    for (const [distance, lod] of [[0, 0], [90, 1], [220, 2]]) {
      car.setLod(distance, 'high', false);
      for (const [label, compound, wet, dirt] of [
        ['slick', 1, 0, 0], ['inter', 3, 0, 0], ['wet', 4, 1, 0],
        ['held', 4, 1, 0], ['dirty', 4, 1, .9], ['rewound', 1, 0, 0],
      ] as const) {
        b[o + F.COMPOUND] = compound; b[H.RAIN] = wet * 14;
        for (let i = 0; i < 4; i++) b[o + WHEEL_BASE + i * WHEEL_STRIDE + W.DIRT] = dirt;
        car.update(b, b, o, 1, 0, 0, false); capture(`tire-${lod}-${label}`);
      }
    }
    const after = resources();
    car.root.visible = false;
    plane = new T.Mesh(new T.PlaneGeometry(30, 30), new T.MeshStandardMaterial());
    materials.push(plane.material); scene.add(plane);
    camera.position.set(.01, .01, 8); camera.lookAt(0, 0, 0);
    for (const finish of ['stone', 'timber', 'metal', 'paving'] as const) {
      const material = installVenueFinish(new T.MeshStandardMaterial({ color: 0x888888, roughness: .8 }), finish);
      materials.push(material); plane.material = material;
      capture(`venue-${finish}`); capture(`venue-${finish}-held`);
    }
    return { captures, before, after, glError: renderer.getContext().getError() };
  } finally {
    if (plane) { scene.remove(plane); plane.geometry.dispose(); }
    for (const material of materials) material.dispose();
    disposePhase27Scene(scene); hero.dispose(); renderer.dispose(); renderer.domElement.remove();
  }
}
