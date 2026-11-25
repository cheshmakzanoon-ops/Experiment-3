import * as T from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextureBudget } from '../src/rendering/texture-budget.ts';
import { ImportedTextureBudget } from '../src/rendering/imported-texture-budget.ts';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { markSharedTextureSource } from '../src/rendering/assets/texture-source-ownership.ts';

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
class Bitmap {
  width = 1024;
  height = 512;
  readonly close = vi.fn();
}
function environment() {
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  vi.stubGlobal('ImageBitmap', Bitmap);
  vi.stubGlobal('document', { createElement: () => new Canvas() });
}
function mesh(...maps: T.Texture[]) {
  return new T.Mesh(
    new T.BufferGeometry(),
    maps.map((map) => new T.MeshBasicMaterial({ map })),
  );
}
function imported() {
  const bitmap = new Bitmap(),
    map = new T.Texture(bitmap);
  map.flipY = false;
  map.userData.immutableAssetTexture = true;
  markSharedTextureSource(map);
  return { bitmap, map, original: map.source, external: map.clone() };
}
function mixed() {
  environment();
  const canvas = new Canvas(),
    generated = new T.CanvasTexture(canvas as unknown as HTMLCanvasElement),
    generatedSource = generated.source,
    generatedSibling = generated.clone(),
    source = imported(),
    importedSibling = source.map.clone(),
    maps = [generated, generatedSibling, source.map, importedSibling],
    originals = [generatedSource, generatedSource, source.original, source.original],
    root = mesh(...maps),
    budget = new TextureBudget();
  budget.configure(128, 2);
  budget.register(root);
  return { budget, root, maps, originals, generated, generatedSibling, canvas, ...source };
}

/** Run the complete production renderer disposer. The budget, scene maps,
 * pass material and Three disposal events are real; unrelated scene owners
 * and the WebGL backend are deliberately inert boundaries. */
