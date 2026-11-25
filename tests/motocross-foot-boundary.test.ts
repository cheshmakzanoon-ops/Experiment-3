import { expect, it } from 'vitest';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { sampleMxFootField } from '../src/rendering/offroad/mx-foot-pose.ts';
import { presentationAlpha } from '../src/rendering/snapshot-interpolation.ts';
import { MxGearStroke } from '../src/simulation/offroad/mx-gear-stroke.ts';
import {
  B, BIKE_BASE, CAR_STRIDE, F, H, HEADER, MX_FOOT, MX_FOOT_TRAJECTORY as S,
  R, RACE_BASE, carBase, hasMxFootControls,
} from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';

const car = carBase(0), fields = [MX_FOOT.ANGLE, MX_FOOT.COVER, MX_FOOT.CLEAR] as const;
const fromFrame = (value: Float32Array) => fields.map(field => value[car + field]);
const sample = (a: Float32Array, b: Float32Array, alpha: number) =>
  fields.map(field => sampleMxFootField(a, b, car, field, alpha));
const linear = (start: number[], end: number[], alpha: number) =>
  start.map((value, channel) => value + (end[channel] - value) * alpha);

function frame(time: number, id: 'mx250' | 'mx450' = 'mx250') {
  const out = new Float32Array(HEADER + CAR_STRIDE);
  out[H.CARS] = 1;
  out[H.TIME] = time;
  out[car + F.QW] = 1;
  out[car + RACE_BASE + R.VEHICLE] = vehicleIndex(id);
  return out;
}

function recorded(stroke: MxGearStroke, time: number) {
  const out = frame(time), pose = stroke.sample(time), seed = stroke.seed;
  out.set([pose.angle, pose.cover, pose.clear], car + MX_FOOT.ANGLE);
  const high = Math.fround(time);
  out.set([1, seed.event, stroke.ageAt(time), seed.direction, seed.angle, seed.cover, seed.clear,
    seed.angleRate, seed.coverRate, seed.clearRate, high, time - high], car + S.RECORDED);
  return out;
}

function pair() {
  const stroke = new MxGearStroke();
  stroke.engage(-1, 0);
  return { stroke, a: recorded(stroke, .08), b: recorded(stroke, .1) };
}

/** BikeShells uses the common presentation alpha, then the original rider
 * state gates the selector and attached boot. PresentedFrame keeps that same
 * discrete state until the newer endpoint. */
function expectPresented(a: Float32Array, b: Float32Array, alpha: number, display = new PresentedFrame()) {
  const t = presentationAlpha(a, b, car, alpha), source = t < 1 ? a : b;
  const expected = hasMxFootControls(source, car) ? sample(a, b, t) : [0, 0, 0];
  expect(fromFrame(display.sample(a, b, alpha))).toEqual(expected.map(Math.fround));
}

it.each(['mx250', 'mx450'] as const)('%s retains the unmarked release and return at every rider-state edge', id => {
  const display = new PresentedFrame();
  for (const state of [1, 2, 3, 4]) {
    const active = frame(1, id), inactive = frame(1 + 1 / 30, id);
    active.set([.2, .8, .6], car + MX_FOOT.ANGLE);
    inactive[car + BIKE_BASE + B.STATE] = state;
    const start = fromFrame(active), end = [0, 0, 0];
    for (const alpha of [0, .25, .499, .5, .75, 1]) {
      expect(sample(active, inactive, alpha)).toEqual(linear(start, end, alpha));
      expectPresented(active, inactive, alpha, display);
    }
    inactive[H.TIME] = 1;
    active[H.TIME] = 1 + 1 / 30;
    for (const alpha of [0, .25, .5, .75, 1]) {
      expect(sample(inactive, active, alpha)).toEqual(linear(end, start, alpha));
      expectPresented(inactive, active, alpha, display);
    }
  }
});

it.each(['older', 'newer'] as const)('preserves the existing mixed pair when the %s endpoint is unmarked', side => {
  const { a, b } = pair(), legacy = side === 'older' ? a : b;
  legacy.fill(0, car + S.RECORDED, car + S.CLOCK_LO + 1);
  const beforeA = a.slice(), beforeB = b.slice(), start = fromFrame(a), end = fromFrame(b);
  for (const alpha of [0, .2, .5, .8, 1]) {
    expect(sample(a, b, alpha)).toEqual(linear(start, end, alpha));
    expectPresented(a, b, alpha);
  }
  expect(a).toEqual(beforeA);
  expect(b).toEqual(beforeB);
});

