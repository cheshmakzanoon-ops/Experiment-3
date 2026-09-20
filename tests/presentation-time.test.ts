import { expect, it } from 'vitest';
import * as T from 'three';
import { CAR_STRIDE, F, H, HEADER, W, WHEEL_BASE, carBase } from '../src/simulation/protocol.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { EffectPlayback } from '../src/rendering/effect-playback.ts';
import { Effects, PARTICLE_KIND } from '../src/rendering/effects.ts';
const o = carBase(0),
  p = o + WHEEL_BASE;
function snapshot(time: number) {
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  frame[H.CARS] = 1;
  frame[H.TIME] = time;
  frame[H.RAIN] = 2;
  frame[o + F.QW] = 1;
  frame[o + F.SPEED] = 30;
  frame[o + F.VZ] = 30;
  frame[o + F.Z] = time * 30;
  frame[p + W.LOAD] = 2000;
  frame[p + W.WATER] = 1;
  frame[o + F.MARBLE_PICKUP_FR] = time * 0.5;
  return frame;
}
// Phase 27A: one loaded slick wheel at 30 m/s and 1 mm water emits
// 30 * 1 * 2.5 * 0.8 * (2000 / 3500) = 240/7 particles/s, not the old
// load-independent 48/s. Keep exact elapsed-time assertions at every FPS.
const fixtureSprayPerSecond = 240 / 7;
function dispose(effects: Effects) {
  effects.group.traverse((object) => {
    if (object instanceof T.Points || object instanceof T.Mesh) {
      object.geometry.dispose();
      (object.material as T.Material).dispose();
    }
  });
}
it('interpolates effect/audio positions without fractional gear, compound or surface IDs', () => {
  const a = snapshot(0),
    b = snapshot(1),
    aCopy = a.slice(),
    sample = new PresentedFrame();
  a[o + F.GEAR] = 2;
  b[o + F.GEAR] = 3;
  a[o + F.COMPOUND] = 0;
  b[o + F.COMPOUND] = 4;
  a[p + W.SURFACE] = 0;
  b[p + W.SURFACE] = 4;
  b[o + F.QY] = 1;
  b[o + F.QW] = 0;
  const out = sample.sample(a, b, 0.5),
    retained = sample.value;
  expect(out[H.TIME]).toBe(0.5);
  expect(out[o + F.Z]).toBe(15);
  expect(out[o + F.GEAR]).toBe(2);
  expect(out[o + F.COMPOUND]).toBe(0);
  expect(out[p + W.SURFACE]).toBe(0);
  expect(out[o + F.QY]).toBeCloseTo(Math.SQRT1_2);
  expect(out[o + F.QW]).toBeCloseTo(Math.SQRT1_2);
  expect(out[o + F.MARBLE_PICKUP_FR]).toBe(0.25);
  expect(sample.sample(a, b, 1)).toBe(retained);
  expect(retained).toEqual(b);
  expect(a[o + F.Z]).toBe(aCopy[o + F.Z]);
  expect(b[H.TIME]).toBe(1);
});
it('does not turn replacement-tire counters into negative interpolation or change input snapshots', () => {
  const a = snapshot(1),
    b = snapshot(2);
  b[o + F.MARBLE_PICKUP_FR] = 0;
  const originals = [a.slice(), b.slice()],
    sample = new PresentedFrame();
  expect(sample.sample(a, b, 0.5)[o + F.MARBLE_PICKUP_FR]).toBe(0.5);
  expect(sample.sample(a, b, 1)[o + F.MARBLE_PICKUP_FR]).toBe(0);
  expect(a).toEqual(originals[0]);
  expect(b).toEqual(originals[1]);
});
it('rejects malformed/rewound presentation pairs instead of extrapolating invalid state', () => {
  const sample = new PresentedFrame(),
    a = snapshot(0),
    b = snapshot(1);
  for (const alpha of [NaN, Infinity, -1, 2]) expect(() => sample.sample(a, b, alpha)).toThrow();
  expect(() => sample.sample(b, a, 0.5)).toThrow();
  expect(() => sample.sample(a.subarray(1), b, 0.5)).toThrow();
});
it.each([24, 30, 60, 90, 120, 144])(
  'replays the same one-second contact work at %i display FPS',
  (hz) => {
    const effects = new Effects(),
      playback = new EffectPlayback(effects);
    try {
      for (let i = 0; i <= hz; i++) playback.update(snapshot(i / hz));
      const measured = effects.diagnostics();
      expect(playback.elapsed).toBeCloseTo(1, 6);
      expect(measured.spawned[PARTICLE_KIND.MARBLE]).toBe(160);
      expect(measured.spawned[PARTICLE_KIND.SPRAY]).toBe(Math.floor(fixtureSprayPerSecond));
      expect(measured.spawned[PARTICLE_KIND.RAIN]).toBe(2 * 40);
    } finally {
      dispose(effects);
    }
  },
);
it('freezes every particle attribute during pause instead of generating stale smoke or rain', () => {
  const effects = new Effects(),
    playback = new EffectPlayback(effects);
  try {
    playback.update(snapshot(0));
    playback.update(snapshot(0.1));
    const geometry = (effects.group.children[0] as T.Points).geometry;
    const before = Object.fromEntries(
      Object.entries(geometry.attributes).map(([name, attribute]) => [
        name,
        Array.from(attribute.array),
      ]),
    );
    const spawned = effects.diagnostics().spawned;
    for (let i = 0; i < 200; i++) playback.update(snapshot(0.1));
    expect(effects.diagnostics().spawned).toEqual(spawned);
    for (const [name, values] of Object.entries(before))
      expect(Array.from(geometry.getAttribute(name).array)).toEqual(values);
  } finally {
    dispose(effects);
  }
});
it('accelerated replay integrates recorded time and moving emitters, not wall-clock duration', () => {
  const effects = new Effects(),
    playback = new EffectPlayback(effects);
  try {
    for (let i = 0; i <= 30; i++) playback.update(snapshot(i / 30));
    const nominal = effects.diagnostics().spawned;
    playback.reset();
    for (let i = 0; i <= 10; i++) playback.update(snapshot(i / 10));
    expect(effects.diagnostics().spawned).toEqual(nominal);
    expect(playback.elapsed).toBeCloseTo(1);
  } finally {
    dispose(effects);
  }
});
it('clears forward/backward seek trails and does not fabricate a catch-up burst', () => {
  const effects = new Effects(),
    playback = new EffectPlayback(effects);
  try {
    playback.update(snapshot(0));
    playback.update(snapshot(0.1));
    expect(effects.diagnostics().active.some((n) => n > 0)).toBe(true);
    playback.update(snapshot(50));
    expect(effects.diagnostics().active.every((n) => n === 0)).toBe(true);
    expect(effects.diagnostics().spawned.every((n) => n === 0)).toBe(true);
    playback.update(snapshot(1));
    expect(effects.diagnostics().spawned.every((n) => n === 0)).toBe(true);
    playback.update(snapshot(1.1));
    expect(effects.diagnostics().spawned[PARTICLE_KIND.MARBLE]).toBe(16);
    playback.update(snapshot(1.2), false);
    expect(effects.diagnostics().active.every((n) => n === 0)).toBe(true);
  } finally {
    dispose(effects);
  }
});

