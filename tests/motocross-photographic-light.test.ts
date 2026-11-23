import { describe, expect, it } from 'vitest';
import {
  GP_CLEAR_SKYLINE,
  SKY_RAMPS,
  skyBlend,
  withClearSky,
} from '../src/rendering/assets/sky-catalogue.ts';
import { GRADE_PROFILES } from '../src/rendering/broadcast-grade.ts';
import {
  applyGpDaylight,
  gpGradeProfile,
  gpPhotographicActive,
  tintGpSun,
} from '../src/rendering/gp-photographic-light.ts';
import {
  MX_ARENA_GRADE,
  MX_ARENA_PHOTOGRAPHIC,
  MX_PHOTOGRAPHIC,
  mxArenaActive,
  mxPhotographicActive,
} from '../src/rendering/offroad/mx-photographic-light.ts';

describe('motocross daylight look', () => {
  it('applies only to a followed motocross bike on a live terrain venue by day or golden hour', () => {
    expect(mxPhotographicActive('motocross', false, 'day', true)).toBe(true);
    expect(mxPhotographicActive('motocross', false, 'sunset', true)).toBe(true);
    // The floodlit stadium, showrooms/studio and paved circuits keep their light.
    expect(mxPhotographicActive('motocross', false, 'night', true)).toBe(false);
    expect(mxPhotographicActive('motocross', true, 'day', true)).toBe(false);
    expect(mxPhotographicActive('motocross', false, 'day', false)).toBe(false);
    for (const classId of ['formula', 'gp-bike', 'superbike', 'supermoto', 'rally', undefined])
      expect(mxPhotographicActive(classId, false, 'day', true)).toBe(false);
    // The two looks never claim the same frame.
    expect(gpPhotographicActive('motocross', false, 'day')).toBe(false);
  });

  it('strengthens and warms the key against a cooler, lower fill with dustier air', () => {
    const light = applyGpDaylight(
      { sun: 3, fill: 1, environment: 1, exposure: 1, haze: 1 },
      MX_PHOTOGRAPHIC,
    );
    expect(light.sun).toBeGreaterThan(3);
    expect(light.sun).toBeLessThan(3.6);
    expect(light.fill).toBeLessThan(1);
    expect(light.fill).toBeGreaterThan(0.8);
    // Specular sky stays at the dome's radiance; AgX re-centres exposure a little.
    expect(light.environment).toBe(1);
    expect(light.exposure).toBeGreaterThan(1);
    expect(light.exposure).toBeLessThan(1.12);
    expect(light.haze).toBeGreaterThan(1.2);
    expect(light.haze).toBeLessThan(2.5);
    const sun = tintGpSun({ r: 1, g: 1, b: 1 }, MX_PHOTOGRAPHIC);
    expect(sun.r).toBe(1);
    expect(sun.g).toBeLessThan(sun.r);
    expect(sun.b).toBeLessThan(sun.g);
    expect(sun.b).toBeGreaterThan(0.75);
  });

  it('crossfades the clear noon horizon into the valley cloud and rain photographs', () => {
    const valley = SKY_RAMPS.green.day;
    const stops = withClearSky(valley, MX_PHOTOGRAPHIC.clearSky!);
    expect(stops[0].skyline).toBe(GP_CLEAR_SKYLINE);
    expect(skyBlend(stops, 0.12)).toEqual({ a: 'kiara-5-noon', b: 'kiara-5-noon', weight: 0 });
    expect(skyBlend(stops, 0.325)).toEqual({
      a: 'kiara-5-noon',
      b: 'rural-landscape',
      weight: 0.5,
    });
    for (const cover of [0.45, 0.62, 0.8, 0.95])
      expect(skyBlend(stops, cover)).toEqual(skyBlend(valley, cover));
    expect(MX_ARENA_PHOTOGRAPHIC.clearSky).toBeNull();
  });

  it('uses the AgX display transform and grades without lens artefacts', () => {
    expect(MX_PHOTOGRAPHIC.toneMapper).toBe('agx');
    expect(gpGradeProfile('night', MX_PHOTOGRAPHIC)).toBeNull();
    expect(gpGradeProfile('studio', MX_PHOTOGRAPHIC)).toBeNull();
    for (const profile of ['day', 'sunset'] as const) {
      const grade = gpGradeProfile(profile, MX_PHOTOGRAPHIC)!,
        shared = GRADE_PROFILES[profile];
      expect(grade.contrast).toBeGreaterThan(shared.contrast);
      expect(grade.contrast).toBeLessThan(0.3);
      expect(grade.vibrance).toBeGreaterThan(shared.vibrance);
      // AgX desaturates mid-chroma; the grade restores it without going garish.
      expect(grade.saturation).toBeGreaterThan(1.1);
      expect(grade.saturation).toBeLessThan(1.2);
      // Warm key, cool shade.
      expect(grade.highlightTint[0]).toBeGreaterThan(grade.highlightTint[2]);
      expect(grade.shadowTint[2]).toBeGreaterThan(grade.shadowTint[0]);
      expect(grade.vignette).toBeLessThan(0.25);
      // Gameplay grades never hide aliasing behind grain, fringe or sharpening.
      expect(grade.grain).toBe(0);
      expect(grade.fringe).toBe(0);
      expect(grade.sharpen).toBe(0);
    }
  });
});

describe('motocross evening arena look', () => {
  it('applies only to a followed motocross bike in a supercross stadium at night', () => {
    expect(mxArenaActive('motocross', false, 'night', true)).toBe(true);
    expect(mxArenaActive('motocross', false, 'day', true)).toBe(false);
    expect(mxArenaActive('motocross', true, 'night', true)).toBe(false);
    expect(mxArenaActive('motocross', false, 'night', false)).toBe(false);
    for (const classId of ['formula', 'gp-bike', 'superbike', undefined])
      expect(mxArenaActive(classId, false, 'night', true)).toBe(false);
    // Never claimed by the daylight look in the same frame.
    expect(mxPhotographicActive('motocross', false, 'night', true)).toBe(false);
  });

  it('darkens the bowl, strengthens the shadowed key and thickens the haze', () => {
    const light = applyGpDaylight(
      { sun: 0.6, fill: 0.085, environment: 0.07, exposure: 1.12, haze: 1 },
      MX_ARENA_PHOTOGRAPHIC,
    );
    expect(light.sun).toBeGreaterThan(0.8);
    expect(light.fill).toBeLessThan(0.06);
    expect(light.environment).toBeLessThan(0.07);
    expect(light.exposure).toBeLessThan(1.12);
    expect(light.haze).toBeGreaterThan(2);
    expect(MX_ARENA_PHOTOGRAPHIC.toneMapper).toBe('agx');
    expect(MX_ARENA_GRADE.contrast).toBeGreaterThan(0.2);
    expect(MX_ARENA_GRADE.shadowTint[2]).toBeGreaterThan(MX_ARENA_GRADE.shadowTint[0]);
    expect(MX_ARENA_GRADE.grain + MX_ARENA_GRADE.fringe + MX_ARENA_GRADE.sharpen).toBe(0);
  });
});
