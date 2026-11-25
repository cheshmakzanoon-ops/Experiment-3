import * as T from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { BikeShells } from '../src/rendering/bike.ts';
import { scannedGround } from '../src/rendering/ground/scan-store.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { setMxQuality } from '../src/rendering/offroad/mx-quality.ts';
import { BuildQueue } from '../src/rendering/build-queue.ts';
import { OffroadScene } from '../src/rendering/offroad/index.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { Roost } from '../src/rendering/offroad/roost.ts';
import { disposeOffroadResources } from '../src/rendering/offroad/owned-resources.ts';
import { textures as proceduralTextures } from '../src/rendering/materials/library.ts';
import type { TerrainRenderDelta } from '../src/simulation/offroad/course-terrain.ts';

function ownedResources(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>(),
    instances = new Set<T.InstancedMesh>();
  root.traverse((object) => {
    if (!(object instanceof T.Mesh || object instanceof T.Points || object instanceof T.Line))
      return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      materials.add(material);
    if (object instanceof T.Mesh) {
      if (object.customDepthMaterial) materials.add(object.customDepthMaterial);
      if (object.customDistanceMaterial) materials.add(object.customDistanceMaterial);
    }
    if (object instanceof T.InstancedMesh) instances.add(object);
  });
  for (const material of materials)
    for (const value of Object.values(material))
      if (value instanceof T.Texture) textures.add(value);
  return { geometries, materials, textures, instances };
}

function watchResources(root: T.Object3D) {
  const resources: {
    name: string;
    addEventListener(type: 'dispose', listener: () => void): void;
  }[] = Object.values(ownedResources(root)).flatMap((owned) => [...owned]);
  return resources.map((resource) => {
    const disposed = vi.fn().mockName(`${resource.constructor.name}: ${resource.name}`);
    resource.addEventListener('dispose', disposed);
    return disposed;
  });
}

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

/** Run the real renderer teardown with a real constructed venue and scene.
 * GPU pass owners are inert: no WebGL context is needed to observe resource
 * dispose events or the global scanned-ground registration lifecycle. */
