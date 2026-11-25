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
  build(start: number, end: number, sortedAxis?: number, leafAxis?: number): number;
  partition(start: number, end: number, middle: number, axis: number): boolean;
  insertionSort(start: number, end: number, axis: number): void;
};

/** Frozen build method from 1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb.
 * Keep the array-bound reduction independent of the scalar implementation;
 * this baseline already has the same partitioning and leaf-order rules. */
function originalBuild(this: BuildState, start: number, end: number, sortedAxis = -1, leafAxis = -1) {
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
    const middle = (start + end) >>> 1;
    if (sortedAxis !== axis) sortedAxis = this.partition(start, end, middle, axis) ? axis : -1;
    node.left = this.build(start, middle, sortedAxis, axis);
    node.right = this.build(middle, end, sortedAxis, axis);
  } else if (leafAxis >= 0 && sortedAxis !== leafAxis) {
    this.insertionSort(start, end, leafAxis);
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

function expectOriginal(geometry: Geometry) {
  const actual = new TriangleBVH(...geometry),
    expected = originalTree(geometry);
  // Vitest's numeric equality distinguishes positive and negative zero.
  expect(actual.nodes).toEqual(expected.nodes);
  for (let i = 0; i < geometry[1].length / 3; i++)
    expect(actual.orderedTriangle(i)).toBe(expected.orderedTriangle(i));
  return { actual, expected };
}

function terrain(rows: number, columns: number): Geometry {
  const vertices = new Float64Array((rows + 1) * (columns + 1) * 3),
    normals = new Float64Array(vertices.length),
    indices = new Uint32Array(rows * columns * 6);
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const vertex = row * (columns + 1) + column,
        x = column * 1.25 - columns * 0.625,
        z = row * 0.75 - rows * 0.375,
        normal = new Vec3(-0.2 * Math.cos(x), 1, 0.3 * Math.sin(z)).normalize();
      vertices.set([x, 0.2 * Math.sin(x) + 0.3 * Math.cos(z), z], vertex * 3);
      normals.set([normal.x, normal.y, normal.z], vertex * 3);
      if (row < rows && column < columns) {
        const next = vertex + columns + 1;
        indices.set(
          [vertex, next, vertex + 1, vertex + 1, next, next + 1],
          (row * columns + column) * 6,
        );
      }
    }
  }
  return [vertices, indices, normals];
}

