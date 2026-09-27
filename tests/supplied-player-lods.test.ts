import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as T from 'three';
import {
  parsePlayerLods,
  loadPlayerLods,
  SuppliedPlayerLods,
} from '../src/rendering/supplied-player-lods.ts';
import manifest from '../src/rendering/supplied-player-lods.manifest.json' with { type: 'json' };

const packed = readFileSync(
  new URL('../public/models/supplied-player-lods.bin.gz', import.meta.url),
);
const raw = new Uint8Array(gunzipSync(packed));
const source = gunzipSync(
  readFileSync(new URL('../public/models/supplied-player.glb.gz', import.meta.url)),
);
const jsonLength = source.readUInt32LE(12);
const document = JSON.parse(source.subarray(20, 20 + jsonLength).toString());
const bin = source.subarray(28 + jsonLength);
function fixture() {
  const root = new T.Group();
  const material = new T.MeshBasicMaterial();
  const keys = new Map<T.Mesh, { meshes: number; primitives: number }>();
  const originals: T.BufferGeometry[] = [];
  for (let m = 0; m < document.meshes.length; m++) {
    for (let p = 0; p < document.meshes[m].primitives.length; p++) {
      const prim = document.meshes[m].primitives[p];
      const geometry = new T.BufferGeometry();
      for (const [semantic, name] of [
        ['POSITION', 'position'],
        ['NORMAL', 'normal'],
        ['TEXCOORD_0', 'uv'],
      ] as const) {
        const a = document.accessors[prim.attributes[semantic]],
          v = document.bufferViews[a.bufferView];
        const width = semantic === 'TEXCOORD_0' ? 2 : 3;
        expect(v.byteStride ?? width * 4).toBe(width * 4);
        const bytes = bin.subarray(
          (v.byteOffset ?? 0) + (a.byteOffset ?? 0),
          (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + a.count * width * 4,
        );
        geometry.setAttribute(
          name,
          new T.BufferAttribute(new Float32Array(new Uint8Array(bytes).buffer), width),
        );
      }
      const a = document.accessors[prim.indices],
        v = document.bufferViews[a.bufferView];
      const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
      const indices = new Uint32Array(a.count);
      for (let i = 0; i < a.count; i++)
        indices[i] =
          a.componentType === 5123
            ? bin.readUInt16LE(offset + i * 2)
            : bin.readUInt32LE(offset + i * 4);
      geometry.setIndex(new T.BufferAttribute(indices, 1));
      const mesh = new T.Mesh(geometry, material);
      root.add(mesh);
      originals.push(geometry);
      keys.set(mesh, { meshes: m, primitives: p });
    }
  }
  return { root, originals, material, keys };
}

describe('supplied player index-only LODs', () => {
  it('pins the actual generated data to the unmodified source and measured budgets', () => {
    const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    expect(hash(source)).toBe(manifest.sourceSHA256);
    expect(hash(packed)).toBe(manifest.compressedSHA256);
    expect(hash(raw)).toBe(manifest.sha256);
    const data = parsePlayerLods(raw);
    expect(data.rows.size).toBe(172);
    // Co-located decals and their support surfaces must not be simplified
    // independently: that produced visible depth intersections in review.
    let protectedCount = 0;
    for (const row of data.rows.values()) {
      const prim = document.meshes[row.mesh].primitives[row.primitive];
      const material = document.materials[prim.material];
      if (
        material.alphaMode === 'BLEND' ||
        /^(Paint|Tyre|Composite) \|/.test(material.name ?? '')
      ) {
        protectedCount++;
        for (const level of row.levels)
          expect(level).toEqual({ offset: -1, count: row.originalCount, error: 0 });
      }
    }
    expect(protectedCount).toBeGreaterThan(60);
    expect(manifest.triangles[1]).toBeLessThan(manifest.triangles[0] * 0.7);
    expect(manifest.triangles[2]).toBeLessThan(manifest.triangles[0] * 0.6);
    expect(manifest.triangles[3]).toBeLessThan(manifest.triangles[0] * 0.56);
  });
  it('rejects malformed lengths, headers, out-of-range indices and wrong-source metadata', () => {
    expect(() => parsePlayerLods(raw.subarray(0, raw.length - 4))).toThrow();
    const badMagic = raw.slice();
    badMagic[0] = 0;
    expect(() => parsePlayerLods(badMagic)).toThrow();
    const oversized = raw.slice();
    new DataView(oversized.buffer).setUint32(4, 0xffffffff, true);
    expect(() => parsePlayerLods(oversized)).toThrow();
    const wrongIndex = raw.slice();
    new DataView(wrongIndex.buffer).setUint32(wrongIndex.length - 4, 0xffffffff, true);
    expect(() => parsePlayerLods(wrongIndex)).toThrow();
    const wrongSource = raw.slice();
    const index = Buffer.from(wrongSource).indexOf(manifest.sourceSHA256);
    wrongSource[index] = wrongSource[index] === 48 ? 49 : 48;
    expect(() => parsePlayerLods(wrongSource)).toThrow();
  });
  it('changes real geometry only, preserves every source attribute and releases each wrapper once', () => {
    const { root, keys, originals, material } = fixture();
    const data = parsePlayerLods(raw);
    const lods = new SuppliedPlayerLods(root, (mesh) => keys.get(mesh), data);
    const disposed = new Map<T.BufferGeometry, number>();
    for (const [level, quality, exact, tier] of [
      [0, 'low', false, 1],
      [1, 'low', false, 2],
      [2, 'low', false, 3],
      [0, 'high', false, 0],
      [0, 'low', true, 0],
      [1, 'high', false, 2],
    ] as const) {
      lods.setLevel(level, quality, exact);
      expect(lods.diagnostics().tier).toBe(tier);
      let triangles = 0;
      root.children.forEach((child, i) => {
        const mesh = child as T.Mesh;
        expect(mesh.material).toBe(material);
        for (const name of ['position', 'normal', 'uv'])
          expect(mesh.geometry.getAttribute(name)).toBe(originals[i].getAttribute(name));
        expect(
          mesh.geometry.index!.array.every((n) => n < mesh.geometry.getAttribute('position').count),
        ).toBe(true);
        triangles += mesh.geometry.index!.count / 3;
        if (!disposed.has(mesh.geometry)) {
          disposed.set(mesh.geometry, 0);
          const geometry = mesh.geometry;
          geometry.addEventListener('dispose', () =>
            disposed.set(geometry, disposed.get(geometry)! + 1),
          );
        }
      });
      expect(triangles).toBe(manifest.triangles[tier]);
    }
    lods.dispose();
    lods.dispose();
    root.children.forEach((child, i) => expect((child as T.Mesh).geometry).toBe(originals[i]));
    for (const [geometry, count] of disposed)
      expect(count).toBe(originals.includes(geometry) ? 0 : 1);
    expect(() => lods.setLevel(0, 'low')).toThrow();
    originals.forEach((g) => g.dispose());
    material.dispose();
  });
  it('fails closed for a missing primitive and for mismatched source vertex counts', () => {
    const { root, keys, originals, material } = fixture();
    const data = parsePlayerLods(raw);
    expect(() => new SuppliedPlayerLods(root, () => undefined, data)).toThrow();
    const mesh = root.children[0] as T.Mesh;
    const old = mesh.geometry.getAttribute('position');
    mesh.geometry.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0], 3));
    expect(() => new SuppliedPlayerLods(root, (m) => keys.get(m), data)).toThrow();
    mesh.geometry.setAttribute('position', old);
    originals.forEach((g) => g.dispose());
    material.dispose();
  });
  it('bounds transport and rejects corruption rather than accepting a fallback', async () => {
    const signal = new AbortController().signal;
    const response = (body: Uint8Array | string, status = 200) =>
      (async () => new Response(body as BodyInit, { status })) as typeof fetch;
    await expect(
      loadPlayerLods('https://example.invalid/lod', signal, response('missing', 404)),
    ).rejects.toThrow('404');
    await expect(
      loadPlayerLods(
        'https://example.invalid/lod',
        signal,
        response(new Uint8Array(manifest.bytes + 1)),
      ),
    ).rejects.toThrow('budget');
    await expect(
      loadPlayerLods('https://example.invalid/lod', signal, response('corrupt')),
    ).rejects.toThrow('integrity');
    const actual = await loadPlayerLods(
      'https://example.invalid/lod',
      signal,
      response(new Uint8Array(packed)),
    );
    expect(actual.rows.size).toBe(manifest.primitives);
    const decompressed = await loadPlayerLods('https://example.invalid/lod', signal, response(raw));
    expect(decompressed.rows.size).toBe(manifest.primitives);
  });
});
