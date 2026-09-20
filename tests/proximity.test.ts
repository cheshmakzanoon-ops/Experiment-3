import { expect, it } from 'vitest';
import { nearbyTraffic } from '../src/ui/proximity.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';
function field() {
  const frame = new Simulation({ ...DEFAULT_OPTIONS, opponents: 2, mode: 'practice' }).makeFrame();
  for (let i = 0; i < 3; i++) {
    const o = carBase(i);
    frame[o + F.X] = 0;
    frame[o + F.Y] = 0;
    frame[o + F.Z] = i * 30;
    frame[o + F.QX] = frame[o + F.QY] = frame[o + F.QZ] = 0;
    frame[o + F.QW] = 1;
  }
  return frame;
}
it('shows near and overlap arrows on the correct side using actual relative positions', () => {
  const frame = field();
  frame[carBase(1) + F.X] = -3;
  frame[carBase(1) + F.Z] = 2;
  frame[carBase(2) + F.X] = 3;
  frame[carBase(2) + F.Z] = -10;
  const original = frame.slice();
  expect(nearbyTraffic(frame)).toEqual({ left: 'overlap', right: 'near' });
  expect(frame).toEqual(original);
});
it('rotates the side axes with the player heading rather than screen/world X', () => {
  const frame = field();
  frame[carBase(0) + F.QY] = Math.SQRT1_2;
  frame[carBase(0) + F.QW] = Math.SQRT1_2;
  frame[carBase(1) + F.X] = 1;
  frame[carBase(1) + F.Z] = -3;
  frame[carBase(2) + F.X] = 100;
  frame[carBase(2) + F.Z] = 100;
  expect(nearbyTraffic(frame)).toEqual({ left: 'clear', right: 'overlap' });
});
it.each(['bridge', 'retired', 'finished', 'behind', 'same-lane', 'grid', 'malformed'] as const)(
  'does not invent proximity for %s',
  (why) => {
    const frame = field(),
      o = carBase(1);
    frame[o + F.X] = -3;
    frame[o + F.Z] = 1;
    if (why === 'bridge') frame[o + F.Y] = 6;
    if (why === 'retired') frame[o + F.RETIRED] = 1;
    if (why === 'finished') frame[o + F.FINISH] = 1;
    if (why === 'behind') frame[o + F.Z] = -20;
    if (why === 'same-lane') frame[o + F.X] = 0;
    if (why === 'grid') frame[H.PHASE] = 1;
    if (why === 'malformed') frame[o + F.X] = NaN;
    expect(nearbyTraffic(frame)).toEqual({ left: 'clear', right: 'clear' });
  },
);
it('keeps the stronger overlap when another car is merely near on the same side', () => {
  const frame = field();
  frame[carBase(1) + F.X] = -3;
  frame[carBase(1) + F.Z] = 1;
  frame[carBase(2) + F.X] = -3;
  frame[carBase(2) + F.Z] = 10;
  expect(nearbyTraffic(frame).left).toBe('overlap');
  expect(nearbyTraffic(new Float32Array())).toEqual({ left: 'clear', right: 'clear' });
});
