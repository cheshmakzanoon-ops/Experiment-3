import * as T from 'three';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { BikeShells } from '../src/rendering/bike.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { sampleMxFender } from '../src/rendering/offroad/mx-machine-pose.ts';
import { sampleBikeField } from '../src/rendering/snapshot-interpolation.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MxMachineMotion } from '../src/simulation/offroad/mx-machine-motion.ts';
import {
  B, BIKE_BASE, F, H, MX_MOTION, W, WHEEL_BASE, WHEEL_STRIDE, carBase, hasMxMachineMotion,
} from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';
import { ReplayRecorder } from '../src/storage/recorders.ts';

beforeAll(() => {
  const context = new Proxy({}, {
    get: (_, key) => key === 'measureText' ? () => ({ width: 10 }) : () => undefined,
    set: () => true,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
});
afterAll(() => vi.unstubAllGlobals());

it('compresses and rings down one mudguard independently, with the same response at each fixed step', () => {
  const run = (hz: number) => {
    const motion = new MxMachineMotion();
    motion.reset(0.07, 0.09, 0);
    const sampled: number[] = [];
    for (let tick = 1; tick <= hz; tick++) {
      const hit = tick <= hz / 15;
      motion.step(1 / hz, 0.07, 0.09, 0, 8, hit ? 3 : 1, 1, hit ? 45 : 0, 0);
      expect(motion.rear.position).toBe(0);
      if (tick % (hz / 60) === 0) sampled.push(motion.front.position);
    }
    expect(Math.max(...sampled)).toBeGreaterThan(0.32);
    expect(Math.min(...sampled)).toBeLessThan(-0.025);
    expect(Math.abs(sampled.at(-1)!)).toBeLessThan(0.0001);
    expect(Math.abs(motion.chainPull)).toBeLessThan(1e-8);
    for (let tick = 0; tick < hz / 4; tick++)
      motion.step(1 / hz, 0.07, 0.09, 0, 8, 1, 1, 0, 600);
    expect(motion.chainPull).toBeLessThan(-0.99);
    motion.reset();
    expect(motion.valid).toBe(false);
    return sampled;
  };
  const sixty = run(60);
  for (const hz of [120, 240]) run(hz).forEach((position, i) =>
    expect(position).toBeCloseTo(sixty[i], 10));
});

const fixtures = [['valley-ridge-mx', 'mx450'], ['arena-nord-sx', 'mx250']] as const;
it.each(fixtures)('%s reconstructs the two real suspension strokes between 30 Hz frames', (circuit, vehicle) => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit, vehicles: [vehicle], opponents: 0,
    ruleset: 'motocross-moto', mode: 'practice' });
  const bike = sim.cars[0] as DirtBikeVehicle, o = carBase(0);
  const display = new PresentedFrame(), window: Float32Array[] = [];
  let linearError = 0, machineError = 0, compared = 0, flexDifference = 0;
  bike.cgY += 0.13;
  bike.vy = -1.1;
  for (let tick = 0; tick <= 480; tick++) {
    if (tick) {
      sim.setInput({ ...bike.input, throttle: tick < 320 ? 0.8 : 0, brake: tick > 360 ? 0.3 : 0,
        steer: 0.09 * Math.sin(tick / 55) });
      sim.step(1 / 120);
    }
    window.push(sim.makeFrame());
    if (window.length < 5) continue;
    const a = window[0], b = window[4];
    if (hasMxMachineMotion(a, o) && hasMxMachineMotion(b, o)) {
      for (let sub = 1; sub < 4; sub++) {
        const t = sub / 4, truth = window[sub], shown = display.sample(a, b, t);
        for (const [field, wheel] of [[B.FORK, 0], [B.SHOCK, 2]] as const) {
          const p = o + BIKE_BASE + field, hub = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
          const stroke = sampleBikeField(a, b, o, field, t);
          linearError += Math.abs(truth[p] - (a[p] + (b[p] - a[p]) * t));
          machineError += Math.abs(truth[p] - stroke);
          expect(stroke).toBeGreaterThanOrEqual(Math.min(a[p], b[p]) - 1e-8);
          expect(stroke).toBeLessThanOrEqual(Math.max(a[p], b[p]) + 1e-8);
          expect(shown[p]).toBe(shown[hub + W.COMPRESSION]);
          expect(shown[hub + W.LENGTH] + shown[p]).toBeCloseTo(a[hub + W.LENGTH] + a[p], 5);
        }
        const front = sampleMxFender(a, b, o, true, t)!;
        const rear = sampleMxFender(a, b, o, false, t)!;
        expect(shown[o + MX_MOTION.FRONT_FLEX]).toBe(Math.fround(front));
        expect(shown[o + MX_MOTION.REAR_FLEX]).toBe(Math.fround(rear));
        flexDifference = Math.max(flexDifference, Math.abs(front - rear));
        compared++;
      }
    }
    window.splice(0, 4);
  }
  expect(compared).toBeGreaterThan(100);
  expect(linearError).toBeGreaterThan(0.015);
  expect(machineError).toBeLessThan(linearError * 0.85);
  expect(flexDifference).toBeGreaterThan(0.07);
});

