import * as T from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { ScanStore, scannedGround } from '../src/rendering/ground/scan-store.ts';
import { installScannedMaps } from '../src/rendering/ground/scanned-ground.ts';
import { disposeSceneTexture } from '../src/rendering/assets/texture-source-ownership.ts';
import {
  disposeTextureLoaders,
  loadPbrSet,
  type PbrSet,
} from '../src/rendering/assets/texture-loader.ts';

class Bitmap {
  width = 2;
  height = 2;
  close = vi.fn(() => {
    this.width = 0;
    this.height = 0;
  });
}

function set() {
  const images = [new Bitmap(), new Bitmap(), new Bitmap()];
  const [map, normalMap, orm] = images.map((image) => new T.Texture(image));
  const maps = { map, normalMap, roughnessMap: orm, metalnessMap: orm, aoMap: orm };
  const pbr: PbrSet = {
    id: 'ground-concrete',
    metres: 2,
    maps,
    formats: { color: 'webp', normal: 'webp', orm: 'webp' },
    dispose() {
      for (const texture of new Set(Object.values(maps))) texture.dispose();
    },
  };
  return { pbr, images, textures: [map, normalMap, orm] };
}

/** Invoke the production renderer teardown. Only unrelated pass owners are
 * inert; the scene, materials, textures and their disposal events are real. */
