import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import {
  InternalTexture,
  InternalTextureSource,
} from '@babylonjs/core/Materials/Textures/internalTexture.js';
import {
  a07TextureGamma,
  a07ProgramGamma,
  assertA07GammaTransport,
} from '../e2e/fixtures/babylon-start-gantry-gamma.ts';

// Minimal original sampling inventory observed in run 41301759966 at da7ea87.
// No archived GPU success is implied; these are CPU-only negative/positive contracts.
const dataDefines = [
  'ALBEDO',
  'BUMP',
  'NORMAL',
  'METALLICWORKFLOW',
  'REFLECTIVITY',
  'ROUGHNESSSTOREINMETALMAPGREEN',
  'METALLNESSSTOREINMETALMAPBLUE',
]
  .map((name) => `#define ${name}`)
  .join('\n');
const nativeProgram = (name: string, defines = '') =>
  a07ProgramGamma(name, `${dataDefines}\n${defines}`, [
    'albedoSampler',
    'bumpSampler',
    'reflectivitySampler',
  ]);

describe('A07 fixture gamma contracts (pinned getter; no GPU execution)', () => {
  const engines: NullEngine[] = [];
  afterEach(() => {
    engines.splice(0).forEach((engine) => engine.dispose());
  });
  function receipt(hardware: boolean, shader: boolean) {
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    const textures = (['baseColor', 'normal', 'metallicRoughness'] as const).map((role) => {
      const texture = new BaseTexture(scene);
      const internal = new InternalTexture(engine, InternalTextureSource.Raw, true);
      texture._texture = internal;
      // Native nonColorData controls storage, not this unused generic tag.
      // Leave the real InternalTexture null default: BaseTexture getter resolves
      // its own true default, just as the recorded native GLTF import does.
      internal._useSRGBBuffer = role === 'baseColor' && hardware;
      return a07TextureGamma(texture, role);
    });
    const programs = [
      nativeProgram(
        'actual-effect-contract',
        shader ? '#define GAMMAALBEDO\n#define ALBEDO' : '#define ALBEDO',
      ),
    ];
    return { textures, programs };
  }
  it('accepts native hardware sRGB even though real BaseTexture.gammaSpace is false', () => {
    const r = receipt(true, false);
    expect(r.textures[0]).toMatchObject({
      gammaSpace: false,
      diagnosticGenericGammaSpace: true,
      hardwareSrgb: true,
    });
    expect(() => assertA07GammaTransport(r.textures, r.programs)).not.toThrow();
  });
  it('accepts shader-only basecolor decoding', () => {
    const r = receipt(false, true);
    expect(r.textures[0].gammaSpace).toBe(true);
    expect(() => assertA07GammaTransport(r.textures, r.programs)).not.toThrow();
  });

  it('accepts da7ea87 observed true/true data metadata with original compiled sampling inventory', () => {
    const r = receipt(true, false);
    for (const texture of r.textures.slice(1))
      expect(texture).toMatchObject({
        gammaSpace: true,
        diagnosticGenericGammaSpace: true,
        hardwareSrgb: false,
      });
    expect(() => assertA07GammaTransport(r.textures, r.programs)).not.toThrow();
  });
  it('grounds unused data metadata in the pinned native loader and PBR shader paths', () => {
    const read = (path: string) => readFileSync(`node_modules/@babylonjs/${path}`, 'utf8');
    expect(JSON.parse(read('core/package.json')).version).toBe('9.33.1');
    const loader = read('loaders/glTF/2.0/glTFLoader.pure.js');
    expect(loader).toContain('material.normalTexture.nonColorData = true;');
    expect(loader).toContain('properties.metallicRoughnessTexture.nonColorData = true;');
    expect(loader).toContain('!texture._textureInfo.nonColorData');
    expect(loader).toContain('useSRGBBuffer: !!useSRGBBuffer && this._parent.useSRGBBuffers');
    const pbr = read('core/Materials/PBR/pbrBaseMaterial.pure.js');
    const gammaAssignment = pbr.indexOf('defines.REFLECTIVITY_GAMMA = false;');
    const metallicStart = pbr.lastIndexOf('if (this._metallicTexture) {', gammaAssignment);
    const metallicPath = pbr.slice(
      metallicStart,
      pbr.indexOf('else if (this._reflectivityTexture) {', metallicStart),
    );
    expect(metallicPath).toContain('defines.REFLECTIVITY_GAMMA = false;');
    expect(metallicPath).not.toContain('.gammaSpace');
    const bump = read('core/Shaders/ShadersInclude/bumpFragment.js');
    expect(bump).toContain('TEXRD(bumpSampler,vBumpUV+uvOffset).xyz');
    expect(bump).not.toContain('toLinearSpace');
    expect(bump).not.toContain('GAMMA');
    const fragment = read('core/Shaders/pbr.fragment.js');
    expect(fragment).toContain(
      'surfaceMetallicOrReflectivityColorMap=TEXRD(reflectivitySampler,vReflectivityUV+uvOffset)',
    );
    expect(fragment).toContain(
      '#ifndef METALLICWORKFLOW\n#ifdef REFLECTIVITY_GAMMA\nsurfaceMetallicOrReflectivityColorMap=toLinearSpace(surfaceMetallicOrReflectivityColorMap);',
    );
  });
  it('rejects missing and double basecolor decoding', () => {
    for (const [hardware, shader] of [
      [false, false],
      [true, true],
    ]) {
      const r = receipt(hardware, shader);
      expect(() => assertA07GammaTransport(r.textures, r.programs)).toThrow(
        /baseColor.*exactly one/,
      );
    }
  });
  it('rejects sRGB data storage and inconsistent native metallic shader defines', () => {
    for (const role of ['normal', 'metallicRoughness'] as const)
      for (const field of ['hardwareSrgb'] as const) {
        const r = receipt(false, true);
        r.textures.find((t) => t.role === role)![field] = true;
        expect(() => assertA07GammaTransport(r.textures, r.programs)).toThrow(new RegExp(role));
      }
    const r = receipt(false, true);
    r.programs[0] = nativeProgram('data-gamma', '#define GAMMAALBEDO\n#define REFLECTIVITY_GAMMA');
    expect(() => assertA07GammaTransport(r.textures, r.programs)).toThrow(/metallicRoughness/);
  });
  it('rejects missing sampling macros/samplers and alternate data paths, including zero-valued macros', () => {
    const r = receipt(true, false);
    for (const macro of Object.keys(r.programs[0].requiredDataPaths)) {
      const bad = a07ProgramGamma(
        'missing-macro',
        dataDefines.replace(`#define ${macro}\n`, '').replace(new RegExp(`#define ${macro}$`), ''),
        r.programs[0].samplers,
      );
      expect(() => assertA07GammaTransport(r.textures, [bad])).toThrow(macro);
    }
    for (const sampler of r.programs[0].samplers) {
      const bad = a07ProgramGamma(
        'missing-sampler',
        dataDefines,
        r.programs[0].samplers.filter((s) => s !== sampler),
      );
      expect(() => assertA07GammaTransport(r.textures, [bad])).toThrow(sampler);
    }
    for (const macro of [
      'UNLIT',
      'OBJECTSPACE_NORMALMAP',
      'PARALLAX',
      'PARALLAXOCCLUSION',
      'DETAIL',
      'ROUGHNESSSTOREINMETALMAPALPHA',
      'AOSTOREINMETALMAPRED',
    ])
      expect(() =>
        assertA07GammaTransport(r.textures, [nativeProgram('alternate', `#define ${macro} 0`)]),
      ).toThrow(macro);
  });
  it('rejects absent roles/effects and a missing basecolor generic tag', () => {
    const r = receipt(false, true);
    expect(() => assertA07GammaTransport(r.textures.slice(1), r.programs)).toThrow(/baseColor/);
    expect(() => assertA07GammaTransport(r.textures, [])).toThrow(/program/);
    r.textures[0].diagnosticGenericGammaSpace = false;
    expect(() => assertA07GammaTransport(r.textures, r.programs)).toThrow(/baseColor.*generic/);
  });
  it('uses exact macro presence as required by native #ifdef, including zero-valued definitions', () => {
    expect(
      a07ProgramGamma(
        'names',
        '#define NOT_GAMMAALBEDO\n#define GAMMAALBEDO_SUFFIX\n// #define GAMMAALBEDO',
      ),
    ).toMatchObject({ gammaAlbedo: false });
    for (const value of ['', ' 0', ' 1'])
      expect(a07ProgramGamma('present', `#define GAMMAALBEDO${value}\n`)).toMatchObject({
        gammaAlbedo: true,
      });
    const r = receipt(true, false);
    r.programs[0] = a07ProgramGamma('double', '#define GAMMAALBEDO 0');
    expect(() => assertA07GammaTransport(r.textures, r.programs)).toThrow(/exactly one/);
  });
});
