import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import {
  loadBabylonSecondBrakingTriplet,
  loadBabylonBrakingTriplet,
  validateBrakingTripletBytes,
  type BabylonBrakingTripletOptions,
} from '../src/engine/babylon/braking-triplet.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { grassApronOffset } from '../src/rendering/ground-profile.ts';
import { distanceBoardLabel } from '../src/rendering/studio/branding-plan.ts';
import {
  a09Bytes,
  a09SyntheticPixels,
  allocateA09Texture,
  installA09CanvasFixture,
  originalA09Triplet,
} from './fixtures/a09-triplet-original.ts';

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const ASSET_SHA = '5a2886f0454fafafc85de772e272eb26ace69722e714ecde2d3da6a983ee1555';
interface RawDocument {
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: {
    name?: string;
    children?: number[];
    mesh?: number;
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes: {
    primitives: { attributes: Record<string, number>; indices: number; material: number }[];
  }[];
  accessors: {
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    sparse?: unknown;
    normalized?: boolean;
  }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  materials: {
    name: string;
    doubleSided: boolean;
    normalTexture: { index: number; scale: number };
    occlusionTexture?: unknown;
    pbrMetallicRoughness: {
      baseColorTexture: { index: number };
      metallicRoughnessTexture: { index: number };
    };
  }[];
  textures: { source: number }[];
  samplers: { magFilter: number; minFilter: number; wrapS: number; wrapT: number }[];
  images: { bufferView: number; mimeType: string; name: string }[];
}
/** Independent GLB byte/accessor walk. Does not call either renderer's loader,
 * the candidate validator, or the candidate geometry conversion. */
function rawOriginal(variant: 'clean' | 'worn' = 'worn') {
  const raw = Buffer.from(a09Bytes()),
    jsonLength = raw.readUInt32LE(12);
  const doc = JSON.parse(raw.subarray(20, 20 + jsonLength).toString()) as RawDocument;
  const bin = raw.subarray(28 + jsonLength),
    data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const accessor = (index: number) => {
    const a = doc.accessors[index],
      view = doc.bufferViews[a.bufferView];
    expect(a.sparse).toBeUndefined();
    expect(a.normalized).not.toBe(true);
    const components = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type];
    const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : 2;
    expect([5123, 5125, 5126]).toContain(a.componentType);
    const result: number[] = [];
    for (let i = 0; i < a.count; i++)
      for (let j = 0; j < components; j++) {
        const offset =
          (view.byteOffset ?? 0) +
          (a.byteOffset ?? 0) +
          i * (view.byteStride ?? components * size) +
          j * size;
        result.push(
          a.componentType === 5126
            ? data.getFloat32(offset, true)
            : a.componentType === 5125
              ? data.getUint32(offset, true)
              : data.getUint16(offset, true),
        );
      }
    return result;
  };
  const worlds = new Map<number, T.Matrix4>();
  const walk = (index: number, parent: T.Matrix4) => {
    const n = doc.nodes[index],
      local = n.matrix
        ? new T.Matrix4().fromArray(n.matrix)
        : new T.Matrix4().compose(
            new T.Vector3().fromArray(n.translation ?? [0, 0, 0]),
            new T.Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]),
            new T.Vector3().fromArray(n.scale ?? [1, 1, 1]),
          );
    const world = parent.clone().multiply(local);
    worlds.set(index, world);
    for (const child of n.children ?? []) walk(child, world);
  };
  for (const root of doc.scenes[doc.scene ?? 0].nodes) walk(root, new T.Matrix4());
  const index = doc.nodes.findIndex((n) => n.name === `A09_${variant.toUpperCase()}_LOD0_SURFACES`),
    node = doc.nodes[index],
    primitive = doc.meshes[node.mesh!].primitives[0];
  const geometry = new T.BufferGeometry();
  for (const [gltf, name, size] of [
    ['POSITION', 'position', 3],
    ['NORMAL', 'normal', 3],
    ['TEXCOORD_0', 'uv', 2],
  ] as const)
    geometry.setAttribute(
      name,
      new T.Float32BufferAttribute(accessor(primitive.attributes[gltf]), size),
    );
  geometry.setIndex(accessor(primitive.indices));
  geometry.applyMatrix4(worlds.get(index)!);
  return { raw, doc, bin, geometry, world: worlds.get(index)! };
}
/** Select only the original kit's second LOD0 groups. No candidate placement or
 * geometry helpers are used; the existing helper constructs the untouched kit. */
