import { beforeAll, describe, expect, it } from 'vitest';
import { MeshoptEncoder } from 'meshoptimizer';
import { orderOpaqueTriangles, fifoVertexMisses } from '../scripts/player-index-cache.ts';

beforeAll(async () => {
  await MeshoptEncoder.ready;
});
const triangles = (indices: Uint32Array) => {
  const counts = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) {
    const key = `${indices[i]},${indices[i + 1]},${indices[i + 2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

describe('build-time opaque triangle locality', () => {
  it('preserves oriented triangle triples, duplicates, sparse IDs and untouched input', () => {
    const indices = new Uint32Array([900, 7, 400, 7, 5, 400, 900, 7, 400, 8, 8, 8, 5, 1, 400]);
    const original = indices.slice();
    const ordered = orderOpaqueTriangles(indices, 1024);
    expect(ordered).not.toBe(indices);
    expect(indices).toEqual(original);
    expect(triangles(ordered)).toEqual(triangles(original));
    expect(orderOpaqueTriangles(indices, 1024)).toEqual(ordered);
  });
  it('reduces a reproducible FIFO locality cost without removing any grid triangle', () => {
    const size = 24,
      list: number[][] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const a = y * (size + 1) + x,
          b = a + size + 1;
        list.push([a, b, a + 1], [a + 1, b, b + 1]);
      }
    // Deterministic interleaving intentionally destroys adjacent triangle reuse.
    const input = new Uint32Array(list.flatMap((_, i) => list[(i * 541) % list.length]));
    const ordered = orderOpaqueTriangles(input, (size + 1) ** 2);
    expect(triangles(ordered)).toEqual(triangles(input));
    expect(fifoVertexMisses(ordered, (size + 1) ** 2)).toBeLessThan(
      fifoVertexMisses(input, (size + 1) ** 2) * 0.7,
    );
  });
  it('rejects empty, non-triangle, out-of-range and oversized inputs before allocating encoder state', () => {
    for (const indices of [new Uint32Array(), new Uint32Array([0, 1]), new Uint32Array([0, 1, 3])])
      expect(() => orderOpaqueTriangles(indices, 3)).toThrow('Invalid triangle cache input');
    for (const vertices of [0, -1, 1.1, Infinity, 4000001])
      expect(() => orderOpaqueTriangles(new Uint32Array([0, 0, 0]), vertices)).toThrow();
  });
});
