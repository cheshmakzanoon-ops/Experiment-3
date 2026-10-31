import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { AssetContainer } from '@babylonjs/core/assetContainer.js';
import * as sceneLoader from '@babylonjs/core/Loading/sceneLoader.js';
import {
  decodeExistingPlayerBytes,
  loadExistingPlayer,
  existingPlayerPrimitiveBindings,
} from '../src/engine/babylon/existing-player.ts';
import {
  existingPlayerPrimitiveSources,
  bindExistingPlayerPrimitives,
  bindExistingPlayerLodRows,
} from '../src/engine/babylon/existing-player-primitives.ts';
import { parsePlayerLods } from '../src/engine/assets/player-lod-data.ts';
import {
  parsePlayerLods as legacyParse,
  loadPlayerLods as legacyLoad,
} from '../src/rendering/supplied-player-lods.ts';
import { loadPlayerLods } from '../src/engine/assets/player-lod-data.ts';

// Default is the real loader with unchanged bytes/options. Only the two
// post-import failure tests replace its result to exercise ownership cleanup.
vi.mock('@babylonjs/core/Loading/sceneLoader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@babylonjs/core/Loading/sceneLoader.js')>();
  return { ...actual, LoadAssetContainerAsync: vi.fn(actual.LoadAssetContainerAsync) };
});

function sameReferences(actual: readonly unknown[], expected: readonly unknown[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBe(expected[index]));
}