it('reconstructs identical elastic tips, rear axle and chain from compact replay after a camera cut', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit: 'arena-nord-sx', vehicles: ['mx250'],
    opponents: 0, ruleset: 'motocross-moto', mode: 'practice' });
  const bike = sim.cars[0] as DirtBikeVehicle, o = carBase(0);
  bike.cgY += 0.14;
  bike.vy = -1;
  const recorded: Float32Array[] = [], replay = new ReplayRecorder(1, 2);
  for (let i = 0; i <= 40; i++) {
    if (i) {
      sim.setInput({ ...bike.input, throttle: 0.9 });
      sim.step(1 / 120);
    }
    if (i % 8 === 0) {
      const frame = sim.makeFrame();
      recorded.push(frame);
      replay.append(frame);
    }
  }
  const a = replay.makeFrame(), b = replay.makeFrame(), t = replay.sample(
    (recorded[2][H.TIME] + recorded[3][H.TIME]) / 2 - replay.start, a, b,
  );
  const shells = new BikeShells(), shown = new PresentedFrame(), host = { root: new T.Object3D() };
  const camera = new T.PerspectiveCamera(58, 16 / 9);
  const pose = (left: Float32Array, right: Float32Array, fraction: number, distance: number) => {
    const frame = shown.sample(left, right, fraction);
    host.root.position.fromArray(frame, o + F.X);
    host.root.quaternion.fromArray(frame, o + F.QX);
    camera.position.copy(host.root.position);
    camera.position.z -= distance;
    shells.update(left, right, fraction, [host], camera, 'high', -1);
    const root = shells.drawnRoot(0)!;
    const front = root.getObjectByName('Motocross front mudguard') as T.Mesh;
    const rear = root.getObjectByName('Motocross rear mudguard') as T.Mesh;
    const chain = root.getObjectByName('Motocross steel chain pins and rollers') as T.InstancedMesh;
    return [front?.morphTargetInfluences?.[0], rear?.morphTargetInfluences?.[0],
      root.getObjectByName('Motocross rear suspension hub')!.position.y,
      ...(chain ? Array.from(chain.instanceMatrix.array) : [])];
  };
  try {
    const live = pose(recorded[2], recorded[3], t, 2);
    expect(Math.abs(live[0]! - live[1]!)).toBeGreaterThan(0.01);
    expect(a[o + MX_MOTION.CHAIN_PULL]).toBe(recorded[2][o + MX_MOTION.CHAIN_PULL]);
    expect(b[o + MX_MOTION.CHAIN_PULL]).toBeGreaterThan(0);
    pose(recorded[4], recorded[5], 1, 500);
    expect(pose(a, b, t, 2)).toEqual(live);
    expect(pose(a, b, t, 2)).toEqual(live);
    const launch = shown.sample(recorded[0], recorded[1], 0.5);
    expect(launch[o + MX_MOTION.FRONT_FLEX]).toBe(Math.fround(
      sampleMxFender(recorded[0], recorded[1], o, true, 0.5) ?? 0,
    ));
    const legacyA = a.slice(), legacyB = b.slice();
    legacyA.fill(0, o + MX_MOTION.VALID, o + MX_MOTION.CHAIN_PULL + 1);
    legacyB.fill(0, o + MX_MOTION.VALID, o + MX_MOTION.CHAIN_PULL + 1);
    expect(sampleMxFender(legacyA, legacyB, o, true, 0.5)).toBeUndefined();
    const fork = o + BIKE_BASE + B.FORK;
    expect(sampleBikeField(legacyA, legacyB, o, B.FORK, 0.5))
      .toBe((legacyA[fork] + legacyB[fork]) / 2);
  } finally {
    shells.disposeAll();
  }
});

it('leaves the optional motion payload empty on a supermoto and on a paved course', () => {
  for (const [vehicle, circuit] of [['sm450', 'arena-nord-sx'], ['mx450', 'aurel']] as const) {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit, vehicles: [vehicle], opponents: 0, mode: 'practice' });
    for (let tick = 0; tick < 10; tick++) sim.step(1 / 120);
    const frame = sim.makeFrame(), o = carBase(0);
    expect(hasMxMachineMotion(frame, o)).toBe(false);
    expect(Array.from(frame.subarray(o + MX_MOTION.VALID, o + MX_MOTION.CHAIN_PULL + 1)))
      .toEqual(Array(9).fill(0));
  }
});
