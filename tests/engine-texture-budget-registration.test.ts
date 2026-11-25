import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { ImportedTextureBudget } from '../src/rendering/imported-texture-budget.ts';
import { TextureBudget } from '../src/rendering/texture-budget.ts';

class Canvas {
  width = 1024;
  height = 512;
  paint = 1;
  readonly context = {
    drawImage: vi.fn((source: Canvas) => {
      this.paint = source.paint;
    }),
    clearRect: vi.fn(() => {
      this.paint = 0;
    }),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(255),
    })),
    putImageData: vi.fn(),
  };
  readonly getContext = vi.fn(() => this.context);
}

function environment() {
  const copies: Canvas[] = [];
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = new Canvas();
      copies.push(canvas);
      return canvas;
    },
  });
  return copies;
}

function scene(...maps: T.Texture[]) {
  // Material arrays and duplicate slots exercise the real traversal without
  // constructing a renderer or allocating any geometry buffers.
  return new T.Mesh(
    new T.BufferGeometry(),
    maps.map((map) => new T.MeshBasicMaterial({ map, alphaMap: map })),
  );
}

function texture(canvas: Canvas, kind: 'generated' | 'imported' = 'generated') {
  const image = canvas as unknown as HTMLCanvasElement;
  if (kind === 'generated') return new T.CanvasTexture(image);
  const map = new T.Texture(image);
  map.flipY = false;
  map.userData.immutableAssetTexture = true;
  return map;
}

afterEach(() => vi.unstubAllGlobals());

