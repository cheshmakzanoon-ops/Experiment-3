import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  GpSliderSparks,
  SLIDER_SPARKS,
  sliderSparkLevel,
  sparkAt,
} from '../src/rendering/gp-slider-sparks.ts';

/** Vehicle art 3, hero frame GP-R1: the knee slider throws sparks only while the rider's knee is
 * folded onto the road at full lean, and the burst is a pure function of presented time. */
describe('GP knee-slider sparks', () => {
  it('needs the knee on the road AND a real lean, and ramps in without popping', () => {
    // Knee clear of the road: nothing at any lean.
    for (const lean of [0, 0.5, 1, 1.2]) expect(sliderSparkLevel(0, lean)).toBe(0);
    // Knee on the road but only a kerb brush at 20 degrees: nothing.
    expect(sliderSparkLevel(1, 0.35)).toBe(0);
    expect(sliderSparkLevel(1, SLIDER_SPARKS.leanFrom)).toBe(0);
    // Full lean: the whole burst, in either direction.
    expect(sliderSparkLevel(1, SLIDER_SPARKS.leanTo)).toBe(1);
    expect(sliderSparkLevel(1, -1.15)).toBe(1);
    // Monotone ramp between.
    let previous = 0;
    for (let lean = SLIDER_SPARKS.leanFrom; lean <= SLIDER_SPARKS.leanTo; lean += 0.02) {
      const level = sliderSparkLevel(1, lean);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
    expect(sliderSparkLevel(NaN, 1)).toBe(0);
    expect(sliderSparkLevel(1, Infinity)).toBe(0);
  });
  it('is deterministic in time: the same presented time shows the same sparks', () => {
    for (let i = 0; i < SLIDER_SPARKS.count; i++)
      for (const time of [0, 0.37, 12.5, 98.001]) {
        const a = sparkAt(i, time, 1, 1),
          b = sparkAt(i, time, 1, 1);
        expect(b).toEqual(a);
        expect(a.alpha).toBeGreaterThanOrEqual(0);
        expect(a.alpha).toBeLessThanOrEqual(1);
      }
  });
  it('flies back along the machine, falls with world gravity and stays within a short trail', () => {
    let alive = 0,
      back = 0,
      maxBack = 0;
    const lean = 0.95;
    for (let i = 0; i < SLIDER_SPARKS.count; i++)
      for (let time = 0; time < 2; time += 0.013) {
        const s = sparkAt(i, time, lean, 1);
        if (s.alpha <= 0) continue;
        alive++;
        if (s.z <= 0) back++;
        maxBack = Math.max(maxBack, -s.z);
        expect(Math.hypot(s.x, s.y, s.z)).toBeLessThan(4);
      }
    expect(alive).toBeGreaterThan(200);
    // Every live spark is behind the slider; none overshoots a 3 m trail.
    expect(back).toBe(alive);
    expect(maxBack).toBeGreaterThan(0.5);
    expect(maxBack).toBeLessThan(3);
    // Gravity: within one spark's flight the second difference of its height is g * gy * dt^2,
    // with gy = -cos(lean) in the machine's frame (here upright, so -g).
    const dt = 0.004;
    let checked = 0;
    for (let time = 0; time < 1 && checked < 5; time += 0.0031) {
      const p0 = sparkAt(3, time, 0, 1),
        p1 = sparkAt(3, time + dt, 0, 1),
        p2 = sparkAt(3, time + 2 * dt, 0, 1);
      if (!(p0.alpha > 0 && p1.alpha > 0 && p2.alpha > 0)) continue;
      expect(p2.y - 2 * p1.y + p0.y).toBeCloseTo(-SLIDER_SPARKS.gravity * dt * dt, 7);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
  it('shows the sparks of a held frame identically after a seek (no wall-clock state)', () => {
    const sparks = new GpSliderSparks();
    const origins: [T.Vector3, T.Vector3] = [
      new T.Vector3(0.2, 0.1, 0),
      new T.Vector3(-0.2, 0.1, 0),
    ];
    expect(sparks.update(4.2, 1.0, origins, [1, 0])).toBe(true);
    const first = Array.from(
      (sparks.points.geometry.getAttribute('position') as T.BufferAttribute).array,
    );
    expect(sparks.points.visible).toBe(true);
    // Another frame, then back to the first: identical positions.
    sparks.update(9.9, 1.0, origins, [1, 0]);
    sparks.update(4.2, 1.0, origins, [1, 0]);
    const again = Array.from(
      (sparks.points.geometry.getAttribute('position') as T.BufferAttribute).array,
    );
    expect(again).toEqual(first);
    // Only the left knee scraped: nothing is lit for the right slider's points.
    expect(sparks.level).toEqual([1, 0]);
    // Upright, or knee clear: hidden.
    expect(sparks.update(4.2, 0.2, origins, [1, 1])).toBe(false);
    expect(sparks.points.visible).toBe(false);
    expect(sparks.update(4.2, 1.0, origins, [0, 0])).toBe(false);
    sparks.dispose();
  });
});
