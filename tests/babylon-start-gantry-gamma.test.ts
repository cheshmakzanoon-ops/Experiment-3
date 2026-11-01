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
      internal._gammaSpace = role === 'baseColor';
      internal._useSRGBBuffer = role === 'baseColor' && hardware;
      return a07TextureGamma(texture, role);
    });
    const programs = [
      a07ProgramGamma(
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
      semanticGammaSpace: true,
      hardwareSrgb: true,
    });
    expect(() => assertA07GammaTransport(r.textures, r.programs)).not.toThrow();
  });
  it('accepts shader-only basecolor decoding', () => {
    const r = receipt(false, true);
    expect(r.textures[0].gammaSpace).toBe(true);
    expect(() => assertA07GammaTransport(r.textures, r.programs)).not.toThrow();
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
  it('rejects semantic, hardware and shader gamma on data maps', () => {
    for (const role of ['normal', 'metallicRoughness'] as const)
      for (const field of ['gammaSpace', 'semanticGammaSpace', 'hardwareSrgb'] as const) {
        const r = receipt(false, true);
        r.textures.find((t) => t.role === role)![field] = true;
        expect(() => assertA07GammaTransport(r.textures, r.programs)).toThrow(new RegExp(role));
      }
    const r = receipt(false, true);
    r.programs[0] = a07ProgramGamma(
      'data-gamma',
      '#define GAMMAALBEDO\n#define REFLECTIVITY_GAMMA',
    );
    expect(() => assertA07GammaTransport(r.textures, r.programs)).toThrow(/metallicRoughness/);
  });
  it('rejects absent roles/effects and a missing semantic basecolor tag', () => {
    const r = receipt(false, true);
    expect(() => assertA07GammaTransport(r.textures.slice(1), r.programs)).toThrow(/baseColor/);
    expect(() => assertA07GammaTransport(r.textures, [])).toThrow(/program/);
    r.textures[0].semanticGammaSpace = false;
    expect(() => assertA07GammaTransport(r.textures, r.programs)).toThrow(/baseColor.*semantic/);
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
