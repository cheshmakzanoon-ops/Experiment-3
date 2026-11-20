import * as T from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { StaticTransformGroup } from '../src/rendering/static-transform-group.ts';
import { TextureBudget } from '../src/rendering/texture-budget.ts';
import { ImportedTextureBudget } from '../src/rendering/imported-texture-budget.ts';
import {
  graphicsPreset,
  type GraphicsOptions,
  type QualityPreset,
} from '../src/rendering/options.ts';
import { loadVenueVegetation } from '../src/rendering/vegetation/index.ts';
import { loadAurelVegetation } from '../src/rendering/aurel-vegetation.ts';
import {
  disposeCircuitPlanting,
  type CircuitPlanting,
} from '../src/rendering/vegetation/ownership.ts';
import type { VegetationLibrary, VegetationSpecies } from '../src/rendering/vegetation/library.ts';
import { SPECIES } from '../src/rendering/vegetation/species.ts';
import { PhotoForest } from '../src/rendering/vegetation/forest.ts';
import { buildScatter } from '../src/rendering/venue-kit/scatter.ts';
import { Track } from '../src/simulation/track.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { setMxQuality } from '../src/rendering/offroad/mx-quality.ts';

vi.mock('../src/rendering/vegetation/index.ts', async (original) => ({
  ...(await original<typeof import('../src/rendering/vegetation/index.ts')>()),
  loadVenueVegetation: vi.fn(),
}));
vi.mock('../src/rendering/aurel-vegetation.ts', async (original) => ({
  ...(await original<typeof import('../src/rendering/aurel-vegetation.ts')>()),
  loadAurelVegetation: vi.fn(),
}));

class Canvas {
  width = 300;
  height = 150;
  getContext() {
    const noop = () => {};
    return new Proxy(
      {
        canvas: this,
        measureText: () => ({ width: 40 }),
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }),
        createPattern: () => ({ setTransform: noop }),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
      },
      { get: (target, key) => Reflect.get(target, key) ?? noop },
    );
  }
}

function library() {
  const geometry = new T.PlaneGeometry(1, 1),
    material = new T.MeshStandardMaterial();
  const species = {
    id: SPECIES.linden,
    info: { height: 11, radius: 4, form: 'tree' },
    cards: geometry,
    trunk: geometry,
    impostor: geometry,
    cardMaterial: material,
    barkMaterial: material,
    impostorMaterial: material,
    cardDepth: null,
    cardDistance: null,
    barkDepth: null,
    barkDistance: null,
    impostorDepth: null,
    grass: null,
    textures: [],
  } as unknown as VegetationSpecies;
  const map = new Map([[SPECIES.linden, species]]);
  return {
    species: map,
    failed: [],
    available: new Set(map.keys()),
    trees: [species],
    get: (id: string) => map.get(id as typeof SPECIES.linden) ?? null,
    dispose: vi.fn(() => {
      geometry.dispose();
      material.dispose();
    }),
  } as unknown as VegetationLibrary;
}

function simplePlanting(): CircuitPlanting {
  const root = new StaticTransformGroup();
  root.add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()));
  return { root, library: null, authored: null, photo: null, disposed: false };
}

/** Real renderer preparation, circuit planting builders, ownership and probes;
 * only WebGL, image downloading and unrelated quality passes are substituted. */
