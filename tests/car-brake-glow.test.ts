import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  ROTOR_BLACKBODY,
  ROTOR_GLOW_PROFILE,
  installRotorGlow,
  rotorGlowColour,
} from '../src/rendering/car-brake-glow.ts';

const compile = (m: T.Material) => {
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};

describe('incandescent brake rotors', () => {
  it('follow the Planckian hue: cherry red, then orange, then towards yellow', () => {
    const temps = [200, 520, 650, 800, 950, 1100, 1300, 1600, 2500];
    const colours = temps.map((t) => rotorGlowColour(t, new T.Color()));
    for (const c of colours) {
      expect(c.r).toBe(1);
      expect(c.g).toBeGreaterThanOrEqual(0);
      expect(c.g).toBeLessThan(0.26);
      expect(c.b).toBeLessThanOrEqual(c.g);
    }
    for (let i = 1; i < colours.length; i++)
      expect(colours[i].g).toBeGreaterThanOrEqual(colours[i - 1].g);
    // Below ~530 C a rotor is the deepest tabulated red; at race heat it is orange.
    expect(colours[0].g).toBeCloseTo(ROTOR_BLACKBODY.green[0], 6);
    expect(colours[4].g).toBeGreaterThan(0.06);
    expect(colours[4].g).toBeLessThan(0.11);
    // Clamped at the hottest knot; non-finite readings fall back to the coolest hue.
    expect(colours[8].g).toBeCloseTo(ROTOR_BLACKBODY.green[6], 6);
    expect(rotorGlowColour(Number.NaN, new T.Color()).g).toBeCloseTo(ROTOR_BLACKBODY.green[0], 6);
  });

  it('concentrates the glow on the friction band of the rotor, once', () => {
    const material = new T.MeshStandardMaterial({ emissive: 0xff4d08 });
    const key = material.customProgramCacheKey();
    expect(installRotorGlow(material, 0.209)).toBe(material);
    installRotorGlow(material, 0.209);
    expect(material.customProgramCacheKey()).toBe(`${key}|rotor-incandescence-v1`);
    const shader = compile(material);
    expect(shader.vertexShader).toContain('vRotorLocal=position;');
    const f = shader.fragmentShader;
    expect(f.split('float rotorBand').length).toBe(2);
    expect(f).toContain(
      `smoothstep(${(ROTOR_GLOW_PROFILE.inner * 0.209).toFixed(5)}, ${(ROTOR_GLOW_PROFILE.band * 0.209).toFixed(5)}, rotorR)`,
    );
    // After the emissive map, before lighting; no new uniform or texture.
    expect(f.indexOf('float rotorBand')).toBeGreaterThan(
      f.indexOf('totalEmissiveRadiance = emissive'),
    );
    expect(f.indexOf('float rotorBand')).toBeLessThan(
      f.indexOf('#include <lights_fragment_begin>'),
    );
    expect(Object.keys(shader.uniforms)).toEqual([]);
    expect(() => installRotorGlow(new T.MeshStandardMaterial(), 0)).toThrow();
    expect(() => installRotorGlow(new T.MeshStandardMaterial(), Number.NaN)).toThrow();
  });
});
