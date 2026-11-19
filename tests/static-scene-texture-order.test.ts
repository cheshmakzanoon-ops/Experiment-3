import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { WebGLShadowMap } from 'three/src/renderers/webgl/WebGLShadowMap.js';
import { BuildQueue } from '../src/rendering/build-queue.ts';
import { FarShadow } from '../src/rendering/far-shadow.ts';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { TextureBudget } from '../src/rendering/texture-budget.ts';
import { nativeTextures, snapshotPayload } from './helpers/native-texture-cache.ts';

/** Deterministic fixture rasterization, not a browser appearance substitute.
 * The real budget and foliage-mip policy operate on these pixel buffers. */
class PixelCanvas {
  width = 1;
  height = 1;
  private storage = new Uint8ClampedArray(4);
  static failContext = false;
  get pixels() {
    if (this.storage.length !== this.width * this.height * 4)
      this.storage = new Uint8ClampedArray(this.width * this.height * 4);
    return this.storage;
  }
  getContext() {
    if (PixelCanvas.failContext) return null;
    return {
      clearRect: () => this.pixels.fill(0),
      drawImage: (
        image: PixelCanvas | PixelBitmap,
        _x: number,
        _y: number,
        width = image.width,
        height = image.height,
      ) => {
        const input = image.pixels.slice();
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const x0 = Math.floor((x * image.width) / width),
              x1 = Math.ceil(((x + 1) * image.width) / width),
              y0 = Math.floor((y * image.height) / height),
              y1 = Math.ceil(((y + 1) * image.height) / height);
            for (let c = 0; c < 4; c++) {
              let sum = 0;
              for (let sy = y0; sy < y1; sy++)
                for (let sx = x0; sx < x1; sx++) sum += input[(sy * image.width + sx) * 4 + c];
              this.pixels[(y * this.width + x) * 4 + c] = sum / ((x1 - x0) * (y1 - y0));
            }
          }
      },
      getImageData: () => ({ data: this.pixels.slice() }),
      putImageData: (image: { data: Uint8ClampedArray }) => this.pixels.set(image.data),
    };
  }
}

class PixelBitmap {
  readonly width = 16;
  readonly height = 8;
  readonly pixels = authoredPixels(this.width, this.height);
  readonly close = vi.fn();
}

function authoredPixels(width: number, height: number) {
  return Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => {
    const pixel = Math.floor(i / 4),
      channel = i % 4;
    return channel === 3
      ? pixel % 5 === 0 || pixel % 7 === 0
        ? 0
        : 255
      : (pixel * 17 + channel * 41) % 256;
  });
}

function imagePayload(value: unknown): unknown {
  return value instanceof PixelCanvas || value instanceof PixelBitmap
    ? { width: value.width, height: value.height, pixels: snapshotPayload(value.pixels) }
    : snapshotPayload(value);
}

function texturePolicy(map: T.Texture) {
  return {
    image: imagePayload(map.image),
    mips: map.mipmaps.map(imagePayload),
    generateMipmaps: map.generateMipmaps,
    minFilter: map.minFilter,
    magFilter: map.magFilter,
    anisotropy: map.anisotropy,
    wrapS: map.wrapS,
    wrapT: map.wrapT,
    flipY: map.flipY,
    premultiplyAlpha: map.premultiplyAlpha,
    colorSpace: map.colorSpace,
    repeat: map.repeat.toArray(),
    offset: map.offset.toArray(),
    rotation: map.rotation,
  };
}

function fixtures() {
  const canvas = new PixelCanvas();
  canvas.width = 16;
  canvas.height = 8;
  canvas.pixels.set(authoredPixels(canvas.width, canvas.height));
  const generated = new T.CanvasTexture(canvas as unknown as HTMLCanvasElement),
    bitmap = new PixelBitmap(),
    foliage = new T.Texture(bitmap);
  generated.name = 'generated';
  generated.wrapS = T.RepeatWrapping;
  generated.repeat.set(3, 2);
  generated.offset.set(0.15, 0.3);
  generated.rotation = 0.2;
  generated.colorSpace = T.SRGBColorSpace;
  foliage.name = 'foliage';
  foliage.flipY = false;
  foliage.colorSpace = T.SRGBColorSpace;
  foliage.needsUpdate = true;
  return { generated, foliage, bitmap };
}

