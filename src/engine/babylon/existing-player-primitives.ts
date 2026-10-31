import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { PlayerLodData, PlayerLodRow } from '../assets/player-lod-data.ts';
import manifest from '../../rendering/supplied-player.manifest.json' with { type: 'json' };
import lodManifest from '../../rendering/supplied-player-lods.manifest.json' with { type: 'json' };

export interface ExistingPlayerPrimitiveSource {
  readonly key: string;
  /** Unique source owner, not an assertion about Babylon's reparented skin hierarchy. */
  readonly node: number;
  readonly mesh: number;
  readonly primitive: number;
  readonly indices: number;
  readonly material: number;
  readonly skin: number | null;
  readonly joints: readonly number[] | null;
  readonly vertices: number;
  readonly originalCount: number;
  readonly attributes: Readonly<Record<string, number>>;
}
export interface ExistingPlayerPrimitiveBinding {
  readonly source: ExistingPlayerPrimitiveSource;
  readonly mesh: Mesh;
}
interface SourceDocument {
  nodes: { mesh?: number; skin?: number }[];
  meshes: {
    primitives: {
      attributes: Record<string, number>;
      indices: number;
      material: number;
      mode?: number;
      targets?: unknown[];
    }[];
  }[];
  accessors: { count: number; type: string }[];
  materials: unknown[];
  skins: { joints: number[] }[];
}
function fail(detail: string): never {
  throw new Error(`Invalid existing player primitive contract: ${detail}`);
}
const integer = (value: number, length: number) =>
  Number.isInteger(value) && value >= 0 && value < length;

/** Read only AFTER decodeExistingPlayerBytes verifies the complete GLB hash.
 * This bounded structural check records source IDs, never guessed mesh names. */
export function existingPlayerPrimitiveSources(raw: Uint8Array<ArrayBuffer>) {
  if (raw.byteLength !== manifest.bytes) fail('source length');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const length = view.getUint32(12, true);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== raw.byteLength ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    length > raw.byteLength - 28
  )
    fail('GLB header');
  const source = JSON.parse(
    new TextDecoder().decode(raw.subarray(20, 20 + length)),
  ) as SourceDocument;
  if (
    !Array.isArray(source.nodes) ||
    source.nodes.length !== manifest.nodes ||
    !Array.isArray(source.meshes) ||
    source.meshes.length !== manifest.meshes ||
    !Array.isArray(source.materials) ||
    source.materials.length !== manifest.materials ||
    !Array.isArray(source.accessors) ||
    !Array.isArray(source.skins) ||
    source.skins.length !== 1 ||
    source.skins[0]?.joints?.length !== manifest.joints
  )
    fail('source inventory');
  const joints = Object.freeze([...source.skins[0].joints]);
  if (
    new Set(joints).size !== manifest.joints ||
    joints.some((node) => !integer(node, source.nodes.length))
  )
    fail('source joints');
  const result: ExistingPlayerPrimitiveSource[] = [];
  let triangles = 0;
  source.meshes.forEach((mesh, meshIndex) => {
    const owners = source.nodes.flatMap((node, index) => (node.mesh === meshIndex ? [index] : []));
    if (owners.length !== 1 || !Array.isArray(mesh.primitives) || !mesh.primitives.length)
      fail('source mesh ownership');
    const skin = source.nodes[owners[0]].skin ?? null;
    if (skin !== null && skin !== 0) fail('source skin');
    mesh.primitives.forEach((primitive, primitiveIndex) => {
      const attributes = primitive.attributes;
      const position = source.accessors[attributes?.POSITION];
      const indices = source.accessors[primitive.indices];
      if (
        !attributes ||
        !position ||
        position.type !== 'VEC3' ||
        !Number.isInteger(position.count) ||
        position.count <= 0 ||
        !indices ||
        indices.type !== 'SCALAR' ||
        !Number.isInteger(indices.count) ||
        indices.count <= 0 ||
        indices.count % 3 ||
        (primitive.mode ?? 4) !== 4 ||
        primitive.targets ||
        !integer(primitive.material, manifest.materials)
      )
        fail('source primitive');
      const semantics =
        skin === null
          ? ['POSITION', 'NORMAL', 'TEXCOORD_0']
          : ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'];
      if (
        Object.keys(attributes).length !== semantics.length ||
        semantics.some(
          (name) =>
            !integer(attributes[name], source.accessors.length) ||
            source.accessors[attributes[name]].count !== position.count,
        )
      )
        fail('source attributes');
      triangles += indices.count / 3;
      result.push(
        Object.freeze({
          key: `${meshIndex}:${primitiveIndex}`,
          node: owners[0],
          mesh: meshIndex,
          primitive: primitiveIndex,
          indices: primitive.indices,
          material: primitive.material,
          skin,
          joints: skin === null ? null : joints,
          vertices: position.count,
          originalCount: indices.count,
          attributes: Object.freeze({ ...attributes }),
        }),
      );
    });
  });
  if (result.length !== lodManifest.primitives || triangles !== manifest.triangles)
    fail('source primitive coverage');
  return Object.freeze(result);
}

/** The only pinned-loader internal API dependency. Babylon 9.33.1 stores source
 * JSON pointers here, not in public metadata or mesh names. Missing/ambiguous
 * pointers fail closed; upgrades must pass the real GLB import contract test. */
function pointer(object: object, pattern: RegExp): string | undefined {
  const metadata = (object as { _internalMetadata?: { gltf?: { pointers?: unknown } } })
    ._internalMetadata;
  const pointers = metadata?.gltf?.pointers;
  if (pointers === undefined) return undefined;
  if (!Array.isArray(pointers) || pointers.some((value) => typeof value !== 'string'))
    fail('loader pointer metadata');
  const matches = pointers.filter((value: string) => pattern.test(value));
  if (matches.length > 1) fail('ambiguous loader pointer');
  return matches[0];
}

