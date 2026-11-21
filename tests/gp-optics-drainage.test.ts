import { describe, it, expect } from 'vitest';
import { GpOpticalRain } from '../src/rendering/gp-optics-rain.ts';
describe('GP visor and screen water paths', () => {
  it('runs down while parked, drifts toward the low side, and sweeps up at speed', () => {
    const rain = new GpOpticalRain(),
      v = rain.flow.value;
    rain.set(4, 10, 0, 0.6, 0);
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(0);
    const parked = v.clone();
    rain.set(4, 10, 0, -0.6, 0);
    expect(v.x).toBeCloseTo(-parked.x, 12);
    expect(v.y).toBeCloseTo(parked.y, 12);
    rain.set(4, 10, 90, 0.6, Math.tan(0.6));
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.y).toBeGreaterThan(0);
    rain.set(4, 10, 0, 0.6, 0);
    expect(v.toArray()).toEqual(parked.toArray());
    rain.set(NaN, NaN, Infinity, NaN, Infinity);
    expect(rain.state.value.toArray()).toEqual([0, 0, 0]);
    expect(v.toArray()).toEqual([0, -0.14]);
  });
});
