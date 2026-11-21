import { afterEach, expect, it, vi } from 'vitest';
import { loadGainMapTextures } from '../src/rendering/assets/gain-map.ts';
import { PhotoSky } from '../src/rendering/assets/photo-sky.ts';
import { type ShippedFile } from '../src/rendering/assets/third-party.ts';

const source: ShippedFile = {
  path: '/sky.hdr.jpg',
  bytes: 16,
  sha256: '',
  role: '2k',
  format: 'ultrahdr',
  width: 2048,
  height: 1024,
  gainMap: { offset: 10, width: 1024, height: 512, gainMax: 6 },
};
afterEach(() => vi.unstubAllGlobals());

it('decodes one panorama into aligned 1k HDR and quarter-size gain texel counts for festival Low', async () => {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array(16)));
  const close = vi.fn();
  const decode = vi.fn(async (_blob: Blob, options: ImageBitmapOptions) => ({
    width: options.resizeWidth,
    height: options.resizeHeight,
    close,
  }));
  vi.stubGlobal('createImageBitmap', decode);
  const pair = await loadGainMapTextures(source, undefined, 1024);
  expect([pair.width, pair.height]).toEqual([1024, 512]);
  expect([pair.gain.image.width, pair.gain.image.height]).toEqual([512, 256]);
  expect(pair.base.colorSpace).not.toBe(pair.gain.colorSpace);
  expect(pair.gainMax).toBe(6);
  expect(decode).toHaveBeenCalledTimes(2);
  pair.dispose();
  expect(close).toHaveBeenCalledTimes(2);
  const sky = new PhotoSky('coast');
  sky.setQuality('low', true);
  expect(sky.diagnostics().variant).toBe('1k');
  sky.setQuality('medium', true);
  expect(sky.diagnostics().variant).toBe('2k');
  sky.setQuality('low');
  expect(sky.enabled).toBe(false);
  sky.dispose();
});

it('releases the successful half when the other image fails', async () => {
  const close = vi.fn();
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array(16)));
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    if (blob.size === 6) throw Error('Broken gain map');
    return { width: 2048, height: 1024, close };
  });
  await expect(loadGainMapTextures(source)).rejects.toThrow();
  expect(close).toHaveBeenCalledOnce();
});
