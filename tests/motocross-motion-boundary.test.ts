import * as T from 'three';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { BikeShells } from '../src/rendering/bike.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { sampleMxFender, sampleMxJointField } from '../src/rendering/offroad/mx-machine-pose.ts';
import {
  B, BIKE_BASE, CAR_STRIDE, F, H, HEADER, MX_FOOT, MX_MOTION, R, RACE_BASE,
  carBase, hasMxMachineMotion,
} from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { ReplayRecorder } from '../src/storage/recorders.ts';

beforeAll(() => {
  const context = new Proxy({}, {
    get: (_, key) => key === 'measureText' ? () => ({ width: 10 }) : () => undefined,
    set: () => true,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
});
afterAll(() => vi.unstubAllGlobals());

const car = carBase(0);
const fields = [
  MX_MOTION.VALID, MX_MOTION.FORK_RATE, MX_MOTION.SHOCK_RATE, MX_MOTION.STEER_RATE,
  MX_MOTION.FRONT_FLEX, MX_MOTION.FRONT_FLEX_RATE,
  MX_MOTION.REAR_FLEX, MX_MOTION.REAR_FLEX_RATE, MX_MOTION.CHAIN_PULL,
] as const;

function frame(time: number) {
  const value = new Float32Array(HEADER + CAR_STRIDE);
  value[H.CARS] = 1;
  value[H.TIME] = time;
  value[car + F.QW] = 1;
  value[car + RACE_BASE + R.VEHICLE] = vehicleIndex('mx250');
  value[car + BIKE_BASE + B.FORK] = 0.08;
  value[car + BIKE_BASE + B.SHOCK] = 0.09;
  value[car + MX_MOTION.VALID] = 1;
  value[car + MX_MOTION.FORK_RATE] = 0.12;
  value[car + MX_MOTION.SHOCK_RATE] = -0.16;
  value[car + MX_MOTION.STEER_RATE] = 0.04;
  value[car + MX_MOTION.FRONT_FLEX] = 0.1;
  value[car + MX_MOTION.FRONT_FLEX_RATE] = 0.2;
  value[car + MX_MOTION.REAR_FLEX] = -0.02;
  value[car + MX_MOTION.REAR_FLEX_RATE] = -0.1;
  value[car + MX_MOTION.CHAIN_PULL] = 0.6;
  return value;
}

it('presents the same selector and boot channels as the drawn linear control pose', () => {
  const a = frame(1), b = frame(1 + 1 / 30), display = new PresentedFrame();
  a[car + MX_FOOT.ANGLE] = -0.24;
  a[car + MX_FOOT.COVER] = 0.2;
  a[car + MX_FOOT.CLEAR] = 0.1;
  b[car + MX_FOOT.ANGLE] = 0.22;
  b[car + MX_FOOT.COVER] = 0.8;
  b[car + MX_FOOT.CLEAR] = 0.9;
  for (const t of [0.125, 0.5, 0.875]) {
    const shown = display.sample(a, b, t);
    for (const field of [MX_FOOT.ANGLE, MX_FOOT.COVER, MX_FOOT.CLEAR]) {
      // BikeShells uses this same endpoint interpretation for the drawn rig.
      const drawn = (1 - t) * a[car + field] + t * b[car + field];
      expect(shown[car + field]).toBe(Math.fround(drawn));
    }
  }
  // A gear stroke predates the optional elastic-machine extension.
  a[car + MX_MOTION.VALID] = b[car + MX_MOTION.VALID] = 0;
  expect(display.sample(a, b, 0.5)[car + MX_FOOT.COVER]).toBe(0.5);
});

it('releases foot controls toward neutral at the same rider-state edge as the drawn rig', () => {
  const a = frame(1), b = frame(1 + 1 / 30);
  a[car + MX_FOOT.ANGLE] = 0.2;
  a[car + MX_FOOT.COVER] = 1;
  b[car + BIKE_BASE + B.STATE] = 1;
  const shown = new PresentedFrame().sample(a, b, 0.5);
  expect(shown[car + BIKE_BASE + B.STATE]).toBe(0);
  expect(shown[car + MX_FOOT.ANGLE]).toBe(Math.fround(a[car + MX_FOOT.ANGLE] / 2));
  expect(shown[car + MX_FOOT.COVER]).toBe(0.5);
});

it('keeps valid recorded endpoint and paused motion bytes exact without mutating input', () => {
  const a = frame(1), b = frame(1 + 1 / 30), display = new PresentedFrame();
  b[car + MX_MOTION.FRONT_FLEX_RATE] = 0.4;
  b[car + MX_FOOT.ANGLE] = -0.14;
  const saved = b.slice();
  expect(display.sample(a, b, 0)).toEqual(a);
  expect(display.sample(a, b, 1)).toEqual(b);
  const paused = display.sample(b, b, 0.37);
  for (const field of [...fields, MX_FOOT.ANGLE, MX_FOOT.COVER, MX_FOOT.CLEAR])
    expect(paused[car + field]).toBe(b[car + field]);
  expect(b).toEqual(saved);
});

it('falls back from malformed marked motion at interpolated, paused and exact endpoints', () => {
  const display = new PresentedFrame();
  for (const field of [MX_MOTION.CHAIN_PULL, MX_MOTION.FORK_RATE, MX_MOTION.FRONT_FLEX_RATE, MX_MOTION.REAR_FLEX]) {
    const a = frame(1), b = frame(1 + 1 / 30);
    b[car + field] = field === MX_MOTION.REAR_FLEX ? Infinity : NaN;
    for (const t of [0.5, 1]) {
      const shown = display.sample(a, b, t);
      expect(hasMxMachineMotion(shown, car)).toBe(false);
      expect(Array.from(shown).every(Number.isFinite)).toBe(true);
      for (const optional of fields) expect(shown[car + optional]).toBe(0);
      expect(sampleMxFender(a, b, car, true, t)).toBeUndefined();
      expect(sampleMxFender(a, b, car, false, t, true)).toBeUndefined();
    }
    expect(sampleMxJointField(a, b, car, B.FORK, 0.5)).toBeUndefined();
    expect(Array.from(display.sample(b, b, 0.4)).every(Number.isFinite)).toBe(true);
    expect(Array.from(display.sample(b, b, 0)).every(Number.isFinite)).toBe(true);
    // Sanitization owns only the presentation copy.
    expect(Number.isFinite(b[car + field])).toBe(false);
  }
});

it('sanitizes a held reset-boundary pose while preserving legacy and other-vehicle payloads', () => {
  const a = frame(1), b = frame(1 + 1 / 30), display = new PresentedFrame();
  a[car + MX_MOTION.CHAIN_PULL] = NaN;
  b[car + F.Z] = 100;
  const held = display.sample(a, b, 0.5);
  expect(held[car + F.Z]).toBe(a[car + F.Z]);
  expect(hasMxMachineMotion(held, car)).toBe(false);
  expect(Array.from(held).every(Number.isFinite)).toBe(true);
  const legacy = frame(1);
  legacy.fill(0, car + MX_MOTION.VALID, car + MX_MOTION.CHAIN_PULL + 1);
  expect(display.sample(legacy, legacy, 1)).toEqual(legacy);
  expect(sampleMxFender(legacy, legacy, car, true, 0.5)).toBeUndefined();
  const road = frame(1);
  road[car + RACE_BASE + R.VEHICLE] = vehicleIndex('sm450');
  road[car + MX_MOTION.CHAIN_PULL] = NaN;
  expect(display.sample(road, road, 1)).toEqual(road);
});

it('rejects finite out-of-envelope mudguards at exact, interpolated, paused and reset poses', () => {
  const display = new PresentedFrame();
  for (const field of [MX_MOTION.FRONT_FLEX, MX_MOTION.REAR_FLEX]) {
    for (const value of [-1e30, -0.320001, 1.000001, 1e30]) {
      const a = frame(1), b = frame(1 + 1 / 30);
      b[car + field] = value;
      const saved = b.slice();
      for (const t of [0.25, 0.75, 1]) {
        const shown = display.sample(a, b, t);
        expect(hasMxMachineMotion(shown, car)).toBe(false);
        for (const optional of fields) expect(shown[car + optional]).toBe(0);
        expect(sampleMxFender(a, b, car, true, t)).toBeUndefined();
        expect(sampleMxFender(a, b, car, false, t, true)).toBeUndefined();
      }
      // An unused corrupt future endpoint must not discard the valid older
      // measurement; selecting the corrupt endpoint must discard its block.
      expect(display.sample(a, b, 0)).toEqual(a);
      expect(sampleMxFender(a, b, car, true, 0)).toBe(a[car + MX_MOTION.FRONT_FLEX]);
      expect(sampleMxJointField(a, b, car, B.FORK, 0.5)).toBeUndefined();
      for (const t of [0, 0.37, 1]) {
        expect(hasMxMachineMotion(display.sample(b, b, t), car)).toBe(false);
      }
      const reset = frame(1 + 1 / 15);
      reset[car + F.Z] = 100;
      const held = display.sample(b, reset, 0.5);
      expect(held[car + F.Z]).toBe(b[car + F.Z]);
      expect(hasMxMachineMotion(held, car)).toBe(false);
      expect(b).toEqual(saved);
    }
  }
});

it('retains exact recorded travel limits and unused legacy bytes', () => {
  const a = frame(1), b = frame(1 + 1 / 30), display = new PresentedFrame();
  for (const field of [MX_MOTION.FRONT_FLEX, MX_MOTION.REAR_FLEX]) {
    a[car + field] = -0.32;
    b[car + field] = 1;
  }
  const savedA = a.slice(), savedB = b.slice();
  for (const [left, right, t] of [[a, b, 0], [a, b, 1], [a, a, 0.4], [b, b, 0.6]] as const) {
    const source = t === 0 || left === right ? left : right;
    expect(display.sample(left, right, t)).toEqual(source);
    for (const front of [true, false]) {
      const field = front ? MX_MOTION.FRONT_FLEX : MX_MOTION.REAR_FLEX;
      expect(sampleMxFender(left, right, car, front, t)).toBe(source[car + field]);
    }
  }
  expect(a).toEqual(savedA);
  expect(b).toEqual(savedB);
  const legacy = frame(1);
  legacy[car + MX_MOTION.VALID] = 0;
  legacy[car + MX_MOTION.FRONT_FLEX] = 1e30;
  expect(display.sample(legacy, legacy, 1)).toEqual(legacy);
  expect(sampleMxFender(legacy, legacy, car, true, 1)).toBeUndefined();
});

it.each(['mx250', 'mx450'] as const)(
  '%s replays malformed finite flex through the same bounded real rig as its legacy fallback',
  (vehicle) => {
    const shells = new BikeShells(), reference = new BikeShells();
    const host = { root: new T.Object3D() }, referenceHost = { root: new T.Object3D() };
    const camera = new T.PerspectiveCamera(58, 16 / 9), display = new PresentedFrame();
    camera.position.set(0, 0, -65);
    const pose = (rig: BikeShells, mount: typeof host, a: Float32Array, b: Float32Array, t: number) => {
      rig.update(a, b, t, [mount], camera, 'high', -1);
      const root = rig.drawnRoot(0)!;
      root.updateMatrixWorld(true);
      const result: number[] = [];
      for (const name of ['Motocross front mudguard', 'Motocross rear mudguard']) {
        const mesh = root.getObjectByName(name) as T.Mesh;
        expect(mesh.morphTargetInfluences).toHaveLength(1);
        const value = mesh.morphTargetInfluences![0];
        expect(value).toBeGreaterThanOrEqual(-0.32);
        expect(value).toBeLessThanOrEqual(1);
        result.push(value, ...mesh.matrixWorld.elements);
      }
      return result;
    };
    try {
      for (const field of [MX_MOTION.FRONT_FLEX, MX_MOTION.REAR_FLEX]) {
        const first = frame(1), last = frame(1 + 1 / 30), replay = new ReplayRecorder(1, 2);
        first[car + RACE_BASE + R.VEHICLE] = last[car + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
        first[car + field] = -1e30;
        last[car + field] = 1e30;
        const savedFirst = first.slice(), savedLast = last.slice();
        replay.append(first);
        replay.append(last);
        const a = replay.makeFrame(), b = replay.makeFrame();
        // Reordered and repeated playback requests must not accumulate a
        // deformation or change the original recorded optional payload.
        for (const fraction of [1, 0, 0.75, 0.25, 0.5, 0.5, 1, 0]) {
          const t = replay.sample(replay.duration * fraction, a, b);
          const legacyA = a.slice(), legacyB = b.slice();
          for (const sample of [legacyA, legacyB]) for (const optional of fields)
            sample[car + optional] = 0;
          const shown = display.sample(a, b, t).slice();
          expect(shown).toEqual(display.sample(legacyA, legacyB, t));
          expect(pose(shells, host, a, b, t)).toEqual(pose(reference, referenceHost, legacyA, legacyB, t));
        }
        expect(first).toEqual(savedFirst);
        expect(last).toEqual(savedLast);
      }
    } finally {
      shells.disposeAll();
      reference.disposeAll();
    }
  },
);
