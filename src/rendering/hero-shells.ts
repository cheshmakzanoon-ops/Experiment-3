import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './apx01-shell.manifest.json' with { type: 'json' };
import assembly from './apx01-assembly.json' with { type: 'json' };

export type HeroPart = keyof typeof assembly.parts;
export const HERO_PARTS = Object.freeze(Object.keys(assembly.parts) as HeroPart[]);
const PARTS = HERO_PARTS;
const abortError = () => new DOMException('Bodywork loading cancelled', 'AbortError');
const digest = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** Convert normalized glTF attributes BEFORE baking the node's metre transform.
 * Transforming the loader's Int16 attributes in-place would quantize the car a
 * second time, collapsing small panels. Runtime canvas UVs use V-up, glTF V-down. */
export function bakeHeroGeometry(mesh: T.Mesh): T.BufferGeometry {
  const source = mesh.geometry,
    out = new T.BufferGeometry();
  try {
    for (const [name, size] of [
      ['position', 3],
      ['normal', 3],
      ['uv', 2],
    ] as const) {
      const attribute = source.getAttribute(name);
      if (
        !attribute ||
        attribute.itemSize !== size ||
        attribute.count > assembly.maxVerticesPerPart ||
        attribute.count < 3
      )
        throw new Error(`Invalid authored ${name} attribute`);
      const data = new Float32Array(attribute.count * size);
      for (let i = 0; i < attribute.count; i++) {
        data[i * size] = attribute.getX(i);
        data[i * size + 1] = name === 'uv' ? 1 - attribute.getY(i) : attribute.getY(i);
        if (size === 3) data[i * size + 2] = attribute.getZ(i);
      }
      if (!data.every(Number.isFinite)) throw new Error('Nonfinite authored bodywork');
      out.setAttribute(name, new T.BufferAttribute(data, size));
    }
    const index = source.getIndex();
    if (!index || index.count % 3 || index.count > assembly.maxIndicesPerPart || index.count < 3)
      throw new Error('Invalid authored triangle topology');
    const count = out.getAttribute('position').count;
    if (['normal', 'uv'].some((name) => out.getAttribute(name).count !== count))
      throw new Error('Mismatched authored attributes');
    for (let i = 0; i < index.count; i++)
      if (!Number.isInteger(index.getX(i)) || index.getX(i) < 0 || index.getX(i) >= count)
        throw new Error('Authored index out of bounds');
    if (
      !mesh.matrixWorld.elements.every(Number.isFinite) ||
      mesh.matrixWorld.determinant() <= 1e-12
    )
      throw new Error('Invalid authored transform');
    const normals = out.getAttribute('normal');
    for (let i = 0; i < normals.count; i++)
      if (Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) < 1e-8)
        throw new Error('Zero authored surface normal');
    out.setIndex(index.clone());
    out.applyMatrix4(mesh.matrixWorld);
    out.normalizeNormals();
    out.computeBoundingBox();
    out.computeBoundingSphere();
    const box = out.boundingBox!;
    if (
      !Number.isFinite(box.min.lengthSq() + box.max.lengthSq()) ||
      box.min.y < -1 ||
      box.max.y > 1 ||
      box.min.z < -3 ||
      box.max.z > 3 ||
      Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) > 1.02
    )
      throw new Error('Authored assembly exceeds the chassis envelope');
    return out;
  } catch (error) {
    out.dispose();
    throw error;
  }
}

