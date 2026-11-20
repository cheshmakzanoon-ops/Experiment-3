// CPU-only eight-rider camera cut. Run with npx vite-node --script scripts/bench/motocross-field.ts
import * as T from 'three';
import { BikeShells } from '../../src/rendering/bike.ts';
import { LocalAtmosphere } from '../../src/rendering/local-atmosphere.ts';
import { installSpecularIBL } from '../../src/rendering/studio/ibl-energy.ts';
import { TextureBudget } from '../../src/rendering/texture-budget.ts';
import { WeatherPresentation } from '../../src/rendering/weather-presentation.ts';
import { reflectInWetRoad } from '../../src/rendering/wet-reflection.ts';
import { rigTrack } from '../../src/simulation/offroad/jump-rig.ts';
import { CAR_STRIDE, F, H, HEADER, R, RACE_BASE, carBase } from '../../src/simulation/protocol.ts';
import { vehicleIndex } from '../../src/simulation/vehicles.ts';

// Materials need canvas dimensions and drawing methods during construction.
// No image is rendered or submitted to a GPU by this measurement.
const noop = () => undefined;
class ProbeCanvas {
  width = 0;
  height = 0;
  getContext() {
    const operations: Record<string, unknown> = {
      canvas: this,
      measureText: () => ({ width: 40 }),
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    };
    return new Proxy(operations, { get: (target, name: string) => target[name] ?? noop });
  }
}
Object.assign(globalThis, {
  document: { createElement: () => new ProbeCanvas() },
  HTMLCanvasElement: ProbeCanvas,
});

function countStorage(roots: T.Object3D[]) {
  const geometries = new Set<T.BufferGeometry>();
  const buffers = new Set<ArrayBufferLike>(),
    images = new Set<T.Source>();
  let baseImageBytes = 0;
  for (const root of roots)
    root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      const g = object.geometry as T.BufferGeometry;
      geometries.add(g);
      const attrs = [...Object.values(g.attributes), ...Object.values(g.morphAttributes).flat()];
      if (g.index) attrs.push(g.index);
      for (const a of attrs) buffers.add(a.array.buffer);
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(m)) {
          if (!(value instanceof T.Texture) || !value.image?.width || images.has(value.source))
            continue;
          images.add(value.source);
          baseImageBytes += value.image.width * value.image.height * 4;
        }
      }
    });
  const bytes = Array.from(buffers).reduce((sum, buffer) => sum + buffer.byteLength, 0);
  return {
    rigs: roots.length,
    uniqueGeometries: geometries.size,
    visible: roots.filter((root) => root.visible).length,
    geometryMiB: +(bytes / 2 ** 20).toFixed(2),
    baseImageMiB: +(baseImageBytes / 2 ** 20).toFixed(2),
  };
}

async function field(mode: 'storage' | 'timing') {
  const shells = new BikeShells(),
    textures = new TextureBudget();
  const weather = new WeatherPresentation(),
    air = new LocalAtmosphere(rigTrack('valley-ridge-mx'));
  const models: T.Object3D[] = [];
  shells.install = (root) => {
    if (/\((high|mid|far)\)$/.test(root.name)) models.push(root);
    if (mode === 'storage') return;
    textures.register(root);
    reflectInWetRoad(root);
    weather.install(root);
    air.install(root);
    installSpecularIBL(root);
  };
  shells.uninstall = (root) => textures.unregister(root);
  const frame = new Float32Array(HEADER + 8 * CAR_STRIDE);
  frame[H.CARS] = 8;
  const camera = new T.PerspectiveCamera(60, 16 / 9);
  camera.position.set(0, 2, -5);
  const spread = [0, 10, 25, 40, 65, 100, 180, 250];
  const cars = spread.map((_, i) => {
    const o = carBase(i);
    frame[o + F.QW] = 1;
    frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(i % 2 ? 'mx250' : 'mx450');
    const root = new T.Object3D();
    root.position.x = i * 1.15;
    return { root };
  });
  const present = () => shells.update(frame, frame, 1, cars, camera, 'high', 0);
  try {
    present();
    for (let i = 0; i < 240; i++) {
      frame[H.TIME] = i / 120;
      present();
    }
    const start = performance.now();
    await shells.prepareDirtField(
      () => false,
      async () => {},
    );
    const prepared = performance.now() - start;
    if (mode === 'storage') {
      return {
        sceneAtGate: countStorage(models.filter((m) => m.parent === shells.root)),
        prepared: countStorage(models),
      };
    }
    cars.forEach((car, i) => {
      car.root.position.z = spread[i];
    });
    const cut = performance.now();
    present();
    return {
      preparationMs: +prepared.toFixed(2),
      firstCutMs: +(performance.now() - cut).toFixed(2),
    };
  } finally {
    shells.disposeAll();
    textures.dispose();
    weather.dispose();
  }
}
if (process.argv.includes('--cadence')) {
  const { runMotocrossDisplayCadence } = await import('./motocross-display-cadence.ts');
  runMotocrossDisplayCadence();
} else {
  console.log('CPU rider data at the starting gate', await field('storage'));
  for (let run = 0; run < 3; run++)
    console.log('Eight-rider CPU camera cut', run + 1, await field('timing'));
}
