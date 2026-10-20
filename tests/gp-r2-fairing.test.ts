import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeModel, staticSag } from '../src/rendering/bike.ts';
import { gpR2LowerFairing } from '../src/rendering/gp-r2-fairing.ts';
import { gpCompactCowl } from '../src/rendering/gp-bodywork.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { meshColumnsFor, meshSurfaceIntrusion } from './gp-mesh-clearance.ts';

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'measureText'
          ? () => ({ width: 10 })
          : key === 'createLinearGradient' || key === 'createRadialGradient'
            ? () => ({ addColorStop: () => undefined })
            : () => undefined,
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());

describe('GP-R2 connected fairing skin', () => {
  it.each(['high', 'mid', 'far'] as const)(
    '%s has a thin closed skin around an open engine/radiator well',
    (detail) => {
      const geometry = gpR2LowerFairing(detail),
        material = new T.MeshBasicMaterial(),
        mesh = new T.Mesh(geometry, material),
        p = geometry.getAttribute('position'),
        uv = geometry.getAttribute('uv'),
        n = geometry.getAttribute('normal'),
        index = geometry.index!,
        a = new T.Vector3(),
        b = new T.Vector3(),
        c = new T.Vector3(),
        ab = new T.Vector3(),
        ac = new T.Vector3(),
        edges = new Map<string, number>();
      try {
        let volume = 0;
        expect(index.count / 3).toBeLessThan(5600);
        for (let i = 0; i < p.count; i++) {
          expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
          expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
        }
        for (let i = 0; i < index.count; i += 3) {
          const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
          a.fromBufferAttribute(p, ids[0]);
          b.fromBufferAttribute(p, ids[1]);
          c.fromBufferAttribute(p, ids[2]);
          expect(ab.subVectors(b, a).cross(ac.subVectors(c, a)).lengthSq()).toBeGreaterThan(1e-18);
          const du1 = uv.getX(ids[1]) - uv.getX(ids[0]),
            dv1 = uv.getY(ids[1]) - uv.getY(ids[0]),
            du2 = uv.getX(ids[2]) - uv.getX(ids[0]),
            dv2 = uv.getY(ids[2]) - uv.getY(ids[0]);
          expect(Math.abs(du1 * dv2 - du2 * dv1)).toBeGreaterThan(1e-9);
          volume += a.dot(ab.copy(b).cross(c)) / 6;
          const keys = [a, b, c].map((point) =>
            point
              .toArray()
              .map((x) => Math.round(x * 1e6))
              .join(','),
          );
          for (let j = 0; j < 3; j++) {
            const key = [keys[j], keys[(j + 1) % 3]].sort().join('|');
            edges.set(key, (edges.get(key) ?? 0) + 1);
          }
        }
        expect(volume).toBeGreaterThan(0.001);
        expect(volume).toBeLessThan(0.005);
        expect(new Set(edges.values())).toEqual(new Set([2]));
        mesh.updateMatrixWorld(true);
        const ray = new T.Raycaster(new T.Vector3(0, 0.6, 0.1), new T.Vector3(0, -1, 0));
        expect(ray.intersectObject(mesh)[0].point.y).toBeLessThan(-0.39);
        ray.ray.origin.set(0, -0.11, 0.8);
        ray.ray.direction.set(0, 0, -1);
        expect(ray.intersectObject(mesh)).toHaveLength(0);
        // The side skin remains real material alongside that open mouth.
        ray.ray.origin.set(0.6, -0.12, 0.25);
        ray.ray.direction.set(-1, 0, 0);
        expect(ray.intersectObject(mesh)[0].point.x).toBeGreaterThan(0.2);
      } finally {
        geometry.dispose();
        material.dispose();
      }
    },
  );

  it('joins both upper side cutlines into the existing painted cowl', () => {
    const material = new BikeMaterials(0),
      fairing = gpR2LowerFairing('high'),
      cowl = gpCompactCowl(material, 'high'),
      shell = cowl.getObjectByName('GP bodywork / paint') as T.Mesh,
      p = shell.geometry.getAttribute('position'),
      index = shell.geometry.index,
      candidate = fairing.getAttribute('position'),
      triangle = new T.Triangle(),
      point = new T.Vector3(),
      closest = new T.Vector3();
    try {
      let joined = 0;
      const samples: unknown[] = [];
      for (let row = 0; row <= 36; row++)
        for (const column of [0, 36]) {
          point.fromBufferAttribute(candidate, row * 37 + column);
          if (point.z < 0.36) continue;
          let distance = Infinity;
          for (let i = 0; i < (index?.count ?? p.count); i += 3) {
            triangle.a.fromBufferAttribute(p, index ? index.getX(i) : i);
            triangle.b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1);
            triangle.c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2);
            triangle.closestPointToPoint(point, closest);
            distance = Math.min(distance, point.distanceTo(closest));
          }
          samples.push({ position: point.toArray(), distance });
          if (distance < 0.006) joined++;
        }
      expect(joined, JSON.stringify(samples)).toBeGreaterThanOrEqual(4);
    } finally {
      fairing.dispose();
      cowl.traverse((object) => {
        if (object instanceof T.Mesh) object.geometry.dispose();
      });
      material.dispose();
    }
  });

  it.each(['high', 'mid'] as const)(
    '%s skin clears actual moving front parts at full fork travel and lock',
    (detail) => {
      const definition = VEHICLES.gpr2,
        spec = definition.bike!,
        materials = new BikeMaterials(0),
        model = new BikeModel(definition, 0, detail, materials, true),
        skin = new T.Mesh(gpR2LowerFairing(detail), materials.paint);
      model.sprung.add(skin);
      let steering: T.Object3D | undefined;
      model.root.traverse((object) => {
        if (!(object instanceof T.Mesh) || object.material !== materials.forkUpper) return;
        let parent = object.parent!;
        while (parent.name === 'Batched rigid motorcycle detail') parent = parent.parent!;
        steering ??= parent;
      });
      try {
        expect(steering).toBeDefined();
        const moving: T.Mesh[] = [];
        steering!.traverse((object) => {
          if (object instanceof T.Mesh) moving.push(object);
        });
        const collisions: unknown[] = [];
        for (const fork of [0, spec.forkTravel / 2, spec.forkTravel])
          for (const steer of [-spec.maxSteer, 0, spec.maxSteer]) {
            model.pose({
              ...staticSag(definition),
              fork,
              steer,
              frontRotation: 0,
              rearRotation: 0,
              chassisLean: 0,
              riderOffset: 0,
              tuck: 1,
              brake: 0,
              rearBrake: 0,
              discTemp: 280,
              compoundColour: 0xffffff,
              riding: true,
            });
            model.root.updateMatrixWorld(true);
            const overlap = meshSurfaceIntrusion([skin], moving, meshColumnsFor([skin], 0.004));
            expect(overlap.surfaceColumns).toBeGreaterThan(1000);
            if (overlap.maximumDepth >= 0.001)
              collisions.push({ fork, steer, depth: overlap.maximumDepth, worst: overlap.worst });
          }
        expect(collisions).toEqual([]);
      } finally {
        skin.removeFromParent();
        skin.geometry.dispose();
        model.dispose();
        materials.dispose();
      }
    },
    30000,
  );
});
