import * as T from 'three';
import { FormulaCar } from '../../src/rendering/car.ts';
import { TireCarcass } from '../../src/rendering/tire-carcass.ts';
import { treadMaterial } from '../../src/rendering/materials.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../../src/simulation/protocol.ts';

/** Actual production geometry and real simulation snapshots for alignment.
 * The isolated loaded/unloaded/puncture pictures are declared controlled tire
 * fixtures, not evidence that a player completed the section-146 race scenario. */
export function verifyWheelFidelity() {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  sim.cars[0].input.throttle = 0.3;
  sim.cars[0].input.steer = 0.65;
  for (let i = 0; i < 120; i++) sim.step(1 / 120);
  const a = sim.makeFrame();
  for (let i = 0; i < 8; i++) sim.step(1 / 120);
  const b = sim.makeFrame(),
    o = carBase(0),
    originals = [a.slice(), b.slice()];
  const car = new FormulaCar(0);
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(512, 384);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.setPixelRatio(1);
  document.body.append(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0xd0d8de);
  scene.add(new T.HemisphereLight(0xffffff, 0x444444, 2));
  const sun = new T.DirectionalLight(0xffffff, 3);
  sun.position.set(2, 4, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -2;
  sun.shadow.camera.right = sun.shadow.camera.top = 2;
  scene.add(sun);
  const camera = new T.PerspectiveCamera(40, 512 / 384, 0.05, 1000);
  const tread = treadMaterial(),
    marking = new T.MeshBasicMaterial({ color: 0xffc840 });
  const tire = new TireCarcass(0.155, tread.material, marking),
    rolling = new T.Group();
  const rim = new T.Mesh(
    new T.CylinderGeometry(0.245, 0.245, 0.314, 40),
    new T.MeshStandardMaterial({ color: 0x666a70, metalness: 0.7, roughness: 0.3 }),
  );
  rim.rotation.z = Math.PI / 2;
  rim.castShadow = true;
  rolling.add(tire.root, rim);
  const floor = new T.Mesh(
    new T.PlaneGeometry(10, 10),
    new T.MeshStandardMaterial({ color: 0x737c84, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.335;
  floor.receiveShadow = true;
  scene.add(rolling, floor);
  const target = new T.WebGLRenderTarget(512, 384);
  const pixels = () => {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const data = new Uint8Array(512 * 384 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 512, 384, data);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    return data;
  };
  const changed = (left: Uint8Array, right: Uint8Array) => {
    let count = 0;
    for (let i = 0; i < left.length; i += 4)
      if (
        Math.abs(left[i] - right[i]) +
          Math.abs(left[i + 1] - right[i + 1]) +
          Math.abs(left[i + 2] - right[i + 2]) >
        18
      )
        count++;
    return count;
  };
  try {
    camera.position.set(1.5, 0.28, 0.6);
    camera.lookAt(0, 0, 0);
    tire.update(0, 0.335, 0, 155);
    const unloaded = pixels();
    tire.update(0, 0.335, 7000, 155);
    const loaded = pixels(),
      loadedImage = renderer.domElement.toDataURL();
    const memoryBefore = renderer.info.memory.geometries;
    const times: number[] = [];
    for (let i = 0; i < 120; i++) {
      const phase = i / 20;
      const started = performance.now();
      tire.update(phase, 0.335, 4000 + 2500 * Math.sin(i / 20), 160);
      times.push(performance.now() - started);
      rolling.rotation.x = phase;
      if (i % 20 === 0) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      }
    }
    times.sort((left, right) => left - right);
    const memoryAfter = renderer.info.memory.geometries;
    tire.update(0, 0.258, 4000, 12);
    rolling.rotation.x = 0;
    const punctured = pixels(),
      puncturedImage = renderer.domElement.toDataURL();
    scene.remove(rolling, floor);
    scene.add(car.root);
    car.update(a, b, o, 0.5, 1 / 60, (a[H.TIME] + b[H.TIME]) / 2, false);
    const high = car.wheelPivots.map((pivot, i) => {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
      return {
        steer: pivot.rotation.y,
        camber: pivot.rotation.z,
        scale: pivot.scale.toArray(),
        expectedSteer: (a[p + W.STEER] + b[p + W.STEER]) / 2,
        expectedCamber: -(a[p + W.CAMBER] + b[p + W.CAMBER]) / 2,
      };
    });
    const rigid = car.wheelSpins
      .map((spin) =>
        spin.children
          .filter((child) => child instanceof T.Mesh)
          .map((child) => {
            const m = child as T.Mesh;
            return {
              mesh: m,
              vertices: new Float32Array(m.geometry.getAttribute('position').array),
              scale: m.scale.toArray(),
            };
          }),
      )
      .flat();
    const punctureFixture = b.slice();
    for (let i = 0; i < 4; i++)
      punctureFixture[o + WHEEL_BASE + i * WHEEL_STRIDE + W.RADIUS] = 0.258;
    car.update(punctureFixture, punctureFixture, o, 1, 1 / 60, b[H.TIME], false);
    const rigidUnchanged = rigid.every(({ mesh, vertices, scale }) => {
      const p = mesh.geometry.getAttribute('position');
      return (
        vertices.every((value, i) => value === p.array[i]) &&
        scale.every((v, i) => v === mesh.scale.toArray()[i])
      );
    });
    car.update(a, b, o, 0.5, 1 / 60, a[H.TIME], false);
    camera.position.set(3.8, 2.4, 5).applyQuaternion(car.root.quaternion).add(car.root.position);
    camera.lookAt(car.root.position);
    sun.position.copy(car.root.position).add(new T.Vector3(2, 4, 3));
    sun.target.position.copy(car.root.position);
    scene.add(sun.target);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    const carImage = renderer.domElement.toDataURL();
    const lods = [];
    for (const distance of [100, 1000]) {
      car.setLod(distance, 'medium', false);
      car.update(a, b, o, 0.5, 1 / 60, a[H.TIME], false);
      const visible = car.root.children.find(
        (child) => child.visible && child !== car.root.children[0],
      );
      // Reduced wheel groups are direct children with one spinning sub-group.
      const wheels =
        visible?.children.filter(
          (child) => child instanceof T.Group && child.children.some((c) => c instanceof T.Group),
        ) ?? [];
      lods.push({
        level: car.lodLevel,
        wheels: wheels.map((w) => ({
          steer: w.rotation.y,
          camber: w.rotation.z,
          scale: w.scale.toArray(),
        })),
      });
    }
    return {
      high,
      lods,
      rigidUnchanged,
      sourcesUnchanged:
        a.every((v, i) => v === originals[0][i]) && b.every((v, i) => v === originals[1][i]),
      loadChangedPixels: changed(unloaded, loaded),
      punctureChangedPixels: changed(loaded, punctured),
      memoryBefore,
      memoryAfter,
      updateMsP50: times[60],
      updateMsP95: times[114],
      updateMsMax: times[119],
      loadedImage,
      puncturedImage,
      carImage,
    };
  } finally {
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    for (const root of [scene, car.root, rolling, floor])
      root.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        geometries.add(object.geometry);
        for (const m of Array.isArray(object.material) ? object.material : [object.material])
          materials.add(m);
      });
    for (const m of materials)
      for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    sun.shadow.dispose();
    target.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
