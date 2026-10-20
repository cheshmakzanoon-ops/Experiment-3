import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  BikeMaterials,
  BikeModel,
  flattenGpR2Tail,
  staticSag,
  superLoft,
  type Section,
} from '../src/rendering/bike.ts';
import { gpCompactCowl, gpUpperCowl } from '../src/rendering/gp-bodywork.ts';
import { gpR2Aero, gpR2LoopWingGeometry } from '../src/rendering/gp-r2-aero.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { meshColumnsFor, meshSurfaceIntrusion } from './gp-mesh-clearance.ts';

beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());

const release = (root: T.Object3D) =>
  root.traverse((object) => {
    if (object instanceof T.Mesh) object.geometry.dispose();
  });

describe('GP-R2 compact nose and shallow tail silhouette', () => {
  it.each(['high', 'mid', 'far'] as const)(
    '%s has a real recessed intake, open instrument well and independently owned geometry',
    (detail) => {
      const materials = new BikeMaterials(0),
        cowl = gpCompactCowl(materials, detail),
        copy = gpCompactCowl(materials, detail),
        catalogue = gpUpperCowl(materials, detail);
      try {
        const paint = cowl.getObjectByName('GP bodywork / paint') as T.Mesh,
          duct = cowl.getObjectByName('GP bodywork / dark') as T.Mesh,
          old = catalogue.children[0] as T.Mesh;
        expect(cowl.children).toHaveLength(2);
        expect(paint.material).toBe(materials.paint);
        expect(duct.material).toBe(materials.dark);
        expect(paint.geometry.boundingBox!.min.z).toBeCloseTo(0.36, 3);
        expect(paint.geometry.boundingBox!.max.z).toBeCloseTo(0.914, 3);
        // The existing dark batch now includes the thin rear channel return.
        expect(duct.geometry.boundingBox!.min.z).toBeCloseTo(0.36, 2);
        expect(duct.geometry.boundingBox!.max.z).toBeCloseTo(0.915, 3);
        // The extra far-LOD dark draw still fits below its old cowl geometry
        // budget; high/mid replace the old separate circle intake draw.
        expect(paint.geometry.index!.count + duct.geometry.index!.count).toBeLessThan(
          old.geometry.index!.count,
        );
        for (const [i, mesh] of (cowl.children as T.Mesh[]).entries()) {
          const other = (copy.children[i] as T.Mesh).geometry,
            geometry = mesh.geometry,
            normal = geometry.getAttribute('normal');
          expect(geometry).not.toBe(other);
          expect(geometry.getAttribute('position').array).not.toBe(
            other.getAttribute('position').array,
          );
          expect(geometry.getAttribute('position').array).toEqual(
            other.getAttribute('position').array,
          );
          for (let v = 0; v < normal.count; v++)
            expect(Math.hypot(normal.getX(v), normal.getY(v), normal.getZ(v))).toBeCloseTo(1, 4);
        }
        cowl.updateMatrixWorld(true);
        const ray = new T.Raycaster(new T.Vector3(0, 0.102, 1.1), new T.Vector3(0, 0, -1)),
          throat = ray.intersectObject(duct)[0],
          shellBehind = ray.intersectObject(paint)[0];
        expect(throat).toBeDefined();
        expect(throat.point.z).toBeCloseTo(0.75, 3);
        expect(shellBehind).toBeUndefined();
        // Adjacent paint and a deliberately obstructing face are positive
        // controls: this must distinguish a genuine hole from missing parts.
        ray.ray.origin.x = 0.09;
        expect(ray.intersectObject(paint)[0].point.z).toBeGreaterThan(0.9);
        ray.ray.origin.set(0, 0.55, 0.49);
        ray.ray.direction.set(0, -1, 0);
        // The rear well and underside are truly open for the fork, rather
        // than retaining the former solid floor at y=.210.
        expect(ray.intersectObject(paint)).toHaveLength(0);
        ray.ray.origin.set(0.14, 0.55, 0.65);
        expect(ray.intersectObject(paint)).toHaveLength(0);
        ray.ray.origin.set(0.185, 0.55, 0.49);
        expect(ray.intersectObject(paint)[0].point.y).toBeGreaterThan(0.24);
        const obstruction = new T.Mesh(new T.PlaneGeometry(0.2, 0.1), materials.dark);
        try {
          obstruction.position.set(0, 0.102, 0.9);
          obstruction.updateMatrixWorld(true);
          ray.ray.origin.set(0, 0.102, 1.1);
          ray.ray.direction.set(0, 0, -1);
          expect(ray.intersectObjects([duct, obstruction])[0].object).toBe(obstruction);
        } finally {
          obstruction.geometry.dispose();
        }
      } finally {
        [cowl, copy, catalogue].forEach(release);
        materials.dispose();
      }
    },
  );

  it.each([40, 20, 10])(
    '%s-sided tail lowers the crown without moving its underside, seat region or attachment envelope',
    (sides) => {
      const sections: Section[] = [
        { z: -0.84, y: 0.33, w: 0.035, top: 0.03, bottom: 0.03, topWidth: 0.7 },
        { z: -0.76, y: 0.32, w: 0.075, top: 0.07, bottom: 0.08, topWidth: 0.7 },
        { z: -0.6, y: 0.28, w: 0.11, top: 0.1, bottom: 0.12, topWidth: 0.75 },
        { z: -0.44, y: 0.2, w: 0.13, top: 0.07, bottom: 0.1, topWidth: 0.85 },
        { z: -0.22, y: 0.17, w: 0.14, top: 0.05, bottom: 0.08 },
        { z: -0.1, y: 0.17, w: 0.13, top: 0.04, bottom: 0.06 },
      ];
      const original = superLoft(sections, sides),
        candidate = flattenGpR2Tail(original.clone());
      try {
        const before = original.getAttribute('position'),
          after = candidate.getAttribute('position'),
          normal = candidate.getAttribute('normal'),
          rings = new Map<number, { a: number[]; b: number[] }>();
        expect(candidate.index!.array).toEqual(original.index!.array);
        expect(candidate.getAttribute('uv').array).toEqual(original.getAttribute('uv').array);
        let moved = 0,
          seat = 0;
        for (let i = 0; i < after.count; i++) {
          const z = before.getZ(i),
            ring = rings.get(z) ?? { a: [], b: [] };
          ring.a.push(before.getY(i));
          ring.b.push(after.getY(i));
          rings.set(z, ring);
          expect(after.getX(i)).toBe(before.getX(i));
          expect(after.getZ(i)).toBe(z);
          expect(after.getY(i)).toBeLessThanOrEqual(before.getY(i));
          expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 4);
          if (z >= -0.48) {
            expect(after.getY(i)).toBe(before.getY(i));
            seat++;
          }
          if (before.getY(i) - after.getY(i) > 0.025) moved++;
        }
        for (const [z, ring] of rings) {
          expect(Math.min(...ring.b)).toBe(Math.min(...ring.a));
          expect(Math.max(...ring.b) - Math.min(...ring.b)).toBeGreaterThan(0.02);
          if (z <= -0.6) expect(Math.max(...ring.b)).toBeCloseTo(0.33, 5);
        }
        expect(moved).toBeGreaterThan(sides);
        expect(seat).toBeGreaterThan(sides * 2);
        // The blend into the fixed seat shoulder stays within 10 mm of the
        // level aft crown, instead of retaining the former 60 mm hump.
        expect(candidate.boundingBox!.max.y).toBeLessThan(0.34);
      } finally {
        original.dispose();
        candidate.dispose();
      }
    },
  );

  it.each(['high', 'mid'] as const)(
    '%s preserves front-assembly clearance through full travel and steering',
    (detail) => {
      const materials = new BikeMaterials(0),
        definition = VEHICLES.gpr2,
        spec = definition.bike!,
        model = new BikeModel(definition, 0, detail, materials, true),
        cowl = model.root.getObjectByName(`GP-R2 compact instrument cowl (${detail})`)!,
        paint = cowl.getObjectByName('GP bodywork / paint') as T.Mesh,
        dark = cowl.getObjectByName('GP bodywork / dark') as T.Mesh,
        original = gpUpperCowl(materials, detail),
        oldPaint = original.children[0] as T.Mesh;
      model.sprung.add(original);
      try {
        let steering: T.Object3D | undefined;
        model.root.traverse((object) => {
          if (!(object instanceof T.Mesh) || object.material !== materials.forkUpper) return;
          let parent = object.parent!;
          while (parent.name === 'Batched rigid motorcycle detail') parent = parent.parent!;
          steering ??= parent;
        });
        expect(steering).toBeDefined();
        const moving: T.Mesh[] = [];
        steering!.traverse((object) => {
          if (object instanceof T.Mesh) moving.push(object);
        });
        expect(moving.length).toBeGreaterThan(10);
        let compared = 0,
          maximumRegression = 0;
        const samples: unknown[] = [];
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
            const grid = meshColumnsFor([paint, dark, oldPaint], 0.006),
              overlap = meshSurfaceIntrusion([paint, dark], moving, grid),
              baseline = meshSurfaceIntrusion([oldPaint], moving, grid);
            expect(overlap.surfaceColumns).toBeGreaterThan(100);
            expect(overlap.solidColumns).toBeGreaterThan(100);
            let regression = 0,
              at: number[] | undefined;
            for (const [column, depth] of overlap.depths) {
              const increase = depth - (baseline.depths.get(column) ?? 0);
              if (increase > regression) {
                regression = increase;
                at = model.sprung
                  .worldToLocal(
                    new T.Vector3(
                      grid.x + (column % grid.columns) * grid.step,
                      overlap.heights.get(column)!,
                      grid.z + Math.floor(column / grid.columns) * grid.step,
                    ),
                  )
                  .toArray();
              }
            }
            maximumRegression = Math.max(maximumRegression, regression);
            samples.push({
              fork,
              steer,
              regression,
              at,
              candidate: overlap.maximumDepth,
              baseline: baseline.maximumDepth,
              worst: overlap.worst,
            });
            compared += overlap.comparedColumns;
          }
        expect(compared).toBeGreaterThan(100);
        // The candidate opens the old well floor and adds a dark edge return.
        // Compare every paint/return column with the original shell, so a new
        // local contact cannot hide behind its inherited worst penetration.
        expect(maximumRegression, JSON.stringify({ detail, samples })).toBeLessThan(0.002);
      } finally {
        original.removeFromParent();
        release(original);
        model.dispose();
        materials.dispose();
      }
    },
    30000,
  );

  it('detects actual open surface contact while allowing a solid inside an empty shell', () => {
    const material = new T.MeshBasicMaterial(),
      shell = new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.1), material),
      solid = new T.Mesh(new T.BoxGeometry(0.02, 0.02, 0.02), material),
      open = new T.Mesh(new T.PlaneGeometry(0.1, 0.1), material);
    open.rotation.x = -Math.PI / 2;
    open.position.y = 0.05;
    [shell, solid, open].forEach((mesh) => mesh.updateMatrixWorld(true));
    const grid = meshColumnsFor([shell], 0.003);
    try {
      expect(meshSurfaceIntrusion([shell], [solid], grid).maximumDepth).toBe(0);
      solid.position.y = 0.05;
      solid.updateMatrixWorld(true);
      expect(meshSurfaceIntrusion([shell], [solid], grid).maximumDepth).toBeGreaterThan(0.009);
      expect(meshSurfaceIntrusion([open], [solid], grid).maximumDepth).toBeGreaterThan(0.009);
    } finally {
      [shell, solid, open].forEach((mesh) => mesh.geometry.dispose());
      material.dispose();
    }
  });
});

