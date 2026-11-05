import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { EXHAUST_TINT, installExhaustHeatTint } from '../src/rendering/exhaust-heat-tint.ts';
import { installManufacturingFinish } from '../src/rendering/manufacturing.ts';

const compile = (m: T.Material) => {
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};

describe('tailpipe heat tint', () => {
  it('compiles a thin-film oxide lobe gated to the tailpipe envelope, once', () => {
    const material = installManufacturingFinish(
      new T.MeshPhysicalMaterial({ color: 0x7c8589, metalness: 0.88, roughness: 0.3 }),
      'turned-alloy',
    );
    const key = material.customProgramCacheKey();
    expect(installExhaustHeatTint(material)).toBe(material);
    installExhaustHeatTint(material);
    expect(material.customProgramCacheKey()).toBe(`${key}|exhaust-heat-tint-v1`);
    // The physical thin-film path is compiled with the oxide's index.
    expect(material.iridescence).toBe(EXHAUST_TINT.strength);
    expect(material.iridescenceIOR).toBe(EXHAUST_TINT.ior);
    const [lo, hi] = material.iridescenceThicknessRange;
    expect(lo).toBeLessThan(Math.min(EXHAUST_TINT.tipNm, EXHAUST_TINT.upstreamNm));
    expect(hi).toBeGreaterThan(Math.max(EXHAUST_TINT.tipNm, EXHAUST_TINT.upstreamNm));
    const shader = compile(material);
    expect(shader.vertexShader).toContain('vExhaustLocal=position;');
    // The manufacturing finish's own varying survives alongside.
    expect(shader.vertexShader).toContain('vManufacture=position;');
    const f = shader.fragmentShader;
    expect(f.split('float apexExhaustMask()').length).toBe(2);
    expect(f).toContain('material.iridescence *= exhaustMask;');
    expect(f).toContain(
      `mix(${EXHAUST_TINT.tipNm.toFixed(1)}, ${EXHAUST_TINT.upstreamNm.toFixed(1)}, along`,
    );
    // The film is set after the stock physical setup and before lighting.
    const film = f.indexOf('material.iridescence *= exhaustMask;');
    expect(film).toBeGreaterThan(f.indexOf('#include <lights_physical_fragment>'));
    expect(film).toBeLessThan(f.indexOf('#include <lights_fragment_begin>'));
    expect(f).toContain(
      `roughnessFactor = min(1.0, roughnessFactor + ${EXHAUST_TINT.roughness.toFixed(4)} * apexExhaustMask());`,
    );
    expect(Object.keys(shader.uniforms)).toEqual([]);
    expect(material.userData.exhaustHeatTint).toBe(true);
  });

  it('places the envelope around the authored tailpipe and clear of the rest of the car', () => {
    const t = EXHAUST_TINT;
    // APX-01 tailpipe (scripts/apx01-author.py): axis y -0.076, z -1.91..-2.17, r <= 0.055.
    expect(t.axisY).toBeCloseTo(-0.076, 6);
    expect(t.halfWidth).toBeGreaterThan(0.055);
    expect(t.yMin).toBeLessThan(-0.076 - 0.055);
    expect(t.yMax).toBeGreaterThan(-0.076 + 0.055);
    expect(t.zTip).toBeLessThan(-2.17);
    expect(t.zUpstream).toBeGreaterThan(-1.91);
    // The procedural outlet (car-mechanical-detail.ts: y -0.015, z -2.04..-2.19, r 0.038).
    expect(t.yMax).toBeGreaterThan(-0.015 + 0.038);
    // Nothing forward of the gearbox face or wider than the crash structure.
    expect(t.zUpstream).toBeLessThan(-1.85);
    expect(t.halfWidth).toBeLessThan(0.09);
    // Blue (hottest) at the lip, straw-gold upstream.
    expect(t.tipNm).toBeGreaterThan(t.upstreamNm);
  });
});
