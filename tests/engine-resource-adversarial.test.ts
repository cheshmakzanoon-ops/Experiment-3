import * as T from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextureBudget } from '../src/rendering/texture-budget.ts';
import { ImportedTextureBudget } from '../src/rendering/imported-texture-budget.ts';
import {
  disposeSceneTexture,
  markSharedTextureSource,
} from '../src/rendering/assets/texture-source-ownership.ts';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { StaticTransformGroup } from '../src/rendering/static-transform-group.ts';
import type { CircuitPlanting } from '../src/rendering/vegetation/ownership.ts';

class Canvas {
  width = 32;
  height = 16;
  readonly context = {
    drawImage() {},
    clearRect() {},
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(255),
    }),
    putImageData() {},
  };
  getContext() {
    return this.context;
  }
}

class Bitmap {
  width = 32;
  height = 16;
  readonly close = vi.fn();
}

function environment() {
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  vi.stubGlobal('ImageBitmap', Bitmap);
  vi.stubGlobal('document', { createElement: () => new Canvas() });
}

type Kind = 'generated' | 'imported';

function texture(kind: Kind) {
  const image = new Canvas() as unknown as HTMLCanvasElement;
  if (kind === 'generated') return new T.CanvasTexture(image);
  const map = new T.Texture(image);
  map.flipY = false;
  map.userData.immutableAssetTexture = true;
  map.userData.foliageAlphaCutoff = 0.45;
  return map;
}

function scene(...maps: T.Texture[]) {
  return new T.Mesh(
    new T.BufferGeometry(),
    maps.map((map) => new T.MeshBasicMaterial({ map, alphaMap: map })),
  );
}

