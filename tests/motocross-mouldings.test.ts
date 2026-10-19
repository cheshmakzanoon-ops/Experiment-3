import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  motocrossFender,
  motocrossForkGuard,
  motocrossTripleClamp,
} from '../src/rendering/offroad/motocross-detail.ts';

/** Check the submitted triangle topology, joining duplicated seam vertices.
 * A painted closed face or unrelated upper/lower sheets cannot pass this. */
function closedShell(geometry: T.BufferGeometry) {
  const positions = geometry.getAttribute('position'),
    index = geometry.index,
    edges = new Map<string, { count: number; direction: number }>(),
    points = [new T.Vector3(), new T.Vector3(), new T.Vector3()],
    cross = new T.Vector3();
  let volume = 0;
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    const keys: string[] = [];
    for (let corner = 0; corner < 3; corner++) {
      points[corner].fromBufferAttribute(positions, index?.getX(i + corner) ?? i + corner);
      keys.push(
        points[corner]
          .toArray()
          .map((x) => Math.round(x * 1e7))
          .join(','),
      );
    }
    expect(
      new T.Triangle(...(points as [T.Vector3, T.Vector3, T.Vector3])).getArea(),
    ).toBeGreaterThan(1e-12);
    volume += points[0].dot(cross.crossVectors(points[1], points[2])) / 6;
    for (let corner = 0; corner < 3; corner++) {
      const a = keys[corner],
        b = keys[(corner + 1) % 3],
        key = a < b ? `${a}|${b}` : `${b}|${a}`,
        edge = edges.get(key) ?? { count: 0, direction: 0 };
      edge.count++;
      edge.direction += a < b ? 1 : -1;
      edges.set(key, edge);
    }
  }
  for (const edge of edges.values()) expect(edge).toEqual({ count: 2, direction: 0 });
  expect(volume).toBeGreaterThan(0);
  for (const attribute of Object.values(geometry.attributes))
    expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
  return volume;
}

function inspect(geometry: T.BufferGeometry) {
  const material = new T.MeshBasicMaterial(),
    mesh = new T.Mesh(geometry, material),
    ray = new T.Raycaster();
  return {
    cast(origin: T.Vector3, direction: T.Vector3) {
      ray.set(origin, direction);
      return ray.intersectObject(mesh);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

describe('motocross formed bodywork', () => {
  for (const front of [true, false])
    it.each(['high', 'mid', 'far'] as const)(
      `${front ? 'front' : 'rear'} %s fender has outward skins, real wall thickness and closed lips`,
      (detail) => {
        const geometry = motocrossFender(front, detail),
          view = inspect(geometry);
        try {
          const volume = closedShell(geometry);
          expect(volume).toBeGreaterThan(front ? 0.00035 : 0.0002);
          expect(volume).toBeLessThan(front ? 0.00065 : 0.0004);
          // Front-sided rays from above/below test raster winding, not merely
          // a DoubleSide material hiding an inside-out patch.
          for (const z of front ? [-0.18, 0.08, 0.32, 0.44] : [-1.04, -0.91, -0.73])
            for (const x of [-0.025, 0, 0.025]) {
              const top = view.cast(new T.Vector3(x, 1, z), new T.Vector3(0, -1, 0))[0],
                bottom = view.cast(new T.Vector3(x, -1, z), new T.Vector3(0, 1, 0))[0];
              expect(top).toBeDefined();
              expect(bottom).toBeDefined();
              const separation = top.point.y - bottom.point.y;
              expect(separation).toBeGreaterThan(0.0031);
              expect(separation).toBeLessThan(0.0055);
              expect(top.face!.normal.y).toBeGreaterThan(0.6);
              expect(bottom.face!.normal.y).toBeLessThan(-0.6);
            }
          expect(geometry.boundingBox!.max.x - geometry.boundingBox!.min.x).toBeLessThan(0.225);
          expect(geometry.index!.count / 3).toBeLessThan(2000);
        } finally {
          view.dispose();
        }
      },
    );

  it.each(['high', 'mid'] as const)(
    '%s fork guard is a closed 3 mm C-section with a real open rear and clearance around the fork tube',
    (detail) => {
      const geometry = motocrossForkGuard(detail),
        view = inspect(geometry);
      try {
        const volume = closedShell(geometry);
        expect(volume).toBeGreaterThan(0.0001);
        expect(volume).toBeLessThan(0.00025);
        const positions = geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++)
          expect(Math.hypot(positions.getX(i), positions.getZ(i))).toBeGreaterThan(0.0325);
        for (const y of [0.08, 0.2, 0.3]) {
          // An observer inside the fork bore sees the inner surface ahead and
          // at either side, while the rear is actually open to the lower tube.
          expect(view.cast(new T.Vector3(0, y, 0), new T.Vector3(0, 0, -1))).toHaveLength(0);
          for (const direction of [
            new T.Vector3(0, 0, 1),
            new T.Vector3(-1, 0, 0),
            new T.Vector3(1, 0, 0),
          ]) {
            const inner = view.cast(new T.Vector3(0, y, 0), direction)[0],
              outer = view.cast(
                direction
                  .clone()
                  .multiplyScalar(0.1)
                  .add(new T.Vector3(0, y, 0)),
                direction.clone().negate(),
              )[0];
            expect(inner).toBeDefined();
            expect(outer).toBeDefined();
            expect(outer.point.distanceTo(inner.point)).toBeGreaterThan(0.0027);
            expect(outer.point.distanceTo(inner.point)).toBeLessThan(0.004);
          }
        }
        expect(geometry.index!.count / 3).toBeLessThan(1000);
      } finally {
        view.dispose();
      }
    },
  );

  it.each(['high', 'mid'] as const)(
    '%s triple clamp leaves the full fork cross-sections open inside continuous collars',
    (detail) => {
      const view = inspect(motocrossTripleClamp(detail, 0.035, 0.022));
      try {
        for (const side of [-1, 1]) {
          for (let a = 0; a < 32; a++) {
            const angle = (a * Math.PI) / 16;
            expect(
              view.cast(
                new T.Vector3(
                  side * 0.095 + Math.cos(angle) * 0.03,
                  0.2,
                  0.022 + Math.sin(angle) * 0.03,
                ),
                new T.Vector3(0, -1, 0),
              ),
            ).toHaveLength(0);
          }
          expect(
            view.cast(new T.Vector3(side * 0.132, 0.2, 0.022), new T.Vector3(0, -1, 0)),
          ).toHaveLength(1);
        }
        expect(view.cast(new T.Vector3(0, 0.2, 0), new T.Vector3(0, -1, 0))).toHaveLength(0);
        expect(view.cast(new T.Vector3(0.035, 0.2, 0), new T.Vector3(0, -1, 0))).toHaveLength(1);
      } finally {
        view.dispose();
      }
    },
  );
});