function fixture(id: 'vellamar' | 'aurel' | 'alpine-pass' | 'valley-ridge-mx' = 'vellamar') {
  const track = new Track('clear', false, undefined, CIRCUITS[id]);
  const circuit = new CircuitScene(track, true);
  const initial = simplePlanting();
  circuit.installPlanting(initial);
  const renderer = Object.create(RacingRenderer.prototype) as RacingRenderer;
  const scene = new T.Scene().add(circuit.group),
    camera = new T.PerspectiveCamera();
  camera.position.set(10, 3, 20);
  camera.updateMatrixWorld();
  const backend = {
    info: { programs: [] },
    properties: { get: () => ({}) },
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getViewport: (v: T.Vector4) => v.set(0, 0, 100, 100),
    getScissor: (v: T.Vector4) => v.set(0, 0, 100, 100),
    getScissorTest: () => false,
    setRenderTarget: vi.fn(),
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
    compileAsync: vi.fn(async () => {}),
  };
  const state = {
    disposed: false,
    showroomOnly: false,
    track,
    circuit,
    scene,
    camera,
    renderer: backend,
    bikeShells: { warmFieldDetails: (compile: () => Promise<void>) => compile() },
    textures: new TextureBudget(),
    preset: 'medium' as QualityPreset,
    graphics: graphicsPreset('medium'),
    quality: 'medium',
    reflection: {
      invalidate: vi.fn(),
      beginProbePreparation: vi.fn(),
      completeProbePreparation: vi.fn(),
    },
    scenePass: { temporal: { reset: vi.fn() } },
    weatherPresentation: { install: vi.fn() },
    atmosphere: { install: vi.fn() },
    composer: { readBuffer: new T.WebGLRenderTarget(4, 4) },
    farShadowBaked: 'day',
    waitForPreparedFrame: vi.fn(async () => true),
    setQuality: vi.fn((preset: QualityPreset, graphics: GraphicsOptions) => {
      state.preset = preset;
      state.graphics = graphics;
      state.quality = preset === 'ultra' ? 'high' : preset;
      Object.assign(renderer, { preset, graphics, quality: state.quality });
    }),
  };
  Object.assign(renderer, state);
  const change = (preset: QualityPreset, cancelled = () => false, yieldControl = async () => {}) =>
    renderer.prepareQuality(preset, graphicsPreset(preset), cancelled, yieldControl);
  return { renderer, state, circuit, initial, backend, change, camera };
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  vi.mocked(loadVenueVegetation).mockReset();
  vi.mocked(loadAurelVegetation).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('live circuit vegetation quality', () => {
  it.each(['cancel during meadow preparation', 'compile error'] as const)(
    'restores both planting and meadow owners after %s',
    async (failure) => {
      setMxQuality('medium');
      const { circuit, initial, state, change, backend } = fixture('valley-ridge-mx');
      const meadow = circuit.offroad!.meadow!;
      const photos = library();
      vi.mocked(loadVenueVegetation).mockResolvedValue(photos);
      const apply = state.setQuality.getMockImplementation()!;
      state.setQuality.mockImplementation((preset, graphics) => {
        apply(preset, graphics);
        setMxQuality(preset);
      });
      let cancelled = false;
      let disposedGrass = 0;
      backend.compileAsync.mockImplementation(async () => {
        expect(meadow.stats.clumps).toBeGreaterThan(2000);
        const first = meadow.root.children[0].children[0] as T.InstancedMesh;
        first.geometry.addEventListener('dispose', () => disposedGrass++);
        throw new Error('MX compilation failed');
      });
      try {
        const result = change(
          'high',
          () => cancelled,
          async () => {
            if (failure === 'cancel during meadow preparation' && meadow.stats.candidates > 0)
              cancelled = true;
          },
        );
        if (failure === 'compile error') {
          await expect(result).rejects.toThrow('MX compilation failed');
          expect(disposedGrass).toBe(1);
        } else {
          expect(await result).toBe(false);
          expect(backend.compileAsync).not.toHaveBeenCalled();
        }
        expect(circuit.planting).toBe(initial);
        expect(initial.disposed).toBe(false);
        expect(photos.dispose).toHaveBeenCalledOnce();
        expect(meadow.stats.clumps).toBe(0);
        expect(meadow.root.children).toHaveLength(0);
        expect(state.preset).toBe('medium');
      } finally {
        circuit.offroad?.dispose();
        circuit.disposePlanting();
        setMxQuality('high');
      }
    },
  );

  it('upgrades Medium to the same photographed planting as a fresh Ultra scene, in place', async () => {
    const { circuit, initial, backend, change, camera, renderer, state } = fixture();
    const photos = library();
    vi.mocked(loadVenueVegetation).mockResolvedValue(photos);
    const outer = circuit.vegetationGroup,
      probes = circuit.probeDetail,
      pose = camera.matrixWorld.clone();
    const oldMesh = initial.root.children[0];
    backend.compileAsync.mockImplementationOnce(async () => {
      expect(circuit.photoLibrary).toBe(photos);
      expect(initial.disposed).toBe(false);
    });
    expect(await change('ultra')).toBe(true);
    const fresh = circuit.buildPlanting(library(), null);
    fresh.photo!.update(camera, 'ultra', graphicsPreset('ultra').vegetationDensity);
    expect(circuit.photoPlanting!.diagnostics()).toEqual(fresh.photo!.diagnostics());
    expect(circuit.vegetationGroup).toBe(outer);
    expect(circuit.probeDetail).toBe(probes);
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.every((p) => p.object !== oldMesh)).toBe(true);
    expect(camera.matrixWorld.equals(pose)).toBe(true);
    expect(initial.disposed).toBe(true);
    expect(state.reflection.invalidate).toHaveBeenCalledOnce();
    expect((renderer as unknown as { farShadowBaked: null }).farShadowBaked).toBeNull();
    expect(state.weatherPresentation.install).toHaveBeenCalledWith(circuit.planting!.root);
    const active = circuit.planting;
    await change('high');
    expect(circuit.planting).toBe(active);
    expect(loadVenueVegetation).toHaveBeenCalledOnce();
    disposeCircuitPlanting(fresh);
    circuit.disposePlanting();
    expect(photos.dispose).toHaveBeenCalledOnce();
  });

  it('downgrades a photographed scene to the same procedural build and releases the photographic owner', async () => {
    const { circuit, change } = fixture();
    const photos = library();
    vi.mocked(loadVenueVegetation).mockResolvedValue(photos);
    await change('high');
    const photographic = circuit.planting!;
    const previousObjects = new Set<T.Object3D>();
    photographic.root.traverse((object) => previousObjects.add(object));
    expect(await change('medium')).toBe(true);
    const fresh = circuit.buildPlanting(null, null);
    expect(circuit.vegetationGroup.userData).toEqual(fresh.root.userData);
    expect(circuit.photoLibrary).toBeNull();
    expect(circuit.photoPlanting).toBeNull();
    expect(photographic.disposed).toBe(true);
    expect(photos.dispose).toHaveBeenCalledOnce();
    expect(circuit.probeDetail.every((p) => !previousObjects.has(p.object))).toBe(true);
    disposeCircuitPlanting(fresh);
    circuit.disposePlanting();
  });

  it('loads Aurel’s authored fallback before downgrading and retains its source identity', async () => {
    const { circuit, change } = fixture('aurel');
    vi.mocked(loadVenueVegetation).mockResolvedValue(library());
    await change('ultra');
    const root = new T.Group();
    const authored = {
      root,
      build: vi.fn((_track: Track, parent: T.Object3D) => parent.add(root)),
      update: vi.fn(),
      dispose: vi.fn(() => root.removeFromParent()),
    } as unknown as Awaited<ReturnType<typeof loadAurelVegetation>>;
    vi.mocked(loadAurelVegetation).mockResolvedValue(authored);
    expect(await change('medium')).toBe(true);
    expect(circuit.vegetation).toBe(authored);
    expect(authored.build).toHaveBeenCalledOnce();
    expect(loadAurelVegetation).toHaveBeenCalledOnce();
    circuit.disposePlanting();
    expect(authored.dispose).toHaveBeenCalledOnce();
  });

  it('keeps the complete fallback when optional photographs are unavailable', async () => {
    const { circuit, initial, change } = fixture();
    vi.mocked(loadVenueVegetation).mockResolvedValue(null);
    expect(await change('ultra')).toBe(true);
    expect(circuit.planting).toBe(initial);
    expect(initial.disposed).toBe(false);
    circuit.disposePlanting();
  });

  it('keeps cancelled High metadata dormant through Low and resumes it only on live High entry', async () => {
    const { circuit, initial, change, backend, state } = fixture();
    let stopped = false;
    const photos = library();
    vi.mocked(loadVenueVegetation).mockImplementation(async () => {
      stopped = true;
      return photos;
    });
    expect(await change('high', () => stopped)).toBe(false);
    expect(circuit.planting).toBe(initial);
    expect(initial.disposed).toBe(false);
    expect(photos.dispose).toHaveBeenCalledOnce();
    expect(backend.compileAsync).not.toHaveBeenCalled();
    expect(state.reflection.beginProbePreparation).toHaveBeenCalledOnce();
    expect(state.reflection.completeProbePreparation).not.toHaveBeenCalled();
    expect(await change('low')).toBe(true);
    expect(state.reflection.beginProbePreparation).toHaveBeenCalledOnce();
    expect(state.reflection.completeProbePreparation).not.toHaveBeenCalled();
    stopped = false;
    const nextPhotos = library();
    vi.mocked(loadVenueVegetation).mockResolvedValue(nextPhotos);
    expect(await change('high', () => stopped)).toBe(true);
    expect(state.reflection.beginProbePreparation).toHaveBeenCalledTimes(2);
    expect(state.reflection.beginProbePreparation.mock.calls[1]).toEqual(
      state.reflection.beginProbePreparation.mock.calls[0],
    );
    expect(state.reflection.completeProbePreparation).toHaveBeenCalledOnce();
    circuit.disposePlanting();
    expect(nextPhotos.dispose).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'compile error', 'teardown'] as const)(
    'cleans both owners correctly after %s during preparation',
    async (failure) => {
      const { circuit, initial, renderer, state, change, backend } = fixture();
      let stopped = false;
      const photos = library();
      vi.mocked(loadVenueVegetation).mockResolvedValue(photos);
      backend.compileAsync.mockImplementation(async () => {
        if (failure === 'compile error') throw new Error('GPU compilation failed');
        if (failure === 'teardown') {
          Object.assign(renderer, { disposed: true });
          state.textures.dispose();
          circuit.disposePlanting();
        } else stopped = true;
      });
      const pending = change('high', () => stopped);
      if (failure === 'compile error')
        await expect(pending).rejects.toThrow('GPU compilation failed');
      else expect(await pending).toBe(false);
      expect(photos.dispose).toHaveBeenCalledOnce();
      if (failure === 'teardown') {
        expect(circuit.planting).toBeNull();
        expect(initial.disposed).toBe(true);
      } else {
        expect(circuit.planting).toBe(initial);
        expect(initial.disposed).toBe(false);
        expect(state.preset).toBe('medium');
        expect(circuit.probeDetail).toHaveLength(1);
        circuit.disposePlanting();
      }
    },
  );

  it('records shrubs at Medium and toggles the same fallback without shifting boulders', () => {
    const { circuit } = fixture('alpine-pass');
    const kit = circuit.venueKit!.context;
    buildScatter(kit);
    expect(kit.photoShrubs.length).toBeGreaterThan(0);
    expect(kit.proceduralShrubs.length).toBeGreaterThan(0);
    const placements = structuredClone(kit.photoShrubs);
    const rocks: T.InstancedMesh[] = [];
    kit.root.traverse((object) => {
      if (object instanceof T.InstancedMesh && object.name === 'Boulders') rocks.push(object);
    });
    const matrices = rocks.map((mesh) => [...mesh.instanceMatrix.array]);
    kit.setPhotoShrubs(true);
    expect(kit.proceduralShrubs.every((mesh) => !mesh.visible)).toBe(true);
    kit.setPhotoShrubs(false);
    expect(kit.proceduralShrubs.every((mesh) => mesh.visible)).toBe(true);
    expect(kit.photoShrubs).toEqual(placements);
    expect(rocks.map((mesh) => [...mesh.instanceMatrix.array])).toEqual(matrices);
    circuit.disposePlanting();
  });

  it('recompacts a stationary forest when High changes to Ultra near distance', () => {
    const photos = library(),
      forest = new PhotoForest(photos),
      camera = new T.PerspectiveCamera();
    forest.add(
      Array.from({ length: 120 }, (_, i) => ({
        species: SPECIES.linden,
        x: i * 5,
        y: 0,
        z: 0,
        scale: 1,
        yaw: 0,
        tint: [1, 1, 1] as const,
      })),
      { label: 'Quality boundary', chunk: 1000, shadows: true },
    );
    const cards = forest.root.children.find(
      (o) => o.userData.photoVegetation === 'cards',
    ) as T.InstancedMesh;
    forest.update(camera, 'high');
    const before = cards.count;
    forest.update(camera, 'ultra');
    expect(cards.count).toBeGreaterThan(before);
    forest.update(camera, 'high');
    expect(cards.count).toBe(before);
    forest.dispose();
    photos.dispose();
  });

  it('bakes photographed trees without submitting their projected crown occlusion as casters', () => {
    const { renderer, circuit } = fixture(),
      photos = library(),
      forest = new PhotoForest(photos),
      bake = vi.fn();
    forest.add([{ species: SPECIES.linden, x: 0, y: 0, z: 0, scale: 1, yaw: 0, tint: [1, 1, 1] }], {
      label: 'Far shadow contact exclusion',
      shadows: false,
      ground: () => 0,
    });
    circuit.vegetationGroup.add(forest.root);
    Object.assign(renderer, {
      cars: [],
      farShadow: { bake },
      farShadowBounds: new T.Box3(),
      sun: new T.DirectionalLight(),
      pitCrew: {},
      gridPreparation: {},
      gridPerformance: {},
      debris: {},
      guide: {},
      engineeringView: {},
      effects: {},
    });
    try {
      (renderer as unknown as { bakeFarShadow(mode: 'day'): void }).bakeFarShadow('day');
      const contact = forest.root.children.find(
        (o) => o.userData.photoVegetation === 'contact',
      ) as T.InstancedMesh;
      const casters = bake.mock.calls[0][2].farCasters as T.Object3D[];
      expect(casters.map((o) => o.userData.photoVegetation)).toEqual([
        'cards',
        'trunk',
        'impostor',
      ]);
      expect(casters).not.toContain(contact);
      expect(contact.castShadow).toBe(false);
      expect(contact.customDepthMaterial).toBeUndefined();
      expect(contact.visible).toBe(true);
      expect((contact.material as T.MeshBasicMaterial).opacity).toBeGreaterThan(0);
    } finally {
      forest.dispose();
      photos.dispose();
      circuit.disposePlanting();
    }
  });
});