describe('GP-R2 formed aero and conformal identity', () => {
  it.each(['high', 'mid'] as const)(
    '%s moulded returns are symmetric closed surfaces around an open duct',
    (detail) => {
      const a = gpR2LoopWingGeometry(detail, 1),
        b = gpR2LoopWingGeometry(detail, -1),
        material = new T.MeshBasicMaterial({ side: T.DoubleSide });
      try {
        const vertices = a.outer.getAttribute('position'),
          mirrored = b.outer.getAttribute('position'),
          edges = new Map<string, number>(),
          v = [new T.Vector3(), new T.Vector3(), new T.Vector3()],
          ab = new T.Vector3(),
          ac = new T.Vector3();
        for (let i = 0; i < vertices.count; i++) {
          expect(vertices.getX(i)).toBeCloseTo(-mirrored.getX(i), 6);
          expect(vertices.getY(i)).toBe(mirrored.getY(i));
          expect(vertices.getZ(i)).toBe(mirrored.getZ(i));
        }
        let triangles = 0,
          volume = 0;
        for (const g of Object.values(a)) {
          const p = g.getAttribute('position'),
            n = g.getAttribute('normal'),
            index = g.index!;
          triangles += index.count / 3;
          for (let i = 0; i < n.count; i++) {
            const length = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
            expect(length).toBeGreaterThan(0.99);
            expect(length).toBeLessThan(1.01);
          }
          for (let i = 0; i < index.count; i += 3) {
            const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
            ids.forEach((id, at) => v[at].fromBufferAttribute(p, id));
            ab.subVectors(v[1], v[0]).cross(ac.subVectors(v[2], v[0]));
            expect(ab.lengthSq()).toBeGreaterThan(1e-19);
            volume += v[0].dot(ab) / 6;
            const keys = v.map((point) =>
              point
                .toArray()
                .map((x) => Math.round(x * 1e7))
                .join('/'),
            );
            for (let j = 0; j < 3; j++) {
              const key = [keys[j], keys[(j + 1) % 3]].sort().join(':');
              edges.set(key, (edges.get(key) ?? 0) + 1);
            }
          }
        }
        expect([...edges.values()].every((count) => count === 2)).toBe(true);
        expect(volume).toBeGreaterThan(0.0001);
        expect(triangles).toBeLessThan(1800);
        const ray = new T.Raycaster(new T.Vector3(0.277, 0.08, 1), new T.Vector3(0, 0, -1));
        const meshes = Object.values(a).map((g) => new T.Mesh(g, material));
        meshes.forEach((m) => m.updateMatrixWorld());
        expect(ray.intersectObjects(meshes)).toHaveLength(0);
        // An adjacent ray strikes the continuous outer return. The test must
        // distinguish an actual open duct from a missing or invisible assembly.
        ray.ray.origin.set(0.333, 0.102, 1);
        expect(ray.intersectObjects(meshes).length).toBeGreaterThan(0);
        expect(a.outer.boundingBox!.max.x).toBeLessThan(0.36);
        expect(a.outer.boundingBox!.min.z).toBeGreaterThan(0.19);
      } finally {
        [...Object.values(a), ...Object.values(b)].forEach((g) => g.dispose());
        material.dispose();
      }
    },
  );

  it.each(['high', 'mid'] as const)(
    '%s integrates projected flank/nose/tail paint and reuses its owned finishes',
    (detail) => {
      const materials = new BikeMaterials(0),
        model = new BikeModel(VEHICLES.gpr2, 0, detail, materials, true),
        aero = gpR2Aero(detail, materials);
      try {
        const owned = new Set(materials.list);
        for (const child of aero.children)
          expect(owned.has((child as T.Mesh).material as T.Material)).toBe(true);
        let triangles = 0,
          livery: T.Mesh | undefined;
        const maps = new Set<T.Texture>(),
          finishes = new Set<T.Material>();
        model.root.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          triangles +=
            ((o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3) *
            (o instanceof T.InstancedMesh ? o.count : 1);
          for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
            finishes.add(material);
            for (const value of Object.values(material))
              if (value instanceof T.Texture) maps.add(value);
            if (material.name === 'Original GP conformal identity atlas') livery = o;
          }
        });
        expect(livery).toBeDefined();
        const p = livery!.geometry.getAttribute('position');
        // One merged atlas covers both flanks, the front number and the tail.
        expect(Array.from({ length: p.count }, (_, i) => p.getX(i)).some((x) => x > 0.18)).toBe(
          true,
        );
        expect(Array.from({ length: p.count }, (_, i) => p.getX(i)).some((x) => x < -0.18)).toBe(
          true,
        );
        expect(Array.from({ length: p.count }, (_, i) => p.getZ(i)).some((z) => z > 0.75)).toBe(
          true,
        );
        expect(Array.from({ length: p.count }, (_, i) => p.getZ(i)).some((z) => z < -0.58)).toBe(
          true,
        );
        expect(triangles).toBeLessThan(110000);
        expect(finishes.size).toBeLessThanOrEqual(34);
        expect(maps.size).toBeLessThanOrEqual(19);
        const pose = {
          ...staticSag(VEHICLES.gpr2),
          steer: 0.2,
          frontRotation: 2,
          rearRotation: 3,
          chassisLean: 0.8,
          riderOffset: 0.16,
          tuck: 0.8,
          brake: 0.5,
          rearBrake: 0.2,
          discTemp: 280,
          compoundColour: 0xffffff,
          riding: true,
        };
        const geometry = livery!.geometry,
          positions = geometry.getAttribute('position').array.slice();
        model.pose(pose);
        const matrices = () => {
          model.root.updateMatrixWorld(true);
          const all: number[] = [];
          model.root.traverse((o) => all.push(...o.matrixWorld.elements));
          return all;
        };
        const original = matrices();
        model.pose({ ...pose, steer: -0.2, brake: 0, chassisLean: -0.7, riderOffset: -0.15 });
        model.pose(pose);
        expect(matrices()).toEqual(original);
        expect(geometry.getAttribute('position').array).toEqual(positions);
      } finally {
        aero.traverse((o) => {
          if (o instanceof T.Mesh) o.geometry.dispose();
        });
        model.dispose();
        materials.dispose();
      }
    },
  );
});