/** Validate all bindings before returning. No vertex/index arrays, transforms, submeshes,
 * materials, skeletons or GPU resources are created, changed or disposed. The
 * container remains their sole owner; this table only holds existing references.
 * Source node ownership is recorded, not a hierarchy-parity certificate: Babylon
 * deliberately reparents skinned render meshes alongside the skeleton root. */
export function bindExistingPlayerPrimitives(
  container: Pick<AssetContainer, 'meshes' | 'materials' | 'skeletons'>,
  sources: readonly ExistingPlayerPrimitiveSource[],
): readonly ExistingPlayerPrimitiveBinding[] {
  if (sources.length !== lodManifest.primitives || container.skeletons.length !== 1)
    fail('binding inventory');
  // The loader may retain non-palette ancestor bones (index -1). Match the
  // authored joint palette, not total bone count or names/creation order.
  const joints = sources.find((source) => source.skin !== null)?.joints;
  const palette = new Map<number, string | undefined>();
  for (const bone of container.skeletons[0].bones) {
    const index = bone.getIndex();
    if (index === -1) continue;
    const node = bone.getTransformNode();
    if (!integer(index, manifest.joints) || palette.has(index) || !node)
      fail('imported joint palette');
    palette.set(index, pointer(node, /^\/nodes\/\d+$/));
  }
  if (
    !joints ||
    joints.length !== manifest.joints ||
    palette.size !== joints.length ||
    joints.some((node, index) => palette.get(index) !== `/nodes/${node}`)
  )
    fail('imported joint palette');
  const remaining = new Map(sources.map((source) => [source.key, source]));
  if (remaining.size !== sources.length) fail('duplicate source primitive');
  const materials = new Map<number, Material>();
  const bindings = new Map<string, ExistingPlayerPrimitiveBinding>();
  for (const mesh of container.meshes) {
    const sourcePointer = pointer(mesh, /^\/meshes\/\d+\/primitives\/\d+$/);
    // The loader adds an empty root mesh; no renderable unknown mesh is allowed.
    if (!sourcePointer && !mesh.getTotalVertices() && !mesh.getTotalIndices()) continue;
    const match = sourcePointer?.match(/^\/meshes\/(\d+)\/primitives\/(\d+)$/);
    const key = match ? `${Number(match[1])}:${Number(match[2])}` : '';
    const source = remaining.get(key);
    if (
      !source ||
      sourcePointer !== `/meshes/${source.mesh}/primitives/${source.primitive}` ||
      !(mesh instanceof Mesh) ||
      mesh.isDisposed() ||
      !mesh.geometry ||
      mesh.geometry.meshes.length !== 1 ||
      mesh.geometry.meshes[0] !== mesh ||
      mesh.morphTargetManager ||
      mesh.instances.length ||
      mesh.hasThinInstances ||
      mesh.isUnIndexed ||
      mesh.getTotalVertices() !== source.vertices ||
      mesh.getTotalIndices() !== source.originalCount ||
      !mesh.getIndices() ||
      mesh.subMeshes.length !== 1 ||
      mesh.subMeshes[0].materialIndex !== 0 ||
      mesh.subMeshes[0].verticesStart !== 0 ||
      mesh.subMeshes[0].verticesCount !== source.vertices ||
      mesh.subMeshes[0].indexStart !== 0 ||
      mesh.subMeshes[0].indexCount !== source.originalCount
    )
      fail('imported primitive');
    const material = mesh.material;
    if (
      !material ||
      !container.materials.includes(material) ||
      pointer(material, /^\/materials\/\d+$/) !== `/materials/${source.material}` ||
      (materials.has(source.material) && materials.get(source.material) !== material)
    )
      fail('imported material');
    const expectedSkeleton = source.skin === null ? null : container.skeletons[0];
    if (mesh.skeleton !== expectedSkeleton) fail('imported skin');
    const attributes =
      source.skin === null
        ? ([
            ['position', 3],
            ['normal', 3],
            ['uv', 2],
          ] as const)
        : ([
            ['position', 3],
            ['normal', 3],
            ['uv', 2],
            ['matricesIndices', 4],
            ['matricesWeights', 4],
          ] as const);
    for (const [kind, size] of attributes) {
      if (mesh.getVertexBuffer(kind)?.getSize() !== size) fail('imported attributes');
    }
    materials.set(source.material, material);
    remaining.delete(key);
    bindings.set(key, Object.freeze({ source, mesh }));
  }
  if (remaining.size || materials.size !== manifest.materials) fail('imported primitive coverage');
  return Object.freeze(sources.map((source) => bindings.get(source.key)!));
}

/** Optional derivative join, separate from full-detail loading: it neither
 * downloads PLD2 nor changes a mesh's selected indices. Call with parsed data. */
export function bindExistingPlayerLodRows(
  bindings: readonly ExistingPlayerPrimitiveBinding[],
  data: PlayerLodData,
) {
  if (bindings.length !== lodManifest.primitives || data.rows.size !== bindings.length)
    fail('LOD coverage');
  const seen = new Set<string>();
  const result: { readonly binding: ExistingPlayerPrimitiveBinding; readonly row: PlayerLodRow }[] =
    [];
  for (const binding of bindings) {
    const source = binding.source,
      row = data.rows.get(source.key);
    if (
      !row ||
      seen.has(source.key) ||
      row.mesh !== source.mesh ||
      row.primitive !== source.primitive ||
      row.vertices !== source.vertices ||
      row.originalCount !== source.originalCount
    )
      fail('LOD correspondence');
    seen.add(source.key);
    result.push(Object.freeze({ binding, row }));
  }
  return Object.freeze(result);
}
