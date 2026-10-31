import { it, expect } from 'vitest';
import { motionReceipt } from '../src/core/motion-receipt.ts';
import { H, F, carBase, CAR_STRIDE } from '../src/simulation/protocol.ts';
it('copies observed motion without mutating or retaining a simulation buffer', () => {
  const frame = new Float32Array(carBase(0) + CAR_STRIDE),
    o = carBase(0);
  frame[H.TICK] = 12;
  frame[H.PHASE] = 2;
  frame[H.TIME] = 0.1;
  frame[o + F.SPEED] = 8;
  frame[o + F.THROTTLE] = 0.5;
  frame[o + F.X] = -3;
  frame[o + F.Z] = 20;
  const before = frame.slice(),
    receipt = motionReceipt(frame)!;
  expect(receipt).toEqual({
    tick: 12,
    phase: 2,
    time: frame[H.TIME],
    speed: 8,
    throttle: 0.5,
    x: -3,
    z: 20,
  });
  expect(frame).toEqual(before);
  frame[o + F.SPEED] = 0;
  expect(receipt.speed).toBe(8);
  receipt.x = 500;
  expect(frame[o + F.X]).toBe(-3);
});
it('does not invent observations for missing, detached, short or invalid snapshots', () => {
  expect(motionReceipt(null)).toBeNull();
  expect(motionReceipt(new Float32Array(0))).toBeNull();
  const frame = new Float32Array(carBase(0) + CAR_STRIDE);
  frame[H.TIME] = NaN;
  expect(motionReceipt(frame)).toBeNull();
  frame[H.TIME] = 0;
  structuredClone(frame, { transfer: [frame.buffer] });
  expect(motionReceipt(frame)).toBeNull();
});