function owner(...materials: T.Material[]) {
  const renderer = Object.create(RacingRenderer.prototype) as RacingRenderer;
  const inert = () => ({ dispose: vi.fn() });
  const owners = Object.fromEntries(
    [
      'renderer',
      'textures',
      'pitCrew',
      'gridPerformance',
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
  Object.assign(renderer, owners, {
    circuit: {
      disposePlanting() {},
      secondaryStands: inert(),
      wetReflection: inert(),
      stateTexture: new T.DataTexture(new Uint8Array(4), 1, 1),
      disposalMaterials: () => new Set<T.Material>(),
    },
    scene: new T.Scene().add(
      ...materials.map((material) => new T.Mesh(new T.PlaneGeometry(), material)),
    ),
    sun: new T.DirectionalLight(),
    cars: [],
  });
  return renderer;
}

beforeEach(() => {
  vi.stubGlobal('ImageBitmap', Bitmap);
  scannedGround.setPreset('high');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('scene GPU handles and retained decoded image ownership', () => {
  it('keeps real scanned-map clones usable through three production renderer teardowns', () => {
    const source = set(),
      baseline = scannedGround.diagnostics().materials;
    scannedGround.adopt('concrete', source.pbr);
    const sourceDisposals = source.textures.map((texture) => vi.spyOn(texture, 'dispose'));
    for (let cycle = 0; cycle < 3; cycle++) {
      const material = new T.MeshStandardMaterial();
      installScannedMaps(material, 'concrete', [0.3, 0.3, 0.3]);
      const clones = [material.map!, material.normalMap!, material.roughnessMap!];
      clones.forEach((texture, index) => {
        expect(texture).not.toBe(source.textures[index]);
        expect(texture.source).toBe(source.textures[index].source);
        expect(texture.image.width).toBe(2);
      });
      const disposals = clones.map((texture) => vi.spyOn(texture, 'dispose'));
      const renderer = owner(material);
      renderer.dispose();
      renderer.dispose();
      for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
      for (const image of source.images) {
        expect(image.close).not.toHaveBeenCalled();
        expect([image.width, image.height]).toEqual([2, 2]);
      }
      for (const dispose of sourceDisposals) expect(dispose).not.toHaveBeenCalled();
      expect(scannedGround.diagnostics().materials).toBe(baseline);
      expect(scannedGround.uniforms.concrete.color.value).toBe(source.pbr.maps.map);
    }
  });

  it('protects retained pixels even when a separate Three.Source wraps the same bitmap', () => {
    const store = new ScanStore(),
      source = set();
    store.adopt('concrete', source.pbr);
    const alias = new T.Texture(source.images[0]);
    expect(alias.source).not.toBe(source.textures[0].source);
    const dispose = vi.spyOn(alias, 'dispose');
    disposeSceneTexture(alias);
    expect(dispose).toHaveBeenCalledOnce();
    expect(source.images[0].close).not.toHaveBeenCalled();
  });

  it('protects decoded loader-cache sources before they are adopted by a ground store', async () => {
    vi.stubGlobal('document', {});
    const sources = [new Bitmap(), new Bitmap(), new Bitmap()].map((image) => new T.Texture(image));
    const load = vi.spyOn(T.TextureLoader.prototype, 'loadAsync');
    for (const source of sources) load.mockResolvedValueOnce(source);
    const renderer = {
      capabilities: { isWebGL2: false, getMaxAnisotropy: () => 8 },
    } as T.WebGLRenderer;
    const first = await loadPbrSet(renderer, 'sandy-gravel-01', { prefer: 'webp' }),
      second = await loadPbrSet(renderer, 'sandy-gravel-01', { prefer: 'webp' });
    expect(load).toHaveBeenCalledTimes(3);
    expect(first.maps.map!.source).toBe(second.maps.map!.source);
    for (const texture of new Set(Object.values(first.maps)))
      if (texture) disposeSceneTexture(texture);
    await disposeTextureLoaders(renderer);
    for (const source of sources) expect(source.image.close).not.toHaveBeenCalled();
    expect(second.maps.map!.image.width).toBe(2);
    second.dispose();
  });

  it('closes exclusive bitmap storage once while releasing every aliased texture handle', () => {
    const image = new Bitmap(),
      first = new T.Texture(image),
      clone = first.clone(),
      separateSource = new T.Texture(image);
    const textures = [first, clone, separateSource],
      disposals = textures.map((texture) => vi.spyOn(texture, 'dispose'));
    const renderer = owner(
      new T.MeshStandardMaterial({ map: first, normalMap: clone, roughnessMap: first }),
      new T.MeshBasicMaterial({ map: separateSource }),
    );
    renderer.dispose();
    renderer.dispose();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    expect(image.close).toHaveBeenCalledOnce();
    expect([image.width, image.height]).toEqual([0, 0]);
  });

  it('does not revoke older clones when a scan layer is replaced or a renderer detached', () => {
    const store = new ScanStore(),
      old = set(),
      replacement = set(),
      renderer = {} as T.WebGLRenderer;
    store.adopt('concrete', old.pbr);
    const oldClone = old.textures[0].clone();
    store.attach(renderer, 'high');
    store.adopt('concrete', replacement.pbr);
    store.detach(renderer);
    disposeSceneTexture(oldClone);
    disposeSceneTexture(replacement.textures[0].clone());
    expect(old.images[0].close).not.toHaveBeenCalled();
    expect(replacement.images[0].close).not.toHaveBeenCalled();
    expect(store.uniforms.concrete.color.value).toBe(replacement.textures[0]);
  });

  it('rejects an invalid scan before retaining a bitmap that belongs to its failed owner', () => {
    const store = new ScanStore(),
      source = set();
    source.pbr.maps.normalMap = null;
    expect(() => store.adopt('concrete', source.pbr)).toThrow('colour or normal missing');
    disposeSceneTexture(source.textures[0]);
    expect(source.images[0].close).toHaveBeenCalledOnce();
  });

  it('disposes non-bitmap handles without assuming a browser image API or closing duck types', () => {
    vi.stubGlobal('ImageBitmap', undefined);
    const duck = { width: 1, height: 1, close: vi.fn() },
      texture = new T.Texture(duck),
      dispose = vi.spyOn(texture, 'dispose');
    disposeSceneTexture(texture);
    expect(dispose).toHaveBeenCalledOnce();
    expect(duck.close).not.toHaveBeenCalled();
  });
});
