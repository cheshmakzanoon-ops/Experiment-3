import * as T from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  disposeTextureLoaders,
  loadPbrSet,
  loadShippedTexture,
} from '../src/rendering/assets/texture-loader.ts';
import {
  assetUrl,
  thirdPartyAsset,
  type ShippedFile,
} from '../src/rendering/assets/third-party.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function fixture() {
  vi.stubGlobal('document', {});
  const renderer = {
    capabilities: { isWebGL2: true, getMaxAnisotropy: () => 8 },
  } as unknown as T.WebGLRenderer;
  vi.spyOn(KTX2Loader.prototype, 'detectSupport').mockReturnThis();
  const dispose = vi.spyOn(KTX2Loader.prototype, 'dispose').mockReturnThis();
  const ktx = vi.spyOn(KTX2Loader.prototype, 'loadAsync');
  const webp = vi.spyOn(T.TextureLoader.prototype, 'loadAsync');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  return { renderer, dispose, ktx, webp };
}

function files(): ShippedFile[] {
  return (['ktx2', 'webp'] as const).map((format) => ({
    path: `assets/cache-lifecycle-fixture/color.${format}`,
    bytes: 0,
    sha256: '',
    role: 'color',
    format,
    colorSpace: 'srgb',
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('renderer texture cache retries', () => {
  it('shares each failed or pending attempt and retains a successful fallback for independent clones', async () => {
    const f = fixture(),
      recovery = deferred<T.Texture>(),
      source = new T.DataTexture(new Uint8Array([1, 2, 3, 255]), 1, 1);
    const release = vi.spyOn(source, 'dispose');
    f.ktx.mockRejectedValue(new Error('KTX2 unavailable'));
    f.webp
      .mockRejectedValueOnce(new Error('temporary WebP failure'))
      .mockReturnValue(recovery.promise);

    const failed = await Promise.all([
      loadShippedTexture(f.renderer, files()),
      loadShippedTexture(f.renderer, files()),
    ]);
    expect(failed).toEqual([null, null]);
    expect(f.ktx).toHaveBeenCalledTimes(1);
    expect(f.webp).toHaveBeenCalledTimes(1);

    const retry = loadShippedTexture(f.renderer, files()),
      concurrent = loadShippedTexture(f.renderer, files());
    await vi.waitFor(() => expect(f.webp).toHaveBeenCalledTimes(2));
    recovery.resolve(source);
    const [a, b] = await Promise.all([retry, concurrent]);
    expect(a?.format).toBe('webp');
    expect(b?.format).toBe('webp');
    expect(a?.texture).not.toBe(b?.texture);
    expect(a?.texture.source).toBe(source.source);
    expect(b?.texture.source).toBe(source.source);
    a!.texture.repeat.set(4, 5);
    a!.texture.anisotropy = 3;
    a!.texture.dispose();

    const retained = await loadShippedTexture(f.renderer, files());
    expect(f.ktx).toHaveBeenCalledTimes(2);
    expect(f.webp).toHaveBeenCalledTimes(2);
    expect(retained?.texture.repeat.toArray()).toEqual([1, 1]);
    expect(retained?.texture.anisotropy).toBe(1);
    expect(retained?.texture.mapping).toBe(source.mapping);
    expect(retained?.texture.colorSpace).toBe(T.SRGBColorSpace);
    expect(retained?.texture.wrapS).toBe(T.RepeatWrapping);
    expect(retained?.texture.wrapT).toBe(T.RepeatWrapping);
    expect(retained?.texture.image.data).toEqual(new Uint8Array([1, 2, 3, 255]));
    await disposeTextureLoaders(f.renderer);
    expect(release).not.toHaveBeenCalled();
    b!.texture.dispose();
    retained!.texture.dispose();
    source.dispose();
  });

  it('retries only the missing PBR role while retaining successful roles and material options', async () => {
    const f = fixture();
    const asset = thirdPartyAsset('sandy-gravel-01')!;
    const webpFiles = asset.files.filter((file) => file.format === 'webp');
    const sources = new Map(webpFiles.map((file) => [assetUrl(file.path), new T.Texture()]));
    const normalUrl = assetUrl(webpFiles.find((file) => file.role === 'normal')!.path);
    let normalAttempts = 0;
    f.webp.mockImplementation(async (url) => {
      if (url === normalUrl && normalAttempts++ === 0) throw new Error('temporary normal failure');
      return sources.get(url)!;
    });
    f.ktx.mockRejectedValue(new Error('normal fallback unavailable'));

    const first = await loadPbrSet(f.renderer, asset.id, { prefer: 'webp', repeat: 2 });
    expect(first.maps.normalMap).toBeNull();
    expect(first.formats).toEqual({ color: 'webp', orm: 'webp' });
    const second = await loadPbrSet(f.renderer, asset.id, {
      prefer: 'webp',
      repeat: [3, 4],
      anisotropy: 16,
    });
    expect(f.webp).toHaveBeenCalledTimes(4);
    expect(f.ktx).toHaveBeenCalledTimes(1);
    expect(second.formats).toEqual({ color: 'webp', normal: 'webp', orm: 'webp' });
    expect(second.maps.normalMap?.source).toBe(sources.get(normalUrl)?.source);
    expect(second.maps.map?.source).toBe(first.maps.map?.source);
    expect(second.maps.roughnessMap?.source).toBe(first.maps.roughnessMap?.source);
    expect(second.maps.map).not.toBe(first.maps.map);
    expect(first.maps.map?.repeat.toArray()).toEqual([2, 2]);
    expect(second.maps.map?.repeat.toArray()).toEqual([3, 4]);
    expect(second.maps.map?.anisotropy).toBe(8);
    expect(second.maps.metalnessMap).toBe(second.maps.roughnessMap);
    expect(second.maps.aoMap).toBe(second.maps.roughnessMap);
    first.dispose();
    second.dispose();
    await disposeTextureLoaders(f.renderer);
    for (const source of sources.values()) source.dispose();
  });

  it('drains a retry already in flight and never reopens a disposed renderer', async () => {
    const f = fixture(),
      recovery = deferred<T.CompressedTexture>(),
      source = new T.CompressedTexture(
        [{ data: new Uint8Array([1, 2, 3, 255]), width: 1, height: 1 }],
        1,
        1,
      );
    f.ktx
      .mockRejectedValueOnce(new Error('temporary KTX2 failure'))
      .mockReturnValue(recovery.promise);
    f.webp.mockRejectedValue(new Error('WebP unavailable'));
    expect(await loadShippedTexture(f.renderer, files())).toBeNull();

    const retry = loadShippedTexture(f.renderer, files());
    expect(f.ktx).toHaveBeenCalledTimes(2);
    const disposal = disposeTextureLoaders(f.renderer);
    expect(await loadShippedTexture(f.renderer, files())).toBeNull();
    expect(f.dispose).not.toHaveBeenCalled();
    recovery.resolve(source);
    const loaded = await retry;
    await disposal;
    expect(loaded?.format).toBe('ktx2');
    expect(loaded?.texture.source).toBe(source.source);
    expect(f.dispose).toHaveBeenCalledTimes(1);
    expect(await loadShippedTexture(f.renderer, files())).toBeNull();
    expect(f.ktx).toHaveBeenCalledTimes(2);
    expect(f.webp).toHaveBeenCalledTimes(1);
    loaded!.texture.dispose();
    source.dispose();
  });
});
