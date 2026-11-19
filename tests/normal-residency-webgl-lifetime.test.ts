import { expect, it } from 'vitest';
import * as T from 'three';
import { WebGLProperties } from 'three/src/renderers/webgl/WebGLProperties.js';
import { WebGLTextures } from 'three/src/renderers/webgl/WebGLTextures.js';
import {
  disposeNormalResidency,
  expandSampledNormal,
} from '../src/rendering/ground/normal-residency.ts';

/** Exercise Three's actual cache/upload decisions. Only the native GL driver
 * is recorded; rejecting a second immutable allocation exposes the exact
 * failure observed for the five 1K BC7 normal maps in the High startup trace. */
function compressedUpload() {
  const properties = new WebGLProperties(),
    allocated = new Set<object>(),
    attempts: { handle: number; args: number[] }[] = [];
  let next = 0,
    bound: { id: number };
  const gl = {
    TEXTURE_2D: 3553,
    TEXTURE0: 33984,
    NONE: 0,
    REPEAT: 10497,
    CLAMP_TO_EDGE: 33071,
    MIRRORED_REPEAT: 33648,
    LINEAR: 9729,
    NEAREST: 9728,
    LINEAR_MIPMAP_LINEAR: 9987,
    LINEAR_MIPMAP_NEAREST: 9985,
    NEAREST_MIPMAP_LINEAR: 9986,
    NEAREST_MIPMAP_NEAREST: 9984,
    createTexture: () => ({ id: ++next }),
    deleteTexture: () => {},
    pixelStorei: () => {},
    texParameteri: () => {},
  };
  const state = {
    activeTexture: () => {},
    bindTexture: (_target: number, texture: { id: number }) => {
      bound = texture;
    },
    texStorage2D: (...args: number[]) => {
      attempts.push({ handle: bound.id, args });
      if (allocated.has(bound)) throw new Error('glTexStorage2D: Texture is immutable');
      allocated.add(bound);
    },
    compressedTexSubImage2D: () => {},
  };
  type Arguments = ConstructorParameters<typeof WebGLTextures>;
  const textures = new WebGLTextures(
    gl as unknown as Arguments[0],
    { has: () => false } as unknown as Arguments[1],
    state as unknown as Arguments[2],
    properties,
    { maxTextureSize: 4096 } as unknown as Arguments[4],
    {
      convert: (value: number) => (value === T.UnsignedByteType ? 5121 : value),
    } as unknown as Arguments[5],
    { memory: { textures: 0 } } as unknown as Arguments[6],
  );
  const mipmaps = [];
  for (let size = 1024; size >= 1; size >>= 1)
    mipmaps.push({
      width: size,
      height: size,
      data: new Uint8Array(Math.ceil(size / 4) ** 2 * 16),
    });
  const normal = new T.CompressedTexture(mipmaps, 1024, 1024, T.RGBA_BPTC_Format);
  normal.needsUpdate = true;
  return { properties, textures, normal, attempts };
}

it('exposes the native Three immutable allocation when a retired renderer uploads again', () => {
  const { properties, textures, normal, attempts } = compressedUpload();
  textures.setTexture2D(normal, 0);
  // r180 WebGLRenderer.dispose() clears these properties. Its WebGLTextures
  // closure still holds the allocated Source -> WebGLTexture mapping.
  properties.dispose();
  expect(() => textures.setTexture2D(normal, 0)).toThrow('Texture is immutable');
  expect(attempts).toEqual([
    { handle: 1, args: [3553, 11, 36492, 1024, 1024] },
    { handle: 1, args: [3553, 11, 36492, 1024, 1024] },
  ]);
  normal.dispose();
});

it('prevents that native reallocation when a suspended normal read completes after disposal', async () => {
  const { properties, textures, normal, attempts } = compressedUpload();
  let release!: () => void,
    target: T.WebGLRenderTarget | null = null;
  const viewport = new T.Vector4(0, 0, 8, 8),
    scissor = viewport.clone();
  const gpu = {
    autoClear: true,
    getContext: () => ({ isContextLost: () => false }),
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getViewport: (out: T.Vector4) => out.copy(viewport),
    getScissor: (out: T.Vector4) => out.copy(scissor),
    getScissorTest: () => false,
    setRenderTarget: (value: T.WebGLRenderTarget | null) => {
      target = value;
    },
    setViewport: (...args: [T.Vector4] | [number, number, number, number]) =>
      args.length === 1 ? viewport.copy(args[0]) : viewport.set(...args),
    setScissor: (value: T.Vector4) => scissor.copy(value),
    setScissorTest: () => {},
    render: () => textures.setTexture2D(normal, 0),
    readRenderTargetPixelsAsync: (
      _target: T.WebGLRenderTarget,
      _x: number,
      _y: number,
      _width: number,
      _height: number,
      data: Uint8Array,
    ) =>
      new Promise<Uint8Array>((resolve) => {
        release = () => resolve(data);
      }),
  };
  const renderer = gpu as unknown as T.WebGLRenderer,
    job = expandSampledNormal(renderer, normal);
  expect(attempts).toEqual([{ handle: 1, args: [3553, 11, 36492, 1024, 1024] }]);
  const draining = disposeNormalResidency(renderer);
  properties.dispose();
  release();
  expect(await job).toBe(normal);
  await draining;
  // The original 11-level chain remains complete. No late submission reaches
  // the retired renderer's allocated handle or a replacement renderer's canvas.
  expect(normal.mipmaps).toHaveLength(11);
  expect(attempts).toHaveLength(1);
  normal.dispose();
});
