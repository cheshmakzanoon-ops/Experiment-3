import { expect, it, vi } from 'vitest';
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
      expect(measured.spawned[PARTICLE_KIND.SPRAY]).toBe(48);
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
    expect(measured.spawned[PARTICLE_KIND.SPRAY]).toBe(192);
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

it.each([2.5, 3.25, 10, 50])(
  'bounds a %s-second live GPU stall without extinguishing measured rain and spray',
  (gap) => {
    const effects = new Effects(),
      playback = new EffectPlayback(effects),
      initial = snapshot(0),
      current = snapshot(gap),
      original = current.slice(),
      update = vi.spyOn(effects, 'update');
    try {
      playback.update(initial, true, true);
      update.mockClear();
      playback.update(current, true, true);
      expect(update.mock.calls).toHaveLength(61);
      expect(update.mock.calls[0][1]).toBe(0);
      expect(update.mock.calls[0][2]).toBe(false);
      expect(update.mock.calls.slice(1).every((call) => call[1] <= 1 / 30)).toBe(true);
      expect(update.mock.calls.reduce((sum, call) => sum + call[1], 0)).toBeCloseTo(2, 8);
      expect(playback.elapsed).toBeCloseTo(2);
      expect(playback.omittedSeconds).toBeCloseTo(gap - 2);
      expect(playback.boundedCatchups).toBe(1);
      expect(playback.resets).toBe(1);
      const measured = effects.diagnostics();
      expect(measured.spawned[PARTICLE_KIND.MARBLE]).toBe(320);
      expect(measured.spawned[PARTICLE_KIND.SPRAY]).toBe(96);
      expect(measured.spawned[PARTICLE_KIND.RAIN]).toBe(160);
      expect(measured.active[PARTICLE_KIND.SPRAY]).toBeGreaterThan(0);
      expect(measured.active[PARTICLE_KIND.RAIN]).toBeGreaterThan(0);
      expect(current).toEqual(original);
      expect(initial).toEqual(snapshot(0));
      update.mockClear();
      playback.update(current, true, true);
      expect(update).not.toHaveBeenCalled();
      expect(effects.diagnostics()).toEqual(measured);
      playback.update(snapshot(gap * 2), true, true);
      expect(playback.elapsed).toBeCloseTo(4);
      expect(playback.omittedSeconds).toBeCloseTo((gap - 2) * 2);
      expect(playback.boundedCatchups).toBe(2);
      expect(effects.diagnostics().active[PARTICLE_KIND.SPRAY]).toBeGreaterThan(0);
    } finally {
      update.mockRestore();
      dispose(effects);
    }
  },
);

it('keeps rewind, explicit reset, replay gaps and inactive views separate from live catch-up', () => {
  const effects = new Effects(),
    playback = new EffectPlayback(effects);
  try {
    playback.update(snapshot(0), true, true);
    playback.update(snapshot(3), true, true);
    expect(playback.boundedCatchups).toBe(1);
    playback.update(snapshot(1), true, true);
    expect(effects.diagnostics().active.every((n) => n === 0)).toBe(true);
    playback.update(snapshot(1.25), true, true);
    expect(effects.diagnostics().active[PARTICLE_KIND.SPRAY]).toBeGreaterThan(0);
    playback.reset();
    playback.update(snapshot(30), true, true);
    expect(playback.boundedCatchups).toBe(0);
    expect(playback.omittedSeconds).toBe(0);
    expect(effects.diagnostics().spawned.every((n) => n === 0)).toBe(true);
    playback.update(snapshot(30.25), true, true);
    playback.update(snapshot(35), true, false);
    expect(effects.diagnostics().active.every((n) => n === 0)).toBe(true);
    playback.update(snapshot(38), true, true);
    expect(effects.diagnostics().active[PARTICLE_KIND.SPRAY]).toBeGreaterThan(0);
    playback.update(snapshot(38), false, true);
    expect(effects.group.visible).toBe(false);
    expect(effects.diagnostics().active.every((n) => n === 0)).toBe(true);
    playback.update(snapshot(45), true, true);
    expect(effects.diagnostics().spawned.every((n) => n === 0)).toBe(true);
  } finally {
    dispose(effects);
  }
});

it('does not fabricate rain or contact spray for dry or disabled long-gap live observations', () => {
  const effects = new Effects(),
    playback = new EffectPlayback(effects),
    dry = (time: number) => {
      const frame = snapshot(time);
      frame[H.RAIN] = 0;
      frame[p + W.WATER] = 0;
      frame[p + W.LOAD] = 0;
      return frame;
    };
  try {
    playback.update(dry(0), true, true);
    playback.update(dry(4), true, true);
    expect(effects.diagnostics().spawned.every((n) => n === 0)).toBe(true);
    effects.enabled = false;
    playback.update(snapshot(8), true, true);
    expect(effects.group.visible).toBe(false);
    expect(effects.diagnostics().spawned.every((n) => n === 0)).toBe(true);
  } finally {
    dispose(effects);
  }
});
