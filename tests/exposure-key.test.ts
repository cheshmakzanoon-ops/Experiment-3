import { expect, it } from 'vitest';
import {
  ExposureAdaptation,
  METER_KEY,
  METER_LOG_MIN,
  METER_LOG_RANGE,
  METER_RESPONSE,
  readExposureMeter,
} from '../src/rendering/exposure-meter.ts';

/** A 16x12 meter readback from scene log2 luminances. */
function meter(samples: readonly number[]) {
  const pixels = new Uint8Array(samples.length * 4);
  samples.forEach((log, i) => {
    pixels[i * 4] = Math.round(((log - METER_LOG_MIN) / METER_LOG_RANGE) * 255);
    pixels[i * 4 + 3] = 255;
  });
  return readExposureMeter(pixels)!;
}

function target(samples: readonly number[], base: number, key: number) {
  const observation = meter(samples),
    state = new ExposureAdaptation();
  state.observe(
    observation.logLuminance,
    base,
    state.generation,
    observation.highlightLogLuminance,
    key,
  );
  return state.targetEV;
}

const fill = (count: number, log: number) => Array<number>(count).fill(log);

it('keeps a cockpit view, mostly dark interior, at the exposure of the lit exterior', () => {
  const base = 0.912,
    exterior = METER_KEY.day - Math.log2(base);
  // 60% of the metered region is carbon and padding 5 EV below the exterior.
  const cockpit = [...fill(115, exterior - 5), ...fill(77, exterior)];
  const chase = [...fill(115, exterior - 1.2), ...fill(77, exterior)];
  expect(Math.abs(target(cockpit, base, METER_KEY.day))).toBeLessThan(0.05);
  expect(Math.abs(target(chase, base, METER_KEY.day))).toBeLessThan(0.05);
  // The trimmed mean of the same cockpit frame asks for far more than the
  // +0.85 EV ceiling: what a mid-grey meter would apply to every frame.
  const mean = meter(cockpit).logLuminance;
  expect(Math.log2(0.22 / base) - mean).toBeGreaterThan(2);
});

it('adapts to frames that depart from the lighting key, within the restrained bounds', () => {
  for (const [lighting, base] of [
    ['day', 0.912],
    ['sunset', 1.006],
    ['night', 1.12],
  ] as const) {
    const key = METER_KEY[lighting],
      atKey = key - Math.log2(base);
    // Meter bins are 24/255 EV wide: a garage interior 1 EV darker than the
    // key opens by half a stop, a broad bright sky 1 EV above closes by half.
    expect(target(fill(192, atKey - 1), base, key)).toBeCloseTo(METER_RESPONSE, 1);
    expect(target(fill(192, atKey + 1), base, key)).toBeCloseTo(-METER_RESPONSE, 1);
    expect(target(fill(192, atKey - 6), base, key)).toBe(0.85);
    expect(target(fill(192, atKey + 6), base, key)).toBe(-0.7);
  }
  // Dusk and night stay darker than day: the meter never equalises them.
  expect(METER_KEY.day).toBeGreaterThan(METER_KEY.sunset);
  expect(METER_KEY.sunset).toBeGreaterThan(METER_KEY.night);
  expect(() => new ExposureAdaptation().observe(-4, 1, 0, -3, NaN)).toThrow('Invalid exposure key');
});

it('centres the measured Aurel views on the authored exposure', () => {
  // Exposed log2 luminance of the 90th-percentile sample in chase, cockpit and
  // trackside views at four points of a lap (Mesa software GL, High, 0 EV).
  const measured = {
    day: [-2.72, -3.38, -2.06, -1.87, -2.63, -2.06, -2.72, -2.82, -2.16, -2.44, -2.53, -1.87],
    sunset: [-3.99, -4.27, -4.08, -2.96, -3.61, -3.14, -4.08, -4.18, -3.52, -3.05, -3.43, -2.86],
    night: [-4.12, -4.78, -3.27, -2.9, -4.31, -1.95, -4.5, -5.15, -3.65, -4.12, -5.15, -3.08],
  };
  for (const lighting of ['day', 'sunset', 'night'] as const) {
    const evs = measured[lighting].map((exposed) => {
      const state = new ExposureAdaptation();
      state.observe(exposed, 1, state.generation, exposed, METER_KEY[lighting]);
      return state.targetEV;
    });
    const mean = evs.reduce((a, b) => a + b, 0) / evs.length;
    // One floodlit night view clamps at the -0.7 EV floor.
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.max(...evs.map(Math.abs))).toBeLessThan(0.75);
    // None of them sits at the ceiling the mid-grey meter applied to all.
    expect(evs.every((ev) => ev < 0.85)).toBe(true);
  }
});
