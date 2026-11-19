import * as T from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import type { PbrSet } from '../src/rendering/assets/texture-loader.ts';
import { ScanStore, scannedGround } from '../src/rendering/ground/scan-store.ts';
import { disposeNormalResidency } from '../src/rendering/ground/normal-residency.ts';
import { installScannedMaps } from '../src/rendering/ground/scanned-ground.ts';

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../src/rendering/assets/texture-loader.ts', () => ({ loadPbrSet: load }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function compressedSet(): PbrSet {
  const mipmaps = [4, 2, 1].map((size) => ({
    width: size,
    height: size,
    data: new Uint8Array(16),
  }));
  return {
    id: 'ground-lawn',
    metres: 2,
    maps: {
      map: new T.DataTexture(new Uint8Array(4), 1, 1),
      normalMap: new T.CompressedTexture(mipmaps, 4, 4, T.RGBA_BPTC_Format),
      roughnessMap: null,
      metalnessMap: null,
      aoMap: null,
    },
    formats: { color: 'ktx2', normal: 'ktx2' },
    dispose: vi.fn(),
  };
}

function renderer(holdFirstRead = false) {
  let target: T.WebGLRenderTarget | null = null,
    release!: () => void;
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
    render: vi.fn(),
    readRenderTargetPixelsAsync: vi.fn(
      (_target: T.WebGLRenderTarget, _x, _y, _width, _height, data: Uint8Array) => {
        if (!holdFirstRead) return Promise.resolve(data);
        holdFirstRead = false;
        return new Promise<Uint8Array>((resolve) => {
          release = () => resolve(data);
        });
      },
    ),
  };
  return { owner: gpu as unknown as T.WebGLRenderer, gpu, release: () => release() };
}

