import * as T from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { FormulaCar } from '../src/rendering/car.ts';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { RoadBikeHost } from '../src/rendering/road-bike-host.ts';
import { sampleChassisPose } from '../src/rendering/snapshot-interpolation.ts';
import { CAR_STRIDE, carBase, F, H, HEADER, R, RACE_BASE } from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { DEFAULT_LIVERY } from '../src/storage/livery.ts';

afterEach(() => vi.unstubAllGlobals());

function stubCanvas() {
  const context = new Proxy(
    {
      measureText: () => ({ width: 40 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    },
    { get: (object, key) => Reflect.get(object, key) ?? (() => {}) },
  );
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
}

it.each([
  ['gp and road', ['gpr1', 'gpr2', 'sbk1000', 'ss600', 'nr900', 'cr750', 'gpr1', 'gpr2']],
  ['motocross', ['mx450', 'mx250', 'mx450', 'mx250', 'mx450', 'mx250', 'mx450', 'mx250']],
] as const)('allocates seven empty %s frames and assembles a replacement car exactly once', (_group, roster) => {
  stubCanvas();
  const scene = new T.Scene();
  const roadMaterial = new T.MeshStandardMaterial();
  const showroom = { id: 0, root: new T.Group() };
  const target = {
    scene,
    cars: [showroom] as (typeof showroom | RoadBikeHost | FormulaCar)[],
    circuit: { track: { circuit: {} }, roadMaterial },
    reflectionMaterials: [] as T.Material[][],
    pendingFormulaPitFits: new Set<number>(),
    deferredFormulaArt: new Set<number>(),
    installFormulaArt: vi.fn(),
    pitCrew: { setWheelGunFits: vi.fn() },
  };
  scene.add(showroom.root);
  const renderer = target as unknown as RacingRenderer;
  const frame = new Float32Array(HEADER + 8 * CAR_STRIDE);
  frame[H.CARS] = 8;
  roster.forEach((model, id) => {
    frame[carBase(id) + RACE_BASE + R.VEHICLE] = vehicleIndex(model);
  });
  const setCars = (count: number) => RacingRenderer.prototype.setCars.call(renderer, count, frame);
  setCars(8);
  expect(target.cars[0]).toBe(showroom);
  const rivals = target.cars.slice(1);
  for (const rival of rivals) {
    expect(rival).toBeInstanceOf(RoadBikeHost);
    expect(rival.root.children).toHaveLength(0);
  }
  expect(scene.children).toHaveLength(8);
  expect(target.pitCrew.setWheelGunFits).not.toHaveBeenCalled();
  setCars(3);
  expect(target.cars[3].root.visible).toBe(false);
  setCars(8);
  expect(target.cars.slice(1)).toEqual(rivals);
  frame[carBase(3) + RACE_BASE + R.VEHICLE] = vehicleIndex('apx01');
  setCars(8);
  const promoted = RacingRenderer.prototype.formulaCar.call(renderer, 3);
  expect(promoted).toBeInstanceOf(FormulaCar);
  expect(rivals[2].root.parent).toBeNull();
  expect(promoted.root.parent).toBe(scene);
  expect(target.reflectionMaterials[3]).toEqual([...promoted.reflectivePaint, roadMaterial]);
  setCars(8);
  expect(target.installFormulaArt).toHaveBeenCalledTimes(1);
  expect(target.pitCrew.setWheelGunFits).toHaveBeenCalledTimes(1);
  expect(target.pitCrew.setWheelGunFits.mock.calls[0][1]).toHaveLength(4);
  expect(target.cars.filter((car) => car instanceof RoadBikeHost)).toHaveLength(6);
});

it('holds a lightweight GP player through practice, then restores its edited Formula livery and mirrors on a vehicle cut', () => {
  stubCanvas();
  const renderer = Object.create(RacingRenderer.prototype) as RacingRenderer;
  const install = vi.fn(), fits = vi.fn(), mirrors = vi.fn();
  Object.assign(renderer, {
    scene: new T.Scene(), cars: [], showroomOnly: false,
    circuit: { track: { circuit: { id: 'poggio-alto' } }, roadMaterial: new T.MeshStandardMaterial() },
    vehicleBodies: { setPlayerLivery: vi.fn() },
    pendingFormulaPitFits: new Set(), deferredFormulaArt: new Set(), reflectionMaterials: [],
    installFormulaArt: install, pitCrew: { setWheelGunFits: fits },
    reflection: { attachMirrors: mirrors, quality: vi.fn() }, graphics: { mirrorQuality: 'low' },
  });
  renderer.setCars(1);
  const host = renderer.cars[0];
  expect(host).toBeInstanceOf(RoadBikeHost);
  expect(host.root.children).toHaveLength(0);
  const livery = { ...DEFAULT_LIVERY, primary: '#b2304c' };
  renderer.setLivery(livery);
  expect(renderer.playerPaintColour).toBe(livery.primary);
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  const slot = carBase(0) + RACE_BASE + R.VEHICLE;
  frame[slot] = vehicleIndex('gpr2');
  renderer.setCars(1, frame);
  expect(renderer.cars[0]).toBe(host);
  expect(install).not.toHaveBeenCalled();
  expect(fits).not.toHaveBeenCalled();
  frame[slot] = vehicleIndex('apx01');
  renderer.setCars(1, frame);
  renderer.setCars(1, frame);
  const player = renderer.formulaCar(0);
  expect(host.root.parent).toBeNull();
  expect(player.paint.color.getHexString()).toBe(livery.primary.slice(1));
  expect(mirrors).toHaveBeenCalledExactlyOnceWith(player.mirrors);
  expect(install).toHaveBeenCalledExactlyOnceWith(player);
  expect(fits).toHaveBeenCalledTimes(1);
});

it('reconstructs the chassis pose at each interpolation, hold, seek and vehicle cut', () => {
  const host = new RoadBikeHost(1),
    offset = carBase(1);
  const a = new Float32Array(HEADER + 2 * CAR_STRIDE);
  a[H.TIME] = 20;
  a[H.CARS] = 2;
  a[offset + F.QW] = 1;
  a[offset + F.X] = 12;
  a[offset + F.VX] = 21;
  const b = a.slice();
  b[H.TIME] += 1 / 30;
  b[offset + F.X] += 0.7;
  b[offset + F.QY] = Math.sin(0.01);
  b[offset + F.QW] = Math.cos(0.01);
  const position = new T.Vector3(),
    rotation = new T.Quaternion();
  for (const vehicle of ['gpr1', 'gpr2']) {
    a[offset + RACE_BASE + R.VEHICLE] = vehicleIndex('gpr1');
    b[offset + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
    for (const alpha of [0, 0.17, 0.85, 1, 1, 0.23, 0]) {
      sampleChassisPose(a, b, offset, alpha, position, rotation);
      host.update(a, b, offset, alpha);
      expect(host.root.position.toArray()).toEqual(position.toArray());
      expect(host.root.quaternion.toArray()).toEqual(rotation.toArray());
    }
  }
});
