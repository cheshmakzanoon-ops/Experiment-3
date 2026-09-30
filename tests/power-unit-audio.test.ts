import { describe, it, expect } from 'vitest';
import { CAR_STRIDE, F, HEADER, carBase } from '../src/simulation/protocol.ts';
import { POWER_UNIT, newPowerUnitMix, powerUnitMix } from '../src/audio/power-unit.ts';

const o = carBase(0);
function frame(rpm: number, torque: number, throttle: number, speed: number, gear: number) {
  const f = new Float32Array(HEADER + CAR_STRIDE);
  f[o + F.RPM] = rpm;
  f[o + F.ENGINE_TORQUE] = torque;
  f[o + F.THROTTLE] = throttle;
  f[o + F.SPEED] = speed;
  f[o + F.GEAR] = gear;
  return f;
}

describe('power-unit audio character from recorded state', () => {
  it('builds turbo whistle with load and RPM, silent when off throttle', () => {
    const idle = powerUnitMix(frame(4000, 80, 0.1, 10, 1), 0, 1, newPowerUnitMix());
    const half = powerUnitMix(frame(9000, 400, 0.8, 50, 5), 0, 5, newPowerUnitMix());
    const full = powerUnitMix(frame(12000, 640, 1, 80, 7), 0, 7, newPowerUnitMix());
    const lift = powerUnitMix(frame(11000, -60, 0, 70, 7), 0, 7, newPowerUnitMix());
    expect(idle.turbo).toBe(0);
    expect(half.turbo).toBeGreaterThan(0);
    expect(full.turbo).toBeGreaterThan(half.turbo);
    expect(full.turboHz).toBeGreaterThan(half.turboHz);
    expect(full.turboHz).toBeLessThanOrEqual(POWER_UNIT.turboMinHz + POWER_UNIT.turboSpanHz);
    expect(lift.turbo).toBe(0);
  });
  it('ties gear whine to road speed and removes it in neutral', () => {
    const slow = powerUnitMix(frame(8000, 300, 0.6, 20, 3), 0, 3, newPowerUnitMix());
    const fast = powerUnitMix(frame(8000, 300, 0.6, 80, 7), 0, 7, newPowerUnitMix());
    expect(fast.whineHz / slow.whineHz).toBeCloseTo(4, 6);
    expect(fast.whineHz).toBeCloseTo(80 * POWER_UNIT.whineHzPerMS, 6);
    expect(fast.whine).toBeGreaterThan(slow.whine);
    expect(powerUnitMix(frame(8000, 0, 0, 20, 0), 0, 0, newPowerUnitMix()).whine).toBe(0);
  });
  it('crackles only on a closed throttle at high RPM and speed', () => {
    expect(powerUnitMix(frame(11500, -50, 0, 70, 6), 0, 6, newPowerUnitMix()).crackleRate).toBeGreaterThan(0);
    expect(powerUnitMix(frame(11500, 500, 0.9, 70, 6), 0, 6, newPowerUnitMix()).crackleRate).toBe(0);
    expect(powerUnitMix(frame(6000, -50, 0, 70, 6), 0, 6, newPowerUnitMix()).crackleRate).toBe(0);
    expect(powerUnitMix(frame(11500, -50, 0, 5, 1), 0, 1, newPowerUnitMix()).crackleRate).toBe(0);
  });
  it('reports gear changes from the recorded gear only', () => {
    const mix = newPowerUnitMix();
    expect(powerUnitMix(frame(11800, 600, 1, 60, 5), 0, 4, mix).shift).toBe(1);
    expect(powerUnitMix(frame(7000, 0, 0, 40, 3), 0, 4, mix).shift).toBe(-1);
    expect(powerUnitMix(frame(7000, 0, 0, 40, 3), 0, 3, mix).shift).toBe(0);
    // First sample after a seek (no previous gear) is not a shift.
    expect(powerUnitMix(frame(7000, 0, 0, 40, 3), 0, NaN, mix).shift).toBe(0);
    expect(() => powerUnitMix(frame(NaN, 0, 0, 40, 3), 0, 3, mix)).toThrow();
  });
});
