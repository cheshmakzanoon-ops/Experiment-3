import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { ImportedTextureBudget } from '../src/rendering/imported-texture-budget.ts';
import { configureSuppliedMaterial } from '../src/rendering/supplied-player-materials.ts';
import { frontToBackOpaque, type OpaqueItem } from '../src/rendering/opaque-order.ts';
import { TextureBudget } from '../src/rendering/texture-budget.ts';

class Bitmap {
  constructor(
    readonly width = 1024,
    readonly height = 512,
  ) {}
  close = vi.fn();
}
class Canvas {
  width = 1;
  height = 1;
  context = { drawImage: vi.fn(), clearRect: vi.fn() };
  getContext() {
    return this.context;
  }
}
function environment() {
  const canvases: Canvas[] = [];
  vi.stubGlobal('ImageBitmap', Bitmap);
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  vi.stubGlobal('document', {
    createElement: () => {
      const c = new Canvas();
      canvases.push(c);
      return c;
    },
  });
  return canvases;
}
function imported(image = new Bitmap()) {
  const texture = new T.Texture(image);
  texture.flipY = false;
  texture.userData.suppliedPlayerTexture = true;
  return texture;
}
afterEach(() => vi.unstubAllGlobals());

describe('immutable imported texture ownership', () => {
  it('shares one reduced canvas without modifying the loader source or an unregistered clone', () => {
    const canvases = environment();
    const bitmap = new Bitmap(),
      texture = imported(bitmap);
    const original = texture.source,
      registeredClone = texture.clone(),
      external = texture.clone();
    const budget = new ImportedTextureBudget();
    budget.configure(256, 2);
    budget.register(texture);
    budget.register(registeredClone);
    budget.register(texture);
    expect(canvases).toHaveLength(1);
    expect(texture.source).toBe(registeredClone.source);
    expect(texture.source).not.toBe(original);
    expect(original.data).toBe(bitmap);
    expect(external.image).toBe(bitmap);
    expect(texture.image.width).toBe(256);
    expect(texture.image.height).toBe(128);
    expect(texture.anisotropy).toBe(2);
    expect(texture.minFilter).toBe(T.LinearMipmapLinearFilter);
    expect(canvases[0].context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 256, 128);
    budget.configure(1024, 16);
    expect(texture.image).toBe(bitmap);
    expect(registeredClone.image).toBe(bitmap);
    expect(texture.anisotropy).toBe(16);
    budget.configure(128, 1);
    expect(canvases).toHaveLength(2);
    expect(canvases[1].context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 128, 64);
    budget.dispose();
    budget.dispose();
    expect(texture.source).toBe(original);
    expect(registeredClone.source).toBe(original);
    expect(bitmap.close).not.toHaveBeenCalled();
  });
  it('preserves glTF orientation, colour interpretation, wrapping and independent UV transforms', () => {
    environment();
    const map = imported();
    map.colorSpace = T.SRGBColorSpace;
    map.wrapS = T.RepeatWrapping;
    map.repeat.set(3, 7);
    map.offset.set(0.2, 0.4);
    map.rotation = 0.3;
    const other = map.clone();
    other.offset.x = 0.8;
    const budget = new ImportedTextureBudget();
    budget.register(map);
    budget.register(other);
    for (const size of [128, 256, 512, 1024]) {
      budget.configure(size, 4);
      expect(map.colorSpace).toBe(T.SRGBColorSpace);
      expect(map.flipY).toBe(false);
      expect(map.premultiplyAlpha).toBe(false);
      expect(map.wrapS).toBe(T.RepeatWrapping);
      expect(map.repeat.toArray()).toEqual([3, 7]);
      expect(map.offset.toArray()).toEqual([0.2, 0.4]);
      expect(other.offset.x).toBe(0.8);
      expect(map.rotation).toBe(0.3);
    }
    budget.dispose();
  });
  it('does not acquire dynamic, data, render-target, unmarked or differently oriented textures', () => {
    environment();
    const samples = [
      imported(),
      imported(),
      imported(),
      imported(),
      imported(),
      new T.DataTexture(new Uint8Array(16), 2, 2),
    ];
    samples[0].userData.dynamic = true;
    samples[1].isRenderTargetTexture = true;
    samples[2].userData.suppliedPlayerTexture = false;
    samples[3].flipY = true;
    samples[4].premultiplyAlpha = true;
    samples[5].userData.suppliedPlayerTexture = true;
    samples[5].flipY = false;
    const sources = samples.map((t) => t.source);
    const budget = new ImportedTextureBudget();
    samples.forEach((t) => budget.register(t));
    budget.configure(128, 2);
    expect(samples.map((t) => t.source)).toEqual(sources);
    samples.forEach((t) => expect(t.anisotropy).toBe(1));
    budget.dispose();
  });
  it('participates in the ordinary graphics budget and releases old GPU storage before resizing', () => {
    environment();
    const bitmap = new Bitmap(),
      texture = imported(bitmap),
      disposed = vi.fn();
    texture.addEventListener('dispose', disposed);
    const group = new T.Group();
    group.add(new T.Mesh(new T.PlaneGeometry(), new T.MeshStandardMaterial({ map: texture })));
    const budget = new TextureBudget();
    budget.configure(256, 2);
    budget.register(group);
    expect(texture.image.width).toBe(256);
    const count = disposed.mock.calls.length;
    budget.configure(128, 2);
    expect(disposed.mock.calls.length).toBeGreaterThan(count);
    expect(texture.image.width).toBe(128);
    budget.configure(1024, 16);
    expect(texture.image).toBe(bitmap);
    budget.dispose();
    expect(texture.image).toBe(bitmap);
  });
  it('fails explicitly when resampling cannot create its canvas, without losing the source', () => {
    environment();
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });
    const bitmap = new Bitmap(),
      texture = imported(bitmap);
    const budget = new ImportedTextureBudget();
    expect(() => budget.register(texture)).toThrow('Canvas 2D');
    budget.dispose();
    expect(texture.image).toBe(bitmap);
    expect(bitmap.close).not.toHaveBeenCalled();
  });
});

