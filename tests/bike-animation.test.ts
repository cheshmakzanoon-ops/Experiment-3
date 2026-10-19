import * as T from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { BikeModel, BikeShells } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { GPChainDrive } from '../src/rendering/gp-chain-drive.ts';
import { FestivalRiders } from '../src/rendering/festival-riders.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { Rider } from '../src/rendering/rider.ts';
import {
  B,
  BIKE_BASE,
  CAR_STRIDE,
  F,
  H,
  HEADER,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';

// These tests inspect production geometry and transforms, without claiming
// rendered-image evidence from the no-op drawing context.
function stubCanvas() {
  const noop = () => undefined;
  class Canvas {
    width = 256;
    height = 256;
    getContext() {
      return new Proxy(
        {
          canvas: this,
          measureText: () => ({ width: 30 }),
          createLinearGradient: () => ({ addColorStop: noop }),
          createRadialGradient: () => ({ addColorStop: noop }),
          createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        },
        { get: (target, key) => Reflect.get(target, key) ?? noop },
      );
    }
  }
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('HTMLCanvasElement', Canvas);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const car = carBase(0),
  bike = car + BIKE_BASE,
  offroad = car + OFFROAD_BASE;
function frame(vehicle: string, time: number) {
  const value = new Float32Array(HEADER + CAR_STRIDE);
  value[H.CARS] = 1;
  value[H.TIME] = time;
  value[car + F.QW] = 1;
  value[car + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
  value[car + F.FRONT_HEALTH] = value[car + F.REAR_HEALTH] = 1;
  value[car + F.GEAR] = 2;
  value[bike + B.FORK] = value[bike + B.SHOCK] = 0.03;
  for (let i = 0; i < 4; i++) {
    const p = car + WHEEL_BASE + i * WHEEL_STRIDE;
    value[p + W.OMEGA] = 200;
    value[p + W.ROTATION] = (6 + 200 * time) % (2 * Math.PI);
    value[p + W.LOAD] = 1000;
    value[p + W.LENGTH] = 0.25;
    value[p + W.RADIUS] = 0.335;
    value[p + W.PRESSURE] = 160;
  }
  return value;
}
type PosedModel = {
  root: T.Group;
  sprung: T.Group;
  rider: Rider;
  frontSpin: T.Group;
  rearSpin: T.Group;
};
function visibleModel(shells: BikeShells) {
  return shells.root.children.find((node) => node.visible && /\((high|mid|far)\)/.test(node.name));
}

it.each(['gpr1', 'mx450'])(
  'poses %s wheels, controls and rider weight from the same intermediate snapshot',
  (vehicle) => {
    stubCanvas();
    const pose = vi.spyOn(
      vehicle === 'mx450' ? DirtBikeModel.prototype : BikeModel.prototype,
      'pose',
    );
    const chain = vi.spyOn(GPChainDrive.prototype, 'update');
    const shells = new BikeShells(),
      host = { root: new T.Object3D() },
      camera = new T.PerspectiveCamera(58, 16 / 9),
      a = frame(vehicle, 0),
      b = frame(vehicle, 0.1);
    b[car + F.BRAKE] = 1;
    b[car + F.GEAR] = 3;
    b[bike + B.LEAN] = 0.6;
    b[bike + B.FORK] = 0.07;
    b[offroad + O.BODY] = 0.8;
    b[offroad + O.STANDING] = 1;
    try {
      shells.update(a, b, 0.4, [host], camera, 'high', 0);
      const model = pose.mock.contexts.at(-1) as unknown as PosedModel;
      const values = pose.mock.calls.at(-1)![0];
      // Analytic constant angular speed: more than three revolutions per pair.
      expect(model.frontSpin.rotation.x).toBeCloseTo(14, 5);
      expect(model.rearSpin.rotation.x).toBeCloseTo(14, 5);
      expect(values.gear).toBe(2);
      expect(values.brake).toBeCloseTo(0.4, 6);
      expect(values.fork).toBeCloseTo(0.046, 6);
      expect(values.body).toBeCloseTo(0.32, 6);
      expect(values.standing).toBeCloseTo(0.4, 6);
      expect(model.rider.root.parent).toBe(model.sprung);
      if (vehicle === 'gpr1') {
        expect(chain).toHaveBeenLastCalledWith(model.rearSpin.rotation.x);
        const lever = model.root.getObjectByName('GP front-brake lever pivot')!;
        expect(lever.rotation.y).toBeCloseTo(-0.16, 6);
        b[car + F.BRAKE] = 0;
        b[bike + B.REAR_BRAKE] = 1;
        shells.update(a, b, 0.4, [host], camera, 'high', 0);
        expect(lever.rotation.y).toBeCloseTo(0, 6);
      }
      const recorded = Array.from(model.frontSpin.matrix.elements);
      shells.update(a, b, 0.4, [host], camera, 'high', 0);
      expect(Array.from(model.frontSpin.matrix.elements)).toEqual(recorded);
    } finally {
      shells.disposeAll();
    }
  },
);

it('holds the crash boundary, samples separated motion, hides old rider LODs and reattaches on reset', () => {
  stubCanvas();
  const pose = vi.spyOn(BikeModel.prototype, 'pose'),
    separated = vi.spyOn(Rider.prototype, 'separated');
  const shells = new BikeShells(),
    host = { root: new T.Object3D() },
    camera = new T.PerspectiveCamera(58, 16 / 9),
    a = frame('gpr1', 0),
    b = frame('gpr1', 0.1);
  b[bike + B.STATE] = 3;
  b[bike + B.RIDER_X] = 3;
  b[bike + B.RIDER_Y] = 0.2;
  b[bike + B.RIDER_HEADING] = Math.PI - 0.1;
  b[bike + B.RIDER_TUMBLE] = 1;
  try {
    shells.update(a, b, 0.75, [host], camera, 'high', 0);
    const near = pose.mock.contexts.at(-1) as unknown as PosedModel;
    expect(near.rider.root.parent).toBe(near.sprung);
    expect(separated).not.toHaveBeenCalled();
    shells.update(a, b, 1, [host], camera, 'high', 0);
    expect(near.rider.root.parent).toBe(shells.root);
    expect(near.rider.root.position.x).toBe(3);

    const next = b.slice();
    next[H.TIME] = 0.2;
    next[bike + B.STATE_CLOCK] = 0.1;
    next[bike + B.RIDER_X] = 5;
    next[bike + B.RIDER_HEADING] = -Math.PI + 0.1;
    next[bike + B.RIDER_TUMBLE] = 1 + 4 * Math.PI;
    shells.update(b, next, 0.5, [host], camera, 'high', 0);
    expect(near.rider.root.position.x).toBe(4);
    expect(near.rider.root.rotation.y).toBeCloseTo(Math.PI, 6);
    expect(separated.mock.calls.at(-1)![1]).toBeCloseTo(1 + 2 * Math.PI, 6);
    expect(separated.mock.calls.at(-1)![2]).toBeCloseTo(0.15, 6);

    camera.position.set(500, 20, 0);
    shells.update(b, next, 0.5, [host], camera, 'high', -1);
    expect(near.rider.root.visible).toBe(false);
    expect(visibleModel(shells)!.name).toContain('(far)');
    expect(
      shells.root.children.filter((node) => node.name === 'Rider' && node.visible),
    ).toHaveLength(1);
    camera.position.set(0, 0, 0);
    shells.update(b, next, 0.5, [host], camera, 'high', 0);
    expect(near.rider.root.visible).toBe(true);
    expect(
      shells.root.children.filter((node) => node.name === 'Rider' && node.visible),
    ).toHaveLength(1);

    const riding = frame('gpr1', 0.3);
    shells.update(next, riding, 1, [host], camera, 'high', 0);
    expect(near.rider.root.parent).toBe(near.sprung);
    expect(near.rider.root.visible).toBe(true);
    expect(near.rider.root.position.toArray()).toEqual([0, 0, 0]);
    expect(near.rider.root.quaternion.toArray()).toEqual([0, 0, 0, 1]);
  } finally {
    shells.disposeAll();
  }
});

it('selects the recorded bike identity until the exact car-swap boundary', () => {
  stubCanvas();
  const shells = new BikeShells(),
    host = { root: new T.Object3D() },
    camera = new T.PerspectiveCamera(58, 16 / 9),
    a = frame('gpr1', 0),
    b = frame('apx01', 0.1);
  try {
    shells.update(a, b, 0.9, [host], camera, 'high', 0);
    expect(shells.count).toBe(1);
    expect(host.root.visible).toBe(false);
    shells.update(a, b, 1, [host], camera, 'high', 0);
    expect(shells.count).toBe(0);
    expect(host.root.visible).toBe(true);
  } finally {
    shells.disposeAll();
  }
});

it('keeps festival motorcycle roots exactly aligned with the presented camera path', () => {
  stubCanvas();
  const riders = new FestivalRiders(),
    camera = new T.PerspectiveCamera(58, 16 / 9),
    a = frame('mx450', 0),
    b = frame('mx450', 0.1),
    sample = new PresentedFrame();
  a[car + F.VX] = 2;
  b[car + F.VX] = 2.8;
  b[car + F.X] = 0.24;
  new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0.7).toArray(b, car + F.QX);
  try {
    for (const alpha of [0, 0.25, 0.7, 1]) {
      const shown = sample.sample(a, b, alpha);
      riders.update(a, b, alpha, camera, 'high');
      const model = visibleModel(riders.shells)!;
      expect(model.position.toArray()).toEqual(
        Array.from(shown.subarray(car + F.X, car + F.X + 3)),
      );
      expect(model.quaternion.toArray()).toEqual(
        Array.from(shown.subarray(car + F.QX, car + F.QX + 4)),
      );
    }
  } finally {
    riders.dispose();
  }
});