describe('BVH scalar node bounds', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 2],
    [7, 5],
    [24, 17],
  ])('retains every node and triangle ID on a shared-vertex %i by %i terrain', (rows, columns) => {
    expectOriginal(terrain(rows, columns));
  });

  it('keeps signed-zero extrema on both root leaves and internal nodes', () => {
    for (const count of [1, 8, 9, 33]) {
      for (const sign of ['negative', 'positive', 'mixed']) {
        const vertices = Float64Array.from({ length: count * 9 }, (_, i) =>
            sign === 'negative' || (sign === 'mixed' && i % 2 === 0) ? -0 : 0,
          ),
          indices = Uint32Array.from({ length: count * 3 }, (_, i) => i),
          { actual } = expectOriginal([vertices, indices]);
        for (let axis = 0; axis < 3; axis++) {
          expect(actual.nodes[0].min[axis]).toBe(sign === 'positive' ? 0 : -0);
          expect(actual.nodes[0].max[axis]).toBe(sign === 'negative' ? -0 : 0);
        }
      }
    }
  });

  it('retains subnormal extrema and finite vertices with overflowed centroid sums', () => {
    const values = [Number.MAX_VALUE, -Number.MAX_VALUE, 5e-324, -5e-324, 0, -0],
      vertices = Float64Array.from(
        { length: 65 * 9 },
        (_, i) => values[Math.floor(i / 9) % values.length],
      ),
      indices = Uint32Array.from({ length: 65 * 3 }, (_, i) => i);
    expectOriginal([vertices, indices]);
  });

  it('retains point, collinear and coincident triangles with repeated centroid ties', () => {
    const vertices = new Float64Array(129 * 9),
      indices = Uint32Array.from({ length: 129 * 3 }, (_, i) => i);
    for (let i = 0; i < 129; i++) {
      const size = 1 + (i % 7);
      vertices.set(
        i % 3 === 0
          ? [0, -0, 0, 0, -0, 0, 0, -0, 0]
          : i % 3 === 1
            ? [-size, 0, -size, 0, -0, 0, size, 0, size]
            : [-1, 0, -1, 1, 0, -1, 0, 0, 2],
        i * 9,
      );
    }
    const { actual, expected } = expectOriginal([vertices, indices]),
      origin = new Vec3(0, 3, 0),
      direction = new Vec3(-0, -1, 0),
      hit = rayHit(),
      reference = rayHit();
    expect(actual.raycast(origin, direction, 5, hit)).toBe(true);
    expect(expected.raycast(origin, direction, 5, reference)).toBe(true);
    expect(hit).toEqual(reference);
    expect(actual.trianglesTested).toBe(expected.trianglesTested);
  });

  it('retains closest ray, cached vertical and tire-support hits with normals and ownership', () => {
    const fixture = terrain(12, 11),
      down = new Vec3(0, -1, -0),
      axle = new Vec3(1, 0, 0);
    let hits = 0,
      misses = 0;
    for (const withNormals of [false, true]) {
      for (const withOwnership of [false, true]) {
        const { actual, expected } = expectOriginal([
            fixture[0],
            fixture[1],
            withNormals ? fixture[2] : undefined,
            withOwnership ? (triangle, x, _y, z) => triangle % 5 !== 0 && x + z < 4 : undefined,
          ]),
          actualColumn = new VerticalRayColumn(),
          expectedColumn = new VerticalRayColumn(),
          actualFootprint = new TireFootprint(actual),
          expectedFootprint = new TireFootprint(expected),
          hit = rayHit(),
          reference = rayHit();
        for (let i = 0; i < 96; i++) {
          const triangle = (i * 37) % (fixture[1].length / 3),
            a = fixture[1][triangle * 3] * 3,
            b = fixture[1][triangle * 3 + 1] * 3,
            c = fixture[1][triangle * 3 + 2] * 3,
            target = new Vec3(
              fixture[0][a] * 0.5 + fixture[0][b] * 0.25 + fixture[0][c] * 0.25,
              fixture[0][a + 1] * 0.5 + fixture[0][b + 1] * 0.25 + fixture[0][c + 1] * 0.25,
              fixture[0][a + 2] * 0.5 + fixture[0][b + 2] * 0.25 + fixture[0][c + 2] * 0.25,
            ),
            direction = i % 2 ? new Vec3(0.2, -1, -0.1).normalize() : down,
            origin = new Vec3().copy(target).addScaled(direction, -3),
            maximum = i % 4 === 0 ? 0 : i % 4 === 1 ? 2.5 : 8,
            found = actual.raycast(origin, direction, maximum, hit);
          expect(found).toBe(expected.raycast(origin, direction, maximum, reference));
          expect(hit).toEqual(reference);
          expect(actual.trianglesTested).toBe(expected.trianglesTested);
          if (found) hits++;
          else misses++;
          origin.copy(target);
          for (const height of [3, 2, -1]) {
            origin.y = target.y + height;
            expect(actual.raycastVertical(origin, maximum, hit, actualColumn)).toBe(
              expected.raycastVertical(origin, maximum, reference, expectedColumn),
            );
            expect(hit).toEqual(reference);
            expect(actual.trianglesTested).toBe(expected.trianglesTested);
            const prior = i % 2 ? 2.7 : Infinity;
            expect(actualFootprint.cast(origin, down, maximum, 0.3, 0.15, axle, prior, hit)).toBe(
              expectedFootprint.cast(origin, down, maximum, 0.3, 0.15, axle, prior, reference),
            );
            expect(hit).toEqual(reference);
            expect(actualFootprint.trianglesTested).toBe(expectedFootprint.trianglesTested);
            expect(actualFootprint.featureTests).toBe(expectedFootprint.featureTests);
          }
        }
      }
    }
    expect(hits).toBeGreaterThan(0);
    expect(misses).toBeGreaterThan(0);
  });
});