type Phase = 'far' | 'near' | 'colour';
type Draw = {
  phase: Phase;
  name: string;
  map: T.Texture;
  source: T.Source;
  handle: { id: number };
  policy: ReturnType<typeof texturePolicy>;
  alphaTest: number;
  native: {
    allocations: unknown[][];
    uploads: unknown[][];
    parameters: unknown[][];
    pixelStores: unknown[][];
  };
};

/** Real renderer scheduling, BuildQueue, TextureBudget, FarShadow and installed
 * Three shadow/material/uniform/texture consumers. Only rasterization and native
 * GL execution are recorded; neither a warmup nor a GPU fence is invented. */
function sceneFixture(originalOrder = false) {
  const queue = new BuildQueue(),
    textures = new TextureBudget(),
    root = new T.Group(),
    scene = new T.Scene().add(root),
    far = new FarShadow(32),
    sun = new T.DirectionalLight(),
    h = nativeTextures(imagePayload),
    assets = fixtures(),
    maps: T.Texture[] = [],
    originals = new Map<T.Texture, T.Source>(),
    materials: T.MeshBasicMaterial[] = [],
    draws: Draw[] = [];
  const renderer = Object.create(RacingRenderer.prototype) as RacingRenderer;
  const backend = h.renderer;
  let phase: Phase = 'far',
    target: T.WebGLRenderTarget | null = null;
  const known = new Set<T.Material>();
  function consume(material: T.MeshBasicMaterial | T.MeshDepthMaterial) {
    const before = {
      allocations: h.allocations.length,
      uploads: h.uploads.length,
      parameters: h.parameters.length,
      pixelStores: h.pixelStores.length,
    };
    if (!known.has(material)) {
      h.own(
        material,
        T.UniformsUtils.clone(
          material instanceof T.MeshDepthMaterial
            ? T.ShaderLib.depth.uniforms
            : T.ShaderLib.basic.uniforms,
        ),
        ['map'],
      );
      known.add(material);
    }
    h.consume(material);
    const map = material.map!;
    draws.push({
      phase,
      name: map.name,
      map,
      source: map.source,
      handle: h.properties.get(map).__webglTexture,
      policy: texturePolicy(map),
      alphaTest: material.alphaTest,
      native: {
        allocations: h.allocations.slice(before.allocations).map((value) => value.args),
        uploads: h.uploads.slice(before.uploads).map((value) => value.args),
        parameters: h.parameters.slice(before.parameters).map((value) => value.args),
        pixelStores: h.pixelStores.slice(before.pixelStores),
      },
    });
  }
  Object.assign(backend, {
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: (next: T.WebGLRenderTarget | null) => {
      target = next;
    },
    clear: () => {},
    state: {
      setBlending: () => {},
      setScissorTest: () => {},
      viewport: () => {},
      buffers: {
        depth: { getReversed: () => false, setTest: () => {} },
        color: { setClear: () => {} },
      },
    },
    renderBufferDirect: (
      _camera: T.Camera,
      _scene: T.Scene,
      _geometry: T.BufferGeometry,
      material: T.MeshDepthMaterial,
    ) => consume(material),
  });
  const shadows = new WebGLShadowMap(
    backend,
    { update: (mesh: T.Mesh) => mesh.geometry } as unknown as ConstructorParameters<
      typeof WebGLShadowMap
    >[1],
    { maxTextureSize: 4096 } as unknown as ConstructorParameters<typeof WebGLShadowMap>[2],
  );
  shadows.enabled = true;
  Object.assign(backend, {
    shadowMap: shadows,
    render: (value: T.Scene, camera: T.Camera) => {
      value.updateMatrixWorld(true);
      shadows.render(
        [sun, far.light].filter((light) => light.visible),
        value,
        camera,
      );
    },
  });
  sun.castShadow = true;
  scene.add(sun, sun.target, far.light, far.light.target);
  Object.assign(renderer, {
    renderer: backend,
    textures,
    lighting: 'day',
    scene,
    sun,
    farShadow: far,
    farShadowBounds: new T.Box3(new T.Vector3(-2, -2, -2), new T.Vector3(2, 2, 2)),
    graphics: { vegetationDensity: 1 },
    circuit: {
      construction: queue,
      group: root,
      vegetationGroup: root,
      crowd: new T.Group(),
      staff: { root: new T.Group() },
      crowdClusters: [],
    },
    cars: [],
    pitCrew: { root: new T.Group() },
    gridPreparation: { root: new T.Group() },
    gridPerformance: { root: new T.Group() },
    debris: { mesh: new T.Group() },
    guide: { mesh: new T.Group() },
    engineeringView: { group: new T.Group() },
    effects: { group: new T.Group() },
  });
  const production = RacingRenderer.prototype as unknown as {
    queueStaticScenePreparation(this: RacingRenderer): void;
    bakeFarShadow(this: RacingRenderer, lighting: 'day'): void;
  };
  if (originalOrder)
    queue.add('Far sun shadow', 9, () => production.bakeFarShadow.call(renderer, 'day'));
  else production.queueStaticScenePreparation.call(renderer);
  // Initial quality is selected after scheduling but before the shared queue
  // runs, just as create() configures the deferred renderer before asset work.
  textures.configure(8, 16);
  function attach(map: T.Texture) {
    maps.push(map);
    originals.set(map, map.source);
    const material = new T.MeshBasicMaterial({ map, alphaTest: 0.45 });
    material.alphaToCoverage = map.name.startsWith('foliage');
    const mesh = new T.Mesh(new T.PlaneGeometry(), material);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    materials.push(material);
    root.add(mesh);
  }
  // These assets and their late clones do not exist when preparation is queued.
  queue.add('Loaded authored fixtures', 3, () => {
    attach(assets.generated);
    attach(assets.foliage);
  });
  queue.add('Spatial fixture batch', 4, () => {
    const clone = assets.generated.clone();
    clone.name = 'generated-batch';
    clone.offset.x = 0.7;
    attach(clone);
  });
  queue.add('Authored foliage policy', 5, () => {
    assets.foliage.userData.immutableAssetTexture = true;
    assets.foliage.userData.foliageAlphaCutoff = 0.45;
  });
  queue.add('Seal fixture transforms', 6, () => root.updateMatrixWorld(true));
  queue.add('Retained late foliage tier', 7, () => {
    const clone = assets.foliage.clone();
    clone.name = 'foliage-tier';
    attach(clone);
  });
  function afterConstruction() {
    if (originalOrder) textures.register(root);
    phase = 'near';
    sun.shadow.needsUpdate = true;
    shadows.render([sun], scene, new T.PerspectiveCamera());
    phase = 'colour';
    materials.forEach(consume);
  }
  function dispose() {
    textures.dispose();
    materials.forEach((material) => material.dispose());
    root.traverse((object) => {
      if (object instanceof T.Mesh) object.geometry.dispose();
    });
    maps.forEach((map) => map.dispose());
    far.dispose();
    sun.shadow.dispose();
  }
  return { queue, textures, h, assets, maps, originals, draws, far, afterConstruction, dispose };
}