for (const when of ['before', 'after'] as const)
  it(`finishes a cancelled normal on the replacement owner attached ${when} the old read settles`, async () => {
    vi.stubGlobal('document', {});
    const store = new ScanStore(),
      set = compressedSet(),
      original = set.maps.normalMap!,
      first = renderer(true),
      replacement = renderer(true),
      material = new T.MeshStandardMaterial();
    load.mockResolvedValue(set);
    store.attach(first.owner, 'high');
    store.register(material, ['lawn']);
    await Promise.resolve();
    expect(first.gpu.render).toHaveBeenCalledTimes(1);
    const pending = store.ready();
    store.detach(first.owner);
    const draining = disposeNormalResidency(first.owner);
    if (when === 'before') store.attach(replacement.owner, 'high');
    first.release();
    await draining;
    if (when === 'after') {
      await pending;
      store.attach(replacement.owner, 'high');
    }
    let ready = false;
    const complete = store.ready().then((value) => {
      ready = true;
      return value;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(replacement.gpu.render).toHaveBeenCalledTimes(1);
    replacement.release();
    expect(await complete).toBe(true);
    await pending;
    expect(first.gpu.render).toHaveBeenCalledTimes(1);
    expect(replacement.gpu.render).toHaveBeenCalledTimes(3);
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.uniforms.lawn.normal.value).not.toBe(original);
    expect(store.uniforms.lawn.normal.value!.mipmaps).toHaveLength(3);
    expect(store.diagnostics().normalResidency.lawn).toBe('decoded-rgba8');
    material.dispose();
  });

it('rebinds actual map-swap wrappers after a retained normal finishes and reuses the completed chain', async () => {
  vi.stubGlobal('document', {});
  const set = compressedSet(),
    original = set.maps.normalMap!,
    originalDispose = vi.spyOn(original, 'dispose'),
    procedural = new T.DataTexture(new Uint8Array([0, 0, 255, 255]), 1, 1),
    material = new T.MeshStandardMaterial({ normalMap: procedural, roughness: 0.4 }),
    replacement = renderer(true),
    following = renderer();
  scannedGround.adopt('lawn', set);
  installScannedMaps(material, 'lawn', [0.3, 0.4, 0.2], 2);
  const compressedWrapper = material.normalMap!,
    oldWrappers = [material.map!, material.normalMap!, material.roughnessMap!],
    wrapperDisposals = oldWrappers.map((texture) => vi.spyOn(texture, 'dispose')),
    roughness = material.roughness,
    color = material.color.clone(),
    repeat = material.normalMap!.repeat.clone();
  expect(compressedWrapper.source).toBe(original.source);
  scannedGround.attach(replacement.owner, 'high');
  expect(material.normalMap).toBe(procedural);
  for (const release of wrapperDisposals) expect(release).toHaveBeenCalledTimes(1);
  const ready = scannedGround.ready();
  replacement.release();
  expect(await ready).toBe(true);
  const decoded = scannedGround.uniforms.lawn.normal.value!,
    decodedWrapper = material.normalMap!;
  expect(decodedWrapper).not.toBe(compressedWrapper);
  expect(decodedWrapper.source).toBe(decoded.source);
  expect(decodedWrapper.userData.normalResidency).toBe('decoded-rgba8');
  expect(decoded.mipmaps).toHaveLength(3);
  expect(decodedWrapper.repeat).toEqual(repeat);
  expect(material.roughness).toBeCloseTo(roughness, 12);
  expect(material.color).toEqual(color);
  expect(originalDispose).toHaveBeenCalledTimes(1);
  scannedGround.detach(replacement.owner);
  scannedGround.attach(following.owner, 'high');
  expect(await scannedGround.ready()).toBe(true);
  expect(material.normalMap).toBe(decodedWrapper);
  expect(following.gpu.render).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
  material.dispose();
  scannedGround.detach(following.owner);
});

it('keeps the full source after an unavailable preparation and retries only on a new owner', async () => {
  vi.stubGlobal('document', {});
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {}),
    store = new ScanStore(),
    set = compressedSet(),
    original = set.maps.normalMap!,
    first = renderer(),
    replacement = renderer(),
    material = new T.MeshStandardMaterial();
  first.gpu.render.mockImplementation(() => {
    throw new Error('context unavailable');
  });
  load.mockResolvedValue(set);
  store.attach(first.owner, 'high');
  store.register(material, ['lawn']);
  expect(await store.ready()).toBe(true);
  expect(store.uniforms.lawn.normal.value).toBe(original);
  expect(original.mipmaps).toHaveLength(3);
  expect(store.diagnostics().failed).toEqual([]);
  store.setPreset('medium');
  store.setPreset('high');
  expect(await store.ready()).toBe(true);
  expect(first.gpu.render).toHaveBeenCalledTimes(1);
  expect(warning).toHaveBeenCalledTimes(1);
  store.detach(first.owner);
  store.attach(replacement.owner, 'high');
  expect(await store.ready()).toBe(true);
  expect(replacement.gpu.render).toHaveBeenCalledTimes(3);
  expect(store.diagnostics().normalResidency.lawn).toBe('decoded-rgba8');
  expect(load).toHaveBeenCalledTimes(1);
  material.dispose();
  warning.mockRestore();
});

it('leaves an unsupported compressed format unchanged across renderer replacement', async () => {
  vi.stubGlobal('document', {});
  const store = new ScanStore(),
    set = compressedSet(),
    original = set.maps.normalMap! as T.CompressedTexture,
    first = renderer(),
    replacement = renderer(),
    material = new T.MeshStandardMaterial();
  original.format = T.RGBA_S3TC_DXT5_Format;
  load.mockResolvedValue(set);
  store.attach(first.owner, 'high');
  store.register(material, ['lawn']);
  expect(await store.ready()).toBe(true);
  store.detach(first.owner);
  store.attach(replacement.owner, 'high');
  expect(await store.ready()).toBe(true);
  expect(store.uniforms.lawn.normal.value).toBe(original);
  expect(original.mipmaps).toHaveLength(3);
  expect(first.gpu.render).not.toHaveBeenCalled();
  expect(replacement.gpu.render).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(1);
  material.dispose();
});