interface HeroDocument {
  buffers?: { byteLength?: number; uri?: string }[];
  bufferViews?: { buffer?: number; byteLength?: number; byteOffset?: number }[];
  images?: unknown[];
  textures?: unknown[];
  samplers?: unknown[];
  animations?: unknown[];
  skins?: unknown[];
  cameras?: unknown[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  nodes?: {
    mesh?: number;
    children?: unknown[];
    camera?: number;
    extras?: { apex_role?: string; apex_material?: string };
  }[];
  meshes?: {
    primitives?: {
      mode?: number;
      material?: number;
      indices?: number;
      attributes?: Record<string, number>;
      targets?: unknown[];
      extensions?: object;
    }[];
  }[];
  materials?: { name?: string }[];
  accessors?: { count?: number; sparse?: object }[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
}
/** Only the checked-in mechanical assembly is accepted, not arbitrary glTF.
 * Materials are bounded named slots, rebound to live paint/rubber/brake state.
 * Rigged humans, embedded/external images and animation need a separate loader. */
export function validateHeroDocument(value: unknown): void {
  if (!value || typeof value !== 'object') throw new Error('Invalid authored glTF document');
  const j = value as HeroDocument;
  const fail = () => {
    throw new Error('Authored assembly violates its static role/material contract');
  };
  if (
    ['images', 'textures', 'samplers', 'animations', 'skins', 'cameras'].some((key) =>
      Boolean((j[key as keyof HeroDocument] as unknown[] | undefined)?.length),
    )
  )
    fail();
  if (
    !Array.isArray(j.buffers) ||
    j.buffers.length !== 1 ||
    j.buffers[0].uri ||
    !Number.isInteger(j.buffers[0].byteLength) ||
    j.buffers[0].byteLength! <= 0 ||
    j.buffers[0].byteLength! > assembly.maxRawBytes
  )
    fail();
  if (
    !Array.isArray(j.nodes) ||
    j.nodes.length !== PARTS.length ||
    !Array.isArray(j.meshes) ||
    j.meshes.length !== PARTS.length ||
    !Array.isArray(j.materials) ||
    j.materials.length > 8 ||
    !Array.isArray(j.accessors) ||
    !Array.isArray(j.bufferViews)
  )
    fail();
  const extensions = [...(j.extensionsUsed ?? []), ...(j.extensionsRequired ?? [])];
  if (extensions.some((e) => !['KHR_mesh_quantization', 'KHR_materials_clearcoat'].includes(e)))
    fail();
  if (
    j.scene !== 0 ||
    j.scenes?.length !== 1 ||
    j.scenes[0].nodes?.length !== PARTS.length ||
    new Set(j.scenes[0].nodes).size !== PARTS.length ||
    j.scenes[0].nodes.some((n) => !Number.isInteger(n) || n < 0 || n >= PARTS.length)
  )
    fail();
  const seen = new Set<string>(),
    meshIds = new Set<number>();
  for (const node of j.nodes!) {
    const role = node.extras?.apex_role as HeroPart;
    if (
      !PARTS.includes(role) ||
      seen.has(role) ||
      node.extras?.apex_material !== assembly.parts[role] ||
      node.children?.length ||
      node.camera !== undefined ||
      !Number.isInteger(node.mesh) ||
      node.mesh! < 0 ||
      node.mesh! >= PARTS.length ||
      meshIds.has(node.mesh!)
    )
      fail();
    seen.add(role);
    meshIds.add(node.mesh!);
    const primitives = j.meshes![node.mesh!]!.primitives;
    if (primitives?.length !== 1) fail();
    const p = primitives![0];
    if (
      (p.mode !== undefined && p.mode !== 4) ||
      p.targets?.length ||
      p.extensions ||
      !Number.isInteger(p.material) ||
      p.material! < 0 ||
      j.materials![p.material!]?.name !== `APX / ${assembly.parts[role]}` ||
      !p.attributes ||
      Object.keys(p.attributes).sort().join(',') !== 'NORMAL,POSITION,TEXCOORD_0' ||
      !Number.isInteger(p.indices)
    )
      fail();
    const indices = j.accessors![p.indices!];
    if (
      !indices ||
      !Number.isInteger(indices.count) ||
      indices.count! < 3 ||
      indices.count! % 3 ||
      indices.count! > assembly.maxIndicesPerPart
    )
      fail();
    for (const index of Object.values(p.attributes!)) {
      const a = j.accessors![index];
      if (
        !Number.isInteger(index) ||
        !a ||
        !Number.isInteger(a.count) ||
        a.count! < 3 ||
        a.count! > assembly.maxVerticesPerPart ||
        a.sparse
      )
        fail();
    }
  }
  for (const view of j.bufferViews!)
    if (
      view.buffer !== 0 ||
      !Number.isInteger(view.byteLength) ||
      view.byteLength! < 0 ||
      !Number.isInteger(view.byteOffset ?? 0) ||
      (view.byteOffset ?? 0) < 0 ||
      (view.byteOffset ?? 0) + view.byteLength! > j.buffers![0].byteLength!
    )
      fail();
}

/** Per-renderer prototypes; never a global cache. Every car receives an owned
 * clone, allowing existing material batching/disposal and independent liveries. */
export class HeroShells {
  private disposed = false;
  private constructor(private readonly parts: Map<HeroPart, T.BufferGeometry>) {}
  copy(part: HeroPart, side: -1 | 1 = 1) {
    if (this.disposed) throw new Error('Authored bodywork already disposed');
    const geometry = this.parts.get(part);
    if (!geometry) throw new Error(`Missing authored part ${part}`);
    if (side !== -1 && side !== 1) throw new Error('Invalid authored handedness');
    const result = geometry.clone();
    result.userData.apxPart = part;
    if (side === -1) {
      // Reflection changes handedness. Reverse triangles as well as positions
      // and normals, otherwise one side renders inside-out or disappears.
      result.scale(-1, 1, 1);
      const index = result.index!;
      for (let i = 0; i < index.count; i += 3) {
        const b = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2));
        index.setX(i + 2, b);
      }
      result.computeBoundingBox();
      result.computeBoundingSphere();
    }
    return result;
  }
  diagnostics() {
    return {
      revision: assembly.revision,
      partCount: this.parts.size,
      materialBindings: assembly.parts,
      sha256: manifest.sha256,
      compressedBytes: manifest.compressedBytes,
      loaded: !this.disposed,
      triangles: Object.fromEntries([...this.parts].map(([name, g]) => [name, g.index!.count / 3])),
      finalArtApproved: false,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const part of this.parts.values()) part.dispose();
    this.parts.clear();
  }
  static async decode(input: Uint8Array<ArrayBuffer>, signal?: AbortSignal) {
    if (signal?.aborted) throw abortError();
    let bytes: Uint8Array<ArrayBuffer>;
    // Some static hosts decode Content-Encoding:gzip before fetch exposes bytes.
    // Both forms must be the exact retained Blender export, not an HTML 200 page.
    if (
      input.length === manifest.compressedBytes &&
      (await digest(input)) === manifest.compressedSHA256
    ) {
      bytes = new Uint8Array(
        await new Response(
          new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip')),
        ).arrayBuffer(),
      );
    } else bytes = input;
    if (bytes.length !== manifest.bytes || (await digest(bytes)) !== manifest.sha256)
      throw new Error('Authored bodywork integrity check failed');
    if (signal?.aborted) throw abortError();
    // The checksum pins all external-reference and resource-size decisions.
    // Additional explicit gates make the asset contract reviewable on updates.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== bytes.length ||
      view.getUint32(16, true) !== 0x4e4f534a
    )
      throw new Error('Invalid authored glTF header');
    const json = JSON.parse(
      new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))),
    );
    validateHeroDocument(json);
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
    const parts = new Map<HeroPart, T.BufferGeometry>();
    try {
      if (signal?.aborted) throw abortError();
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        const role = object.userData.apex_role as HeroPart;
        if (
          !PARTS.includes(role) ||
          parts.has(role) ||
          object instanceof T.SkinnedMesh ||
          object.userData.apex_material !== assembly.parts[role]
        )
          throw new Error('Unexpected authored assembly role or material');
        parts.set(role, bakeHeroGeometry(object));
      });
      if (PARTS.some((part) => !parts.has(part))) throw new Error('Incomplete authored bodywork');
      const triangles = [...parts.values()].reduce((sum, g) => sum + g.index!.count / 3, 0);
      if (triangles > assembly.maxTriangles)
        throw new Error('Authored assembly triangle budget exceeded');
      return new HeroShells(parts);
    } catch (error) {
      for (const part of parts.values()) part.dispose();
      throw error;
    } finally {
      // Preview materials are NOT the live paint, wetness or livery materials.
      const geometries = new Set<T.BufferGeometry>(),
        materials = new Set<T.Material>();
      gltf.scene.traverse((o) => {
        if (o instanceof T.Mesh) {
          geometries.add(o.geometry);
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
        }
      });
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    }
  }
}

