import { describe, expect, it } from 'vitest';
import {
  BUS_NAMES,
  DEFAULT_LEVELS,
  GAIN_STAGING,
  MasterBus,
  busGain,
  dbToGain,
  duckGain,
  gainToDb,
  masterGain,
  sliderGain,
  smoothToward,
  softLimit,
  softLimitCurve,
  validateLevels,
} from '../src/audio/mixer.ts';
import { FakeContext, asContext } from './fake-audio.ts';

describe('bus levels (player sliders)', () => {
  it('defaults every bus to the mix as designed and music below it', () => {
    expect(validateLevels(undefined)).toEqual(DEFAULT_LEVELS);
    expect(validateLevels({})).toEqual(DEFAULT_LEVELS);
    for (const bus of ['engine', 'effects', 'ambience', 'ui'] as const)
      expect(DEFAULT_LEVELS[bus]).toBe(1);
    expect(DEFAULT_LEVELS.music).toBeLessThan(1);
    expect([...BUS_NAMES]).toEqual(['engine', 'effects', 'ambience', 'ui', 'music']);
  });
  it('clamps to 0..1 and ignores anything that is not a finite number', () => {
    const v = validateLevels({ engine: 3, effects: -1, ambience: NaN, ui: 'loud', music: 0.25 });
    expect(v).toEqual({ engine: 1, effects: 0, ambience: 1, ui: 1, music: 0.25 });
    expect(validateLevels(null)).toEqual(DEFAULT_LEVELS);
    expect(validateLevels('x')).toEqual(DEFAULT_LEVELS);
  });
  it('maps a slider to amplitude with a square-law taper: half way is -12 dB, zero is silence', () => {
    expect(sliderGain(0)).toBe(0);
    expect(sliderGain(1)).toBe(1);
    expect(gainToDb(sliderGain(0.5))).toBeCloseTo(-12.04, 1);
    let previous = -1;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const g = sliderGain(v);
      expect(g).toBeGreaterThanOrEqual(previous);
      previous = g;
    }
    expect(sliderGain(7)).toBe(1);
    expect(sliderGain(-7)).toBe(0);
  });
  it('multiplies the calibrated trim by the slider; a muted slider mutes the bus', () => {
    const levels = { ...DEFAULT_LEVELS, music: 1 };
    for (const bus of BUS_NAMES)
      expect(gainToDb(busGain(bus, levels))).toBeCloseTo(GAIN_STAGING.trimDb[bus], 6);
    expect(busGain('engine', { ...levels, engine: 0 })).toBe(0);
    expect(busGain('effects', { ...levels, effects: 0.5 })).toBeCloseTo(
      dbToGain(GAIN_STAGING.trimDb.effects - 12.0412),
      4,
    );
  });
  it('keeps the master volume linear (the setting every saved profile already holds)', () => {
    expect(masterGain(0.45)).toBeCloseTo(0.45 * 0.8, 9);
    expect(masterGain(1, 0.85)).toBeCloseTo(0.8 * 0.85, 9);
    expect(masterGain(2)).toBeCloseTo(0.8, 9);
    expect(masterGain(-1)).toBe(0);
  });
});

describe('gain staging maths', () => {
  it('converts decibels both ways', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 4);
    expect(gainToDb(dbToGain(-17.3))).toBeCloseTo(-17.3, 9);
    expect(Number.isFinite(gainToDb(0))).toBe(true);
  });
  it('smooths exponentially toward a target and never overshoots', () => {
    let v = 0;
    for (let i = 0; i < 400; i++) {
      const next = smoothToward(v, 1, 0.025, 0.25);
      expect(next).toBeGreaterThanOrEqual(v);
      expect(next).toBeLessThanOrEqual(1);
      v = next;
    }
    expect(v).toBeGreaterThan(0.9999);
    // One time constant covers 1 - 1/e of the distance.
    expect(smoothToward(0, 1, 0.25, 0.25)).toBeCloseTo(1 - Math.exp(-1), 9);
    expect(smoothToward(0.3, 0.8, 0, 0.25)).toBe(0.8); // no time passed: no step defined, take the target
    expect(smoothToward(1, 0, 0.1, 0.1)).toBeCloseTo(Math.exp(-1), 9);
  });
  it('ducks the ambience under the engines: none when they are absent, the full depth when present', () => {
    expect(duckGain(0)).toBe(1);
    expect(duckGain(0.1)).toBe(1);
    expect(duckGain(1)).toBeCloseTo(dbToGain(-GAIN_STAGING.ambienceDuckDb), 9);
    expect(gainToDb(duckGain(1, 6))).toBeCloseTo(-6, 6);
    let previous = 2;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const g = duckGain(p);
      expect(g).toBeLessThanOrEqual(previous);
      expect(g).toBeGreaterThan(0);
      previous = g;
    }
  });
});

