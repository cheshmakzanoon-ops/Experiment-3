import { expect, it } from 'vitest';
import * as T from 'three';
import { PitCrewView, serviceWheelOffset } from '../src/rendering/pit-crew.ts';
import {
  F,
  H,
  HEADER,
  CAR_STRIDE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';

it('keeps loaded wheels attached and aligns removal/install with the service phases', () => {
  expect(serviceWheelOffset(2, 0.5, 0)).toBe(0);
  expect(serviceWheelOffset(3, 1.8, 1000)).toBe(0);
  expect(serviceWheelOffset(3, 1.8, 0)).toBeGreaterThan(0.2);
  expect(serviceWheelOffset(3, 2.2, 0)).toBe(0.48);
  expect(serviceWheelOffset(4, 2.2, 0)).toBe(0.48);
  expect(serviceWheelOffset(4, 3.3, 0)).toBe(0);
  expect(serviceWheelOffset(5, 4, 0)).toBe(0);
  expect(serviceWheelOffset(6, 5.2, 0)).toBe(0);
  expect(() => serviceWheelOffset(3, NaN, 0)).toThrow();
});
it('bounds twelve authored fifteen-person crews to seven draw batches with finite transforms', () => {
  const frame = new Float32Array(HEADER + 12 * CAR_STRIDE);
  frame[H.CARS] = 12;
  for (let i = 0; i < 12; i++) {
    const o = carBase(i);
    frame[o + F.QW] = 1;
    frame[o + F.PIT_PHASE] = 3;
    frame[o + F.PIT_CLOCK] = 1.9;
    frame[o + F.JACK_HEIGHT] = 0.19;
    frame[o + F.Y] = 0.75;
    frame[o + F.X] = i * 7;
    for (let wheel = 0; wheel < 4; wheel++)
      frame[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LENGTH] = 0.3;
  }
  const crew = new PitCrewView();
  crew.update(frame, new T.Vector3());
  expect(crew.activeCrews).toBe(12);
  expect(crew.activeActors).toBe(180);
  expect(crew.root.children).toHaveLength(7);
  for (const object of crew.root.children) {
    const batch = object as T.InstancedMesh;
    expect(batch.count).toBeGreaterThan(0);
    expect(batch.count).toBeLessThanOrEqual(batch.instanceMatrix.count);
    expect([...batch.instanceMatrix.array].every(Number.isFinite)).toBe(true);
  }
  crew.update(frame, new T.Vector3(10000, 0, 0));
  expect(crew.activeCrews).toBe(0);
  for (let i = 0; i < 12; i++) frame[carBase(i) + F.PIT_PHASE] = 6;
  crew.update(frame, new T.Vector3());
  expect(crew.activeCrews).toBe(0);
});