describe('texture budget registration batches', () => {
  it.each(['generated', 'imported'] as const)(
    'updates 1024 shared %s wrappers once each in one traversal',
    (kind) => {
      const copies = environment(),
        authored = new Canvas(),
        map = texture(authored, kind),
        original = map.source,
        external = map.clone(),
        wrappers = [map, ...Array.from({ length: 1023 }, () => map.clone())],
        versions = wrappers.map((wrapper) => wrapper.version),
        root = scene(...wrappers),
        budget = new TextureBudget();
      budget.configure(128, 2);
      budget.register(root);

      expect(copies).toHaveLength(1);
      expect(copies[0].context.drawImage).toHaveBeenCalledExactlyOnceWith(authored, 0, 0, 128, 64);
      expect(copies[0].context.clearRect).not.toHaveBeenCalled();
      expect(wrappers.map((wrapper) => wrapper.version)).toEqual(versions.map((v) => v + 1));
      expect(map.source.version).toBe(1024);
      expect(wrappers.every((wrapper) => wrapper.source === map.source)).toBe(true);
      expect(original.data).toBe(authored);
      expect(external.source).toBe(original);
      expect(external.image).toBe(authored);

      budget.register(root);
      expect(copies[0].context.drawImage).toHaveBeenCalledTimes(1);
      expect(map.source.version).toBe(1024);
      budget.dispose();
      expect(wrappers.every((wrapper) => wrapper.source === original)).toBe(true);
    },
  );

  it('repaints a mutable canvas once per later registration and on explicit refresh', () => {
    const copies = environment(),
      authored = new Canvas(),
      map = texture(authored),
      sibling = map.clone(),
      budget = new TextureBudget();
    budget.configure(256, 2);
    budget.register(scene(map, sibling));
    const owned = map.source,
      image = map.image,
      releases = vi.fn();
    map.addEventListener('dispose', releases);
    sibling.addEventListener('dispose', releases);
    authored.paint = 7;
    const late = [map.clone(), map.clone()],
      wrappers = [map, sibling, ...late],
      versions = wrappers.map((wrapper) => wrapper.version);
    budget.register(scene(map, ...late));

    expect(copies).toHaveLength(1);
    expect(copies[0].paint).toBe(7);
    expect(copies[0].context.drawImage).toHaveBeenCalledTimes(2);
    expect(copies[0].context.clearRect).toHaveBeenCalledTimes(1);
    expect(wrappers.map((wrapper) => wrapper.version)).toEqual(versions.map((v) => v + 1));
    expect(wrappers.every((wrapper) => wrapper.source === owned && wrapper.image === image)).toBe(
      true,
    );
    authored.paint = 11;
    budget.refresh(late[0]);
    expect(copies[0].paint).toBe(11);
    expect(copies[0].context.drawImage).toHaveBeenCalledTimes(3);
    expect(wrappers.map((wrapper) => wrapper.version)).toEqual(versions.map((v) => v + 2));
    expect(releases).not.toHaveBeenCalled();
    budget.dispose();
  });

  it('keeps resolution and CPU-readback groups distinct through quality changes and removal', () => {
    const copies = environment(),
      authored = new Canvas(),
      map = texture(authored),
      original = map.source,
      sibling = map.clone(),
      hero = map.clone(),
      readback = map.clone(),
      wrappers = [map, sibling, hero, readback],
      budget = new TextureBudget();
    hero.userData.textureBudgetScale = 2;
    readback.userData.cpuReadback = true;
    budget.configure(128, 2);
    budget.register(scene(...wrappers));
    expect(copies).toHaveLength(3);
    expect(map.source).toBe(sibling.source);
    expect(new Set(wrappers.map((wrapper) => wrapper.source)).size).toBe(3);
    expect(wrappers.map((wrapper) => wrapper.image.width)).toEqual([128, 128, 256, 128]);
    expect(readback.image.getContext.mock.calls[0]).toEqual(['2d', { willReadFrequently: true }]);
    for (const copy of copies) expect(copy.context.drawImage).toHaveBeenCalledTimes(1);
    const sources = wrappers.map((wrapper) => wrapper.source),
      releaseWidths: number[] = [];
    for (const wrapper of wrappers)
      wrapper.addEventListener('dispose', () => releaseWidths.push(wrapper.image.width));

    budget.configure(256, 4);
    expect(releaseWidths).toEqual([128, 128, 256, 128]);
    expect(wrappers.map((wrapper) => wrapper.source)).toEqual(sources);
    expect(wrappers.map((wrapper) => wrapper.image.width)).toEqual([256, 256, 512, 256]);
    for (const wrapper of wrappers) {
      expect(wrapper.anisotropy).toBe(4);
      expect(wrapper.generateMipmaps).toBe(true);
      expect(wrapper.minFilter).toBe(T.LinearMipmapLinearFilter);
    }
    budget.configure(1024, 8);
    expect(wrappers.every((wrapper) => wrapper.image === authored)).toBe(true);
    budget.unregister(scene(map));
    const retiredVersion = map.version;
    budget.configure(128, 1);
    expect(map.source).toBe(original);
    expect(map.version).toBe(retiredVersion);
    expect(sibling.image.width).toBe(128);
    budget.dispose();
    expect(wrappers.every((wrapper) => wrapper.source === original)).toBe(true);
  });

  it('shares foliage coverage mipmaps across a batch and preserves single-wrapper registration', () => {
    const copies = environment(),
      authored = new Canvas();
    authored.width = 8;
    authored.height = 4;
    const map = texture(authored, 'imported'),
      original = map.source,
      wrappers = [map, ...Array.from({ length: 15 }, () => map.clone())],
      versions = wrappers.map((wrapper) => wrapper.version),
      budget = new ImportedTextureBudget();
    wrappers[1].userData.foliageAlphaCutoff = 0.45;
    budget.configure(4, 2);
    budget.register(wrappers);
    expect(copies).toHaveLength(4); // Coverage sample plus 4x2, 2x1 and 1x1 mips.
    expect(map.mipmaps).toHaveLength(3);
    expect(wrappers.map((wrapper) => wrapper.version)).toEqual(versions.map((v) => v + 1));
    expect(wrappers.every((wrapper) => wrapper.mipmaps === map.mipmaps)).toBe(true);
    expect(wrappers.every((wrapper) => !wrapper.generateMipmaps)).toBe(true);
    const levels = map.mipmaps,
      late = map.clone();
    budget.register(late);
    budget.configure(4, 8);
    expect(copies).toHaveLength(4);
    expect(late.mipmaps).toBe(levels);
    expect(late.anisotropy).toBe(8);
    budget.configure(8, 8);
    expect(late.mipmaps).toHaveLength(4);
    expect(late.source).toBe(map.source);
    budget.dispose();
    expect(late.source).toBe(original);
    expect(late.mipmaps).toEqual([]);
    expect(late.generateMipmaps).toBe(true);
  });
});