function thrown(action: () => void) {
  try {
    action();
    return { threw: false, error: undefined };
  } catch (error) {
    return { threw: true, error };
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('resource release under actual Three disposal callbacks', () => {
  it.each(['generated', 'imported'] as const)(
    'removes a throwing %s wrapper and the remaining root while its shared sibling stays live',
    (kind) => {
      environment();
      const first = texture(kind),
        sibling = first.clone(),
        second = texture(kind === 'generated' ? 'imported' : 'generated'),
        detail = new T.DataTexture(new Uint8Array(4), 1, 1),
        originals = [first.source, second.source],
        budget = new TextureBudget();
      detail.userData.surfaceDetail = true;
      budget.configure(8, 2);
      budget.register(scene(first, sibling, second, detail));
      const owned = [first.source, second.source],
        siblingImage = sibling.image,
        removed = scene(first, second, detail),
        releases: T.Source[] = [];
      first.addEventListener('dispose', () => {
        releases.push(first.source);
        throw undefined;
      });
      second.addEventListener('dispose', () => {
        releases.push(second.source);
        throw new Error('later root release failed');
      });

      expect(thrown(() => budget.unregister(removed))).toEqual({ threw: true, error: undefined });
      expect(releases).toEqual(owned);
      expect([first.source, second.source]).toEqual(originals);
      expect(sibling.source).toBe(owned[0]);
      expect(sibling.image).toBe(siblingImage);
      if (kind === 'imported') {
        expect(first.mipmaps).toEqual([]);
        expect(first.generateMipmaps).toBe(true);
        expect(sibling.mipmaps.length).toBeGreaterThan(0);
        expect(sibling.generateMipmaps).toBe(false);
      }
      const retired = [first, second, detail],
        versions = retired.map((map) => map.version);
      expect(() => budget.unregister(removed)).not.toThrow();
      budget.configure(16, 4);
      expect(retired.map((map) => map.version)).toEqual(versions);
      expect(detail.anisotropy).toBe(2);
      expect(sibling.image.width).toBe(16);
      expect(sibling.anisotropy).toBe(4);
      expect(releases).toEqual(owned);
      budget.dispose();
      expect(sibling.source).toBe(originals[0]);
    },
  );

  it.each(['generated', 'imported'] as const)(
    'does not release the same %s wrapper again when its removal callback closes the budget',
    (kind) => {
      environment();
      const first = texture(kind),
        sibling = first.clone(),
        original = first.source,
        budget = new TextureBudget();
      budget.configure(8, 2);
      budget.register(scene(first, sibling));
      const owned = first.source,
        releases: T.Source[] = [],
        siblingRelease = vi.fn();
      let reentered = false;
      first.addEventListener('dispose', () => {
        releases.push(first.source);
        if (!reentered) {
          reentered = true;
          budget.dispose();
        }
      });
      sibling.addEventListener('dispose', siblingRelease);

      budget.unregister(scene(first));
      expect(releases).toEqual([owned]);
      expect(siblingRelease).toHaveBeenCalledOnce();
      expect([first.source, sibling.source]).toEqual([original, original]);
      const versions = [first.version, sibling.version];
      budget.configure(16, 4);
      budget.dispose();
      expect([first.version, sibling.version]).toEqual(versions);
      expect(releases).toEqual([owned]);
    },
  );

  it.each(['generated', 'imported'] as const)(
    'can close a partially acquired %s registration and reuse the budget afterward',
    (kind) => {
      environment();
      const first = texture(kind),
        second = first.clone(),
        last = first.clone(),
        maps = [first, second, last],
        original = first.source,
        failure = new Error('registration disposal failed'),
        budget = kind === 'generated' ? new TextureBudget() : new ImportedTextureBudget();
      const register = () =>
        budget instanceof TextureBudget ? budget.register(scene(...maps)) : budget.register(maps);
      const fail = () => {
        second.removeEventListener('dispose', fail);
        throw failure;
      };
      second.addEventListener('dispose', fail);
      budget.configure(8, 2);
      expect(() => register()).toThrow(failure);
      budget.dispose();
      expect(maps.every((map) => map.source === original)).toBe(true);
      register();
      expect(maps.every((map) => map.source === first.source && map.image.width === 8)).toBe(true);
      budget.dispose();
      expect(maps.every((map) => map.source === original)).toBe(true);
    },
  );

  it.each([false, true])(
    'finishes decoded-image ownership after a texture listener throws (shared=%s)',
    (shared) => {
      environment();
      const image = new Bitmap(),
        first = new T.Texture(image),
        alias = new T.Texture(image),
        source = first.source,
        releases: T.Source[] = [];
      if (shared) markSharedTextureSource(first);
      first.addEventListener('dispose', () => {
        releases.push(first.source);
        expect(image.close).not.toHaveBeenCalled();
        throw undefined;
      });

      expect(thrown(() => disposeSceneTexture(first))).toEqual({ threw: true, error: undefined });
      expect(image.close).toHaveBeenCalledTimes(shared ? 0 : 1);
      disposeSceneTexture(alias);
      expect(image.close).toHaveBeenCalledTimes(shared ? 0 : 1);
      expect(releases).toEqual([source]);
    },
  );

  it.each([false, true])(
    'attempts planting release after budget removal fails and retains that first failure (later failure=%s)',
    (laterFailure) => {
      environment();
      const map = texture('generated'),
        original = map.source,
        mesh = scene(map),
        planting: CircuitPlanting = {
          root: new StaticTransformGroup().add(mesh),
          library: null,
          authored: null,
          photo: null,
          disposed: false,
        },
        parent = new T.Group().add(planting.root),
        budget = new TextureBudget(),
        owner = Object.create(RacingRenderer.prototype) as {
          releasePlanting(planting: CircuitPlanting): void;
        },
        geometryReleased = vi.fn(),
        materialReleased = vi.fn();
      Object.assign(owner, { textures: budget });
      budget.configure(8, 2);
      budget.register(planting.root);
      const owned = map.source,
        releases: T.Source[] = [];
      map.addEventListener('dispose', () => {
        releases.push(map.source);
        if (releases.length === 1) throw undefined;
        if (laterFailure) throw new Error('later planting release failed');
      });
      mesh.geometry.addEventListener('dispose', geometryReleased);
      for (const material of mesh.material) material.addEventListener('dispose', materialReleased);

      expect(thrown(() => owner.releasePlanting(planting))).toEqual({
        threw: true,
        error: undefined,
      });
      expect(map.source).toBe(original);
      expect(releases).toEqual([owned, original]);
      expect(planting.disposed).toBe(true);
      expect(parent.children).toHaveLength(0);
      expect(geometryReleased).toHaveBeenCalledOnce();
      expect(materialReleased).toHaveBeenCalledOnce();
      if (!laterFailure) expect(planting.root.children).toHaveLength(0);
      expect(() => owner.releasePlanting(planting)).not.toThrow();
      expect(releases).toEqual([owned, original]);
      budget.dispose();
    },
  );
});
