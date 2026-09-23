import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './apx01-shell.manifest.json' with { type: 'json' };

export type HeroPart = 'nose' | 'engine' | 'sidepod';
const PARTS: readonly HeroPart[] = ['nose', 'engine', 'sidepod'];
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
      if (!attribute || attribute.itemSize !== size || attribute.count > 16384)
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
    if (!index || index.count % 3 || index.count > 65535)
      throw new Error('Invalid authored triangle topology');
    const count = out.getAttribute('position').count;
    if (['normal', 'uv'].some((name) => out.getAttribute(name).count !== count))
      throw new Error('Mismatched authored attributes');
    for (let i = 0; i < index.count; i++)
      if (index.getX(i) >= count) throw new Error('Authored index out of bounds');
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
      Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) > 1
    )
      throw new Error('Authored skin exceeds the chassis envelope');
    return out;
  } catch (error) {
    out.dispose();
    throw error;
  }
}

/** Per-renderer prototypes; never a global cache. Every car receives an owned
 * clone, allowing existing material batching/disposal and independent liveries. */
export class HeroShells {
  private disposed = false;
  private constructor(private readonly parts: Map<HeroPart, T.BufferGeometry>) {}
  copy(part: HeroPart) {
    if (this.disposed) throw new Error('Authored bodywork already disposed');
    const geometry = this.parts.get(part);
    if (!geometry) throw new Error(`Missing authored skin ${part}`);
    return geometry.clone();
  }
  diagnostics() {
    return {
      revision: 'APX-01 / 27H',
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
    if (
      json.images?.length ||
      json.animations?.length ||
      json.skins?.length ||
      json.buffers?.length !== 1 ||
      json.buffers.some((b: { uri?: string }) => b.uri) ||
      json.meshes?.length !== 3
    )
      throw new Error('Authored bodywork must be three self-contained static skins');
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
        if (!PARTS.includes(role) || parts.has(role) || object instanceof T.SkinnedMesh)
          throw new Error('Unexpected authored bodywork role');
        parts.set(role, bakeHeroGeometry(object));
      });
      if (PARTS.some((part) => !parts.has(part))) throw new Error('Incomplete authored bodywork');
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