describe('supplied surface-sheet material cost', () => {
  it('removes only the redundant named decal pass and opts immutable glTF maps into the budget', () => {
    const texture = new T.Texture();
    texture.flipY = false;
    const decal = new T.MeshPhysicalMaterial({
      transparent: true,
      side: T.DoubleSide,
      map: texture,
    });
    decal.name = 'Decal | oracle';
    const old = {
      transparent: decal.transparent,
      side: decal.side,
      opacity: decal.opacity,
      depthWrite: decal.depthWrite,
      depthTest: decal.depthTest,
      blending: decal.blending,
    };
    configureSuppliedMaterial(decal);
    expect(decal.forceSinglePass).toBe(true);
    expect(decal).toMatchObject(old);
    expect(decal.map).toBe(texture);
    expect(texture.userData.suppliedPlayerTexture).toBe(true);
    const visor = new T.MeshPhysicalMaterial({ transparent: true, side: T.DoubleSide });
    visor.name = 'F1CP_MAT_Visor';
    configureSuppliedMaterial(visor);
    expect(visor.forceSinglePass).toBe(false);
    decal.forceSinglePass = false;
    decal.transparent = false;
    configureSuppliedMaterial(decal);
    expect(decal.forceSinglePass).toBe(false);
  });
});

describe('opaque early-depth ordering', () => {
  const item = (
    id: number,
    z: number,
    material = id,
    groupOrder = 0,
    renderOrder = 0,
  ): OpaqueItem => ({ id, z, material: { id: material }, groupOrder, renderOrder });
  it('draws the near surface before an expensive hidden one regardless of material creation order', () => {
    const far = item(1, 0.9, 1),
      near = item(2, 0.1, 20);
    expect([far, near].sort(frontToBackOpaque)).toEqual([near, far]);
  });
  it('honours explicit group and render orders and retains stable equal-depth material/id ties', () => {
    expect(frontToBackOpaque(item(1, 0.9, 1, 0), item(2, 0.1, 2, 1))).toBeLessThan(0);
    expect(frontToBackOpaque(item(1, 0.9, 1, 0, 0), item(2, 0.1, 2, 0, 1))).toBeLessThan(0);
    expect(frontToBackOpaque(item(10, 0.5, 1), item(2, 0.5, 2))).toBeLessThan(0);
    expect(frontToBackOpaque(item(1, 0.5, 1), item(2, 0.5, 1))).toBeLessThan(0);
    expect(frontToBackOpaque(item(1, 0.5, 1), item(1, 0.5, 1))).toBe(0);
  });
});
