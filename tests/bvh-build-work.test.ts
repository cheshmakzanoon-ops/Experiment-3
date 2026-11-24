import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { TriangleBVH, VerticalRayColumn, rayHit } from '../src/simulation/bvh.ts';
import { TireFootprint } from '../src/simulation/tire-footprint.ts';

type Geometry = ConstructorParameters<typeof TriangleBVH>;
type BuildState = {
  nodes: TriangleBVH['nodes'];
  vertices: Float64Array;
  indices: Uint32Array;
  order: number[];
  centroids: Float64Array;
  build(start: number, end: number): number;
  compare(a: number, b: number, axis: number): number;
  heapSort(start: number, end: number, axis: number): void;
};

/** Frozen constructor recursion from 5edead7. The production constructor still
 * computes its original centroids; this reference retains slice/sort/copy-back
 * at every internal node, independently of the replacement range operations. */
function originalBuild(this: BuildState, start: number, end: number): number {
  const node = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
    left: -1,
    right: -1,
    start,
    end,
  };
  const id = this.nodes.push(node) - 1;
  for (let j = start; j < end; j++)
    for (let k = 0; k < 3; k++) {
      const p = this.indices[this.order[j] * 3 + k] * 3;
      for (let a = 0; a < 3; a++) {
        node.min[a] = Math.min(node.min[a], this.vertices[p + a]);
        node.max[a] = Math.max(node.max[a], this.vertices[p + a]);
      }
    }
  if (end - start > 8) {
    let axis = 0;
    for (let a = 1; a < 3; a++)
      if (node.max[a] - node.min[a] > node.max[axis] - node.min[axis]) axis = a;
    const part = this.order.slice(start, end);
    part.sort((a, b) => this.centroids[a * 3 + axis] - this.centroids[b * 3 + axis] || a - b);
    for (let j = 0; j < part.length; j++) this.order[start + j] = part[j];
    const middle = (start + end) >>> 1;
    node.left = this.build(start, middle);
    node.right = this.build(middle, end);
  }
  return id;
}

function originalTree(geometry: Geometry) {
  const prototype = TriangleBVH.prototype as unknown as BuildState,
    build = prototype.build;
  try {
    prototype.build = originalBuild;
    return new TriangleBVH(...geometry);
  } finally {
    prototype.build = build;
  }
}