beforeEach(() => {
  PixelCanvas.failContext = false;
  vi.stubGlobal('HTMLCanvasElement', PixelCanvas);
  vi.stubGlobal('ImageBitmap', PixelBitmap);
  vi.stubGlobal('document', { createElement: () => new PixelCanvas() });
});
afterEach(() => vi.unstubAllGlobals());

describe('static scene texture policy before shadow submission', () => {
  it.each(['synchronous', 'cooperative'] as const)(
    'binds final owners for far, near and colour consumers through the %s queue',
    async (mode) => {
      const f = sceneFixture();
      try {
        expect(f.maps).toHaveLength(0);
        if (mode === 'synchronous') f.queue.runSynchronously();
        else
          expect(
            await f.queue.run(
              () => {},
              () => false,
              async () => {},
            ),
          ).toBe(true);
        expect(f.queue.ready).toBe(true);
        f.afterConstruction();
        expect(f.maps).toHaveLength(4);
        expect(f.far.bakes).toBe(1);
        expect(f.draws).toHaveLength(12);
        for (const map of f.maps) {
          const [far, near, colour] = f.draws.filter((draw) => draw.map === map);
          expect([far.phase, near.phase, colour.phase]).toEqual(['far', 'near', 'colour']);
          expect(far.source).toBe(map.source);
          expect(far.source).not.toBe(f.originals.get(map));
          expect(near.source).toBe(far.source);
          expect(colour.source).toBe(far.source);
          expect(near.handle).toBe(far.handle);
          expect(colour.handle).toBe(far.handle);
          expect(near.policy).toEqual(far.policy);
          expect(colour.policy).toEqual(far.policy);
          expect(far.policy.anisotropy).toBe(16);
          expect(far.policy.image).toMatchObject({ width: 8, height: 4 });
          expect(far.alphaTest).toBe(map.name.startsWith('foliage') ? 0.5 : 0.45);
          expect(near.alphaTest).toBe(far.alphaTest);
          expect(colour.alphaTest).toBe(0.45);
        }
        expect(f.h.allocations).toHaveLength(2);
        expect(f.h.uploads).toHaveLength(5);
        expect(f.h.deleted).toEqual([]);
        expect(f.assets.generated.source).toBe(f.maps[2].source);
        expect(f.assets.foliage.source).toBe(f.maps[3].source);
        expect(f.maps[2].offset.x).toBe(0.7);
      } finally {
        f.dispose();
      }
    },
  );

  it('reproduces the old post-bake rebind while preserving the exact final consumer policy', () => {
    const original = sceneFixture(true),
      ordered = sceneFixture();
    try {
      for (const f of [original, ordered]) {
        f.queue.runSynchronously();
        f.afterConstruction();
      }
      for (const map of ordered.maps) {
        const previous = original.draws.filter((draw) => draw.name === map.name),
          current = ordered.draws.filter((draw) => draw.name === map.name);
        expect(previous[0].source).not.toBe(previous[1].source);
        expect(previous[0].handle).not.toBe(previous[1].handle);
        expect(previous[0].policy).not.toEqual(previous[1].policy);
        // The selected final colour policy is byte/sampler identical. Only its
        // first-use timing changes; far-shadow pixels need not match the old bake.
        expect(current[2].policy).toEqual(previous[2].policy);
        expect(current[0].policy).toEqual(previous[1].policy);
        expect(current[0].native).toEqual(previous[1].native);
      }
      expect(original.h.allocations).toHaveLength(4);
      expect(original.h.deleted).toHaveLength(2);
      expect(original.h.uploads).toHaveLength(7);
      expect(ordered.h.allocations).toHaveLength(2);
      expect(ordered.h.deleted).toHaveLength(0);
      expect(ordered.h.uploads).toHaveLength(5);
    } finally {
      original.dispose();
      ordered.dispose();
    }
  });

  it.each(['Scene texture budget', 'Far sun shadow'])(
    'cancels before %s without a shadow submission and restores owned sources',
    async (stopBefore) => {
      const f = sceneFixture();
      let cancelled = false,
        clock = 0;
      try {
        expect(
          await f.queue.run(
            ({ label }) => {
              if (label === stopBefore) cancelled = true;
            },
            () => cancelled,
            async () => {},
            () => (clock += 9),
          ),
        ).toBe(false);
        expect(f.queue.statistics.cancelled).toBe(true);
        expect(f.queue.ready).toBe(false);
        expect(f.far.bakes).toBe(0);
        expect(f.h.allocations).toEqual([]);
        expect(f.h.uploads).toEqual([]);
        expect(f.draws).toEqual([]);
        expect(f.maps).toHaveLength(4);
        if (stopBefore === 'Far sun shadow')
          for (const map of f.maps) expect(map.source).not.toBe(f.originals.get(map));
        f.textures.dispose();
        for (const map of f.maps) expect(map.source).toBe(f.originals.get(map));
        expect(f.assets.bitmap.close).not.toHaveBeenCalled();
      } finally {
        f.dispose();
      }
    },
  );

  it('releases shared native owners once and preserves loader pixels on teardown', () => {
    const f = sceneFixture(),
      originalPixels = imagePayload(f.assets.bitmap);
    try {
      f.queue.runSynchronously();
      f.afterConstruction();
      const handles = f.h.allocations.map((entry) => entry.handle);
      f.textures.dispose();
      expect(f.h.deleted).toHaveLength(handles.length);
      expect(new Set(f.h.deleted)).toEqual(new Set(handles));
      const released = [...f.h.deleted];
      for (const map of f.maps) expect(map.source).toBe(f.originals.get(map));
      expect(imagePayload(f.assets.bitmap)).toEqual(originalPixels);
      expect(f.assets.bitmap.close).not.toHaveBeenCalled();
      f.dispose();
      expect(f.h.deleted).toEqual(released);
      f.h.retire();
      expect(() => f.textures.dispose()).not.toThrow();
    } finally {
      f.dispose();
    }
  });

  it('propagates registration failure before any far shadow and restores partial ownership', () => {
    const f = sceneFixture();
    try {
      PixelCanvas.failContext = true;
      expect(() => f.queue.runSynchronously()).toThrow('Texture resampling requires Canvas 2D');
      expect(f.far.bakes).toBe(0);
      expect(f.h.uploads).toEqual([]);
      f.textures.dispose();
      for (const map of f.maps) expect(map.source).toBe(f.originals.get(map));
      expect(f.assets.bitmap.close).not.toHaveBeenCalled();
    } finally {
      PixelCanvas.failContext = false;
      f.dispose();
    }
  });
});
