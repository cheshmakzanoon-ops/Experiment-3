import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import '../src/rendering/far-shadow.ts';
import {
  SHADOW_FILTER_TAPS,
  SHADOW_PENUMBRA_TEXELS,
  SUN_ANGULAR_DIAMETER,
  installShadowFilter,
  shadowFilterChunk,
  sunPenumbraScale,
} from '../src/rendering/studio/shadow-filter.ts';
import {
  CAR_GROUNDING,
  CAR_GROUNDING_HOOK,
  carGroundingAt,
  installCarGrounding,
} from '../src/rendering/studio/car-grounding.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { studioUniforms } from '../src/rendering/studio/studio-frame.ts';
import { graphicsPreset } from '../src/rendering/options.ts';

/** three's pristine r180 chunk, as shipped (the module patch replaces the global one). */
function pristineShadowPars() {
  const file = readFileSync(
    new URL(
      '../node_modules/three/src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js',
      import.meta.url,
    ),
    'utf8',
  );
  const body = file.slice(file.indexOf('`') + 1, file.lastIndexOf('`'));
  expect(body).not.toContain('${');
  return body;
}

describe('sun shadow filter', () => {
  it('replaces only the PCF_SOFT branch of getShadow, once', () => {
    const original = pristineShadowPars();
    expect(original).toContain('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )');
    const patched = shadowFilterChunk(original);
    expect(patched).toContain('float apexShadowFilter( sampler2D map');
    expect(patched).toContain(
      'shadow = apexShadowFilter( shadowMap, shadowMapSize, shadowRadius, shadowCoord.xy, shadowCoord.z );',
    );
    // three's fixed 3x3 bilinear kernel is gone from getShadow; PCF, VSM and the
    // point-light branches are untouched.
    const getShadow = patched.slice(patched.indexOf('float getShadow('));
    const directional = getShadow.slice(0, getShadow.indexOf('float getPointShadow('));
    expect(directional).not.toContain(') * ( 1.0 / 9.0 );');
    expect(directional).toContain('#if defined( SHADOWMAP_TYPE_PCF )');
    expect(directional).toContain('#elif defined( SHADOWMAP_TYPE_VSM )');
    expect(patched.slice(patched.indexOf('float getPointShadow('))).toBe(
      original.slice(original.indexOf('float getPointShadow(')),
    );
    // The helper precedes its only caller, and both appear once.
    expect(patched.indexOf('float apexShadowFilter(')).toBeLessThan(
      patched.indexOf('float getShadow('),
    );
    expect(patched.split('apexShadowFilter(').length - 1).toBe(2);
    expect(shadowFilterChunk(patched)).toBe(patched);
    expect(() => shadowFilterChunk('not a chunk')).toThrow('Unexpected three.js shadow map chunk');
  });

  it('is installed globally after the far map, both patches present', () => {
    installShadowFilter();
    const chunk = T.ShaderChunk.shadowmap_pars_fragment;
    expect(chunk).toContain('float apexFarShadow(');
    expect(chunk.split('float apexShadowFilter(').length - 1).toBe(1);
    // The Medium fragment-loop limit (16 taps) holds.
    expect(SHADOW_FILTER_TAPS).toBeLessThanOrEqual(16);
    // No clock or random source: the rotation is a function of the pixel.
    expect(chunk).not.toMatch(/time|random/i);
  });

  it('derives the sun penumbra scale from the 0.53 degree disc and the frustum', () => {
    const camera = { left: -38, right: 38, near: 20, far: 500 };
    const scale = sunPenumbraScale(camera);
    expect(scale).toBeCloseTo((Math.tan(SUN_ANGULAR_DIAMETER / 2) * 480) / 76, 6);
    // In (0, 1): the shader's PCSS selector; three's default radius 1 is not.
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(1);
    // Penumbra radius on a 2048 map (3.7 cm texels): a roof edge 10 m above the
    // ground spreads about 1.25 texels (a 9 cm wide penumbra), a 40 m tree top
    // 5 texels; a car floor 5 cm above the road clamps to the 1-texel minimum.
    const texels = (metres: number) => (metres / 480) * scale * 2048;
    expect(texels(10)).toBeCloseTo(1.25, 1);
    expect(texels(40)).toBeGreaterThan(4.5);
    expect(texels(40)).toBeLessThan(SHADOW_PENUMBRA_TEXELS.max);
    expect(texels(0.05)).toBeLessThan(SHADOW_PENUMBRA_TEXELS.min);
    expect(() => sunPenumbraScale({ left: 1, right: 1, near: 0, far: 1 })).toThrow();
  });

  it('gives Medium the 2048 map (fill cost only), Low none', () => {
    expect(graphicsPreset('medium').shadowSize).toBe(2048);
    expect(graphicsPreset('high').shadowSize).toBe(2048);
    expect(graphicsPreset('low').shadowSize).toBe(0);
  });
});