function rendererOwner(circuit: CircuitScene) {
  const renderer = Object.create(RacingRenderer.prototype) as RacingRenderer;
  const owners = Object.fromEntries(
    [
      'renderer',
      'textures',
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
      'outputPass',
      'fxaa',
      'scenePass',
      'grade',
      'ultra',
      'environment',
      'composer',
    ].map((key) => [key, { dispose: vi.fn() }]),
  );
  const sun = new T.DirectionalLight();
  sun.shadow.map = new T.WebGLRenderTarget(16, 16);
  sun.shadow.mapPass = new T.WebGLRenderTarget(8, 8);
  Object.assign(renderer, owners, {
    circuit,
    scene: new T.Scene().add(circuit.group, sun),
    sun,
    cars: [],
    bikeShells: new BikeShells(),
  });
  return { renderer, sun, outputPass: owners.outputPass };
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  const texture = () => new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  // Feed the real shared store a resident set without requesting a decoder
  // or WebGL context. Closing either venue must retain these shared images.
  scannedGround.adopt('wetEarth', {
    id: 'ground-wet-earth',
    metres: 2,
    maps: {
      map: texture(),
      normalMap: texture(),
      roughnessMap: texture(),
      metalnessMap: null,
      aoMap: null,
    },
    formats: { color: 'ktx2', normal: 'ktx2', orm: 'ktx2' },
    dispose() {},
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('complete terrain-venue resource ownership', () => {
  it('cancels detached meadow work when the real renderer is torn down during preparation', async () => {
    setMxQuality('medium');
    const circuit = new CircuitScene(rigTrack('valley-ridge-mx'), true);
    const { renderer, outputPass } = rendererOwner(circuit);
    const meadow = circuit.offroad!.meadow!;
    const instances = vi.spyOn(T.InstancedMesh.prototype, 'dispose');
    let signal!: () => void,
      resume!: () => void,
      postSampling = 0;
    const staged = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const pending = meadow.prepareQuality(
      'high',
      () => false,
      async () => {
        if (meadow.stats.candidates !== 58000 || ++postSampling < 2) return;
        signal();
        await new Promise<void>((resolve) => {
          resume = resolve;
        });
      },
    );
    try {
      await staged;
      expect(meadow.root.children).toHaveLength(0);
      renderer.dispose();
      expect(outputPass.dispose).toHaveBeenCalledOnce();
      const released = instances.mock.contexts.filter(
        (object) => object instanceof T.InstancedMesh && object.name.startsWith('MX field grass '),
      );
      expect(released).toHaveLength(1);
      resume();
      expect(await pending).toBe(false);
      expect(meadow.stats.clumps).toBe(0);
      setMxQuality('high');
      expect(meadow.root.visible).toBe(false);
      expect(meadow.root.children).toHaveLength(0);
    } finally {
      resume?.();
      renderer.dispose();
      setMxQuality('high');
    }
  });

  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s releases unused palette registrations, textures and both main-shadow targets once',
    async (id) => {
      setMxQuality('high');
      const baseline = scannedGround.diagnostics().materials;
      const register = vi.spyOn(scannedGround, 'register');
      const circuit = new CircuitScene(rigTrack(id));
      const attached = new Set<T.Material>();
      circuit.group.traverse((object) => {
        if (object instanceof T.Mesh || object instanceof T.Points || object instanceof T.Line)
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            attached.add(material);
      });
      const registered = new Set(register.mock.calls.map(([material]) => material));
      const orphaned = [...registered].filter((material) => !attached.has(material));
      // Negative control: scene traversal alone misses actual, registered
      // templates. The renderer must include their owner palette explicitly.
      expect(orphaned.length).toBeGreaterThan(0);
      const owned = circuit.disposalMaterials();
      for (const material of orphaned) expect(owned.has(material)).toBe(true);
      const orphanDisposals = orphaned.map((material) => vi.spyOn(material, 'dispose'));

      // Unused facade templates also own image maps even if no scanned hook
      // is installed on them. Verify cleanup covers their texture resources.
      const unusedTextures = new Set<T.Texture>();
      for (const material of owned)
        if (!attached.has(material))
          for (const value of Object.values(material))
            if (value instanceof T.Texture) unusedTextures.add(value);
      expect(unusedTextures.size).toBeGreaterThan(0);
      const textureDisposals = [...unusedTextures].map((texture) => vi.spyOn(texture, 'dispose'));
      const residentBefore = scannedGround.diagnostics().resident;
      const sharedMaps = Object.values(scannedGround.uniforms)
        .flatMap((layer) => [layer.color.value, layer.normal.value, layer.orm.value])
        .filter((texture): texture is T.Texture => texture instanceof T.Texture);
      expect(sharedMaps).toHaveLength(3);
      const sharedDisposals = [...new Set(sharedMaps)].map((texture) =>
        vi.spyOn(texture, 'dispose'),
      );
      const { renderer, sun, outputPass } = rendererOwner(circuit);
      const offroad = circuit.offroad!;
      const venueDisposals = watchResources(offroad.group);
      const ownedObjects: T.Object3D[] = [];
      offroad.group.traverse((object) => ownedObjects.push(object));
      const closeVenue = vi.spyOn(offroad, 'dispose');
      const meadow = circuit.offroad?.meadow;
      const meadowDisposals: ReturnType<typeof vi.spyOn>[] = [];
      if (meadow) {
        expect(meadow.stats.clumps).toBeGreaterThan(2000);
        const first = meadow.root.children[0].children[0] as T.InstancedMesh;
        meadowDisposals.push(
          vi.spyOn(first, 'dispose'),
          vi.spyOn(first.geometry, 'dispose'),
          vi.spyOn(first.material as T.Material, 'dispose'),
        );
      }
      const shadow = vi.spyOn(sun.shadow.map!, 'dispose');
      const shadowPass = vi.spyOn(sun.shadow.mapPass!, 'dispose');

      renderer.dispose();
      expect(outputPass.dispose).toHaveBeenCalledOnce();
      expect(closeVenue).toHaveBeenCalledOnce();
      expect(offroad.group.parent).toBeNull();
      expect(offroad.group.children).toHaveLength(0);
      for (const dispose of venueDisposals) expect(dispose).toHaveBeenCalledOnce();
      // Keep references to the destroyed meshes. A retained quality listener
      // would still mutate their counts/visibility despite an empty root.
      const closedState = ownedObjects.map((object) => ({
        object,
        visible: object.visible,
        count: object instanceof T.InstancedMesh ? object.count : null,
      }));
      for (const quality of ['low', 'medium', 'high', 'ultra'] as const) {
        setMxQuality(quality);
        for (const { object, visible, count } of closedState) {
          expect(object.visible, object.name).toBe(visible);
          if (object instanceof T.InstancedMesh) expect(object.count, object.name).toBe(count);
        }
      }
      expect(scannedGround.diagnostics().materials).toBe(baseline);
      expect(scannedGround.diagnostics().resident).toEqual(residentBefore);
      for (const dispose of orphanDisposals) expect(dispose).toHaveBeenCalledTimes(1);
      for (const dispose of textureDisposals) expect(dispose).toHaveBeenCalledTimes(1);
      for (const dispose of sharedDisposals) expect(dispose).not.toHaveBeenCalled();
      expect(shadow).toHaveBeenCalledTimes(1);
      expect(shadowPass).toHaveBeenCalledTimes(1);
      if (meadow) {
        expect(meadow.stats.clumps).toBe(0);
        expect(meadow.root.children).toHaveLength(0);
        setMxQuality('medium');
        setMxQuality('high');
        expect(meadow.root.visible).toBe(false);
        expect(
          await meadow.prepareQuality(
            'high',
            () => false,
            async () => {},
          ),
        ).toBe(false);
        for (const dispose of meadowDisposals) expect(dispose).toHaveBeenCalledOnce();
      }

      renderer.dispose();
      offroad.dispose();
      expect(outputPass.dispose).toHaveBeenCalledOnce();
      for (const dispose of venueDisposals) expect(dispose).toHaveBeenCalledOnce();
      for (const dispose of orphanDisposals) expect(dispose).toHaveBeenCalledTimes(1);
      expect(shadow).toHaveBeenCalledTimes(1);
      expect(shadowPass).toHaveBeenCalledTimes(1);
      for (const dispose of meadowDisposals) expect(dispose).toHaveBeenCalledOnce();
    },
    120000,
  );

  it('does not reconstruct an offroad venue when an already-running queue resumes after disposal', async () => {
    setMxQuality('high');
    const queue = new BuildQueue(),
      world = new OffroadScene(rigTrack('valley-ridge-mx'), queue),
      parent = new T.Group().add(world.group),
      disposals = watchResources(world.group);
    let yields = 0;
    expect(
      await queue.run(
        () => {},
        () => false,
        async () => {
          if (++yields === 1) world.dispose();
        },
      ),
    ).toBe(true);
    // The caller deliberately did not cancel its queue; its callbacks really
    // ran, and the disposed venue still must not allocate or subscribe again.
    expect(queue.statistics.tasks).toBeGreaterThan(200);
    expect(world.terrain).toBeNull();
    expect(world.gate).toBeNull();
    expect(world.dressing).toBeNull();
    expect(world.spectators).toBeNull();
    expect(world.landmarks).toBeNull();
    expect(world.looseSoil).toBeNull();
    expect(world.meadow!.stats.clumps).toBe(0);
    expect(parent.children).toHaveLength(0);
    expect(world.group.children).toHaveLength(0);
    for (const quality of ['low', 'high'] as const) setMxQuality(quality);
    expect(world.meadow!.root.visible).toBe(false);
    expect(
      await world.prepareQuality(
        'high',
        () => false,
        async () => {},
      ),
    ).toBe(false);
    world.dispose();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it('releases the completed owners when a terrain keyframe fails during construction', () => {
    setMxQuality('medium');
    const baseline = proceduralTextures.diagnostics().clones,
      queue = new BuildQueue(),
      world = new OffroadScene(rigTrack('valley-ridge-mx'), queue),
      parent = new T.Group().add(world.group);
    const failure = new Error('Invalid queued terrain keyframe');
    let disposals: ReturnType<typeof watchResources> = [];
    vi.spyOn(TerrainView.prototype, 'record').mockImplementation(() => {
      disposals = watchResources(world.group);
      throw failure;
    });
    world.record({ reset: true } as TerrainRenderDelta, 0, true);
    expect(() => queue.runSynchronously()).toThrow(failure);
    expect(disposals.length).toBeGreaterThan(30);
    expect(parent.children).toHaveLength(0);
    expect(world.group.children).toHaveLength(0);
    expect(world.roost.groundHeight).toBeNull();
    expect(proceduralTextures.diagnostics().clones).toBe(baseline);
    world.record({ reset: true } as TerrainRenderDelta, 1, true);
    world.showAt(0);
    world.update(new Float32Array(0));
    world.dispose();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    setMxQuality('high');
    expect(world.meadow!.root.visible).toBe(false);
  });

  it('releases immediate resources if construction cannot be queued', () => {
    const queue = new BuildQueue();
    queue.runSynchronously();
    const dispose = vi.spyOn(Roost.prototype, 'dispose');
    expect(() => new OffroadScene(rigTrack('arena-nord-sx'), queue)).toThrow(
      'Cannot extend a running construction queue',
    );
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('releases a scan clone once without releasing its source or shader-uniform maps', () => {
    const source = new T.DataTexture(new Uint8Array([1, 2, 3, 255]), 1, 1),
      clone = source.clone(),
      material = new T.MeshStandardMaterial({ map: clone, roughnessMap: clone }),
      depth = new T.MeshDepthMaterial(),
      geometry = new T.BoxGeometry(),
      mesh = new T.InstancedMesh(geometry, material, 2),
      root = new T.Group().add(mesh),
      parent = new T.Group().add(root);
    mesh.customDepthMaterial = depth;
    material.userData.sharedUniforms = { scannedAlbedo: { value: source } };
    const sourceDispose = vi.spyOn(source, 'dispose'),
      cloneDispose = vi.spyOn(clone, 'dispose'),
      depthDispose = vi.spyOn(depth, 'dispose'),
      instanceDispose = vi.spyOn(mesh, 'dispose');
    expect(clone.source).toBe(source.source);
    disposeOffroadResources([root], [material], [clone], [geometry]);
    expect(parent.children).toHaveLength(0);
    expect(root.children).toHaveLength(0);
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(cloneDispose).toHaveBeenCalledOnce();
    expect(depthDispose).toHaveBeenCalledOnce();
    expect(instanceDispose).toHaveBeenCalledOnce();
    expect(source.image.data).toEqual(new Uint8Array([1, 2, 3, 255]));
    source.dispose();
  });
});