it('honors disabled particles immediately even without a new simulation tick', () => {
  const effects = new Effects(),
    playback = new EffectPlayback(effects),
    f = snapshot(0);
  try {
    playback.update(f);
    expect(effects.group.visible).toBe(true);
    effects.enabled = false;
    playback.update(f);
    expect(effects.group.visible).toBe(false);
    effects.enabled = true;
    playback.update(f);
    expect(effects.group.visible).toBe(true);
    playback.update(f, false);
    expect(effects.group.visible).toBe(false);
  } finally {
    dispose(effects);
  }
});

it.each([0.5, 1, 2])('retains real weather/contact work during %s FPS rendering', (hz) => {
  const effects = new Effects(),
    playback = new EffectPlayback(effects);
  try {
    for (let i = 0; i <= hz * 4; i++) playback.update(snapshot(i / hz));
    const measured = effects.diagnostics();
    expect(playback.elapsed).toBeCloseTo(4, 6);
    expect(playback.resets).toBe(1);
    expect(measured.spawned[PARTICLE_KIND.MARBLE]).toBe(640);
    expect(measured.spawned[PARTICLE_KIND.SPRAY]).toBe(Math.floor(4 * fixtureSprayPerSecond));
    expect(measured.spawned[PARTICLE_KIND.RAIN]).toBe(320);
    expect(measured.active[PARTICLE_KIND.SPRAY]).toBeGreaterThan(0);
    expect(measured.active[PARTICLE_KIND.RAIN]).toBeGreaterThan(0);
    const before = measured.spawned;
    playback.update(snapshot(4));
    expect(effects.diagnostics().spawned).toEqual(before);
    playback.update(snapshot(20));
    expect(effects.diagnostics().spawned.every((n) => n === 0)).toBe(true);
  } finally {
    dispose(effects);
  }
});

it.each([
  { load: 0, compound: 0, speed: 30, water: 1, expected: 0 },
  { load: 1, compound: 0, speed: 30, water: 1, expected: 0 },
  { load: 100, compound: 0, speed: 30, water: 1, expected: 21 },
  { load: 2000, compound: 0, speed: 30, water: 1, expected: 34 },
  { load: 3500, compound: 0, speed: 30, water: 1, expected: 60 },
  { load: 7000, compound: 0, speed: 30, water: 1, expected: 78 },
  { load: 3500, compound: 3, speed: 30, water: 1, expected: 75 },
  { load: 3500, compound: 4, speed: 30, water: 1, expected: 86 },
  { load: 3500, compound: 4, speed: 100, water: 10, expected: 180 },
  { load: 3500, compound: 4, speed: 5, water: 1, expected: 0 },
  { load: 3500, compound: 4, speed: 30, water: 0, expected: 0 },
])(
  'pins Phase 27A spray births: $load N, compound $compound, $speed m/s, $water mm',
  ({ load, compound, speed, water, expected }) => {
    const effects = new Effects(),
      playback = new EffectPlayback(effects);
    try {
      for (let i = 0; i <= 60; i++) {
        const frame = snapshot(i / 60);
        frame[p + W.LOAD] = load;
        frame[p + W.WATER] = water;
        frame[o + F.COMPOUND] = compound;
        frame[o + F.SPEED] = speed;
        frame[o + F.VZ] = speed;
        frame[o + F.Z] = (speed * i) / 60;
        playback.update(frame);
      }
      expect(effects.diagnostics().spawned[PARTICLE_KIND.SPRAY]).toBe(expected);
      expect(playback.elapsed).toBeCloseTo(1, 6);
    } finally {
      dispose(effects);
    }
  },
);