it('keeps a complete endpoint at marked rider edges with missing or stale trajectory data', () => {
  for (const staleMarker of [false, true]) {
    const { a, b } = pair();
    b[car + BIKE_BASE + B.STATE] = 1;
    b.fill(0, car + MX_FOOT.ANGLE, car + MX_FOOT.CLEAR + 1);
    if (!staleMarker) b.fill(0, car + S.RECORDED, car + S.CLOCK_LO + 1);
    for (const alpha of [0, .25, .499, .5, .75, 1]) {
      expect(sample(a, b, alpha)).toEqual(alpha < .5 ? fromFrame(a) : [0, 0, 0]);
      expectPresented(a, b, alpha);
    }
    a[H.TIME] = .12;
    for (const alpha of [0, .25, .5, .75, 1]) {
      expect(sample(b, a, alpha)).toEqual(alpha < .5 ? [0, 0, 0] : fromFrame(a));
      expectPresented(b, a, alpha);
    }
  }
});

it('distinguishes a corrupt marked seed from ignored optional bytes and sanitized bare foot positions', () => {
  const { a, b } = pair();
  b[car + S.COVER_RATE] = NaN;
  for (const alpha of [.25, .5, .75]) {
    expect(sample(a, b, alpha)).toEqual(fromFrame(alpha < .5 ? a : b));
    expectPresented(a, b, alpha);
  }
  b[car + S.RECORDED] = 0;
  for (const alpha of [.25, .5, .75]) {
    expect(sample(a, b, alpha)).toEqual(linear(fromFrame(a), fromFrame(b), alpha));
    expectPresented(a, b, alpha);
  }
  a[car + S.RECORDED] = 0;
  b.set([NaN, Infinity, 2], car + MX_FOOT.ANGLE);
  for (const alpha of [0, .25, .5, .75, 1]) {
    expect(sample(a, b, alpha)).toEqual(linear(fromFrame(a), [0, 0, 1], alpha));
    expectPresented(a, b, alpha);
  }
  expect(Number.isNaN(b[car + MX_FOOT.ANGLE])).toBe(true);
  expect(b[car + MX_FOOT.COVER]).toBe(Infinity);
  expect(b[car + MX_FOOT.CLEAR]).toBe(2);
});

it('respects same-time presentation holds while preserving the exact newer endpoint', () => {
  const { a, b } = pair(), display = new PresentedFrame();
  b[H.TIME] = a[H.TIME];
  for (const alpha of [0, .25, .5, .75]) {
    expect(fromFrame(display.sample(a, b, alpha))).toEqual(fromFrame(a));
    expectPresented(a, b, alpha, display);
  }
  expect(fromFrame(display.sample(a, b, 1))).toEqual(fromFrame(b));
  expectPresented(a, b, 1, display);
  expectPresented(a, a, .5, display);
});

it('preserves measured endpoint selection for adapter-clock discontinuities and rider resets', () => {
  for (const boundary of ['same clock', 'rewound clock', 'crash', 'state reset', 'stroke reset']) {
    const source = pair(), a = source.a;
    let b = source.b;
    if (boundary === 'same clock' || boundary === 'rewound clock') {
      b[car + S.CLOCK_HI] = a[car + S.CLOCK_HI] - (boundary === 'rewound clock' ? 1 : 0);
      b[car + S.CLOCK_LO] = a[car + S.CLOCK_LO];
    } else if (boundary === 'crash') b[car + BIKE_BASE + B.CRASHES] = 1;
    else if (boundary === 'state reset') a[car + BIKE_BASE + B.STATE_CLOCK] = 1;
    else {
      source.stroke.reset();
      b = recorded(source.stroke, .1);
    }
    for (const alpha of [0, .25, .499, .5, .75, 1]) {
      expect(sample(a, b, alpha)).toEqual(fromFrame(alpha < .5 ? a : b));
      expectPresented(a, b, alpha);
    }
    expect(sample(b, a, .25)).toEqual(fromFrame(b));
    expect(sample(b, a, .75)).toEqual(fromFrame(a));
    expect(() => new PresentedFrame().sample(b, a, .5)).toThrow('Invalid presentation snapshot pair');
  }
});
