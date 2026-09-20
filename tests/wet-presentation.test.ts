import { expect, it } from 'vitest';
import * as T from 'three';
import { Effects, EFFECT_CAPACITY, PARTICLE_KIND } from '../src/rendering/effects.ts';
import { RainStreaks } from '../src/rendering/rain-streaks.ts';
import { EffectPlayback } from '../src/rendering/effect-playback.ts';
import {
  CAR_STRIDE,
  HEADER,
  F,
  H,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';

function wetFrame(cars = 1) {
  const frame = new Float32Array(HEADER + CAR_STRIDE * cars);
  frame[H.CARS] = cars;
  frame[H.RAIN] = 100;
  frame[H.WIND_X] = 6;
  frame[H.WIND_Z] = -3;
  for (let id = 0; id < cars; id++) {
    const o = carBase(id);
    frame[o + F.QW] = 1;
    frame[o + F.SPEED] = 60;
    frame[o + F.VZ] = 60;
    frame[o + F.COMPOUND] = 4;
    frame[o + F.Z] = id * 10;
    for (let wheel = 0; wheel < 4; wheel++) {
      const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
      frame[p + W.LOAD] = 2000;
      frame[p + W.WATER] = 2;
    }
  }
  return frame;
}
function dispose(effects: Effects) {
  effects.group.traverse((o) => {
    if (o instanceof T.Points || o instanceof T.Mesh) {
      o.geometry.dispose();
      (o.material as T.Material).dispose();
    }
  });
}
it.each([24, 60, 144])(
  'reserves spray and rain capacity under a twelve-car storm at %i FPS',
  (hz) => {
    const effects = new Effects(),
      playback = new EffectPlayback(effects),
      frame = wetFrame(12);
    try {
      for (let i = 0; i <= 2 * hz; i++) {
        frame[H.TIME] = i / hz;
        playback.update(frame);
      }
      const d = effects.diagnostics();
      expect(d.capacity).toBe(1800);
      expect(d.contactCapacity + d.rainCapacity).toBe(d.capacity);
      expect(d.active[PARTICLE_KIND.SPRAY]).toBe(EFFECT_CAPACITY.contact);
      expect(d.active[PARTICLE_KIND.RAIN]).toBe(EFFECT_CAPACITY.rain);
      expect(d.spawned[PARTICLE_KIND.RAIN]).toBe(8000);
      expect(d.spawned[PARTICLE_KIND.SPRAY]).toBe(17280);
      expect(d.velocityX[PARTICLE_KIND.RAIN]).toBe(6);
      expect(d.velocityZ[PARTICLE_KIND.RAIN]).toBe(-3);
      const points = effects.group.children[0] as T.Points;
      const rain = effects.group.children[1] as T.Mesh<T.InstancedBufferGeometry>;
      expect(points.geometry.drawRange.count).toBe(EFFECT_CAPACITY.contact);
      expect(rain.geometry.instanceCount).toBe(EFFECT_CAPACITY.rain);
      expect(rain.geometry.getAttribute('position').count).toBe(4);
      expect(rain.geometry.index?.count).toBe(6);
      for (const attribute of Object.values(rain.geometry.attributes))
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
    } finally {
      dispose(effects);
    }
  },
);
it('rain births cannot overwrite an existing contact plume', () => {
  const effects = new Effects(),
    frame = wetFrame();
  try {
    frame[H.RAIN] = 0;
    effects.update(frame, 0.25);
    const before = effects.diagnostics().active[PARTICLE_KIND.SPRAY];
    expect(before).toBeGreaterThan(0);
    frame[H.RAIN] = 100;
    for (let wheel = 0; wheel < 4; wheel++)
      frame[carBase(0) + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LOAD] = 0;
    // 2,000 rain births exceeded the old shared pool before the plume expired.
    effects.update(frame, 0.25);
    effects.update(frame, 0.25);
    expect(effects.diagnostics().active[PARTICLE_KIND.SPRAY]).toBe(before);
    expect(effects.diagnostics().spawned[PARTICLE_KIND.RAIN]).toBe(2000);
  } finally {
    dispose(effects);
  }
});
it('rain buffers share the bounded pool and clear immediately during a held replay seek', () => {
  const effects = new Effects(),
    frame = wetFrame(),
    playback = new EffectPlayback(effects);
  try {
    playback.update(frame);
    frame[H.TIME] = 0.2;
    playback.update(frame);
    const pointGeometry = (effects.group.children[0] as T.Points).geometry;
    const rainGeometry = (effects.group.children[1] as T.Mesh<T.InstancedBufferGeometry>).geometry;
    const alpha = rainGeometry.getAttribute('opacity') as T.InstancedBufferAttribute;
    expect(alpha.array.buffer).toBe(pointGeometry.getAttribute('opacity').array.buffer);
    expect(rainGeometry.getAttribute('center').array.buffer).toBe(
      pointGeometry.getAttribute('position').array.buffer,
    );
    expect(Array.from(alpha.array).some((n) => n > 0)).toBe(true);
    const arrays = Object.values(rainGeometry.attributes).map((a) => Array.from(a.array));
    const originalFrame = frame.slice();
    for (let i = 0; i < 30; i++) playback.update(frame);
    expect(Object.values(rainGeometry.attributes).map((a) => Array.from(a.array))).toEqual(arrays);
    expect(frame).toEqual(originalFrame);
    const version = alpha.version;
    frame[H.TIME] = 40;
    playback.update(frame);
    expect(alpha.version).toBeGreaterThan(version);
    expect(Array.from(alpha.array).every((n) => n === 0)).toBe(true);
    expect(effects.diagnostics().active.every((n) => n === 0)).toBe(true);
  } finally {
    dispose(effects);
  }
});
it('both transparent passes are depth-tested, fog-aware and owned by the disposable scene', () => {
  const effects = new Effects();
  try {
    for (const o of effects.group.children as (T.Points | T.Mesh)[]) {
      const m = o.material as T.ShaderMaterial;
      expect(m.fog).toBe(true);
      expect(m.depthTest).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(m.uniforms.fogColor).toBeDefined();
      expect(m.fragmentShader).toContain('#include <fog_fragment>');
    }
  } finally {
    dispose(effects);
  }
});
it('rejects inconsistent rain instance views instead of drawing beyond allocated attributes', () => {
  expect(
    () => new RainStreaks(new Float32Array(0), new Float32Array(0), new Float32Array(0)),
  ).toThrow();
  expect(
    () => new RainStreaks(new Float32Array(3), new Float32Array(6), new Float32Array(1)),
  ).toThrow();
});

it.each([
  [0, 0],
  [1250, 30],
  [1750, 42],
  [2000, 48],
  [2500, 60],
  [10000, 78],
])('preserves Phase-27 load-aware emission at %i N: %i births per wheel/second', (load, births) => {
  const effects = new Effects(),
    frame = wetFrame();
  frame[H.RAIN] = 0;
  frame[carBase(0) + F.SPEED] = 30;
  frame[carBase(0) + F.COMPOUND] = 0;
  for (let wheel = 0; wheel < 4; wheel++) {
    const p = carBase(0) + WHEEL_BASE + wheel * WHEEL_STRIDE;
    frame[p + W.LOAD] = load;
    frame[p + W.WATER] = 1;
  }
  const copy = frame.slice();
  try {
    for (let i = 0; i < 60; i++) effects.update(frame, 1 / 60);
    expect(effects.diagnostics().spawned[PARTICLE_KIND.SPRAY]).toBe(births * 4);
    expect(frame).toEqual(copy);
  } finally {
    dispose(effects);
  }
});
