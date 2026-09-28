import * as T from 'three';
import { SuppliedDrawRanges } from './supplied-draw-ranges.ts';
import manifest from './supplied-player-lods.manifest.json' with { type: 'json' };
import sourceManifest from './supplied-player.manifest.json' with { type: 'json' };

interface Level {
  offset: number;
  count: number;
  error: number;
}
export interface PlayerLodRow {
  mesh: number;
  primitive: number;
  vertices: number;
  originalCount: number;
  levels: Level[];
}
export interface PlayerLodData {
  rows: ReadonlyMap<string, PlayerLodRow>;
  indices: Uint32Array;
}
const digest = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
const fail = (): never => {
  throw new Error('Invalid supplied player LOD contract');
};
const integer = (v: number, min: number, max: number) =>
  Number.isInteger(v) && v >= min && v <= max;

/** Validate structure independently of the transport digest, including complete
 * primitive coverage, contiguous index ranges and the measured triangle budget. */
export function parsePlayerLods(bytes: Uint8Array<ArrayBuffer>): PlayerLodData {
  if (bytes.length !== manifest.bytes || bytes.length < 8) fail();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== 0x32444c50) fail();
  const length = v.getUint32(4, true);
  if (length < 1 || length > 100000 || length > bytes.length - 8) fail();
  const start = 8 + Math.ceil(length / 4) * 4;
  if (start > bytes.length || (bytes.length - start) % 4) fail();
  const data = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length))) as {
    version?: number;
    sourceSHA256?: string;
    rows?: PlayerLodRow[];
  };
  if (
    data.version !== 2 ||
    data.sourceSHA256 !== manifest.sourceSHA256 ||
    !Array.isArray(data.rows) ||
    data.rows.length !== manifest.primitives
  )
    fail();
  // Copy permits callers to pass an otherwise valid unaligned Uint8Array view.
  const indices = new Uint32Array(bytes.slice(start).buffer);
  const rows = new Map<string, PlayerLodRow>();
  const counts = [0, 0, 0, 0];
  let next = 0;
  for (const row of data.rows!) {
    if (
      !row ||
      !integer(row.mesh, 0, sourceManifest.meshes - 1) ||
      !integer(row.primitive, 0, manifest.primitives - 1) ||
      !integer(row.vertices, 1, 4000000) ||
      !integer(row.originalCount, 3, sourceManifest.triangles * 3) ||
      row.originalCount % 3 ||
      !Array.isArray(row.levels) ||
      row.levels.length !== 3
    )
      fail();
    const key = `${row.mesh}:${row.primitive}`;
    if (rows.has(key)) fail();
    counts[0] += row.originalCount / 3;
    const ranges = new Map<number, number>();
    row.levels.forEach((level, i) => {
      if (
        !level ||
        !integer(level.count, 3, row.originalCount) ||
        level.count % 3 ||
        !Number.isFinite(level.error) ||
        level.error < 0 ||
        level.error > manifest.levels[i].error * 1.001
      )
        fail();
      if (level.offset === -1) {
        if (level.count !== row.originalCount || level.error !== 0) fail();
      } else {
        if (!integer(level.offset, 0, indices.length - level.count)) fail();
        if (ranges.has(level.offset)) {
          // Only a complete earlier range of this SAME primitive may be reused.
          // Partial overlaps, forward aliases and cross-primitive aliases fail.
          if (ranges.get(level.offset) !== level.count) fail();
        } else {
          if (level.offset !== next) fail();
          for (let j = next; j < next + level.count; j++) if (indices[j] >= row.vertices) fail();
          ranges.set(level.offset, level.count);
          next += level.count;
        }
      }
      counts[i + 1] += level.count / 3;
    });
    rows.set(key, row);
  }
  if (next !== indices.length || counts.some((n, i) => n !== manifest.triangles[i])) fail();
  return { rows, indices };
}

