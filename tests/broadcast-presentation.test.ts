import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { graphicsPreset, validateGraphics } from '../src/rendering/options.ts';
import {
  AMBIENT_OCCLUSION,
  CONTACT_SUN,
  SCENE_AMBIENT_GLSL,
  SceneAmbientPass,
  gtaoSlices,
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

describe('ground-truth ambient occlusion and sun contact shadows', () => {
  it('integrates GTAO horizons in 2-3 slices of 6 steps with a multi-bounce fit', () => {
    const glsl = SCENE_AMBIENT_GLSL.obscurance;
    expect(glsl).toContain('#define GTAO_STEPS 6');
    expect(glsl).toContain('interleavedNoise(pixel)');
    // Jimenez 2016 multi-bounce fit for albedo 0.3.
    const rho = 0.3;
    for (const [name, value] of [
      ['a', 2.0404 * rho - 0.3324],
      ['b', -4.7951 * rho + 0.6417],
      ['c', 2.7552 * rho + 0.6903],
    ] as const)
      expect(glsl).toContain(`${name} = ${value.toFixed(5)}`);
    expect(gtaoSlices(0)).toBe(2);
    expect(gtaoSlices(2)).toBe(2);
    expect(gtaoSlices(4)).toBe(3);
    // The frozen near fade still guards the cockpit interior.
    expect(glsl).toContain('smoothstep(nearStart, nearEnd, -p.z)');
  });
  it('marches 12 steps over 0.3 m toward the sun and removes only direct light', () => {
    expect(SCENE_AMBIENT_GLSL.obscurance).toContain('#define CONTACT_STEPS 12');
    expect(SCENE_AMBIENT_GLSL.obscurance).toContain('#define CONTACT_LENGTH 0.3');
    expect(SCENE_AMBIENT_GLSL.composite).toContain('mix(1.0, contact, directShare)');
    expect(SCENE_AMBIENT_GLSL.blur).toContain('.rgb * w');
  });
  it('rebuilds the slice count with the sample count and keys contact shadows to the sun', () => {
    const camera = new T.PerspectiveCamera(50, 16 / 9, 0.045, 7000);
    camera.position.set(0, 1.65, -4.9);
    camera.lookAt(0, 0.4, 13);
    camera.updateMatrixWorld(true);
    const sun = new T.DirectionalLight(0xffffff, 3.9);
    sun.position.set(-140, 235, -115);
    sun.updateMatrixWorld(true);
    sun.target.updateMatrixWorld(true);
    const pass = new SceneAmbientPass(new T.Scene(), camera, 2, null, sun);
    type Internals = { obscuranceMaterial: T.ShaderMaterial };
    const material = (pass as unknown as Internals).obscuranceMaterial;
    expect(material.defines.GTAO_SLICES).toBe(2);
    pass.setSamples(4);
    expect(material.defines.GTAO_SLICES).toBe(3);
    const renderer = { autoClear: true, setRenderTarget: () => {}, render: () => {} };
    const write = new T.WebGLRenderTarget(4, 4);
    const contact = (intensity: number) => {
      sun.intensity = intensity;
      pass.render(renderer as unknown as T.WebGLRenderer, write);
      return material.uniforms.sunRatio.value as number;
    };
    expect(contact(3.9)).toBeCloseTo(CONTACT_SUN.ratioPerIntensity * 3.9, 9);
    expect(contact(0.3)).toBe(0); // night key (moon) and overcast cast none
    contact(3.9);
    const view = material.uniforms.sunView.value as T.Vector3;
    const world = new T.Vector3(-140, 235, -115).normalize();
    expect(view.length()).toBeCloseTo(1, 6);
    expect(view.clone().transformDirection(camera.matrixWorld).dot(world)).toBeCloseTo(1, 6);
    // Without a key-light shadow map every pixel counts as sunlit; with one,
    // the pass reads this frame's map so contact shadows never double up.
    expect(material.uniforms.sunShadowed.value).toBe(0);
    sun.castShadow = true;
    sun.shadow.map = new T.WebGLRenderTarget(2048, 1024);
    sun.shadow.bias = -1.5e-5;
    sun.shadow.updateMatrices(sun);
    contact(3.9);
    expect(material.uniforms.sunShadowed.value).toBe(1);
    expect(material.uniforms.sunShadowMap.value).toBe(sun.shadow.map.texture);
    expect(material.uniforms.sunShadowTexel.value.toArray()).toEqual([1 / 2048, 1 / 1024]);
    expect(material.uniforms.sunShadowBias.value).toBe(-1.5e-5);
    const expected = sun.shadow.matrix.clone().multiply(camera.matrixWorld);
    expect(material.uniforms.sunShadowMatrix.value.equals(expected)).toBe(true);
    expect(SCENE_AMBIENT_GLSL.obscurance).toContain('direct *= sunVisibility(p, n)');
    sun.position.set(-140, -10, -115); // below the horizon
    sun.updateMatrixWorld(true);
    expect(contact(3.9)).toBe(0);
    sun.shadow.map.dispose();
    pass.dispose();
    write.dispose();
  });
});
