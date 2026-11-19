import { vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as T from 'three';
// @ts-expect-error Installed r180 includes this native module; @types does not.
import { WebGLMaterials } from 'three/src/renderers/webgl/WebGLMaterials.js';
import { WebGLProperties } from 'three/src/renderers/webgl/WebGLProperties.js';
import { WebGLTextures } from 'three/src/renderers/webgl/WebGLTextures.js';
import { WebGLUniforms } from 'three/src/renderers/webgl/WebGLUniforms.js';

type NativeTexture = { id: number };
interface ActiveUniform {
  name: string;
  size: number;
  type: number;
}
interface ParsedUniforms {
  seq: object[];
}
// The installed declaration incorrectly types the native program as Three's
// wrapper and the values object as an array. These are r180's actual contracts.
const NativeUniforms = WebGLUniforms as unknown as {
  new (gl: object, program: object): ParsedUniforms;
  seqWithValue(seq: object[], values: Record<string, T.IUniform>): object[];
  upload(
    gl: object,
    seq: object[],
    values: Record<string, T.IUniform>,
    textures: WebGLTextures,
  ): void;
};

/** Only GL execution is recorded. Selection and final sampling use installed
 * WebGLMaterials, WebGLUniforms and WebGLTextures, including native Source /
 * sampler-key sharing, mip upload decisions and disposal reference counts. */
export function nativeTextures(
  snapshotNativePayload: (value: unknown) => unknown = snapshotPayload,
) {
  const properties = new WebGLProperties();
  const propertiesFor = (owner: object) =>
    properties.get(owner) as {
      __webglTexture: NativeTexture;
      uniforms: Record<string, T.IUniform>;
    };
  const allocations: { handle: NativeTexture; args: unknown[] }[] = [],
    uploads: { handle: NativeTexture; args: unknown[] }[] = [],
    parameters: { handle: NativeTexture; args: unknown[] }[] = [],
    pixelStores: unknown[][] = [],
    uploadSources: unknown[] = [],
    mipmaps: NativeTexture[] = [],
    deleted: NativeTexture[] = [],
    sampled: { unit: number; handle: NativeTexture | null }[] = [];
  let next = 0,
    bound: NativeTexture | null = null,
    unit = 0,
    retired = false;
  const alive = () => {
    if (retired) throw new Error('Native texture work after renderer retirement');
  };
  const gl = {
    TEXTURE_2D: 3553,
    TEXTURE0: 33984,
    RGBA: 6408,
    RGBA8: 32856,
    SRGB8_ALPHA8: 35907,
    UNSIGNED_BYTE: 5121,
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
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_MIN_FILTER: 10241,
    UNPACK_FLIP_Y_WEBGL: 37440,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
    UNPACK_ALIGNMENT: 3317,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 37443,
    BROWSER_DEFAULT_WEBGL: 37444,
    createTexture: () => {
      alive();
      return { id: ++next };
    },
    deleteTexture: (texture: NativeTexture) => {
      alive();
      deleted.push(texture);
    },
    pixelStorei: (...args: unknown[]) => {
      alive();
      pixelStores.push(args);
    },
    texParameteri: (...args: unknown[]) => {
      alive();
      parameters.push({ handle: bound!, args });
    },
    texParameterf: (...args: unknown[]) => {
      alive();
      parameters.push({ handle: bound!, args });
    },
    getProgramParameter: (program: { active: ActiveUniform[] }) => program.active.length,
    getActiveUniform: (program: { active: ActiveUniform[] }, index: number) =>
      program.active[index],
    getUniformLocation: (_program: unknown, name: string) => name,
    uniform1i: vi.fn(),
    uniform1iv: vi.fn(),
  };
  const state = {
    activeTexture: (value: number) => {
      alive();
      unit = value - gl.TEXTURE0;
    },
    bindTexture: (_target: number, texture: NativeTexture | null, slot?: number) => {
      alive();
      if (slot !== undefined) unit = slot - gl.TEXTURE0;
      bound = texture;
      sampled.push({ unit, handle: bound });
    },
    unbindTexture: () => {
      bound = null;
    },
    texStorage2D: (...args: unknown[]) => {
      alive();
      allocations.push({ handle: bound!, args });
    },
    texSubImage2D: (...args: unknown[]) => {
      alive();
      uploadSources.push(args.at(-1));
      uploads.push({ handle: bound!, args: args.map(snapshotNativePayload) });
    },
    texImage2D: (...args: unknown[]) => {
      alive();
      uploadSources.push(args.at(-1));
      uploads.push({ handle: bound!, args: args.map(snapshotNativePayload) });
    },
  };
  const context = {
    ...gl,
    generateMipmap: () => {
      alive();
      mipmaps.push(bound!);
    },
  };
  type TextureArguments = ConstructorParameters<typeof WebGLTextures>;
  const cache = new WebGLTextures(
    context as unknown as TextureArguments[0],
    {
      has: (name: string) => name === 'EXT_texture_filter_anisotropic',
      get: () => ({ TEXTURE_MAX_ANISOTROPY_EXT: 34046 }),
    } as unknown as TextureArguments[1],
    state as unknown as TextureArguments[2],
    properties,
    {
      maxTextureSize: 4096,
      maxTextures: 32,
      getMaxAnisotropy: () => 16,
    } as unknown as TextureArguments[4],
    {
      convert: (value: number) =>
        value === T.UnsignedByteType ? gl.UNSIGNED_BYTE : value === T.RGBAFormat ? gl.RGBA : value,
    } as unknown as TextureArguments[5],
    { memory: { textures: 0 }, render: { frame: 0 } } as unknown as TextureArguments[6],
  );
  const target = new T.WebGLCubeRenderTarget(32),
    viewport = new T.Vector4(11, 13, 17, 19),
    scissor = new T.Vector4(23, 29, 31, 37);
  const initializeTexture = (texture: T.Texture) => {
    // The production selector admits ordinary 2D sampled textures only.
    // This is the installed WebGLRenderer.initTexture 2D dispatch.
    cache.setTexture2D(texture, 0);
    state.unbindTexture();
  };
  const adapter = {
    info: { programs: [] as T.WebGLProgram[] },
    properties,
    outputColorSpace: T.SRGBColorSpace,
    getRenderTarget: () => target,
    getActiveCubeFace: () => 3,
    getActiveMipmapLevel: () => 2,
    getViewport: (out: T.Vector4) => out.copy(viewport),
    getScissor: (out: T.Vector4) => out.copy(scissor),
    getScissorTest: () => true,
    initTexture: vi.fn(initializeTexture),
  };
  const renderer = adapter as unknown as T.WebGLRenderer;
  const nativeMaterials = (
    WebGLMaterials as (
      renderer: T.WebGLRenderer,
      properties: WebGLProperties,
    ) => {
      refreshMaterialUniforms(
        uniforms: Record<string, T.IUniform>,
        material: T.Material,
        pixelRatio: number,
        height: number,
        transmission: T.WebGLRenderTarget | null,
      ): void;
    }
  )(renderer, properties);
  const owners = new Map<
    T.Material,
    { uniforms: Record<string, T.IUniform>; parsed: ParsedUniforms; program: T.WebGLProgram }
  >();
  function own(
    material: T.Material,
    uniforms: Record<string, T.IUniform>,
    active: (string | ActiveUniform)[],
  ) {
    const parsed = new NativeUniforms(context, {
      active: active.map((value) =>
        typeof value === 'string' ? { name: value, size: 1, type: 0x8b5e } : value,
      ),
    });
    const program = { usedTimes: 1, getUniforms: () => parsed } as unknown as T.WebGLProgram;
    Object.assign(propertiesFor(material), {
      uniforms,
      programs: new Map([['retained-native-owner', program]]),
      currentProgram: program,
    });
    adapter.info.programs.push(program);
    owners.set(material, { uniforms, parsed, program });
    return program;
  }
  function consume(material: T.Material) {
    const { uniforms, parsed } = owners.get(material)!;
    nativeMaterials.refreshMaterialUniforms(uniforms, material, 1, 600, null);
    cache.resetTextureUnits();
    NativeUniforms.upload(
      context,
      NativeUniforms.seqWithValue(parsed.seq, uniforms),
      uniforms,
      cache,
    );
  }
  return {
    renderer,
    own,
    consume,
    properties: { get: propertiesFor },
    allocations,
    uploads,
    parameters,
    pixelStores,
    uploadSources,
    mipmaps,
    deleted,
    sampled,
    init: adapter.initTexture,
    upload: initializeTexture,
    state: () => ({
      target,
      face: 3,
      mip: 2,
      viewport: viewport.toArray(),
      scissor: scissor.toArray(),
    }),
    retire: () => {
      retired = true;
    },
  };
}

export function snapshotPayload(value: unknown) {
  if (!ArrayBuffer.isView(value)) return value;
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}
