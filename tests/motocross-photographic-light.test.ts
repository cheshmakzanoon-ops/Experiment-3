import { describe, expect, it } from 'vitest';
import { GRADE_PROFILES } from '../src/rendering/broadcast-grade.ts';
import {
  applyGpDaylight,
  gpGradeProfile,
  gpPhotographicActive,
  tintGpSun,
} from '../src/rendering/gp-photographic-light.ts';
import {
  MX_PHOTOGRAPHIC,
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
    // Specular sky stays at the dome's radiance; exposure is not re-centred.
    expect(light.environment).toBe(1);
    expect(light.exposure).toBe(1);
    expect(light.haze).toBeGreaterThan(1.2);
    expect(light.haze).toBeLessThan(2.5);
    const sun = tintGpSun({ r: 1, g: 1, b: 1 }, MX_PHOTOGRAPHIC);
    expect(sun.r).toBe(1);
    expect(sun.g).toBeLessThan(sun.r);
    expect(sun.b).toBeLessThan(sun.g);
    expect(sun.b).toBeGreaterThan(0.75);
  });

  it('keeps the preset display transform and the venue sky, and grades without lens artefacts', () => {
    expect(MX_PHOTOGRAPHIC.toneMapper).toBeNull();
    expect(MX_PHOTOGRAPHIC.clearSky).toBeNull();
    expect(gpGradeProfile('night', MX_PHOTOGRAPHIC)).toBeNull();
    expect(gpGradeProfile('studio', MX_PHOTOGRAPHIC)).toBeNull();
    for (const profile of ['day', 'sunset'] as const) {
      const grade = gpGradeProfile(profile, MX_PHOTOGRAPHIC)!,
        shared = GRADE_PROFILES[profile];
      expect(grade.contrast).toBeGreaterThan(shared.contrast);
      expect(grade.contrast).toBeLessThan(0.3);
      expect(grade.vibrance).toBeGreaterThan(shared.vibrance);
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
