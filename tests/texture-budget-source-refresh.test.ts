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
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  vi.stubGlobal('document', { createElement: () => new Canvas() });
}

function texture() {
  return new T.CanvasTexture(new Canvas() as unknown as HTMLCanvasElement);
}

function scene(...maps: T.Texture[]) {
  const root = new T.Group();
  for (const map of maps)
    root.add(new T.Mesh(new T.PlaneGeometry(), new T.MeshBasicMaterial({ map })));
  return root;
}

afterEach(() => vi.unstubAllGlobals());

describe('refreshing a budgeted canvas source', () => {
  it('repaints every registered resolution and CPU-readback group without touching other sources', () => {
    environment();
    const map = texture(),
      sibling = map.clone(),
      larger = map.clone(),
      readback = map.clone(),
      unrelated = texture(),
      original = map.source,
      budget = new TextureBudget();
    larger.userData.textureBudgetScale = 2;
    readback.userData.cpuReadback = true;
    budget.configure(128, 2);
    budget.register(scene(map, sibling, larger, readback, unrelated));
    const affected = [map, sibling, larger, readback];
    const sources = affected.map((sample) => sample.source);
    const versions = affected.map((sample) => sample.version);
    const unrelatedVersion = unrelated.version;
    const copies = [map, larger, readback, unrelated].map(
      (sample) => sample.image as unknown as Canvas,
    );
    const releases = vi.fn();
    for (const sample of affected) sample.addEventListener('dispose', releases);
    for (const copy of copies) {
      copy.context.drawImage.mockClear();
      copy.context.clearRect.mockClear();
    }

    // All these copies derive from the same repainted original. The CPU-backed
    // wrapper is only the notification route, not the sole owner of the paint.
    budget.refresh(readback);

    for (const copy of copies.slice(0, 3)) {
      expect(copy.context.clearRect).toHaveBeenCalledExactlyOnceWith(
        0,
        0,
        copy.width,
        copy.height,
      );
      expect(copy.context.drawImage).toHaveBeenCalledExactlyOnceWith(
        original.data,
        0,
        0,
        copy.width,
        copy.height,
      );
    }
    expect(affected.map((sample) => sample.source)).toEqual(sources);
    expect(affected.map((sample) => sample.version)).toEqual(versions.map((value) => value + 1));
    expect(affected.map((sample) => [sample.image.width, sample.image.height])).toEqual([
      [128, 64],
      [128, 64],
      [256, 128],
      [128, 64],
    ]);
    expect(readback.image.getContext.mock.calls[0]).toEqual([
      '2d',
      { willReadFrequently: true },
    ]);
    expect(copies[3].context.drawImage).not.toHaveBeenCalled();
    expect(copies[3].context.clearRect).not.toHaveBeenCalled();
    expect(unrelated.version).toBe(unrelatedVersion);
    expect(releases).not.toHaveBeenCalled();
    budget.dispose();
  });

  it('invalidates an original-sized sibling and retains its original pixels through restoration', () => {
    environment();
    const map = texture(),
      fullSize = map.clone(),
      original = map.source,
      authored = map.image as unknown as Canvas,
      budget = new TextureBudget();
    fullSize.userData.textureBudgetScale = 4;
    budget.configure(256, 2);
    budget.register(scene(map, fullSize));
    const fullVersion = fullSize.version;
    expect(fullSize.image).toBe(authored);

    budget.refresh(map);

    expect(fullSize.version).toBe(fullVersion + 1);
    expect(fullSize.image).toBe(authored);
    expect(authored.getContext).not.toHaveBeenCalled();
    budget.configure(1024, 8);
    expect(map.image).toBe(authored);
    expect(fullSize.image).toBe(authored);
    expect(original.data).toBe(authored);
    budget.dispose();
    expect(map.source).toBe(original);
    expect(fullSize.source).toBe(original);
  });
});