it('unregisters replaced imported maps while preserving a live clone and immutable image source', () => {
  const budget = new ImportedTextureBudget(),
    canvas = new Canvas();
  const a = new T.Texture(canvas as unknown as HTMLCanvasElement);
  a.flipY = false;
  a.userData.immutableAssetTexture = true;
  const b = a.clone(),
    original = a.source;
  budget.register(a);
  budget.register(b);
  const resized = b.source;
  budget.unregister(a);
  expect(a.source).toBe(original);
  expect(b.source).toBe(resized);
  const version = a.version;
  budget.configure(1024, 4);
  expect(a.version).toBe(version);
  expect(b.anisotropy).toBe(4);
  budget.unregister(b);
  expect(b.source).toBe(original);
  budget.dispose();
});

it('forgets retired procedural atlas canvases before later quality edits', () => {
  const budget = new TextureBudget(),
    canvas = new Canvas();
  canvas.width = canvas.height = 2048;
  const map = new T.CanvasTexture(canvas as unknown as HTMLCanvasElement);
  const root = new T.Mesh(new T.PlaneGeometry(), new T.MeshStandardMaterial({ map }));
  budget.register(root);
  expect(map.image).not.toBe(canvas);
  budget.unregister(root);
  expect(map.image).toBe(canvas);
  const version = map.version;
  budget.configure(1024, 4);
  expect(map.version).toBe(version);
  budget.dispose();
  root.geometry.dispose();
  root.material.dispose();
  map.dispose();
});
