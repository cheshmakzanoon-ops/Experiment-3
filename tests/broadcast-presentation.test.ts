import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { graphicsPreset, validateGraphics } from '../src/rendering/options.ts';
import {
  AMBIENT_OCCLUSION,
  SceneAmbientPass,
  obscuranceSize,
} from '../src/rendering/scene-ambient-pass.ts';
import {
  BroadcastGradePass,
  GRADE_PROFILES,
  gradeCurve,
} from '../src/rendering/broadcast-grade.ts';

describe('broadcast presentation options', () => {
  it('scales multisampling and obscurance with the quality preset', () => {
    expect(graphicsPreset('low')).toMatchObject({ msaa: 0, ambientOcclusion: false, bloom: false });
    expect(graphicsPreset('medium')).toMatchObject({
      msaa: 2,
      ambientOcclusion: true,
      bloom: true,
    });
    expect(graphicsPreset('high')).toMatchObject({ msaa: 4, ambientOcclusion: true, bloom: true });
    for (const quality of ['low', 'medium', 'high'] as const)
      expect(graphicsPreset(quality).filmGrade).toBe(true);
  });
  it('rejects unsupported sample counts and coerced booleans', () => {
    const g = validateGraphics({ msaa: 8, ambientOcclusion: 'true', filmGrade: 0 }, 'high');
    expect(g.msaa).toBe(4);
    expect(g.ambientOcclusion).toBe(true);
    expect(g.filmGrade).toBe(true);
    const off = validateGraphics(
      { ...graphicsPreset('high'), msaa: 0, ambientOcclusion: false, filmGrade: false },
      'high',
    );
    expect(off).toMatchObject({ msaa: 0, ambientOcclusion: false, filmGrade: false });
  });
  it('keeps settings saved before these controls existed on the preset values', () => {
    const legacy: Record<string, unknown> = { ...graphicsPreset('medium') };
    delete legacy.msaa;
    delete legacy.ambientOcclusion;
    delete legacy.filmGrade;
    expect(validateGraphics(legacy, 'medium')).toEqual(graphicsPreset('medium'));
  });
});

describe('scene ambient obscurance', () => {
  it('computes a half-resolution buffer that never collapses to zero', () => {
    expect(obscuranceSize(1920, 1080)).toEqual({ width: 960, height: 540 });
    expect(obscuranceSize(1601, 901)).toEqual({ width: 801, height: 451 });
    expect(obscuranceSize(0, 1)).toEqual({ width: 1, height: 1 });
    expect(() => obscuranceSize(NaN, 1)).toThrow();
  });
  it('uses bounded, fading tuning suitable for cockpit and circuit scales', () => {
    expect(AMBIENT_OCCLUSION.radius).toBeGreaterThan(0.2);
    expect(AMBIENT_OCCLUSION.radius).toBeLessThan(2);
    expect(AMBIENT_OCCLUSION.fadeStart).toBeLessThan(AMBIENT_OCCLUSION.fadeEnd);
    expect(AMBIENT_OCCLUSION.maxPixels).toBeLessThanOrEqual(96);
    // No obscurance on the cockpit interior (wheel and gloves within about
    // 0.9 m of the eye), full obscurance from T-cam and chase distances.
    expect(AMBIENT_OCCLUSION.nearStart).toBeGreaterThanOrEqual(0.8);
    expect(AMBIENT_OCCLUSION.nearStart).toBeLessThan(AMBIENT_OCCLUSION.nearEnd);
    expect(AMBIENT_OCCLUSION.nearEnd).toBeLessThanOrEqual(3);
    expect(Object.isFrozen(AMBIENT_OCCLUSION)).toBe(true);
  });
  it('owns a float depth attachment and releases the framebuffer on sample changes', () => {
    const pass = new SceneAmbientPass(new T.Scene(), new T.PerspectiveCamera(), 2);
    expect(pass.needsSwap).toBe(true);
    expect(pass.samples).toBe(2);
    expect(pass.target.depthTexture?.type).toBe(T.FloatType);
    let disposed = 0;
    pass.target.addEventListener('dispose', () => disposed++);
    pass.setSamples(2);
    expect(disposed).toBe(0);
    pass.setSamples(4);
    expect(pass.samples).toBe(4);
    expect(disposed).toBe(1);
    pass.setSize(1601, 901);
    expect(pass.diagnostics()).toMatchObject({
      width: 1601,
      height: 901,
      obscuranceWidth: 801,
      obscuranceHeight: 451,
      samples: 4,
    });
    pass.dispose();
  });
});

describe('broadcast colour grade', () => {
  it('is a monotonic, endpoint-preserving S-curve', () => {
    for (const contrast of [0, 0.2, 1]) {
      expect(gradeCurve(0, contrast)).toBe(0);
      expect(gradeCurve(1, contrast)).toBe(1);
      expect(gradeCurve(0.5, contrast)).toBeCloseTo(0.5, 12);
      let previous = -1;
      for (let i = 0; i <= 100; i++) {
        const value = gradeCurve(i / 100, contrast);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
    expect(gradeCurve(0.25, 0.3)).toBeLessThan(0.25);
    expect(gradeCurve(0.75, 0.3)).toBeGreaterThan(0.75);
    expect(() => gradeCurve(NaN, 0.2)).toThrow();
  });
  it('keeps every lighting profile within restrained look-development bounds', () => {
    for (const profile of Object.values(GRADE_PROFILES)) {
      expect(profile.contrast).toBeGreaterThanOrEqual(0);
      expect(profile.contrast).toBeLessThan(0.4);
      expect(profile.saturation).toBeGreaterThan(0.9);
      expect(profile.saturation).toBeLessThan(1.25);
      expect(profile.vignette).toBeLessThan(0.5);
      expect(profile.fringe).toBeLessThan(0.003);
      expect(profile.grain).toBeLessThan(0.05);
      for (const channel of [...profile.shadowTint, ...profile.highlightTint]) {
        expect(channel).toBeGreaterThan(0.85);
        expect(channel).toBeLessThan(1.15);
      }
    }
    // No gameplay or studio profile disguises aliasing or weak textures with
    // grain, lens fringe or unsharp masking; vignetting stays light.
    for (const profile of Object.values(GRADE_PROFILES)) {
      expect(profile.grain).toBe(0);
      expect(profile.fringe).toBe(0);
      expect(profile.sharpen).toBe(0);
      expect(profile.vignette).toBeLessThanOrEqual(0.2);
    }
  });
  it('derives grain from presented simulation time, so held frames are identical', () => {
    const pass = new BroadcastGradePass();
    const uniforms = (pass as unknown as { material: T.ShaderMaterial }).material.uniforms;
    pass.apply('night', 12.5);
    const seed = uniforms.seed.value;
    pass.apply('night', 12.5);
    expect(uniforms.seed.value).toBe(seed);
    expect(pass.profile).toBe('night');
    expect(uniforms.vignette.value).toBe(GRADE_PROFILES.night.vignette);
    pass.apply('day', NaN);
    expect(uniforms.seed.value).toBe(0);
    pass.dispose();
  });
});