describe('actual authored Babylon primitive bindings (NullEngine, not GPU acceptance)', () => {
  let engine: NullEngine, scene: Scene, container: AssetContainer, raw: Uint8Array<ArrayBuffer>;
  const data = parsePlayerLods(
    new Uint8Array(gunzipSync(readFileSync('public/models/supplied-player-lods.bin.gz'))),
  );
  beforeAll(async () => {
    raw = await decodeExistingPlayerBytes(
      new Uint8Array(readFileSync('public/models/supplied-player.glb.gz')),
      new AbortController().signal,
    );
    engine = new NullEngine();
    scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      expect(String(url)).toBe('https://example.invalid/models/supplied-player.glb.gz');
      return new Response(raw);
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      container = await loadExistingPlayer(
        scene,
        'https://example.invalid/',
        new AbortController().signal,
      );
      expect(fetcher).toHaveBeenCalledTimes(1); // No mandatory derivative request.
      expect(fetcher.mock.calls[0][0].toString()).toContain('supplied-player.glb.gz');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  afterAll(() => {
    container?.dispose();
    scene?.dispose();
    engine?.dispose();
  });

  it('retains the old codec exports and joins all real imported primitives to the pinned derivative', () => {
    expect(legacyParse).toBe(parsePlayerLods);
    expect(legacyLoad).toBe(loadPlayerLods);
    const bindings = existingPlayerPrimitiveBindings(container);
    expect(bindings).toHaveLength(172);
    expect(new Set(bindings.map(({ source }) => source.key)).size).toBe(172);
    expect(bindings.filter(({ source }) => source.skin === 0)).toHaveLength(61);
    expect(new Set(bindings.map(({ mesh }) => mesh.material)).size).toBe(101);
    expect(container.textures).toHaveLength(82);
    expect(container.skeletons).toHaveLength(1);
    expect(container.skeletons[0].bones.filter((bone) => bone.getIndex() >= 0)).toHaveLength(58);
    expect(container.skeletons[0].bones).toHaveLength(59); // Includes the retained -1 ancestor.
    const joined = bindExistingPlayerLodRows(bindings, data);
    expect(joined).toHaveLength(172);
    expect(
      joined.every(({ binding, row }) => binding.source.key === `${row.mesh}:${row.primitive}`),
    ).toBe(true);
    expect(joined.reduce((sum, { binding }) => sum + binding.mesh.getTotalIndices() / 3, 0)).toBe(
      1455118,
    );
    expect(Object.isFrozen(bindings)).toBe(true);
    expect(Object.isFrozen(joined)).toBe(true);
    const receipt = bindings.map(({ source }) => [
      source.node,
      source.mesh,
      source.primitive,
      source.material,
      source.indices,
      Object.entries(source.attributes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      source.vertices,
      source.originalCount,
    ]);
    expect(createHash('sha256').update(JSON.stringify(receipt)).digest('hex')).toBe(
      '732400ba6ad1e43e071e08255bd7b3be91bb1004bd0e082a1d8f520f7b451f3e',
    );
  });

  it('retains every actual source vertex ID, attribute value and original index in the imported GLB', () => {
    const length = new DataView(raw.buffer, raw.byteOffset).getUint32(12, true);
    const document = JSON.parse(new TextDecoder().decode(raw.subarray(20, 20 + length))) as {
      meshes: { primitives: { indices: number }[] }[];
      accessors: {
        bufferView: number;
        byteOffset?: number;
        count: number;
        type: string;
        componentType: number;
        normalized?: boolean;
      }[];
      bufferViews: { byteOffset?: number; byteStride?: number }[];
    };
    const values = (id: number) => {
      const accessor = document.accessors[id],
        view = document.bufferViews[accessor.bufferView];
      const widths: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
      const types = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
      const Type = types[accessor.componentType as keyof typeof types];
      expect(Type).toBeDefined();
      expect(accessor.normalized ?? false).toBe(false);
      const stride = widths[accessor.type] * Type.BYTES_PER_ELEMENT;
      expect(view.byteStride ?? stride).toBe(stride);
      return new Type(
        raw.buffer,
        raw.byteOffset + 28 + length + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
        accessor.count * widths[accessor.type],
      );
    };
    const kinds: Record<string, string> = {
      POSITION: 'position',
      NORMAL: 'normal',
      TEXCOORD_0: 'uv',
      JOINTS_0: 'matricesIndices',
      WEIGHTS_0: 'matricesWeights',
    };
    for (const { mesh, source } of existingPlayerPrimitiveBindings(container)) {
      const original = values(document.meshes[source.mesh].primitives[source.primitive].indices);
      const actual = mesh.getIndices()!;
      expect(actual.length).toBe(original.length);
      expect(actual.every((value, index) => value === original[index])).toBe(true);
      for (const [semantic, accessor] of Object.entries(source.attributes)) {
        const original = values(accessor),
          actual = mesh.getVerticesData(kinds[semantic])!;
        expect(actual.length).toBe(original.length);
        expect(actual.every((value, index) => value === original[index])).toBe(true);
      }
    }
  });

  it('does not mutate or allocate model resources, arrays, transforms or animation ownership', () => {
    const before = container.meshes
      .filter((mesh): mesh is Mesh => mesh instanceof Mesh)
      .map((mesh) => ({
        mesh,
        geometry: 'geometry' in mesh ? mesh.geometry : undefined,
        indices: mesh.getIndices(),
        material: mesh.material,
        skeleton: mesh.skeleton,
        parent: mesh.parent,
        submeshes: mesh.subMeshes?.slice(),
        buffers: mesh.getVerticesDataKinds().map((kind) => mesh.getVertexBuffer(kind)),
        position: mesh.position.asArray(),
        rotation: mesh.rotationQuaternion?.asArray(),
        scale: mesh.scaling.asArray(),
      }));
    const resources = [
      container.meshes.slice(),
      container.geometries.slice(),
      container.materials.slice(),
      container.textures.slice(),
      container.skeletons.slice(),
      container.animationGroups.slice(),
    ];
    const sceneResources = [
      scene.meshes.slice(),
      scene.geometries.slice(),
      scene.materials.slice(),
      scene.textures.slice(),
      scene.skeletons.slice(),
      scene.animationGroups.slice(),
    ];
    const bindings = bindExistingPlayerPrimitives(container, existingPlayerPrimitiveSources(raw));
    bindExistingPlayerLodRows(bindings, data);
    [
      container.meshes,
      container.geometries,
      container.materials,
      container.textures,
      container.skeletons,
      container.animationGroups,
    ].forEach((list, index) => sameReferences(list, resources[index]));
    [
      scene.meshes,
      scene.geometries,
      scene.materials,
      scene.textures,
      scene.skeletons,
      scene.animationGroups,
    ].forEach((list, index) => sameReferences(list, sceneResources[index]));
    for (const old of before) {
      const mesh = old.mesh;
      expect('geometry' in mesh ? mesh.geometry : undefined).toBe(old.geometry);
      if (mesh.geometry) expect(mesh.getIndices()).toBe(old.indices);
      else expect(mesh.getIndices()).toEqual([]); // Empty root has no owned index array.
      expect(mesh.material).toBe(old.material);
      expect(mesh.skeleton).toBe(old.skeleton);
      expect(mesh.parent).toBe(old.parent);
      sameReferences(mesh.subMeshes ?? [], old.submeshes ?? []);
      sameReferences(
        mesh.getVerticesDataKinds().map((kind) => mesh.getVertexBuffer(kind)),
        old.buffers,
      );
      expect(mesh.position.asArray()).toEqual(old.position);
      expect(mesh.rotationQuaternion?.asArray()).toEqual(old.rotation);
      expect(mesh.scaling.asArray()).toEqual(old.scale);
    }
  });

  it('fails closed for missing, duplicate and ambiguous primitive pointers', () => {
    const sources = existingPlayerPrimitiveSources(raw),
      mesh = existingPlayerPrimitiveBindings(container)[0].mesh;
    expect(() =>
      bindExistingPlayerPrimitives(
        { ...container, meshes: container.meshes.filter((m) => m !== mesh) },
        sources,
      ),
    ).toThrow('coverage');
    expect(() =>
      bindExistingPlayerPrimitives({ ...container, meshes: [...container.meshes, mesh] }, sources),
    ).toThrow('primitive');
    const metadata = mesh._internalMetadata;
    try {
      mesh._internalMetadata = null;
      expect(() => bindExistingPlayerPrimitives(container, sources)).toThrow('primitive');
      mesh._internalMetadata = {
        gltf: { pointers: ['/meshes/0/primitives/0', '/meshes/0/primitives/1'] },
      };
      expect(() => bindExistingPlayerPrimitives(container, sources)).toThrow('ambiguous');
    } finally {
      mesh._internalMetadata = metadata;
    }
  });

  it('rejects changed material, skin, original counts and derivative correspondence without partial edits', () => {
    const sources = existingPlayerPrimitiveSources(raw),
      bindings = existingPlayerPrimitiveBindings(container);
    const mesh = bindings[0].mesh,
      material = mesh.material,
      skeleton = mesh.skeleton;
    const indices = mesh.getIndices();
    try {
      mesh.material = bindings.find(
        ({ mesh: other }) => other.material !== material,
      )!.mesh.material;
      expect(() => bindExistingPlayerPrimitives(container, sources)).toThrow('material');
      mesh.material = material;
      mesh.skeleton = null;
      expect(() => bindExistingPlayerPrimitives(container, sources)).toThrow('skin');
    } finally {
      mesh.material = material;
      mesh.skeleton = skeleton;
    }
    expect(() =>
      bindExistingPlayerPrimitives(
        container,
        sources.map((source, i) =>
          i ? source : { ...source, originalCount: source.originalCount - 3 },
        ),
      ),
    ).toThrow('primitive');
    const rows = new Map(data.rows),
      row = rows.get(bindings[0].source.key)!;
    rows.set(bindings[0].source.key, { ...row, vertices: row.vertices + 1 });
    expect(() => bindExistingPlayerLodRows(bindings, { ...data, rows })).toThrow('correspondence');
    rows.delete(bindings[0].source.key);
    expect(() => bindExistingPlayerLodRows(bindings, { ...data, rows })).toThrow('coverage');
    expect(mesh.getIndices()).toBe(indices);
    expect(mesh.material).toBe(material);
    expect(mesh.skeleton).toBe(skeleton);
  });

  it('matches source identities independently of imported mesh names and enumeration order', () => {
    const sources = existingPlayerPrimitiveSources(raw),
      original = existingPlayerPrimitiveBindings(container);
    const mesh = original[0].mesh,
      name = mesh.name;
    try {
      mesh.name = 'not a source identifier';
      const reordered = bindExistingPlayerPrimitives(
        { ...container, meshes: [...container.meshes].reverse() },
        sources,
      );
      reordered.forEach((binding, index) => expect(binding.mesh).toBe(original[index].mesh));
    } finally {
      mesh.name = name;
    }
  });

  it('rejects a changed joint palette without changing skeleton or animation targets', () => {
    const sources = existingPlayerPrimitiveSources(raw);
    const bone = container.skeletons[0].bones.find((bone) => bone.getIndex() === 0)!;
    const node = bone.getTransformNode()!,
      metadata = node._internalMetadata;
    try {
      node._internalMetadata = { gltf: { pointers: ['/nodes/0'] } };
      expect(() => bindExistingPlayerPrimitives(container, sources)).toThrow('joint palette');
    } finally {
      node._internalMetadata = metadata;
    }
    expect(existingPlayerPrimitiveBindings(container)[0].mesh.skeleton).toBe(
      container.skeletons[0],
    );
  });

  it('disposes an unpublished failed import and retains its validation error when cleanup also fails', async () => {
    const rejected = new AssetContainer(scene);
    const dispose = vi.spyOn(rejected, 'dispose');
    vi.mocked(sceneLoader.LoadAssetContainerAsync)
      .mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(rejected);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response(raw)),
    );
    try {
      await expect(
        loadExistingPlayer(scene, 'https://example.invalid/', new AbortController().signal),
      ).rejects.toThrow('binding inventory');
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(() => existingPlayerPrimitiveBindings(rejected)).toThrow('unavailable');
      dispose.mockImplementationOnce(() => {
        throw new Error('cleanup fault');
      });
      await expect(
        loadExistingPlayer(scene, 'https://example.invalid/', new AbortController().signal),
      ).rejects.toThrow('binding inventory');
      expect(logged).toHaveBeenCalledWith(
        'Existing player cleanup failed:',
        expect.objectContaining({ message: 'cleanup fault' }),
      );
    } finally {
      dispose.mockRestore();
      logged.mockRestore();
      vi.unstubAllGlobals();
      rejected.dispose();
    }
  });

  it('disposes an unpublished import cancelled while the loader was running', async () => {
    const rejected = new AssetContainer(scene),
      abort = new AbortController();
    const dispose = vi.spyOn(rejected, 'dispose');
    vi.mocked(sceneLoader.LoadAssetContainerAsync).mockImplementationOnce(async () => {
      abort.abort();
      return rejected;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response(raw)),
    );
    try {
      await expect(
        loadExistingPlayer(scene, 'https://example.invalid/', abort.signal),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(() => existingPlayerPrimitiveBindings(rejected)).toThrow('unavailable');
    } finally {
      dispose.mockRestore();
      vi.unstubAllGlobals();
      rejected.dispose();
    }
  });
});