async function originalSecondTriplet(track: Track) {
  const original = await originalA09Triplet(track);
  const parts: typeof original.parts = [];
  for (const [station, text] of [
    [1020, '150'],
    [1070, '100'],
    [1120, '50'],
  ] as const) {
    const group = original.kit.root.getObjectByName(`A09 ${text} ${station}m LOD0`);
    if (!group) throw new Error('Original second triplet missing');
    for (const child of group.children)
      if (child instanceof T.Mesh)
        parts.push({
          mesh: child,
          text,
          station,
          kind: child.name.endsWith('structure') ? 'structure' : 'print',
        });
  }
  return { ...original, parts };
}
const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.unstubAllGlobals();
});
function harness() {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  engine.getCaps().supportSRGBBuffers = true;
  const canvas = installA09CanvasFixture(),
    track = new Track();
  cleanup.push(() => {
    scene.dispose();
    engine.dispose();
  });
  const options: BabylonBrakingTripletOptions = {
    scene,
    track,
    base: 'https://example.invalid/',
    context: {
      presentation: 'circuit',
      vehicles: [{ classId: 'formula', dynamicsKind: 'four-wheel' }],
    },
    signal: new AbortController().signal,
    deadline: performance.now() + 120000,
    isCurrent: () => true,
    schedule: new PresentationSchedule(),
    gpu: {
      prepare: async (
        _label: string,
        _deadline: number,
        work: (signal: AbortSignal) => Promise<unknown>,
      ) => work(new AbortController().signal),
    } as unknown as BabylonBrakingTripletOptions['gpu'],
  };
  const load = () =>
    loadBabylonSecondBrakingTriplet(options, {
      fetcher: async () => new Response(a09Bytes()),
      allocateTexture: allocateA09Texture,
      prepare: async () => {},
      present: async () => {},
    });
  return { engine, scene, canvas, track, options, load };
}
it('pins untouched A09 bytes and independent original construction/print sources', () => {
  const expected: Record<string, string> = {
    'src/rendering/track-boards.ts':
      'a721839b06187f91a940d316de8785f53d2e93d5789547ca1a575d6679016750',
    'src/rendering/track-board-plan.ts':
      'cb437c9444b3d644c8aa64312c644654d92a86943b803f35698dbce715b36e7c',
    'src/rendering/track-boards.manifest.json':
      'e30b1ba4fe9b1bbd64d21b1ed8e1030cacfdcd88aebfb95761029860c9fe7559',
    'src/rendering/studio/branding-plan.ts':
      'b9dd6915f7fd08373f8479f575d0308ecaaffc5582025fe5ada7f823c3fc4bbd',
    'src/rendering/studio/brand-atlas.ts':
      'dca85756467bfc3420acb61a5cba7592dd7b988d60152a6d01dcd5fd5ef817e6',
  };
  for (const [path, hash] of Object.entries(expected))
    expect(sha(readFileSync(path)), path).toBe(hash);
  expect(a09Bytes()).toHaveLength(676084);
  expect(sha(a09Bytes())).toBe(ASSET_SHA);
});
it('rejects corrupt and truncated immutable bytes before decode', async () => {
  const signal = new AbortController().signal;
  await expect(validateBrakingTripletBytes(a09Bytes(), signal)).resolves.toBeUndefined();
  const corrupt = a09Bytes();
  corrupt[corrupt.length - 1] ^= 1;
  await expect(validateBrakingTripletBytes(corrupt, signal)).rejects.toThrow();
  await expect(validateBrakingTripletBytes(a09Bytes().slice(0, -1), signal)).rejects.toThrow();
});
it('independently decodes raw accessors/node matrices and verifies the original worn LOD0 template and second-triplet placement', async () => {
  const original = rawOriginal(),
    reference = await originalSecondTriplet(new Track());
  cleanup.push(() => {
    original.geometry.dispose();
    reference.dispose();
  });
  const template = reference.kit.templates.get('worn:0')!;
  expect(template).toHaveLength(1);
  expect(original.geometry.index!.count / 3).toBe(1692);
  expect(original.world.determinant()).toBeGreaterThan(0);
  expect(Array.from(template[0].geometry.index!.array)).toEqual(
    Array.from(original.geometry.index!.array),
  );
  for (const key of ['position', 'normal', 'uv'])
    expect(Array.from(template[0].geometry.getAttribute(key).array)).toEqual(
      Array.from(original.geometry.getAttribute(key).array),
    );
  const sites = reference.kit.sites
    .filter((s) => [1020, 1070, 1120].includes(s.s))
    .sort((a, b) => a.s - b.s);
  expect(sites.map((s) => [s.text, s.s, s.lateral, s.variant])).toEqual([
    ['150', 1020, -18, 'worn'],
    ['100', 1070, -18, 'clean'],
    ['50', 1120, -18, 'clean'],
  ]);
  expect(reference.parts).toHaveLength(6);
  expect(reference.parts.reduce((sum, p) => sum + p.mesh.geometry.index!.count / 3, 0)).toBe(4994);
});
it('matches every original second-triplet vertex/index/normal/UV and planted foot world coordinate', async () => {
  const h = harness(),
    reference = await originalSecondTriplet(h.track),
    owner = await h.load(),
    raw = rawOriginal(),
    clean = rawOriginal('clean');
  cleanup.push(() => {
    owner.dispose();
    reference.dispose();
    raw.geometry.dispose();
    clean.geometry.dispose();
  });
  const d = owner.diagnostics();
  expect(d.parts).toHaveLength(6);
  for (const part of d.parts) {
    const expected = reference.parts.find(
      (p) => p.station === part.station && p.kind === part.kind,
    )!;
    expect(expected.text).toBe(part.text);
    expect(Array.from(part.mesh.getIndices()!)).toEqual(
      Array.from(expected.mesh.geometry.index!.array),
    );
    for (const key of ['position', 'normal', 'uv'])
      expect(Array.from(part.mesh.getVerticesData(key)!)).toEqual(
        Array.from(expected.mesh.geometry.getAttribute(key).array),
      );
    expect(Array.from(part.mesh.worldMatrixFromCache.m)).toEqual(
      expected.mesh.matrixWorld.elements,
    );
    expect(h.scene.meshes).not.toContain(part.mesh);
    if (part.kind === 'print') {
      expect(expected.mesh.material.side).toBe(T.FrontSide);
      expect(expected.mesh.material.polygonOffset).toBe(true);
      expect([
        expected.mesh.material.polygonOffsetFactor,
        expected.mesh.material.polygonOffsetUnits,
      ]).toEqual([-1, -1]);
      const position = expected.mesh.geometry.getAttribute('position');
      const normal = expected.mesh.geometry.getAttribute('normal');
      const indices = expected.mesh.geometry.index!;
      for (let i = 0; i < indices.count; i += 3) {
        const a = new T.Vector3().fromBufferAttribute(position, indices.getX(i));
        const b = new T.Vector3().fromBufferAttribute(position, indices.getX(i + 1));
        const c = new T.Vector3().fromBufferAttribute(position, indices.getX(i + 2));
        expect(
          b
            .sub(a)
            .cross(c.sub(a))
            .dot(new T.Vector3().fromBufferAttribute(normal, indices.getX(i))),
        ).toBeGreaterThan(0);
      }
    }
    if (part.kind === 'structure') {
      const site = reference.kit.sites.find((s) => s.s === part.station)!,
        matrix = new T.Matrix4().makeRotationY(site.yaw).setPosition(site.x, site.y, site.z);
      const source = (part.station === 1020 ? raw : clean).geometry.getAttribute('position'),
        actual = part.mesh.getVerticesData('position')!;
      let feet = 0;
      for (let i = 0; i < source.count; i++)
        if (source.getY(i) < 0) {
          const p = new T.Vector3().fromBufferAttribute(source, i).applyMatrix4(matrix),
            q = trackPoint(),
            lateral = h.track.nearest(Math.fround(p.x), Math.fround(p.z), q);
          const ground =
            q.y +
            q.bank * Math.max(-12, Math.min(12, lateral)) +
            grassApronOffset(h.track, q.s, lateral);
          expect(actual[i * 3 + 1]).toBe(Math.fround(Math.min(Math.fround(p.y), ground - 0.02)));
          feet++;
        }
      expect(feet).toBeGreaterThan(0);
    }
  }
  await owner.install();
  expect(d.parts.every((p) => h.scene.meshes.includes(p.mesh) && p.mesh.isEnabled())).toBe(true);
  expect(h.scene.lights).toHaveLength(0);
  expect(h.scene.environmentTexture).toBeNull();
});
it('retains actual native GLTF atlas ownership, raw PBR roles, and original print-facing/depth bias', async () => {
  const h = harness(),
    raw = rawOriginal();
  let native: PBRMaterial | undefined;
  const owner = await loadBabylonSecondBrakingTriplet(h.options, {
    fetcher: async () => new Response(a09Bytes()),
    allocateTexture: allocateA09Texture,
    decode: async (bytes, scene) => {
      const container = await LoadAssetContainerAsync(bytes, scene, { pluginExtension: '.glb' });
      native = container.materials.find(
        (m) => m.name === 'A09_original_PBR_surface_atlas',
      ) as PBRMaterial;
      return container;
    },
    prepare: async () => {},
    present: async () => {},
  });
  cleanup.push(() => {
    owner.dispose();
    raw.geometry.dispose();
  });
  const reference = await originalSecondTriplet(h.track);
  cleanup.push(() => reference.dispose());
  const originalAtlas = reference.parts.find((p) => p.kind === 'structure')!.mesh.material;
  expect(
    [originalAtlas.map, originalAtlas.normalMap, originalAtlas.roughnessMap].map(
      (t) => t!.anisotropy,
    ),
  ).toEqual([1, 1, 1]);
  expect(raw.doc.samplers).toEqual([
    { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 },
  ]);
  const material = raw.doc.materials[0];
  expect(material.doubleSided).toBe(true);
  expect(material.occlusionTexture).toBeUndefined();
  expect([
    material.normalTexture.index,
    material.pbrMetallicRoughness.baseColorTexture.index,
    material.pbrMetallicRoughness.metallicRoughnessTexture.index,
  ]).toEqual([0, 1, 2]);
  for (const image of raw.doc.images) {
    const view = raw.doc.bufferViews[image.bufferView],
      png = raw.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  }
  const state = vi.spyOn(h.engine, 'setState');
  for (const part of owner.diagnostics().parts) {
    expect(part.mesh.sideOrientation).toBe(Material.CounterClockWiseSideOrientation);
    if (part.kind === 'structure') {
      expect(part.material).toBe(native);
      for (const texture of [
        part.material.albedoTexture,
        part.material.bumpTexture,
        part.material.metallicTexture,
      ]) {
        expect(texture!.anisotropicFilteringLevel).toBe(1);
        expect(texture!.wrapU).toBe(Texture.CLAMP_ADDRESSMODE);
        expect(texture!.wrapV).toBe(Texture.CLAMP_ADDRESSMODE);
        expect(texture!.samplingMode).toBe(Texture.TRILINEAR_SAMPLINGMODE);
      }
      expect(part.material.albedoTexture).toBeTruthy();
      expect(part.material.bumpTexture!.level).toBe(material.normalTexture.scale);
      expect(part.material.metallicTexture).toBeTruthy();
      expect(part.material.ambientTexture).toBeNull();
      expect(part.material.backFaceCulling).toBe(false);
    } else {
      expect(part.material.roughness).toBe(0.72);
      expect(part.material.metallic).toBe(0);
      expect(part.material.backFaceCulling).toBe(true);
      expect([part.material.zOffset, part.material.zOffsetUnits]).toEqual([-1, -1]);
      const orientation = part.material._getEffectiveOrientation(part.mesh);
      state.mockClear();
      expect(part.material._preBind(undefined, orientation)).toBe(false);
      expect(state).toHaveBeenCalledWith(true, -1, false, false, true, part.material.stencil, -1);
    }
  }
});
it('preserves original 256-square stroke numeral commands and explicitly row-reverses synthetic RGBA', async () => {
  const h = harness(),
    expected = new Map<string, unknown[][]>();
  for (const text of ['150', '100', '50']) {
    const start = h.canvas.records.length,
      texture = distanceBoardLabel(text, 256, 256);
    expected.set(text, h.canvas.records[start].commands);
    expect(texture.anisotropy).toBe(8);
    texture.dispose();
  }
  const owner = await h.load();
  cleanup.push(() => owner.dispose());
  const labels = owner.diagnostics().labels;
  expect(labels.map((l) => l.text)).toEqual(['150', '100', '50']);
  for (const label of labels) {
    const record = h.canvas.records.find((r) => r.canvas === label.sourceCanvas)!;
    expect([label.sourceCanvas.width, label.sourceCanvas.height]).toEqual([256, 256]);
    expect(record.commands).toEqual(expected.get(label.text));
    expect(label.texture.anisotropicFilteringLevel).toBe(8);
    expect(record.commands).toContainEqual(['fillStyle', '#f2f2f2']);
    expect(record.commands).toContainEqual(['strokeStyle', '#111214']);
    expect(record.commands.some((c) => c[0] === 'stroke')).toBe(true);
    expect(record.commands.some((c) => c[0] === 'fillText')).toBe(false);
    expect(record.reads).toEqual([[0, 0, 256, 256]]);
    const original = a09SyntheticPixels(256, 256);
    for (let y = 0; y < 256; y++)
      expect(Array.from(label.pixels.subarray(y * 1024, (y + 1) * 1024))).toEqual(
        Array.from(original.subarray((255 - y) * 1024, (256 - y) * 1024)),
      );
    expect(label.material.albedoTexture).toBe(label.texture);
    expect(label.texture.gammaSpace).toBe(false);
    expect(label.texture.getInternalTexture()!._useSRGBBuffer).toBe(true);
  }
});