function shaderFor(id: 'standard' | 'physical' = 'standard'): StudioShader {
  const source = T.ShaderLib[id];
  return {
    uniforms: T.UniformsUtils.clone(source.uniforms),
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
  } as unknown as StudioShader;
}

describe('car grounding', () => {
  it('chains once and binds the shared car poses by identity', () => {
    const material = new T.MeshStandardMaterial();
    expect(installCarGrounding(material)).toBe(true);
    expect(installCarGrounding(material)).toBe(false);
    expect(studioHookKeys(material)).toEqual([CAR_GROUNDING_HOOK]);
    expect(material.customProgramCacheKey()).toContain(`|${CAR_GROUNDING_HOOK}`);
    const shader = shaderFor();
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.uniforms.studioCarPose).toBe(studioUniforms.studioCarPose);
    expect(shader.uniforms.studioCarCount).toBe(studioUniforms.studioCarCount);
    // The world position reaches the fragment stage through its own varying.
    expect(shader.vertexShader).toContain('varying vec3 vApexGroundWorld;');
    expect(shader.vertexShader).toMatch(/#include <project_vertex>\n\{\n\tvec4 apexGroundWorld/);
    expect(shader.fragmentShader).toContain('varying vec3 vApexGroundWorld;');
    // Declarations (uniforms, pose helper) precede the function using them,
    // which precedes the light scaling after the AO chunk.
    const f = shader.fragmentShader;
    const order = [
      'uniform vec4 studioCarPose[STUDIO_MAX_CARS];',
      'vec3 studioCarPoseLocal(',
      'float apexCarGrounding( vec3 p )',
      '#include <aomap_fragment>',
      'reflectedLight.indirectDiffuse *= apexIndirect;',
    ].map((text) => f.indexOf(text));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(f).toContain('if ( i >= studioCarCount ) break;');
  });

  it('darkens under the floor and the tyres with a 0.2 m edge, nothing beside the car', () => {
    // Under the floor centre and at a tyre contact: full occlusion.
    expect(carGroundingAt(0, 0, -0.3)).toBeCloseTo(1, 5);
    expect(carGroundingAt(0.83, 0, 1.82)).toBeCloseTo(1, 5);
    expect(carGroundingAt(-0.83, 0, -1.62)).toBeCloseTo(1, 5);
    // The floor edge (0.78 m) is the half-way point of the soft edge.
    expect(carGroundingAt(0.78, 0, 0)).toBeCloseTo(0.5, 5);
    // 0.2 m outside every part: open road.
    expect(carGroundingAt(1.25, 0, 0)).toBe(0);
    expect(carGroundingAt(0, 0, 3.05)).toBe(0);
    expect(carGroundingAt(0, 0, -2.86)).toBe(0);
    // The high nose and the wings occlude only partly.
    expect(carGroundingAt(0, 0, 1.9)).toBeCloseTo(0.45, 5);
    expect(carGroundingAt(0, 0, 2.5)).toBeCloseTo(0.5, 5);
    // A receiver far above or below the cars' ground level is left alone.
    expect(carGroundingAt(0, CAR_GROUNDING.height + 0.01, -0.3)).toBe(0);
    expect(carGroundingAt(0, -1, -0.3)).toBe(0);
    // Mirror symmetric across the car.
    for (const [x, z] of [
      [0.5, 1.7],
      [0.9, -1.2],
      [0.3, 2.6],
    ])
      expect(carGroundingAt(-x, 0, z)).toBeCloseTo(carGroundingAt(x, 0, z), 10);
    // Light under the floor centre: 25-35 % less sun, 55-65 % less sky.
    expect(CAR_GROUNDING.direct).toBeGreaterThanOrEqual(0.25);
    expect(CAR_GROUNDING.direct).toBeLessThanOrEqual(0.35);
    expect(CAR_GROUNDING.indirect).toBeGreaterThanOrEqual(0.55);
    expect(CAR_GROUNDING.indirect).toBeLessThanOrEqual(0.65);
  });
});
