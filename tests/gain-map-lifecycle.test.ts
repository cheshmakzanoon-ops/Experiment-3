import * as T from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeGainMapToHalfFloat,
  loadGainMapTextures,
  type GainMapTextures,
} from '../src/rendering/assets/gain-map.ts';
import type { ShippedFile } from '../src/rendering/assets/third-party.ts';

function pair(): GainMapTextures {
  return {
    base: new T.Texture(),
    gain: new T.Texture(),
    gainMax: 3,
    width: 64,
    height: 32,
    bytes: 4,
    dispose: vi.fn(),
  };
}

function rendererFixture(previous: T.WebGLRenderTarget | null = new T.WebGLCubeRenderTarget(16)) {
  let target = previous,
    face = previous ? 4 : 0,
    mip = previous ? 2 : 0;
  const adapter = {
    getRenderTarget: () => target,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => mip,
    setRenderTarget: vi.fn((next: T.WebGLRenderTarget | null, nextFace = 0, nextMip = 0) => {
      target = next;
      face = nextFace;
      mip = nextMip;
    }),
    render: vi.fn<(object: T.Object3D, camera: T.Camera) => void>(),
  };
  const targetDispose = vi.spyOn(T.WebGLRenderTarget.prototype, 'dispose');
  const materialDispose = vi.spyOn(T.Material.prototype, 'dispose');
  const geometryDispose = vi.spyOn(T.BufferGeometry.prototype, 'dispose');
  return {
    adapter,
    renderer: adapter as unknown as T.WebGLRenderer,
    state: () => ({ target, face, mip }),
    targetDispose,
    materialDispose,
    geometryDispose,
  };
}

class Bitmap {
  width = 64;
  height = 32;
  close = vi.fn();
}

function loadFixture() {
  const base = new Bitmap(),
    gain = new Bitmap();
  const file: ShippedFile = {
    path: 'assets/gain-map-lifecycle.hdr.jpg',
    format: 'ultrahdr',
    role: '2k',
    bytes: 4,
    width: 64,
    height: 32,
    sha256: '',
    gainMap: { offset: 2, width: 32, height: 16, gainMax: 3 },
  };
  const bitmap = vi.fn().mockResolvedValueOnce(base).mockResolvedValueOnce(gain);
  vi.stubGlobal('createImageBitmap', bitmap);
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  })));
  return { base, gain, file, bitmap };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('gain-map render target ownership', () => {
  it.each(['cube target', 'canvas'] as const)('restores the borrowed %s and transfers only the output', (kind) => {
    const f = rendererFixture(kind === 'canvas' ? null : new T.WebGLCubeRenderTarget(16));
    const before = f.state(),
      textures = pair();
    const baseDispose = vi.spyOn(textures.base, 'dispose'),
      gainDispose = vi.spyOn(textures.gain, 'dispose');
    const target = decodeGainMapToHalfFloat(f.renderer, textures, 2);
    expect(f.state()).toEqual(before);
    expect(f.targetDispose).not.toHaveBeenCalled();
    expect(f.materialDispose).toHaveBeenCalledTimes(1);
    expect(f.geometryDispose).toHaveBeenCalledTimes(1);
    expect(baseDispose).not.toHaveBeenCalled();
    expect(gainDispose).not.toHaveBeenCalled();
    expect(textures.dispose).not.toHaveBeenCalled();
    const quad = f.adapter.render.mock.calls[0][0] as T.Mesh<T.PlaneGeometry, T.RawShaderMaterial>;
    expect(quad.material.uniforms.base.value).toBe(textures.base);
    expect(quad.material.uniforms.gain.value).toBe(textures.gain);
    expect(quad.material.uniforms.scale.value).toBe(2);
    expect(target.texture.mapping).toBe(T.EquirectangularReflectionMapping);
    expect(target.texture.type).toBe(T.HalfFloatType);
    target.dispose();
    expect(f.targetDispose.mock.contexts).toEqual([target]);
  });

  it.each(['bind', 'draw'] as const)('releases every temporary resource when the %s fails', (stage) => {
    const f = rendererFixture(),
      before = f.state(),
      textures = pair(),
      failure = new Error(`${stage} failed`);
    if (stage === 'bind') {
      const setTarget = f.adapter.setRenderTarget.getMockImplementation()!;
      f.adapter.setRenderTarget.mockImplementationOnce((...args) => {
        setTarget(...args);
        throw failure;
      });
    } else f.adapter.render.mockImplementationOnce(() => { throw failure; });
    expect(() => decodeGainMapToHalfFloat(f.renderer, textures)).toThrow(failure);
    const output = f.adapter.setRenderTarget.mock.calls[0][0];
    expect(f.targetDispose.mock.contexts).toEqual([output]);
    expect(f.materialDispose).toHaveBeenCalledTimes(1);
    expect(f.geometryDispose).toHaveBeenCalledTimes(1);
    expect(f.state()).toEqual(before);
    expect(textures.dispose).not.toHaveBeenCalled();
  });

  it('releases the output and draw resources when restoring the renderer throws', () => {
    const f = rendererFixture(),
      before = f.state(),
      failure = new Error('restore failed');
    const setTarget = f.adapter.setRenderTarget.getMockImplementation()!;
    f.adapter.setRenderTarget.mockImplementation((...args) => {
      setTarget(...args);
      if (args[0] === before.target) throw failure;
    });
    expect(() => decodeGainMapToHalfFloat(f.renderer, pair())).toThrow(failure);
    const output = f.adapter.setRenderTarget.mock.calls[0][0];
    expect(f.targetDispose.mock.contexts).toEqual([output]);
    expect(f.materialDispose).toHaveBeenCalledTimes(1);
    expect(f.geometryDispose).toHaveBeenCalledTimes(1);
    expect(f.state()).toEqual(before);
  });

  it('still releases geometry and the unreturned target if a material disposal listener throws', () => {
    const f = rendererFixture(),
      before = f.state(),
      failure = new Error('material disposal listener failed');
    f.adapter.render.mockImplementationOnce((object) => {
      const quad = object as T.Mesh<T.PlaneGeometry, T.RawShaderMaterial>;
      quad.material.addEventListener('dispose', () => { throw failure; });
    });
    expect(() => decodeGainMapToHalfFloat(f.renderer, pair())).toThrow(failure);
    const output = f.adapter.setRenderTarget.mock.calls[0][0];
    expect(f.targetDispose.mock.contexts).toEqual([output]);
    expect(f.materialDispose).toHaveBeenCalledTimes(1);
    expect(f.geometryDispose).toHaveBeenCalledTimes(1);
    expect(f.state()).toEqual(before);
  });
});

