import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as T from 'three';
// @ts-expect-error Installed r180 includes this native module; @types does not.
import { WebGLMaterials } from 'three/src/renderers/webgl/WebGLMaterials.js';
import { WebGLProperties } from 'three/src/renderers/webgl/WebGLProperties.js';
import { WebGLTextures } from 'three/src/renderers/webgl/WebGLTextures.js';
import { WebGLUniforms } from 'three/src/renderers/webgl/WebGLUniforms.js';
import { prepareSceneTextures } from '../src/rendering/preparation.ts';

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
function nativeTextures() {
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
      uploads.push({ handle: bound!, args: args.map(snapshotPayload) });
    },
    texImage2D: (...args: unknown[]) => {
      alive();
      uploadSources.push(args.at(-1));
      uploads.push({ handle: bound!, args: args.map(snapshotPayload) });
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

function snapshotPayload(value: unknown) {
  if (!ArrayBuffer.isView(value)) return value;
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function retainedNormal(size = 4) {
  const mips = [];
  for (let width = size; width >= 1; width >>= 1)
    mips.push({ width, height: width, data: new Uint8Array(width * width * 4).fill(width % 251) });
  const map = new T.DataTexture(mips[0].data, size, size);
  map.mipmaps = mips;
  map.generateMipmaps = false;
  map.minFilter = T.LinearMipmapLinearFilter;
  map.magFilter = T.LinearFilter;
  map.anisotropy = 16;
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.userData.normalResidency = 'decoded-rgba8';
  map.needsUpdate = true;
  return map;
}

function scene(...materials: T.Material[]) {
  const root = new T.Scene();
  for (const material of materials) root.add(new T.Mesh(new T.PlaneGeometry(), material));
  return root;
}

function stateOf(texture: T.Texture) {
  return {
    source: texture.source,
    image: texture.image,
    version: texture.version,
    sourceVersion: texture.source.version,
    mipmaps: texture.mipmaps.map((mip) => ({
      width: mip.width,
      height: mip.height,
      data: snapshotPayload('data' in mip ? mip.data : undefined),
    })),
    minFilter: texture.minFilter,
    magFilter: texture.magFilter,
    wrapS: texture.wrapS,
    wrapT: texture.wrapT,
    anisotropy: texture.anisotropy,
    colorSpace: texture.colorSpace,
    generateMipmaps: texture.generateMipmaps,
  };
}

describe('retained native scene texture preparation', () => {
  it('moves the exact 11-mip upload before sampling with the same native owner and no repeat', () => {
    const normal = retainedNormal(1024),
      material = new T.MeshBasicMaterial({ map: normal }),
      root = scene(material),
      before = stateOf(normal);
    const uploaded = vi.fn();
    normal.onUpdate = uploaded;
    const cold = nativeTextures(),
      warm = nativeTextures();
    for (const h of [cold, warm])
      h.own(material, T.UniformsUtils.clone(T.ShaderLib.basic.uniforms), ['map']);
    cold.consume(material);
    expect(uploaded).toHaveBeenCalledTimes(1);
    const targetState = warm.state();
    prepareSceneTextures(warm.renderer, root, () => false);
    expect(uploaded).toHaveBeenCalledTimes(2);
    const handle = warm.properties.get(normal).__webglTexture;
    expect(warm.allocations).toEqual(cold.allocations);
    expect(warm.uploads).toEqual(cold.uploads);
    expect(warm.parameters).toEqual(cold.parameters);
    expect(warm.pixelStores).toEqual(cold.pixelStores);
    expect(warm.parameters.some(({ args }) => args[1] === 34046 && args[2] === 16)).toBe(true);
    for (let i = 0; i < normal.mipmaps.length; i++)
      expect(warm.uploadSources[i]).toBe((normal.mipmaps[i] as T.CompressedTextureMipmap).data);
    expect(warm.uploads).toHaveLength(11);
    expect(warm.mipmaps).toEqual([]);
    expect(warm.properties.get(material).uniforms.map.value).toBeNull();
    warm.consume(material);
    expect(uploaded).toHaveBeenCalledTimes(2);
    expect(warm.properties.get(normal).__webglTexture).toBe(handle);
    expect(warm.sampled.at(-1)?.handle).toBe(handle);
    expect(warm.uploads).toEqual(cold.uploads);
    expect(warm.allocations).toHaveLength(1);
    expect(warm.state()).toEqual(targetState);
    const after = stateOf(normal);
    expect(after.source).toBe(before.source);
    expect(after.image).toBe(before.image);
    expect({ ...after, source: null, image: null }).toEqual({
      ...before,
      source: null,
      image: null,
    });
  });

  it('retains custom compiled sampler owners and prepares only active scalar 2D samplers', () => {
    const h = nativeTextures(),
      active = retainedNormal(),
      unused = retainedNormal(),
      array = retainedNormal(),
      cube = retainedNormal(),
      disabled = retainedNormal();
    const uniforms = {
      sampledNormal: { value: active },
      unusedNormal: { value: unused },
      array: { value: [array] },
      cube: { value: cube },
      disabled: { value: disabled, needsUpdate: false },
    };
    const material = new T.ShaderMaterial({ uniforms });
    h.own(material, uniforms, [
      'sampledNormal',
      { name: 'array[0]', size: 1, type: 0x8b5e },
      { name: 'cube', size: 1, type: 0x8b60 },
      'disabled',
    ]);
    prepareSceneTextures(h.renderer, scene(material), () => false);
    expect(h.init.mock.calls.map(([texture]) => texture)).toEqual([active]);
    expect(uniforms.sampledNormal.value).toBe(active);
    expect(h.uploads).toHaveLength(3);
  });

  it('lets native Source and sampler keys share compatible wrappers and separate changed samplers', () => {
    const h = nativeTextures(),
      original = retainedNormal(),
      shared = original.clone(),
      different = original.clone();
    different.magFilter = T.NearestFilter;
    const materials = [original, shared, different].map((map) => new T.MeshBasicMaterial({ map }));
    for (const material of materials)
      h.own(material, T.UniformsUtils.clone(T.ShaderLib.basic.uniforms), ['map']);
    prepareSceneTextures(h.renderer, scene(...materials, materials[0]), () => false);
    expect(h.init).toHaveBeenCalledTimes(3);
    expect(h.allocations).toHaveLength(2);
    expect(h.uploads).toHaveLength(6);
    const first = h.properties.get(original).__webglTexture,
      second = h.properties.get(different).__webglTexture;
    expect(h.properties.get(shared).__webglTexture).toBe(first);
    expect(second).not.toBe(first);
    for (const material of materials) h.consume(material);
    expect(h.uploads).toHaveLength(6);
    original.dispose();
    expect(h.deleted).toEqual([]);
    shared.dispose();
    expect(h.deleted).toEqual([first]);
    different.dispose();
    expect(h.deleted).toEqual([first, second]);
  });

  it('does not resurrect a cleared native map from an older compiled uniform', () => {
    const h = nativeTextures(),
      removed = retainedNormal(),
      material = new T.MeshBasicMaterial({ map: removed }),
      uniforms = T.UniformsUtils.clone(T.ShaderLib.basic.uniforms);
    h.own(material, uniforms, ['map']);
    h.consume(material);
    expect(uniforms.map.value).toBe(removed);
    const oldHandle = h.properties.get(removed).__webglTexture;
    material.map = null;
    removed.dispose();
    prepareSceneTextures(h.renderer, scene(material), () => false);
    expect(h.init).not.toHaveBeenCalled();
    expect(h.allocations).toHaveLength(1);
    expect(h.uploads).toHaveLength(3);
    expect(h.deleted).toEqual([oldHandle]);
  });

  it('uses the native processed environment owner and leaves its render target resident', () => {
    const h = nativeTextures(),
      raw = retainedNormal(),
      processed = new T.WebGLRenderTarget(32, 16),
      material = new T.MeshStandardMaterial({ envMap: raw }),
      uniforms = T.UniformsUtils.clone(T.ShaderLib.standard.uniforms);
    raw.mapping = T.EquirectangularReflectionMapping;
    processed.texture.mapping = T.CubeUVReflectionMapping;
    processed.texture.needsUpdate = true;
    h.own(material, uniforms, ['envMap']);
    Object.assign(h.properties.get(material), {
      envMap: processed.texture,
      envMapRotation: new T.Euler(),
    });
    const existingHandle = { id: 99 };
    h.properties.get(processed.texture).__webglTexture = existingHandle;
    prepareSceneTextures(h.renderer, scene(material), () => false);
    expect(h.init).not.toHaveBeenCalled();
    h.consume(material);
    expect(uniforms.envMap.value).toBe(processed.texture);
    expect(h.sampled.at(-1)?.handle).toBe(existingHandle);
    expect(h.allocations).toEqual([]);
    expect(h.uploads).toEqual([]);
  });

  it('does not treat a non-renderable group property as a compiled draw owner', () => {
    const h = nativeTextures(),
      material = new T.MeshBasicMaterial({ map: retainedNormal() }),
      group = Object.assign(new T.Group(), { material }),
      root = new T.Scene();
    root.add(group);
    h.own(material, T.UniformsUtils.clone(T.ShaderLib.basic.uniforms), ['map']);
    prepareSceneTextures(h.renderer, root, () => false);
    expect(h.init).not.toHaveBeenCalled();
  });

  it('leaves mutable, unready, framebuffer and retired program owners on their native paths', () => {
    const h = nativeTextures(),
      mutable = new T.DataTexture(new Uint8Array(16), 2, 2),
      dynamic = retainedNormal(),
      unready = retainedNormal(),
      depth = new T.DepthTexture(2, 2),
      target = new T.WebGLRenderTarget(2, 2),
      external = Object.assign(retainedNormal(), { isExternalTexture: true }),
      dead = retainedNormal();
    mutable.needsUpdate = true;
    dynamic.userData.dynamic = true;
    unready.source.dataReady = false;
    depth.needsUpdate = true;
    target.texture.needsUpdate = true;
    const materials = [mutable, dynamic, unready, depth, target.texture, external, dead].map(
      (map) => new T.MeshBasicMaterial({ map }),
    );
    for (const material of materials)
      h.own(material, T.UniformsUtils.clone(T.ShaderLib.basic.uniforms), ['map']);
    h.renderer.info.programs!.at(-1)!.usedTimes = 0;
    prepareSceneTextures(h.renderer, scene(...materials), () => false);
    expect(h.init).not.toHaveBeenCalled();
    const version = mutable.version;
    mutable.image.data[0] = 91;
    mutable.needsUpdate = true;
    h.consume(materials[0]);
    expect(h.uploads).toHaveLength(1);
    expect(mutable.version).toBe(version + 1);
    expect(h.uploadSources[0]).toBe(mutable.image.data);
  });

  it('omits hidden Formula hosts and keeps real visible owners when host visibility changes', () => {
    const h = nativeTextures(),
      map = retainedNormal(),
      material = new T.MeshBasicMaterial({ map }),
      root = scene(material),
      host = root.children[0];
    h.own(material, T.UniformsUtils.clone(T.ShaderLib.basic.uniforms), ['map']);
    host.visible = false;
    prepareSceneTextures(h.renderer, root, () => false, [host]);
    expect(h.init).not.toHaveBeenCalled();
    host.visible = true;
    prepareSceneTextures(h.renderer, root, () => false, [host]);
    expect(h.init).toHaveBeenCalledWith(map);
  });

  it('does no more native work after cancellation and renderer retirement between owners', () => {
    const h = nativeTextures(),
      maps = [retainedNormal(), retainedNormal()],
      materials = maps.map((map) => new T.MeshBasicMaterial({ map }));
    for (const material of materials)
      h.own(material, T.UniformsUtils.clone(T.ShaderLib.basic.uniforms), ['map']);
    let stopped = false;
    h.init.mockImplementationOnce((texture) => {
      // Keep the real first upload, then model cancellation before the next.
      h.upload(texture);
      stopped = true;
      h.retire();
    });
    prepareSceneTextures(h.renderer, scene(...materials), () => stopped);
    expect(h.allocations).toHaveLength(1);
    expect(h.uploads).toHaveLength(3);
  });

  it('propagates upload failure without changing source ownership or sampler state', () => {
    const h = nativeTextures(),
      map = retainedNormal(),
      material = new T.MeshBasicMaterial({ map }),
      before = stateOf(map);
    h.own(material, T.UniformsUtils.clone(T.ShaderLib.basic.uniforms), ['map']);
    h.init.mockImplementationOnce(() => {
      throw new Error('Interrupted native texture upload');
    });
    expect(() => prepareSceneTextures(h.renderer, scene(material), () => false)).toThrow(
      'Interrupted native texture upload',
    );
    expect(stateOf(map)).toEqual(before);
    expect(h.deleted).toEqual([]);
    prepareSceneTextures(h.renderer, scene(material), () => false);
    h.consume(material);
    expect(h.allocations).toHaveLength(1);
    expect(h.uploads).toHaveLength(3);
  });
});
