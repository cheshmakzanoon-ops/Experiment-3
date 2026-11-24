import { describe, expect, it, vi } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { TriangleBVH, rayHit, type ContactOwnership, type RayHit } from '../src/simulation/bvh.ts';

/** Frozen right-first traversal and triangle equations from the original BVH.
 * Keep the reference independent of the optimized raycast and its tie ranking. */
function legacyRaycast(
  tree: TriangleBVH,
  origin: Vec3,
  direction: Vec3,
  maximum: number,
  hit = rayHit(),
) {
  const stack = [0];
  hit.distance = maximum;
  hit.triangle = -1;
  let trianglesTested = 0;
  while (stack.length) {
    const node = tree.nodes[stack.pop()!];
    let near = 0,
      far = hit.distance,
      intersects = true;
    for (let axis = 0; axis < 3; axis++) {
      const o = axis === 0 ? origin.x : axis === 1 ? origin.y : origin.z,
        d = axis === 0 ? direction.x : axis === 1 ? direction.y : direction.z;
      if (Math.abs(d) < 1e-12) {
        if (o < node.min[axis] - 1e-8 || o > node.max[axis] + 1e-8) {
          intersects = false;
          break;
        }
      } else {
        const a = (node.min[axis] - o) / d,
          b = (node.max[axis] - o) / d;
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
        if (near > far + 1e-8) {
          intersects = false;
          break;
        }
      }
    }
    if (!intersects) continue;
    if (node.left >= 0) stack.push(node.left, node.right);
    else {
      for (let j = node.start; j < node.end; j++) {
        trianglesTested++;
        legacyTriangle(tree, tree.orderedTriangle(j), origin, direction, hit);
      }
    }
  }
  return { found: hit.triangle !== -1, hit, trianglesTested };
}

function legacyTriangle(tree: TriangleBVH, t: number, o: Vec3, d: Vec3, hit: RayHit) {
  const v = tree.vertices,
    idx = tree.indices,
    a = idx[t * 3] * 3,
    b = idx[t * 3 + 1] * 3,
    c = idx[t * 3 + 2] * 3;
  const ex = v[b] - v[a],
    ey = v[b + 1] - v[a + 1],
    ez = v[b + 2] - v[a + 2],
    fx = v[c] - v[a],
    fy = v[c + 1] - v[a + 1],
    fz = v[c + 2] - v[a + 2];
  const px = d.y * fz - d.z * fy,
    py = d.z * fx - d.x * fz,
    pz = d.x * fy - d.y * fx,
    determinant = ex * px + ey * py + ez * pz;
  if (Math.abs(determinant) < 1e-12) return;
  const x = o.x - v[a],
    y = o.y - v[a + 1],
    z = o.z - v[a + 2],
    u = (x * px + y * py + z * pz) / determinant;
  if (u < -1e-8 || u > 1 + 1e-8) return;
  const qx = y * ez - z * ey,
    qy = z * ex - x * ez,
    qz = x * ey - y * ex,
    w = (d.x * qx + d.y * qy + d.z * qz) / determinant;
  if (w < -1e-8 || u + w > 1 + 1e-8) return;
  const distance = (fx * qx + fy * qy + fz * qz) / determinant;
  if (distance < 0 || distance > hit.distance) return;
  if (
    tree.ownsContact &&
    !tree.ownsContact(t, o.x + d.x * distance, o.y + d.y * distance, o.z + d.z * distance)
  )
    return;
  hit.distance = distance;
  hit.triangle = t;
  hit.point.copy(o).addScaled(d, distance);
  if (tree.normals) {
    const n = tree.normals;
    hit.normal
      .set(
        n[a] * (1 - u - w) + n[b] * u + n[c] * w,
        n[a + 1] * (1 - u - w) + n[b + 1] * u + n[c + 1] * w,
        n[a + 2] * (1 - u - w) + n[b + 2] * u + n[c + 2] * w,
      )
      .normalize();
  } else hit.normal.set(ey * fz - ez * fy, ez * fx - ex * fz, ex * fy - ey * fx).normalize();
  if (hit.normal.dot(d) > 0) hit.normal.scale(-1);
}