describe('gain-map decoded image ownership', () => {
  it('releases both textures and images exactly once when the pair is disposed repeatedly', async () => {
    const f = loadFixture();
    const textures = await loadGainMapTextures(f.file);
    const baseDispose = vi.spyOn(textures.base, 'dispose'),
      gainDispose = vi.spyOn(textures.gain, 'dispose');
    expect(textures.base.image).toBe(f.base);
    expect(textures.gain.image).toBe(f.gain);
    expect(f.base.close).not.toHaveBeenCalled();
    expect(f.gain.close).not.toHaveBeenCalled();
    textures.dispose();
    textures.dispose();
    expect(baseDispose).toHaveBeenCalledTimes(1);
    expect(gainDispose).toHaveBeenCalledTimes(1);
    expect(f.base.close).toHaveBeenCalledTimes(1);
    expect(f.gain.close).toHaveBeenCalledTimes(1);
  });

  it('closes a successful bitmap after the other JPEG and its image fallback reject', async () => {
    const f = loadFixture(),
      failure = new Error('image decode failed');
    f.bitmap.mockReset().mockResolvedValueOnce(f.base).mockRejectedValueOnce(failure);
    vi.stubGlobal('Image', class {
      decode = vi.fn(async () => { throw failure; });
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    await expect(loadGainMapTextures(f.file)).rejects.toBe(failure);
    expect(f.base.close).toHaveBeenCalledTimes(1);
    expect(f.gain.close).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('releases the partially configured textures and both bitmaps if texture setup throws', async () => {
    const f = loadFixture(),
      failure = new Error('texture setup failed');
    const dispose = vi.spyOn(T.Texture.prototype, 'dispose');
    const update = vi.spyOn(T.Texture.prototype, 'needsUpdate', 'set');
    const setUpdate = update.getMockImplementation()!;
    update.mockImplementationOnce(setUpdate).mockImplementationOnce(() => { throw failure; });
    await expect(loadGainMapTextures(f.file)).rejects.toBe(failure);
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(dispose.mock.contexts.map((texture) => (texture as T.Texture).image)).toEqual([f.gain, f.base]);
    expect(f.base.close).toHaveBeenCalledTimes(1);
    expect(f.gain.close).toHaveBeenCalledTimes(1);
  });

  it('releases remaining resources if a texture disposal listener throws', async () => {
    const f = loadFixture(),
      failure = new Error('texture disposal listener failed');
    const textures = await loadGainMapTextures(f.file);
    const gainDispose = vi.spyOn(textures.gain, 'dispose');
    textures.base.addEventListener('dispose', () => { throw failure; });
    expect(() => textures.dispose()).toThrow(failure);
    expect(gainDispose).toHaveBeenCalledTimes(1);
    expect(f.base.close).toHaveBeenCalledTimes(1);
    expect(f.gain.close).toHaveBeenCalledTimes(1);
    expect(() => textures.dispose()).not.toThrow();
    expect(gainDispose).toHaveBeenCalledTimes(1);
  });
});
