import { expect, it } from 'vitest';
import { wheelPhase, wheelTravel } from '../src/rendering/wheel-pose.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { TAU } from '../src/core/math.ts';
import { CAR_STRIDE, HEADER, H, F, W, WHEEL_BASE, carBase } from '../src/simulation/protocol.ts';
const car = carBase(0),
  wheel = car + WHEEL_BASE;
function pair(speed = 200, dt = 1 / 15) {
  const a = new Float32Array(HEADER + CAR_STRIDE),
    b = a.slice();
  a[H.CARS] = b[H.CARS] = 1;
  a[car + F.QW] = b[car + F.QW] = 1;
  b[H.TIME] = dt;
  a[wheel + W.ROTATION] = 6;
  b[wheel + W.ROTATION] = (6 + speed * dt) % TAU;
  a[wheel + W.OMEGA] = b[wheel + W.OMEGA] = speed;
  return { a, b };
}
it.each([0, 5, 80, 200, 350, -5, -200])(
  'preserves the observed rolling direction and turns at %i rad/s',
  (speed) => {
    const { a, b } = pair(speed);
    expect(wheelPhase(a, b, car, wheel, 0)).toBe(a[wheel + W.ROTATION]);
    expect(wheelPhase(a, b, car, wheel, 1)).toBe(b[wheel + W.ROTATION]);
    for (const alpha of [0.1, 0.25, 0.5, 0.75, 0.9])
      expect(wheelPhase(a, b, car, wheel, alpha)).toBeCloseTo(6 + (speed / 15) * alpha, 5);
  },
);
it('treats tire replacement and discontinuous gaps as a baseline, not backwards spin', () => {
  const { a, b } = pair();
  b[car + F.PIT_STOPS] = 1;
  expect(wheelPhase(a, b, car, wheel, 0.5)).toBe(6);
  b[car + F.PIT_STOPS] = 0;
  b[car + F.COMPOUND] = 3;
  expect(wheelPhase(a, b, car, wheel, 0.5)).toBe(6);
  b[car + F.COMPOUND] = 0;
  b[H.TIME] = 2;
  expect(wheelPhase(a, b, car, wheel, 0.5)).toBe(6);
});
it('interpolates actual suspension travel and reuses wheel phase in presentation snapshots', () => {
  const { a, b } = pair();
  a[wheel + W.LENGTH] = 0.2;
  b[wheel + W.LENGTH] = 0.3;
  expect(wheelTravel(a, b, wheel, 0.5)).toBeCloseTo(0.25, 6);
  const before = [a.slice(), b.slice()];
  const frame = new PresentedFrame().sample(a, b, 0.5);
  expect(frame[wheel + W.ROTATION]).toBeCloseTo(wheelPhase(a, b, car, wheel, 0.5), 5);
  expect(frame[wheel + W.LENGTH]).toBeCloseTo(0.25, 6);
  expect(a).toEqual(before[0]);
  expect(b).toEqual(before[1]);
});