it('keeps the default live first triplet unchanged and makes the second selection explicit', async () => {
  const h = harness();
  const deps = {
    fetcher: async () => new Response(a09Bytes()),
    allocateTexture: allocateA09Texture,
    prepare: async () => {},
    present: async () => {},
  };
  const first = await loadBabylonBrakingTriplet(h.options, deps);
  cleanup.push(() => first.dispose());
  const second = await loadBabylonSecondBrakingTriplet(h.options, deps);
  cleanup.push(() => second.dispose());
  expect(first.diagnostics().stations).toEqual([420, 470, 520]);
  expect(first.diagnostics().retainedTriangles).toBe(4950);
  expect(second.diagnostics().stations).toEqual([1020, 1070, 1120]);
  expect(second.diagnostics().retainedTriangles).toBe(4994);
  expect(first.diagnostics().parts.map((p) => p.mesh.getTotalIndices() / 3)).toEqual([
    1648, 2, 1648, 2, 1648, 2,
  ]);
  expect(second.diagnostics().parts.map((p) => p.mesh.getTotalIndices() / 3)).toEqual([
    1692, 2, 1648, 2, 1648, 2,
  ]);
  expect(
    second
      .diagnostics()
      .parts.every((p) => !first.diagnostics().parts.some((q) => q.mesh === p.mesh)),
  ).toBe(true);
});
it('independently distinguishes worn geometry from clean while preserving both raw UV/index/normal templates', async () => {
  const reference = await originalSecondTriplet(new Track());
  cleanup.push(() => reference.dispose());
  for (const [variant, triangles] of [
    ['worn', 1692],
    ['clean', 1648],
  ] as const) {
    const raw = rawOriginal(variant);
    cleanup.push(() => raw.geometry.dispose());
    const expected = reference.kit.templates.get(`${variant}:0`)!;
    expect(expected).toHaveLength(1);
    expect(raw.geometry.index!.count / 3).toBe(triangles);
    expect(Array.from(expected[0].geometry.index!.array)).toEqual(
      Array.from(raw.geometry.index!.array),
    );
    for (const kind of ['position', 'normal', 'uv'])
      expect(Array.from(expected[0].geometry.getAttribute(kind).array)).toEqual(
        Array.from(raw.geometry.getAttribute(kind).array),
      );
    expect(raw.world.determinant()).toBeGreaterThan(0);
  }
});