function seeded(seed: number) {
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function layers(count: number, ownsContact?: ContactOwnership) {
  const vertices: number[] = [],
    indices: number[] = [];
  for (let x = 1; x <= count; x++) {
    const n = vertices.length / 3;
    vertices.push(x, -1, -1, x, 1, -1, x, -1, 1, x, 1, 1);
    indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
  }
  return new TriangleBVH(
    Float64Array.from(vertices),
    Uint32Array.from(indices),
    undefined,
    ownsContact,
  );
}

function expectReference(tree: TriangleBVH, origin: Vec3, direction: Vec3, maximum: number) {
  const expected = legacyRaycast(tree, origin, direction, maximum),
    actual = rayHit();
  expect(tree.raycast(origin, direction, maximum, actual)).toBe(expected.found);
  expect(actual).toEqual(expected.hit);
  return expected;
}

describe('deferred BVH contact resolution', () => {
  it('matches the legacy result exactly for 4,096 seeded rays with normals and ownership', () => {
    const random = seeded(0xa341316c),
      vertices: number[] = [],
      normals: number[] = [],
      indices: number[] = [],
      targets: Vec3[] = [];
    for (let i = 0; i < 192; i++) {
      const x = random() * 24 - 12,
        y = random() * 24 - 12,
        z = random() * 24 - 12,
        n = vertices.length / 3;
      const points = [x, y, z];
      for (let j = 0; j < 2; j++)
        points.push(x + random() * 4 - 2, y + random() * 4 - 2, z + random() * 4 - 2);
      vertices.push(...points);
      for (let j = 0; j < 9; j++) normals.push(random() * 2 - 1);
      indices.push(n, n + 1, n + 2);
      targets.push(
        new Vec3(
          (points[0] + points[3] + points[6]) / 3,
          (points[1] + points[4] + points[7]) / 3,
          (points[2] + points[5] + points[8]) / 3,
        ),
      );
      // Exact coincident faces can straddle leaves after centroid sorting.
      if (i % 13 === 0) indices.push(n, n + 1, n + 2);
    }
    const rayRandom = seeded(0x9e3779b9),
      rays = Array.from({ length: 1024 }, (_, i) => {
        const direction = new Vec3(
          rayRandom() * 2 - 1,
          rayRandom() * 2 - 1,
          rayRandom() * 2 - 1,
        ).normalize();
        if (i % 11 === 0) direction.set(1, -0, 0);
        if (i % 11 === 1) direction.set(0, -1, 0);
        if (i % 11 === 2) direction.set(1e-13, 0, -1).normalize();
        const distance = 1 + rayRandom() * 30,
          target = targets[i % targets.length],
          origin =
            i % 2 === 0
              ? new Vec3().copy(target).addScaled(direction, -distance)
              : new Vec3(rayRandom() * 40 - 20, rayRandom() * 40 - 20, rayRandom() * 40 - 20);
        if (i % 17 === 0) origin.copy(target);
        const maximum = i % 7 === 0 ? 0 : i % 7 === 1 ? distance : i % 7 === 2 ? 0.25 : 60;
        return { origin, direction, maximum };
      });
    const ownership: ContactOwnership = (triangle, x, y, z) => triangle % 7 !== 0 && x + y - z < 15;
    for (const withNormals of [false, true]) {
      for (const withOwnership of [false, true]) {
        const tree = new TriangleBVH(
          Float64Array.from(vertices),
          Uint32Array.from(indices),
          withNormals ? Float64Array.from(normals) : undefined,
          withOwnership ? ownership : undefined,
        );
        for (const { origin, direction, maximum } of rays)
          expectReference(tree, origin, direction, maximum);
      }
    }
  });

  it('keeps the legacy equal-distance winner across leaves with different entry distances', () => {
    const vertices: number[] = [],
      indices: number[] = [];
    for (let i = 0; i < 16; i++) {
      const n = vertices.length / 3;
      if (i % 2 === 0) vertices.push(-4, -4, -1, 0, 0, 1, 1, 1, -1);
      else vertices.push(0, -1, -1, 0, 1, -1, 0, 0, 1);
      indices.push(n, n + 1, n + 2);
    }
    const tree = new TriangleBVH(Float64Array.from(vertices), Uint32Array.from(indices)),
      expected = expectReference(tree, new Vec3(-5, 0, 0), new Vec3(1, 0, 0), 5);
    // IDs interleave the two leaves; choosing the largest triangle ID is wrong.
    expect(expected.hit.triangle).toBe(14);
    expect(expected.hit.distance).toBe(5);
    expect(Math.abs(expected.hit.normal.y)).toBeGreaterThan(0.7);
  });

  it('preserves a tolerated edge hit outside its leaf entry distance', () => {
    const vertices: number[] = [],
      indices: number[] = [];
    for (let i = 0; i < 16; i++) {
      const n = vertices.length / 3;
      if (i < 8) vertices.push(-1e-7, -1, -1, -1e-7, 1, -1, -1e-7, 0, 1);
      else vertices.push(0, 0, 0, 100, 1, 0, 100, 0, 1);
      indices.push(n, n + 1, n + 2);
    }
    const tree = new TriangleBVH(Float64Array.from(vertices), Uint32Array.from(indices));
    const expected = expectReference(tree, new Vec3(-10, -5e-9, 0), new Vec3(1, 0, 0), 200);
    // Near-first traversal incorrectly replaces this with triangle 7 at
    // 9.9999999: the tolerated hit lies before its leaf's entry distance of 10.
    expect(expected.hit.triangle).toBe(15);
    expect(expected.hit.distance).toBe(9.9999995);
  });

  it('preserves slab tolerances, ray limits, backwards rays and nearly parallel components', () => {
    const tree = layers(32),
      edges = [-1 - 1e-8, -1 - 1e-9, -1, 0, 1, 1 + 1e-9, 1 + 1e-8];
    for (const y of edges) {
      for (const z of edges) {
        for (const direction of [
          new Vec3(1, 0, -0),
          new Vec3(1, 1e-13, 0).normalize(),
          new Vec3(-1, 0, 0),
        ]) {
          for (const maximum of [0, 1 - 1e-9, 1, 1 + 1e-8, 40])
            expectReference(tree, new Vec3(0, y, z), direction, maximum);
        }
      }
    }
  });

  it('does not let rejected nearer contacts shorten traversal before an owned surface', () => {
    const tree = layers(512, (_triangle, x) => x >= 120),
      origin = new Vec3(0, 0.25, -0.125),
      direction = new Vec3(1, 0, 0),
      expected = expectReference(tree, origin, direction, 513);
    expect(expected.hit.distance).toBe(120);
    expect(tree.trianglesTested).toBe(1024);
    expect(expected.trianglesTested).toBe(1024);
    expectReference(tree, origin, direction, 119);
  });

  it('preserves aliased ray inputs and leaves contact details unchanged after misses', () => {
    const tree = layers(16);
    for (const alias of ['origin-point', 'origin-normal', 'direction-point', 'direction-normal']) {
      const setup = () => {
        const out = rayHit();
        let origin = new Vec3(0, 0.25, -0.125),
          direction = new Vec3(1, 0, 0);
        if (alias === 'origin-point') origin = out.point.copy(origin);
        if (alias === 'origin-normal') origin = out.normal.copy(origin);
        if (alias === 'direction-point') direction = out.point.copy(direction);
        if (alias === 'direction-normal') direction = out.normal.copy(direction);
        return { out, origin, direction };
      };
      const reference = setup(),
        actual = setup(),
        expected = legacyRaycast(tree, reference.origin, reference.direction, 20, reference.out);
      expect(tree.raycast(actual.origin, actual.direction, 20, actual.out)).toBe(expected.found);
      expect(actual).toEqual(reference);
    }
    const expected = rayHit(),
      actual = rayHit(),
      direction = new Vec3(1, 0, 0);
    for (const origin of [new Vec3(0, 0.25, 0), new Vec3(0, 5, 5)]) {
      const reference = legacyRaycast(tree, origin, direction, 20, expected);
      expect(tree.raycast(origin, direction, 20, actual)).toBe(reference.found);
      expect(actual).toEqual(expected);
    }
  });

  it('resolves point and normal only once per hit for 128 rays through 512 layers', () => {
    const tree = layers(512),
      random = seeded(0x510e527f),
      normalize = vi.spyOn(Vec3.prototype, 'normalize'),
      addScaled = vi.spyOn(Vec3.prototype, 'addScaled');
    let legacyChecks = 0,
      deferredChecks = 0,
      legacyNormals = 0,
      deferredNormals = 0,
      legacyPoints = 0,
      deferredPoints = 0;
    try {
      for (const side of [1, -1]) {
        for (let i = 0; i < 64; i++) {
          const origin = new Vec3(side === 1 ? 0 : 513, random() - 0.5, random() - 0.5),
            direction = new Vec3(side, 0, 0),
            expected = legacyRaycast(tree, origin, direction, 514),
            actual = rayHit();
          legacyChecks += expected.trianglesTested;
          legacyNormals += normalize.mock.calls.length;
          legacyPoints += addScaled.mock.calls.length;
          normalize.mockClear();
          addScaled.mockClear();
          expect(tree.raycast(origin, direction, 514, actual)).toBe(expected.found);
          expect(actual).toEqual(expected.hit);
          deferredChecks += tree.trianglesTested;
          deferredNormals += normalize.mock.calls.length;
          deferredPoints += addScaled.mock.calls.length;
          expect(normalize).toHaveBeenCalledTimes(1);
          expect(addScaled).toHaveBeenCalledTimes(1);
          normalize.mockClear();
          addScaled.mockClear();
        }
      }
    } finally {
      normalize.mockRestore();
      addScaled.mockRestore();
    }
    // Work counts are deterministic; this makes no wall-clock or FPS claim.
    expect({ legacyChecks, deferredChecks }).toEqual({
      legacyChecks: 66048,
      deferredChecks: 66048,
    });
    expect({ legacyNormals, deferredNormals }).toEqual({
      legacyNormals: 8448,
      deferredNormals: 128,
    });
    expect({ legacyPoints, deferredPoints }).toEqual({ legacyPoints: 8448, deferredPoints: 128 });
  });
});
