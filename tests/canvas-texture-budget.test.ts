import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { TextureBudget } from '../src/rendering/texture-budget.ts';

class Canvas {
  width = 1024;
  height = 512;
  readonly context = { drawImage: vi.fn(), clearRect: vi.fn() };
  readonly getContext = vi.fn(() => this.context);
}
function environment() {
  const canvases: Canvas[] = [];
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = new Canvas();
      canvases.push(canvas);
      return canvas;
    },
  });
  return canvases;
}
function scene(...maps: T.Texture[]) {
  const root = new T.Group();
  for (const map of maps)
    root.add(new T.Mesh(new T.PlaneGeometry(), new T.MeshBasicMaterial({ map })));
  return root;
}
afterEach(() => vi.unstubAllGlobals());

describe('generated canvas source ownership', () => {
  it('invalidates every uploaded clone before changing shared storage dimensions', () => {
    environment();
    const canvas = new Canvas() as unknown as HTMLCanvasElement;
    const map = new T.CanvasTexture(canvas),
      clone = map.clone(),
      budget = new TextureBudget();
    budget.configure(256, 2);
    budget.register(scene(map, clone));
    const releases: [string, number][] = [];
    map.addEventListener('dispose', () => releases.push(['map', map.image.width]));
    clone.addEventListener('dispose', () => releases.push(['clone', clone.image.width]));
    budget.configure(128, 2);
    // Three shares Source between Texture.clone() wrappers. Releasing only the
    // first wrapper leaves immutable GPU storage at 256 while its image is 128.
    expect(releases).toEqual([
      ['map', 256],
      ['clone', 256],
    ]);
    expect(map.source).toBe(clone.source);
    expect(map.image.width).toBe(128);
    budget.dispose();
  });

  it('retains the authored canvas and restores full detail for early and late clones', () => {
    const canvases = environment();
    const canvas = new Canvas() as unknown as HTMLCanvasElement;
    const map = new T.CanvasTexture(canvas),
      original = map.source,
      clone = map.clone(),
      external = map.clone(),
      budget = new TextureBudget();
    budget.configure(256, 2);
    budget.register(scene(map, clone));
    const late = map.clone();
    budget.register(scene(late));
    expect(canvases).toHaveLength(1);
    expect(original.data).toBe(canvas);
    expect(external.source).toBe(original);
    expect(external.image.width).toBe(1024);
    expect(late.source).toBe(map.source);
    budget.configure(1024, 16);
    for (const texture of [map, clone, late]) {
      expect(texture.image).toBe(canvas);
      expect(texture.anisotropy).toBe(16);
    }
    budget.dispose();
    for (const texture of [map, clone, late]) expect(texture.source).toBe(original);
  });

  it('repaints a shared budget image and releases one owner without resizing its siblings', () => {
    const canvases = environment();
    const canvas = new Canvas() as unknown as HTMLCanvasElement;
    const map = new T.CanvasTexture(canvas),
      clone = map.clone(),
      original = map.source,
      budget = new TextureBudget(),
      first = scene(map),
      second = scene(clone);
    budget.configure(256, 2);
    budget.register(first);
    budget.register(second);
    const image = map.image,
      version = clone.version;
    canvases[0].context.drawImage.mockClear();
    budget.refresh(map);
    expect(canvases[0].context.drawImage).toHaveBeenCalledWith(canvas, 0, 0, 256, 128);
    expect(clone.version).toBeGreaterThan(version);
    budget.unregister(first);
    expect(map.source).toBe(original);
    expect(map.image).toBe(canvas);
    expect(clone.image).toBe(image);
    budget.configure(128, 1);
    expect(map.image.width).toBe(1024);
    expect(clone.image.width).toBe(128);
    budget.dispose();
    expect(clone.source).toBe(original);
  });

  it('keeps distinct resolution claims and CPU-readback backing separate', () => {
    const copies = environment();
    const canvas = new Canvas() as unknown as HTMLCanvasElement;
    const map = new T.CanvasTexture(canvas),
      hero = map.clone(),
      readback = map.clone(),
      budget = new TextureBudget();
    hero.userData.textureBudgetScale = 2;
    readback.userData.cpuReadback = true;
    budget.configure(128, 2);
    budget.register(scene(map, hero, readback));
    expect(map.image.width).toBe(128);
    expect(hero.image.width).toBe(256);
    expect(readback.image.width).toBe(128);
    expect(map.source).not.toBe(hero.source);
    expect(map.source).not.toBe(readback.source);
    expect(readback.image.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
    for (const copy of copies) {
      expect(copy.context.drawImage).toHaveBeenCalledTimes(1);
      expect(copy.context.clearRect).not.toHaveBeenCalled();
    }
    budget.refresh(readback);
    const ink = readback.image as unknown as Canvas;
    expect(ink.context.clearRect).toHaveBeenCalledTimes(1);
    expect(ink.context.drawImage).toHaveBeenCalledTimes(2);
    budget.dispose();
  });
});
