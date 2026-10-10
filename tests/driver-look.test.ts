import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  HELMET,
  VISOR,
  hueDegrees,
  installSuitRecolour,
  teamHelmetMaterial,
  visorMaterial,
} from '../src/rendering/studio/helmet-livery.ts';
import { applySuppliedCharacterLookdev } from '../src/rendering/studio/supplied-character-lookdev.ts';
import { driverMaterials } from '../src/rendering/driver-materials.ts';
import { HEAD_ROLL_GAIN } from '../src/rendering/driver.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';

const compile = (m: T.Material, id: 'standard' | 'physical' = 'physical') => {
  const shader = {
    uniforms: T.UniformsUtils.clone(T.ShaderLib[id].uniforms),
    vertexShader: T.ShaderLib[id].vertexShader,
    fragmentShader: T.ShaderLib[id].fragmentShader,
  } as unknown as StudioShader;
  m.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};
const design = { primary: 0xb3121e, secondary: 0x3a0a0e, accent: 0xf2f2ee };

describe('team helmet and visor', () => {
  it('paints the helmet in the team design under a glossy coat', () => {
    const { material, uniforms } = teamHelmetMaterial(design);
    expect(material.roughness).toBe(HELMET.roughness);
    expect(material.clearcoat).toBe(1);
    expect(material.clearcoatRoughness).toBe(0.03);
    expect(uniforms.helmetPrimary.value.getHex()).toBe(new T.Color(design.primary).getHex());
    expect(studioHookKeys(material)).toEqual(['team-helmet-v1']);
    const f = compile(material).fragmentShader;
    expect(f).toContain('D16 team helmet');
    expect(f.indexOf('D16 team helmet')).toBeGreaterThan(f.indexOf('#include <color_fragment>'));
  });

  it('gives the visor a dark iridescent film and a strong environment response', () => {
    const visor = visorMaterial();
    expect(visor.color.getHex()).toBe(VISOR.color);
    expect(visor.roughness).toBe(0.04);
    expect(visor.iridescence).toBe(1);
    expect(visor.iridescenceIOR).toBe(1.8);
    expect(visor.iridescenceThicknessRange).toEqual([280, 620]);
    expect(visor.clearcoatRoughness).toBe(0.015);
    expect(visor.envMapIntensity).toBe(2.5);
  });
});

describe('team kit', () => {
  it('builds sheened team suits and gloves; the default kit is unchanged', () => {
    const plain = driverMaterials();
    expect(plain.suit).not.toBeInstanceOf(T.MeshPhysicalMaterial);
    expect(plain.suit.color.getHex()).toBe(0x283f46);
    const team = driverMaterials(design);
    for (const m of [team.suit, team.glove, team.panel]) {
      expect(m).toBeInstanceOf(T.MeshPhysicalMaterial);
      const p = m as T.MeshPhysicalMaterial;
      expect(p.sheen).toBeGreaterThan(0);
      expect(p.sheenRoughness).toBeGreaterThanOrEqual(0.55);
      expect(p.sheenRoughness).toBeLessThanOrEqual(0.6);
      // Shared woven maps are kept.
      expect(p.normalMap).toBe(team.suit.normalMap);
    }
    expect(Math.abs(hueDegrees(team.glove.color) - hueDegrees(design.primary))).toBeLessThan(15);
    expect((team.suit as T.MeshPhysicalMaterial).sheenColor.r).toBeCloseTo(
      new T.Color(design.primary).r * 0.6,
      6,
    );
    expect(studioHookKeys(team.suit)).toEqual(['team-suit-v1']);
  });

  it('remaps the authored teal suit vertex colours to the kit', () => {
    const material = new T.MeshStandardMaterial({ vertexColors: true });
    const uniforms = installSuitRecolour(material, design);
    const shader = compile(material, 'standard');
    expect(shader.uniforms.suitPrimary).toBe(uniforms.suitPrimary);
    expect(shader.fragmentShader).toContain('D16: authored teal suit panels become the team kit.');
  });

  it('rolls the head about 6 degrees at 5 g', () => {
    expect(0.013 * 5 * HEAD_ROLL_GAIN).toBeGreaterThan((5 * Math.PI) / 180);
    expect(0.013 * 5 * HEAD_ROLL_GAIN).toBeLessThan((7 * Math.PI) / 180);
  });
});

describe('supplied driver look-dev', () => {
  it('tunes the supplied visor, helmet paint and fabrics by name, keeping blending flags', () => {
    const visor = new T.MeshPhysicalMaterial({
      name: 'F1CP_MAT_Visor',
      transparent: true,
      opacity: 0.7,
      side: T.DoubleSide,
    });
    visor.forceSinglePass = true;
    expect(applySuppliedCharacterLookdev(visor)).toBe(true);
    expect(visor.color.getHex()).toBe(VISOR.color);
    expect([visor.transparent, visor.opacity, visor.side, visor.forceSinglePass]).toEqual([
      true,
      0.7,
      T.DoubleSide,
      true,
    ]);
    const helmet = new T.MeshPhysicalMaterial({ name: 'F1CP_MAT_HelmetPaint', roughness: 0.27 });
    applySuppliedCharacterLookdev(helmet);
    expect([helmet.roughness, helmet.clearcoat, helmet.clearcoatRoughness]).toEqual([
      0.25, 1, 0.03,
    ]);
    const glove = new T.MeshPhysicalMaterial({ name: 'F1CP_MAT_Glove', color: 0x223355 });
    applySuppliedCharacterLookdev(glove);
    expect(glove.sheenRoughness).toBe(0.5);
    expect(glove.sheenColor.b).toBeCloseTo(glove.color.b * 0.6, 6);
    expect(
      applySuppliedCharacterLookdev(new T.MeshPhysicalMaterial({ name: 'Paint | navy' })),
    ).toBe(false);
    expect(
      applySuppliedCharacterLookdev(new T.MeshStandardMaterial({ name: 'F1CP_MAT_Visor' })),
    ).toBe(false);
  });
});