function seeded(seed: number) {
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

type Pattern = 'random' | 'sorted' | 'reverse' | 'equal' | 'degenerate' | 'organ-pipe';
function geometry(count: number, pattern: Pattern = 'random', seed = 18731): Geometry {
  const random = seeded(seed),
    vertices = new Float64Array(count * 9),
    indices = Uint32Array.from({ length: count * 3 }, (_, i) => i);
  for (let i = 0; i < count; i++) {
    if (pattern === 'equal') {
      const size = 1 + (i % 19);
      vertices.set([size, 0, 0, -size, size, -size, 0, -size, size], i * 9);
    } else if (pattern !== 'degenerate') {
      const x =
          pattern === 'random'
            ? random() * 1000
            : pattern === 'reverse'
              ? count - i
              : pattern === 'organ-pipe'
                ? Math.min(i, count - i)
                : i,
        y = pattern === 'random' ? random() * 20 : 0,
        z = pattern === 'random' ? random() * 1000 : 0;
      vertices.set([x, y, z, x + 1, y, z, x, y, z + 1], i * 9);
    }
  }
  return [vertices, indices];
}

function order(tree: TriangleBVH) {
  return Array.from({ length: tree.indices.length / 3 }, (_, i) => tree.orderedTriangle(i));
}

function expectOriginal(geometry: Geometry) {
  const actual = new TriangleBVH(...geometry),
    expected = originalTree(geometry);
  expect(actual.nodes).toEqual(expected.nodes);
  expect(order(actual)).toEqual(order(expected));
  return { actual, expected };
}

/** Count actual comparator calls and explicitly copied ranges. Restore all
 * hooks before assertions, so neither Vitest work nor timing is measured. */
function buildWork(geometry: Geometry, original: boolean) {
  const prototype = TriangleBVH.prototype as unknown as BuildState,
    compare = prototype.compare,
    heapSort = prototype.heapSort,
    slice = Array.prototype.slice,
    sort = Array.prototype.sort,
    work = { slices: 0, copiedIDs: 0, sorts: 0, comparisons: 0, heapFallbacks: 0 };
  try {
    prototype.compare = function (a, b, axis) {
      work.comparisons++;
      return compare.call(this, a, b, axis);
    };
    prototype.heapSort = function (start, end, axis) {
      work.heapFallbacks++;
      return heapSort.call(this, start, end, axis);
    };
    Array.prototype.slice = function <T>(this: T[], start?: number, end?: number) {
      const part = slice.call(this, start, end) as T[];
      work.slices++;
      work.copiedIDs += part.length;
      return part;
    };
    Array.prototype.sort = function <T>(this: T[], comparator?: (a: T, b: T) => number) {
      work.sorts++;
      return sort.call(
        this,
        comparator
          ? (a: T, b: T) => {
              work.comparisons++;
              return comparator(a, b);
            }
          : undefined,
      ) as T[];
    };
    const tree = original ? originalTree(geometry) : new TriangleBVH(...geometry);
    return { tree, work };
  } finally {
    prototype.compare = compare;
    prototype.heapSort = heapSort;
    Array.prototype.slice = slice;
    Array.prototype.sort = sort;
  }
}

describe('BVH construction work and exact ordering', () => {
  it.each<Pattern>(['random', 'sorted', 'reverse', 'equal', 'degenerate', 'organ-pipe'])(
    'preserves every node and leaf across small %s partitions',
    (pattern) => {
      for (const count of [1, 2, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127])
        expectOriginal(geometry(count, pattern));
    },
  );

  it('preserves complete large, uneven and independently seeded hierarchies', () => {
    for (const [count, seed] of [
      [8192, 18731],
      [16385, 0x9e3779b9],
      [32769, 0xa341316c],
    ])
      expectOriginal(geometry(count, 'random', seed));
  });

  it('retains overflowed centroids, signed zero and subnormal tie ordering', () => {
    const vertices = new Float64Array(96 * 9),
      indices = Uint32Array.from({ length: 96 * 3 }, (_, i) => i),
      values = [1e308, -1e308, Number.MAX_VALUE, -Number.MAX_VALUE, 0, -0, 5e-324, -5e-324];
    for (let i = 0; i < 96; i++) {
      const x = values[i % values.length],
        y = values[(i * 3 + 1) % values.length],
        z = values[(i * 5 + 2) % values.length];
      vertices.set([x, y, z, x, y, z, -x, -y, -z], i * 9);
    }
    expectOriginal([vertices, indices]);
    const zeroVertices = new Float64Array(33 * 9);
    for (let i = 0; i < zeroVertices.length; i++) zeroVertices[i] = i % 3 === 0 ? -0 : 0;
    const { actual } = expectOriginal([
      zeroVertices,
      Uint32Array.from({ length: 33 * 3 }, (_, i) => i),
    ]);
    expect(Object.is(actual.nodes[0].min[0], -0)).toBe(true);
    expect(Object.is(actual.nodes[0].max[1], 0)).toBe(true);
  });

  it('removes recursive range copies and halves the audited random comparison workload', () => {
    const fixture = geometry(8192),
      expected = buildWork(fixture, true),
      actual = buildWork(fixture, false);
    expect(expected.work).toEqual({
      slices: 1023,
      copiedIDs: 81920,
      sorts: 1023,
      comparisons: 519166,
      heapFallbacks: 0,
    });
    expect(actual.work.slices).toBe(0);
    expect(actual.work.copiedIDs).toBe(0);
    expect(actual.work.sorts).toBe(0);
    expect(actual.work.comparisons).toBeLessThan(expected.work.comparisons / 2);
    expect(actual.tree.nodes).toEqual(expected.tree.nodes);
    expect(order(actual.tree)).toEqual(order(expected.tree));
  });

  it.each<Pattern>(['sorted', 'reverse', 'equal', 'degenerate'])(
    'reuses the complete %s ordering without repeated child sorts',
    (pattern) => {
      const { work } = buildWork(geometry(8192, pattern), false);
      expect(work.comparisons).toBe(8191);
      expect(work.slices).toBe(0);
      expect(work.heapFallbacks).toBe(0);
    },
  );

  it('bounds adversarial median partitions with an exact heap fallback', () => {
    const fixture = geometry(8192, 'organ-pipe'),
      actual = buildWork(fixture, false),
      expected = originalTree(fixture);
    expect(actual.work.heapFallbacks).toBeGreaterThan(0);
    expect(actual.work.comparisons).toBeLessThan(8192 * 13 * 8);
    expect(actual.tree.nodes).toEqual(expected.nodes);
    expect(order(actual.tree)).toEqual(order(expected));
  });

  it('preserves ray, vertical-column and tire-footprint outputs and candidate counts', () => {
    const fixture = geometry(513, 'random', 0x510e527f),
      random = seeded(0x243f6a88),
      normals = Float64Array.from(fixture[0], (_, i) =>
        i % 3 === 1 ? 1 : random() * 0.25 - 0.125,
      );
    for (const withNormals of [false, true]) {
      for (const withOwnership of [false, true]) {
        const { actual, expected } = expectOriginal([
            fixture[0],
            fixture[1],
            withNormals ? normals : undefined,
            withOwnership
              ? (triangle, x, y, z) => triangle % 7 !== 0 && x + z - y > 250
              : undefined,
          ]),
          actualColumn = new VerticalRayColumn(),
          expectedColumn = new VerticalRayColumn(),
          actualFootprint = new TireFootprint(actual),
          expectedFootprint = new TireFootprint(expected),
          hit = rayHit(),
          reference = rayHit();
        for (let i = 0; i < 512; i++) {
          const triangle = (i * 37) % 513,
            at = triangle * 9,
            target = new Vec3(
              fixture[0][at] + (i % 9 === 0 ? -5e-9 : 0.25),
              fixture[0][at + 1],
              fixture[0][at + 2] + 0.25,
            ),
            direction =
              i % 3 === 0
                ? new Vec3(0, -1, -0)
                : new Vec3(random() - 0.5, -1, random() - 0.5).normalize(),
            origin = new Vec3().copy(target).addScaled(direction, -10),
            maximum = i % 11 === 0 ? 0 : i % 11 === 1 ? 10 : 20;
          expect(actual.raycast(origin, direction, maximum, hit)).toBe(
            expected.raycast(origin, direction, maximum, reference),
          );
          expect(hit).toEqual(reference);
          expect(actual.trianglesTested).toBe(expected.trianglesTested);
          origin.copy(target);
          direction.set(0, -1, 0);
          for (const height of [10, 5, -1]) {
            origin.y = target.y + height;
            expect(actual.raycastVertical(origin, maximum, hit, actualColumn)).toBe(
              expected.raycastVertical(origin, maximum, reference, expectedColumn),
            );
            expect(hit).toEqual(reference);
            expect(actual.trianglesTested).toBe(expected.trianglesTested);
            const axle = new Vec3(1, 0, 0),
              prior = i % 2 === 0 ? Infinity : 9.7;
            expect(
              actualFootprint.cast(origin, direction, maximum, 0.3, 0.15, axle, prior, hit),
            ).toBe(
              expectedFootprint.cast(origin, direction, maximum, 0.3, 0.15, axle, prior, reference),
            );
            expect(hit).toEqual(reference);
            expect(actualFootprint.trianglesTested).toBe(expectedFootprint.trianglesTested);
            expect(actualFootprint.featureTests).toBe(expectedFootprint.featureTests);
          }
        }
      }
    }
  });

  it('keeps coincident-face winners and the tolerated edge hit before its leaf entry', () => {
    for (const tolerated of [false, true]) {
      const vertices: number[] = [],
        indices: number[] = [];
      for (let i = 0; i < 16; i++) {
        const n = vertices.length / 3;
        if (tolerated) {
          if (i < 8) vertices.push(-1e-7, -1, -1, -1e-7, 1, -1, -1e-7, 0, 1);
          else vertices.push(0, 0, 0, 100, 1, 0, 100, 0, 1);
        } else if (i % 2 === 0) vertices.push(-4, -4, -1, 0, 0, 1, 1, 1, -1);
        else vertices.push(0, -1, -1, 0, 1, -1, 0, 0, 1);
        indices.push(n, n + 1, n + 2);
      }
      const { actual, expected } = expectOriginal([
          Float64Array.from(vertices),
          Uint32Array.from(indices),
        ]),
        origin = tolerated ? new Vec3(-10, -5e-9, 0) : new Vec3(-5, 0, 0),
        direction = new Vec3(1, 0, 0),
        hit = rayHit(),
        reference = rayHit();
      expect(actual.raycast(origin, direction, 200, hit)).toBe(true);
      expect(expected.raycast(origin, direction, 200, reference)).toBe(true);
      expect(hit).toEqual(reference);
      expect(actual.trianglesTested).toBe(expected.trianglesTested);
      expect(hit.triangle).toBe(tolerated ? 15 : 14);
      expect(hit.distance).toBe(tolerated ? 9.9999995 : 5);
    }
  });
});