/** Same-origin, bounded, cancelable asset loading. A failed production asset is
 * an explicit startup error; silently reverting to the old car is not success. */
export async function loadHeroShells(
  cancelled: () => boolean = () => false,
  fetcher: typeof fetch = fetch,
  url?: string,
): Promise<HeroShells> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const cancellation = setInterval(() => {
    if (cancelled()) controller.abort();
  }, 50);
  let result: HeroShells | undefined;
  try {
    if (cancelled()) throw abortError();
    // Resolve only when loading is requested. Inline/library consumers can import
    // geometry helpers on about:blank, where a relative URL has no usable base.
    // Keep this static expression intact so Vite still emits the fingerprinted asset.
    const assetUrl = url ?? new URL('./apx01-shell.glb.gz', import.meta.url).href;
    const response = await fetcher(assetUrl, {
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!response.ok || !response.body) throw new Error(`Bodywork HTTP ${response.status}`);
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted || cancelled()) throw abortError();
        if (done) break;
        length += value.length;
        if (length > manifest.bytes) throw new Error('Authored bodywork response exceeds budget');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    result = await HeroShells.decode(bytes, controller.signal);
    if (cancelled() || controller.signal.aborted) throw abortError();
    return result;
  } catch (error) {
    result?.dispose();
    throw error;
  } finally {
    clearTimeout(timeout);
    clearInterval(cancellation);
  }
}
