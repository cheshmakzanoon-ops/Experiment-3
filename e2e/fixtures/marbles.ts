import * as T from 'three';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { F, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../../src/simulation/protocol.ts';
import { CircuitScene } from '../../src/rendering/circuit.ts';
import { FormulaCar } from '../../src/rendering/car.ts';
import { Effects, PARTICLE_KIND } from '../../src/rendering/effects.ts';

/** Component GPU oracle, not the full section-146 driving acceptance. A declared
 * pre-rubbered track fixture exercises the unmodified production physics; clean
 * comparison images isolate material and particle output, not fake race events. */
export function verifyMarbleGPU() {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  sim.track.marbles.fill(0.75);
  sim.autoPlayer = true;
  const initial = sim.makeFrame();
  for (let tick = 0; tick < 360; tick++) sim.step(1 / 120);
  const frame = sim.makeFrame(),
    o = carBase(0);
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(256, 256);
  document.body.append(renderer.domElement);
  const target = new T.WebGLRenderTarget(256, 256),
    scene = new T.Scene();
  scene.background = new T.Color(0xb9c4ca);
  scene.add(new T.HemisphereLight(0xffffff, 0x606060, 3));
  const camera = new T.PerspectiveCamera(60, 1, 0.05, 1000);
  const circuit = new CircuitScene(sim.track, true),
    effects = new Effects(),
    car = new FormulaCar(0);
  const geometry = new T.PlaneGeometry(6, 6);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.getAttribute('position'),
    uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = 0.5 + pos.getX(i) / 16;
    uv[i * 2 + 1] = 0.2 + pos.getZ(i) / sim.track.length;
  }
  geometry.setAttribute('trackUV', new T.BufferAttribute(uv, 2));
  const road = new T.Mesh(geometry, circuit.roadMaterial);
  scene.add(road);
  const pixels = () => {
    const data = new Uint8Array(256 * 256 * 4);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 256, 256, data);
    return data;
  };
  const changed = (a: Uint8Array, b: Uint8Array) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4)
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
    return n;
  };
  try {
    camera.position.set(0, 3.5, 3.5);
    camera.lookAt(0, 0, 0);
    circuit.updateSurface(
      sim.track.water,
      sim.track.rubber,
      new Float32Array(sim.track.marbles.length),
    );
    const cleanRoad = pixels();
    circuit.updateSurface(sim.track.water, sim.track.rubber, sim.track.marbles);
    const marbleRoad = pixels(),
      roadChangedPixels = changed(cleanRoad, marbleRoad);
    const encodedDensity = circuit.stateBytes[2],
      expectedDensity = Math.round(sim.track.marbles[0] * 255);
    scene.remove(road);
    scene.add(car.root);
    const q = new T.Quaternion(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
    const offset = new T.Vector3(2.3, 0.9, 2.5).applyQuaternion(q);
    camera.position.set(frame[o] + offset.x, frame[o + 1] + offset.y, frame[o + 2] + offset.z);
    camera.lookAt(frame[o], frame[o + 1] - 0.2, frame[o + 2]);
    const clean = frame.slice();
    for (let wheel = 0; wheel < 4; wheel++) {
      const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
      clean[p + W.DIRT] = clean[p + W.WEAR] = clean[p + W.BLISTERING] = clean[p + W.GRAINING] = 0;
    }
    car.update(clean, clean, o, 1, 1 / 60, 3, false);
    const cleanTire = pixels();
    car.update(frame, frame, o, 1, 1 / 60, 3, false);
    const dirtyTire = pixels();
    const tireChangedPixels = changed(cleanTire, dirtyTire);
    const uniformCoverage = car.treads.map((t) => t.condition.value.x);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    const tireImage = renderer.domElement.toDataURL('image/png');
    scene.remove(car.root);
    scene.add(effects.group);
    const blank = pixels();
    effects.update(initial, 1 / 60);
    effects.update(frame, 1 / 60);
    const chips = pixels(),
      chipChangedPixels = changed(blank, chips);
    const diagnostics = effects.diagnostics();
    effects.clear();
    const clearDifferences = changed(blank, pixels());
    return {
      roadChangedPixels,
      tireChangedPixels,
      chipChangedPixels,
      clearDifferences,
      encodedDensity,
      expectedDensity,
      diagnostics,
      marbleKind: PARTICLE_KIND.MARBLE,
      uniformCoverage,
      tireImage,
      pickup: sim.cars[0].tires.map((t) => t.marblePickup),
      contamination: sim.cars[0].tires.map((t) => t.dirt),
      speedMps: sim.cars[0].speed,
    };
  } finally {
    const geometries = new Set<T.BufferGeometry>([geometry]);
    const materials = new Set<T.Material>([circuit.roadMaterial]);
    const textures = new Set<T.Texture>([circuit.stateTexture]);
    for (const root of [scene, car.root, circuit.group, effects.group])
      root.traverse((object) => {
        if (!(object instanceof T.Mesh || object instanceof T.Points)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          materials.add(material);
      });
    for (const m of materials)
      for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    target.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