/** Bounded fetch; corrupt or absent derivatives never substitute a legacy car. */
export async function loadPlayerLods(url: string, signal: AbortSignal, fetcher = fetch) {
  const response = await fetcher(`${url}?v=${manifest.compressedSHA256.slice(0, 16)}`, { signal });
  if (!response.ok || !response.body)
    throw new Error(`Unable to load player LODs (${response.status})`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) throw new DOMException('Player LOD loading cancelled', 'AbortError');
      size += value.length;
      if (size > Math.max(manifest.bytes, manifest.compressedBytes))
        throw new Error('Player LOD download exceeds byte budget');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const packed = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    packed.set(chunk, offset);
    offset += chunk.length;
  }
  let bytes = packed;
  if (size === manifest.compressedBytes && (await digest(packed)) === manifest.compressedSHA256) {
    // Only the already hash-verified gzip reaches decompression. Some hosts
    // instead set Content-Encoding:gzip; Fetch returns raw bytes on those hosts.
    bytes = new Uint8Array(
      await new Response(
        new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')),
      ).arrayBuffer(),
    );
  }
  if (signal.aborted) throw new DOMException('Player LOD loading cancelled', 'AbortError');
  if (bytes.length !== manifest.bytes || (await digest(bytes)) !== manifest.sha256)
    throw new Error('Player LOD integrity check failed');
  return parsePlayerLods(bytes);
}

/** Geometry wrappers share immutable source attributes, never materials, bones
 * or animation copies. Switching a tier swaps indices, not the player model. */
export class SuppliedPlayerLods {
  private readonly bindings: { mesh: T.Mesh; geometries: T.BufferGeometry[] }[] = [];
  private readonly owned = new Set<T.BufferGeometry>();
  readonly drawRanges?: SuppliedDrawRanges;
  private tier = 0;
  private disposed = false;
  constructor(
    root: T.Group,
    keyFor: (mesh: T.Mesh) => { meshes?: number; primitives?: number } | undefined,
    data: PlayerLodData,
  ) {
    const used = new Set<string>();
    try {
      root.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        const ref = keyFor(object);
        const key = `${ref?.meshes}:${ref?.primitives}`;
        const row = data.rows.get(key);
        const original: T.BufferGeometry = object.geometry;
        if (
          !row ||
          used.has(key) ||
          original.index?.count !== row.originalCount ||
          original.getAttribute('position').count !== row.vertices
        )
          fail();
        if (!row) return fail();
        used.add(key);
        const geometries = [original];
        const shared = new Map<number, T.BufferGeometry>();
        for (const level of row.levels) {
          if (level.offset < 0) {
            geometries.push(original);
            continue;
          }
          const reused = shared.get(level.offset);
          if (reused) {
            if (reused.index?.count !== level.count) fail();
            geometries.push(reused);
            continue;
          }
          const geometry = new T.BufferGeometry();
          shared.set(level.offset, geometry);
          this.owned.add(geometry);
          for (const [name, attribute] of Object.entries(original.attributes))
            geometry.setAttribute(name, attribute);
          geometry.morphAttributes = original.morphAttributes;
          geometry.morphTargetsRelative = original.morphTargetsRelative;
          geometry.boundingBox = original.boundingBox;
          geometry.boundingSphere = original.boundingSphere;
          geometry.setIndex(
            new T.BufferAttribute(
              data.indices.subarray(level.offset, level.offset + level.count),
              1,
            ),
          );
          geometries.push(geometry);
        }
        this.bindings.push({ mesh: object, geometries });
      });
      if (used.size !== manifest.primitives) fail();
      this.drawRanges = new SuppliedDrawRanges(this.bindings);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  setLevel(level: number, quality: 'low' | 'medium' | 'high', exactClose = false) {
    if (!integer(level, 0, 2) || this.disposed) throw new Error('Invalid player LOD selection');
    const tier = level === 0 ? (quality === 'high' || exactClose ? 0 : 1) : level + 1;
    if (tier === this.tier) return;
    this.tier = tier;
    for (const { mesh, geometries } of this.bindings) mesh.geometry = geometries[tier];
  }
  diagnostics() {
    return {
      tier: this.tier,
      triangles: manifest.triangles[this.tier],
      tiers: [...manifest.triangles],
      sha256: manifest.sha256,
      sourceSHA256: manifest.sourceSHA256,
      sharedAttributes: true,
      ownedGeometries: this.owned.size,
      disposed: this.disposed,
      drawRanges: this.drawRanges?.diagnostics() ?? null,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.drawRanges?.dispose();
    // Restore original ownership before RacingRenderer traverses/disposes scene resources.
    for (const { mesh, geometries } of this.bindings) mesh.geometry = geometries[0];
    this.owned.forEach((geometry) => geometry.dispose());
    this.owned.clear();
    this.disposed = true;
  }
}
