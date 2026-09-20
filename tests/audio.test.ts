import { expect, it } from 'vitest';
import { contactMix, newContactMix } from '../src/audio/surface-audio.ts';
import {
  HEADER,
  CAR_STRIDE,
  F,
  H,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { SURFACE } from '../src/simulation/track.ts';
function frame() {
  const f = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  f[H.CARS] = 1;
  f[o + F.SPEED] = 40;
  f[o + F.RPM] = 8000;
  for (let i = 0; i < 4; i++) {
    const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
    f[p + W.LOAD] = 2000;
    f[p + W.OMEGA] = 120;
  }
  return f;
}
it('distinguishes asphalt, grass, gravel and kerb instead of one road rumble', () => {
  const f = frame(),
    o = carBase(0);
  for (const [surface, key] of [
    [SURFACE.ASPHALT, 'asphalt'],
    [SURFACE.GRASS, 'grass'],
    [SURFACE.GRAVEL, 'gravel'],
    [SURFACE.KERB, 'kerb'],
  ] as const) {
    for (let i = 0; i < 4; i++) f[o + WHEEL_BASE + i * WHEEL_STRIDE + W.SURFACE] = surface;
    const mix = contactMix(f, newContactMix());
    expect(mix[key]).toBeGreaterThan(0);
    for (const other of ['asphalt', 'grass', 'gravel', 'kerb'] as const)
      if (other !== key) expect(mix[other]).toBe(0);
  }
});
it('does not synthesize ground scrub or spray for unloaded wheels', () => {
  const f = frame(),
    o = carBase(0);
  for (let i = 0; i < 4; i++) {
    const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
    f[p + W.LOAD] = 0;
    f[p + W.WATER] = 2;
    f[p + W.FLAT] = 1;
    f[p + W.SLIP_POWER] = 1e5;
  }
  const mix = contactMix(f, newContactMix());
  expect([mix.scrub, mix.spray, mix.flat, mix.asphalt]).toEqual([0, 0, 0, 0]);
});
it('braking alone does not make smoke-like tire audio and lock/spin change the spectrum', () => {
  const f = frame(),
    o = carBase(0),
    p = o + WHEEL_BASE;
  f[o + F.BRAKE] = 1;
  expect(contactMix(f, newContactMix()).scrub).toBe(0);
  f[p + W.SLIP_POWER] = 8e4;
  f[p + W.SLIP] = -0.9;
  const lock = contactMix(f, newContactMix());
  f[p + W.SLIP] = 0.8;
  const spin = contactMix(f, newContactMix());
  expect(lock.scrub).toBeGreaterThan(0);
  expect(spin.scrubHz).toBeGreaterThan(lock.scrubHz);
});
it('flat-spot repetition comes from actual loaded wheel speed and vanishes at rest', () => {
  const f = frame(),
    o = carBase(0),
    p = o + WHEEL_BASE;
  f[p + W.FLAT] = 0.8;
  expect(contactMix(f, newContactMix()).flatHz).toBeCloseTo(120 / (2 * Math.PI));
  f[p + W.OMEGA] = 240;
  expect(contactMix(f, newContactMix()).flatHz).toBeCloseTo(240 / (2 * Math.PI));
  f[o + F.SPEED] = 0;
  expect(contactMix(f, newContactMix()).flat).toBe(0);
});
it('bottoming and electrical noise require actual contact work and power', () => {
  const f = frame(),
    o = carBase(0);
  expect(contactMix(f, newContactMix()).bottom).toBe(0);
  expect(contactMix(f, newContactMix()).hybrid).toBe(0);
  f[o + F.BOTTOM_ENERGY] = 18000;
  f[o + F.REGEN_POWER] = 100000;
  const mix = contactMix(f, newContactMix());
  expect(mix.bottom).toBeGreaterThan(0);
  expect(mix.hybrid).toBeGreaterThan(0);
  f[o + F.SPEED] = NaN;
  expect(() => contactMix(f, newContactMix())).toThrow();
});
