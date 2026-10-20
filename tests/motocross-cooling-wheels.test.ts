import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { addMotocrossRadiators } from '../src/rendering/offroad/motocross-radiators.ts';
import {
  motocrossWheelHub,
  motocrossWheelSpokes,
} from '../src/rendering/offroad/motocross-wheel-detail.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());

function disposeGeometry(root: T.Object3D) {
  root.traverse((o) => {
    if (o instanceof T.Mesh) o.geometry.dispose();
  });
}

/** Recover connected pieces from the actual rendered triangles, ignoring UV
 * and normal seams. This checks the lacing that was built, not debug anchors. */
function connectedPieces(geometry: T.BufferGeometry) {
  const position = geometry.getAttribute('position'),
    ids = new Map<string, number>(),
    points: T.Vector3[] = [],
    weld: number[] = [],
    parent: number[] = [];
  for (let i = 0; i < position.count; i++) {
    const point = new T.Vector3().fromBufferAttribute(position, i),
      key = point
        .toArray()
        .map((v) => Math.round(v * 1e7))
        .join(',');
    if (!ids.has(key)) {
      ids.set(key, points.length);
      parent.push(points.length);
      points.push(point);
    }
    weld.push(ids.get(key)!);
  }
  const root = (id: number): number => (parent[id] === id ? id : (parent[id] = root(parent[id])));
  for (let i = 0; i < (geometry.index?.count ?? position.count); i += 3) {
    const a = weld[geometry.index?.getX(i) ?? i],
      b = weld[geometry.index?.getX(i + 1) ?? i + 1],
      c = weld[geometry.index?.getX(i + 2) ?? i + 2];
    parent[root(b)] = root(a);
    parent[root(c)] = root(a);
  }
  const pieces = new Map<number, T.Vector3[]>();
  points.forEach((point, i) => {
    const key = root(i),
      group = pieces.get(key) ?? [];
    group.push(point);
    pieces.set(key, group);
  });
  return [...pieces.values()];
}

describe('motocross open cooling and laced wheels', () => {
  it.each(['high', 'mid'] as const)(
    '%s radiators contain supported fins and real air passages behind the guards',
    (detail) => {
      const parent = new T.Group(),
        materials = new BikeMaterials(0),
        ray = new T.Raycaster(),
        direction = new T.Vector3(0, 0, -1);
      addMotocrossRadiators(parent, detail, materials);
      parent.updateMatrixWorld(true);
      try {
        for (const side of [-1, 1]) {
          let open = 0,
            blocked = 0;
          for (let row = 0; row < 31; row++)
            for (let column = 0; column < 17; column++) {
              ray.set(
                new T.Vector3(
                  side * 0.115 - 0.04 + ((column + 0.31) * 0.08) / 17,
                  -0.21 + ((row + 0.37) * 0.21) / 31,
                  0.3,
                ),
                direction,
              );
              if (ray.intersectObject(parent).length) blocked++;
              else open++;
            }
          expect(open / (open + blocked)).toBeGreaterThan(0.4);
          expect(blocked / (open + blocked)).toBeGreaterThan(0.15);
        }
        const bounds = new T.Box3().setFromObject(parent);
        expect(bounds.min.x).toBeGreaterThan(-0.17);
        expect(bounds.max.x).toBeLessThan(0.17);
        expect(bounds.max.z).toBeLessThan(0.233);
        expect(bounds.min.y).toBeGreaterThan(-0.295);
        for (const child of parent.children)
          if (child instanceof T.Mesh) {
            const geometry: T.BufferGeometry = child.geometry;
            for (const attribute of Object.values(geometry.attributes))
              expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
          }
      } finally {
        disposeGeometry(parent);
        materials.dispose();
      }
    },
  );

  it.each(['high', 'mid'] as const)(
    '%s hub preserves a clear axle bore and substantial flange shoulders',
    (detail) => {
      const geometry = motocrossWheelHub(detail),
        material = new T.MeshBasicMaterial(),
        mesh = new T.Mesh(geometry, material),
        ray = new T.Raycaster();
      try {
        for (const side of [-1, 1])
          for (let i = 0; i < 16; i++) {
            const angle = (i * Math.PI) / 8,
              direction = new T.Vector3(-side, 0, 0);
            ray.set(
              new T.Vector3(side * 0.1, Math.cos(angle) * 0.009, Math.sin(angle) * 0.009),
              direction,
            );
            expect(ray.intersectObject(mesh)).toHaveLength(0);
            ray.set(
              new T.Vector3(side * 0.1, Math.cos(angle) * 0.044, Math.sin(angle) * 0.044),
              direction,
            );
            expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
          }
      } finally {
        geometry.dispose();
        material.dispose();
      }
    },
  );

  for (const rim of [0.2667, 0.2286])
    it.each(['high', 'mid'] as const)(
      `%s ${rim} m rim has equal opposing spokes on both flanges and seated nipples`,
      (detail) => {
        const geometry = motocrossWheelSpokes(rim, detail);
        try {
          const pieces = connectedPieces(geometry),
            counts = [
              [0, 0],
              [0, 0],
            ],
            radial = (p: T.Vector3) => Math.hypot(p.y, p.z);
          let nippleCount = 0;
          for (const points of pieces) {
            const radii = points.map(radial),
              min = Math.min(...radii),
              max = Math.max(...radii);
            expect(max).toBeLessThan(rim + 0.004);
            if (max - min < 0.025) {
              nippleCount++;
              expect(max).toBeGreaterThan(rim - 0.004);
              expect(min).toBeGreaterThan(rim - 0.018);
              continue;
            }
            const average = (list: T.Vector3[]) =>
                list.reduce((sum, p) => sum.add(p), new T.Vector3()).divideScalar(list.length),
              inner = average(points.filter((p) => radial(p) < min + 0.008)),
              outer = average(points.filter((p) => radial(p) > max - 0.008)),
              twist = inner.y * outer.z - inner.z * outer.y;
            expect(Math.abs(inner.x)).toBeGreaterThan(0.035);
            expect(Math.abs(outer.x)).toBeLessThan(0.012);
            expect(Math.abs(twist)).toBeGreaterThan(0.005);
            counts[inner.x > 0 ? 0 : 1][twist > 0 ? 0 : 1]++;
          }
          const perDirection = detail === 'high' ? 9 : 5;
          expect(counts).toEqual([
            [perDirection, perDirection],
            [perDirection, perDirection],
          ]);
          expect(nippleCount).toBe(perDirection * 4);
        } finally {
          geometry.dispose();
        }
      },
    );

  for (const id of ['mx250', 'mx450'])
    it(`${id} complete high-detail bike and rider stay inside the existing geometry budget`, () => {
      const materials = new BikeMaterials(0),
        model = new DirtBikeModel(VEHICLES[id], 0, 'high', materials, mudUniforms());
      try {
        let triangles = 0;
        model.root.traverse((object) => {
          if (object instanceof T.Mesh)
            triangles +=
              ((object.geometry.index?.count ?? object.geometry.getAttribute('position').count) /
                3) *
              (object instanceof T.InstancedMesh ? object.count : 1);
        });
        expect(triangles).toBeLessThan(130000);
      } finally {
        model.dispose();
        materials.dispose();
      }
    });
});
