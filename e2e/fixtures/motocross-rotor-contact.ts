import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BikeMaterials } from '../../src/rendering/bike.ts';
import { DirtBikeModel } from '../../src/rendering/offroad/dirt-bike-model.ts';
import { motocrossRotor } from '../../src/rendering/offroad/motocross-detail.ts';
import { mudUniforms } from '../../src/rendering/offroad/mud.ts';
import { VEHICLES } from '../../src/simulation/vehicles.ts';

/** Compare the wiped friction track to the unswept carrier under the same
 * wet deposit, measured on the actual front and rear rotor materials. */
export function measureMxBrakeTrack(rear: boolean) {
  const palette = new BikeMaterials(0, 'dirt'), coat = mudUniforms();
  const bike = new DirtBikeModel(VEHICLES.mx450, 0, 'high', palette, coat);
  const name = rear ? 'Motocross rear stainless wave rotor' : 'Motocross stainless wave rotor';
  let steel: T.Material | undefined;
  bike.root.traverse((o) => {
    if (o instanceof T.Mesh) {
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      steel ??= materials.find((m: T.Material) => m.name === name);
    }
  });
  if (!steel) throw new Error('Missing production rotor material');
  const glRenderer = new T.WebGLRenderer({ alpha: true, antialias: false });
  const size = 240, radius = rear ? 0.117 : 0.131, half = radius * 1.08;
  glRenderer.setSize(size, size, false);
  glRenderer.setClearColor(0, 0);
  glRenderer.outputColorSpace = T.LinearSRGBColorSpace;
  const room = new RoomEnvironment(), pmrem = new T.PMREMGenerator(glRenderer);
  const environment = pmrem.fromScene(room);
  const scene = new T.Scene();
  scene.environment = environment.texture;
  const geometry = motocrossRotor(radius, 'high');
  scene.add(new T.Mesh(geometry, steel), new T.HemisphereLight(0xffffff, 0x9d8a6f, 1));
  const camera = new T.OrthographicCamera(-half, half, half, -half, 0.02, 2);
  camera.position.x = 0.65;
  camera.lookAt(0, 0, 0);
  const gl = glRenderer.getContext();
  const read = (mud: number) => {
    coat.offroadMud.value = mud;
    coat.offroadMudWet.value = 1;
    glRenderer.render(scene, camera);
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  try {
    const clean = read(0), coated = read(0.95), returned = read(0);
    const stats = (r0: number, r1: number) => {
      let count = 0, delta = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const r = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1) * half / radius;
        const o = 4 * (y * size + x);
        if (r < r0 || r > r1 || clean[o + 3] < 250) continue;
        count++;
        for (let c = 0; c < 3; c++) delta += Math.abs(clean[o + c] - coated[o + c]);
      }
      return { pixels: count, meanChange: delta / (3 * count) };
    };
    return { track: stats(0.84, 0.92), carrier: stats(0.46, 0.72),
      restored: clean.every((v, index) => returned[index] === v),
      calls: glRenderer.info.render.calls, glError: gl.getError() };
  } finally {
    geometry.dispose();
    bike.dispose();
    palette.dispose();
    room.dispose();
    environment.dispose();
    pmrem.dispose();
    glRenderer.dispose();
    glRenderer.forceContextLoss();
  }
}
