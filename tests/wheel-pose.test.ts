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

it('uses measured angular acceleration within the lifted whole-turn interval', () => {
  const { a, b } = pair(0, 0.1),
    dt = b[H.TIME];
  a[wheel + W.OMEGA] = 0;
  b[wheel + W.OMEGA] = 20;
  b[wheel + W.ROTATION] = (6 + 10 * dt) % TAU;
  for (const alpha of [0.1, 0.25, 0.5, 0.8])
    expect(wheelPhase(a, b, car, wheel, alpha)).toBeCloseTo(6 + 10 * dt * alpha * alpha, 6);
});

it('limits impulse slopes without overshoot or a spurious backwards turn', () => {
  const { a, b } = pair(0, 0.1);
  a[wheel + W.OMEGA] = 1000;
  b[wheel + W.OMEGA] = -1000;
  b[wheel + W.ROTATION] = 6.1;
  let previous = 6;
  for (let i = 1; i < 100; i++) {
    const phase = wheelPhase(a, b, car, wheel, i / 100);
    expect(phase).toBeGreaterThanOrEqual(previous);
    expect(phase).toBeLessThanOrEqual(b[wheel + W.ROTATION]);
    previous = phase;
  }
});

it('preserves a coherent low-speed reversal inside one measured interval', () => {
  const { a, b } = pair(0, 0.1);
  a[wheel + W.OMEGA] = 2;
  b[wheel + W.OMEGA] = -2;
  b[wheel + W.ROTATION] = 6;
  expect(wheelPhase(a, b, car, wheel, 0.5)).toBeCloseTo(6.05, 6);
  expect(wheelPhase(a, b, car, wheel, 1)).toBe(6);
});

it('holds wheel phase at resets and remains independent of playback query order', () => {
  const { a, b } = pair(200);
  const expected = wheelPhase(a, b, car, wheel, 0.4);
  for (const alpha of [1, 0.1, 0.9, 0, 0.4]) wheelPhase(a, b, car, wheel, alpha);
  expect(wheelPhase(a, b, car, wheel, 0.4)).toBe(expected);
  b[car + F.X] = 100;
  expect(wheelPhase(a, b, car, wheel, 0.4)).toBe(6);
  expect(wheelPhase(a, b, car, wheel, 1)).toBe(b[wheel + W.ROTATION]);
});

it('does not produce NaN rotation from an unusable angular-velocity sample', () => {
  const { a, b } = pair();
  b[wheel + W.OMEGA] = NaN;
  expect(wheelPhase(a, b, car, wheel, 0.5)).toBe(6);
});