describe('the ceiling (soft limiter curve)', () => {
  const ceiling = dbToGain(GAIN_STAGING.ceilingDbfs);
  it('sits at or below -1 dBFS and never reaches full scale', () => {
    expect(GAIN_STAGING.ceilingDbfs).toBeLessThanOrEqual(-1);
    for (const x of [0.6, 0.8, 1, 1.5, 4, 100, 1e9])
      expect(softLimit(x, ceiling)).toBeLessThan(ceiling + 1e-12);
  });
  it('is the identity below the knee, odd-symmetric and monotone', () => {
    for (const x of [0, 0.1, -0.3, 0.59, -0.6]) expect(softLimit(x, ceiling)).toBe(x);
    let previous = -Infinity;
    for (let x = -3; x <= 3; x += 0.01) {
      const y = softLimit(x, ceiling);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(softLimit(-x, ceiling)).toBeCloseTo(-y, 12);
      previous = y;
    }
  });
  it('joins the straight part smoothly: the slope is 1 at the knee and falls away after', () => {
    const slope = (x: number) =>
      (softLimit(x + 1e-6, ceiling) - softLimit(x - 1e-6, ceiling)) / 2e-6;
    expect(slope(0.6 - 1e-3)).toBeCloseTo(1, 4);
    expect(slope(0.6 + 1e-3)).toBeGreaterThan(0.99);
    expect(slope(0.8)).toBeLessThan(slope(0.7));
    expect(slope(1.5)).toBeLessThan(0.2);
  });
  it('builds a WaveShaper table whose ends (what an input beyond full scale maps to) stay under the ceiling', () => {
    const curve = softLimitCurve(ceiling);
    expect(curve.length).toBe(4097);
    expect(curve[2048]).toBe(0);
    expect(Math.max(...curve)).toBeLessThan(ceiling);
    expect(Math.min(...curve)).toBeGreaterThan(-ceiling);
    expect(curve[0]).toBeCloseTo(-curve[4096], 7);
  });
});

describe('the master bus graph', () => {
  it('runs damp-air low-pass, compressor, make-up and ceiling into the destination', () => {
    const ctx = new FakeContext(),
      bus = new MasterBus(asContext(ctx));
    const [shaper] = ctx.of('shaper');
    expect(ctx.reaches(ctx.of('biquad')[0], ctx.destination)).toBe(true);
    expect(ctx.of('compressor')).toHaveLength(1);
    expect(ctx.reaches(ctx.of('biquad')[0], ctx.of('compressor')[0])).toBe(true);
    expect(ctx.reaches(ctx.of('compressor')[0], shaper)).toBe(true);
    expect(shaper.outputs).toContain(ctx.destination);
    expect(shaper.oversample).toBe('4x');
    expect(ctx.of('biquad')[0].frequency.value).toBe(18000);
    expect(ctx.of('gain')[0].gain.value).toBeCloseTo(dbToGain(GAIN_STAGING.makeupDb), 9);
    expect(bus.output).toBe(shaper as unknown);
  });
  it('can take the compressor and ceiling out of the path for pre-limiter measurement, and put them back', () => {
    const ctx = new FakeContext(),
      bus = new MasterBus(asContext(ctx)),
      [compressor] = ctx.of('compressor'),
      [shaper] = ctx.of('shaper'),
      [filter] = ctx.of('biquad');
    bus.bypassDynamics(true);
    expect(ctx.reaches(filter, compressor)).toBe(false);
    expect(ctx.reaches(filter, ctx.destination)).toBe(true);
    expect(shaper.outputs).toHaveLength(0);
    bus.bypassDynamics(false);
    expect(ctx.reaches(filter, compressor)).toBe(true);
    expect(shaper.outputs).toContain(ctx.destination);
    bus.dispose();
    expect(filter.outputs).toHaveLength(0);
  });
});