function rendererOwner(f: ReturnType<typeof mixed>) {
  const owner = Object.create(RacingRenderer.prototype) as RacingRenderer,
    inert = () => ({ dispose: vi.fn() }),
    outputPass = new OutputPass(),
    outputReleased = vi.fn(),
    ownerSnapshots: boolean[][] = [],
    backend = inert(),
    scene = new T.Scene().add(f.root);
  outputPass.material.addEventListener('dispose', outputReleased);
  const owners = Object.fromEntries(
    [
      'pitCrew',
      'gridPerformance',
      'gridPreparation',
      'reflection',
      'shadowProxies',
      'farShadow',
      'gpuTimer',
      'gpuFrames',
      'motionBlur',
      'exposure',
      'weatherPresentation',
      'bloom',
      'fxaa',
      'scenePass',
      'grade',
      'ultra',
      'environment',
      'composer',
    ].map((key) => [key, inert()]),
  );
  Object.assign(owner, owners, {
    disposed: false,
    renderer: backend,
    textures: f.budget,
    outputPass,
    bikeShells: { disposeAll: vi.fn() },
    releaseCarTemplates: inert,
    suppliedPlayerAsset: {
      dispose: () => {
        ownerSnapshots.push(f.maps.map((map, i) => map.source === f.originals[i]));
      },
    },
    circuit: {
      disposePlanting: vi.fn(),
      secondaryStands: inert(),
      wetReflection: inert(),
      stateTexture: new T.Texture(),
      disposalMaterials: () => new Set<T.Material>(),
    },
    scene,
    sun: new T.DirectionalLight(),
    cars: [],
  });
  return { owner, outputReleased, backend, ownerSnapshots };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('texture budgets and their renderer owner', () => {
  it('keeps shared loader originals usable through streaming replacement, repaint, quality and renderer teardown', () => {
    const f = mixed(),
      removed = mesh(f.generated, f.map),
      retained = [f.generatedSibling, f.maps[3]];
    f.budget.unregister(removed);
    expect([f.generated.source, f.map.source]).toEqual([f.originals[0], f.original]);
    const retiredVersions = [f.generated.version, f.map.version];
    f.budget.configure(256, 4);
    expect([f.generated.version, f.map.version]).toEqual(retiredVersions);
    expect(retained.map((map) => map.image.width)).toEqual([256, 256]);
    f.canvas.paint = 9;
    f.budget.register(removed);
    expect(f.generated.source).toBe(f.generatedSibling.source);
    expect(f.map.source).toBe(f.maps[3].source);
    expect((f.generated.image as unknown as Canvas).paint).toBe(9);
    f.canvas.paint = 12;
    f.budget.refresh(f.generatedSibling);
    expect((f.generated.image as unknown as Canvas).paint).toBe(12);
    f.budget.configure(1024, 8);
    expect(f.generated.image).toBe(f.canvas);
    expect(f.map.image).toBe(f.bitmap);
    const r = rendererOwner(f);
    r.owner.dispose();
    r.owner.dispose();
    expect(r.ownerSnapshots).toEqual([[true, true, true, true]]);
    expect(f.maps.map((map) => map.source)).toEqual(f.originals);
    expect(f.external.source).toBe(f.original);
    expect(f.bitmap.close).not.toHaveBeenCalled();
    expect(r.outputReleased).toHaveBeenCalledOnce();
    expect(r.backend.dispose).toHaveBeenCalledOnce();
  });

  it.each(['imported', 'generated'] as const)(
    'restores every source before later renderer owners even when a %s disposal listener throws',
    (kind) => {
      const f = mixed(),
        r = rendererOwner(f),
        failure = new Error(`${kind} disposal failed`);
      const throwing = kind === 'imported' ? f.map : f.generated;
      const owned = throwing.source,
        releases: T.Source[] = [];
      throwing.addEventListener('dispose', () => {
        releases.push(throwing.source);
        throw failure;
      });
      expect(() => r.owner.dispose()).toThrow(failure);
      // The old GPU upload is released before source restoration; the generic
      // scene cleanup subsequently sees the original, as the renderer expects.
      expect(releases).toEqual([owned, kind === 'imported' ? f.original : f.originals[0]]);
      expect(r.ownerSnapshots).toEqual([[true, true, true, true]]);
      expect(f.maps.map((map) => map.source)).toEqual(f.originals);
      expect(r.outputReleased).toHaveBeenCalledOnce();
      expect(r.backend.dispose).toHaveBeenCalledOnce();
      expect(f.bitmap.close).not.toHaveBeenCalled();
      expect(() => r.owner.dispose()).not.toThrow();
      const versions = f.maps.map((map) => map.version);
      f.budget.configure(64, 1);
      expect(f.maps.map((map) => map.version)).toEqual(versions);
    },
  );

  it('retires mixed budget ownership before reentrant disposal and preserves an undefined first failure', () => {
    const f = mixed(),
      seen: string[] = [];
    let reentered = false;
    f.map.addEventListener('dispose', () => {
      seen.push('imported');
      if (!reentered) {
        reentered = true;
        f.budget.dispose();
      }
      throw undefined;
    });
    f.generated.addEventListener('dispose', () => {
      seen.push('generated');
      throw new Error('later failure');
    });
    let threw = false,
      caught: unknown;
    try {
      f.budget.dispose();
    } catch (error) {
      threw = true;
      caught = error;
    }
    expect(threw).toBe(true);
    expect(caught).toBeUndefined();
    expect(seen).toEqual(['imported', 'generated']);
    expect(f.maps.map((map) => map.source)).toEqual(f.originals);
    expect(() => f.budget.dispose()).not.toThrow();
    // Disposal releases ownership without making the reusable budget terminal.
    const fresh = new T.CanvasTexture(new Canvas() as unknown as HTMLCanvasElement),
      original = fresh.source;
    f.budget.register(mesh(fresh));
    expect(fresh.source).not.toBe(original);
    f.budget.dispose();
    expect(fresh.source).toBe(original);
  });

  it('drains standalone imported ownership after a callback failure and accepts a later asset', () => {
    environment();
    const first = imported(),
      second = imported(),
      budget = new ImportedTextureBudget(),
      failure = new Error('first wrapper release failed');
    first.bitmap.width = 8;
    first.bitmap.height = 4;
    first.map.userData.foliageAlphaCutoff = 0.45;
    budget.register([first.map, second.map]);
    expect(first.map.mipmaps.length).toBeGreaterThan(0);
    expect(first.map.generateMipmaps).toBe(false);
    first.map.addEventListener('dispose', () => {
      throw failure;
    });
    expect(() => budget.dispose()).toThrow(failure);
    expect([first.map.source, second.map.source]).toEqual([first.original, second.original]);
    expect(first.map.mipmaps).toEqual([]);
    expect(first.map.generateMipmaps).toBe(true);
    const next = imported();
    budget.register(next.map);
    budget.configure(128, 2);
    expect(next.map.image.width).toBe(128);
    budget.dispose();
    expect(next.map.source).toBe(next.original);
    expect(first.bitmap.close).not.toHaveBeenCalled();
    expect(second.bitmap.close).not.toHaveBeenCalled();
    expect(next.bitmap.close).not.toHaveBeenCalled();
  });
});
