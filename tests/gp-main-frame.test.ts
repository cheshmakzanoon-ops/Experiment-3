import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeModel, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import { gpMainFrame, gpMainSpar, gpR2SeatPad, gpR2Tank } from '../src/rendering/gp-main-frame.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { meshColumnOverlap, meshColumnsFor, meshSurfaceIntrusion } from './gp-mesh-clearance.ts';

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

function headFor(id: string) {
  const b = VEHICLES[id].bike!;
  return new T.Vector3(
    0,
    b.frontWheelRadius - b.cgHeight + 0.7 * Math.cos(0.42) - 0.03 * Math.sin(0.42),
    b.cgToFront - 0.7 * Math.sin(0.42) - 0.03 * Math.cos(0.42),
  );
}

function meshes(root: T.Object3D) {
  const result: T.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof T.Mesh) result.push(object);
  });
  return result;
}

function pose(id: string, controls: Partial<BikePoseValues> = {}): BikePoseValues {
  return {
    ...staticSag(VEHICLES[id]),
    steer: 0,
    frontRotation: 0,
    rearRotation: 0,
    chassisLean: 0,
    riderOffset: 0,
    tuck: 0.75,
    brake: 0,
    rearBrake: 0,
    discTemp: 280,
    compoundColour: 0xffffff,
    riding: true,
    ...controls,
  };
}

describe('GP main frame and GP-R2 tank construction', () => {
  it.each(['high', 'mid', 'far'] as const)(
    '%s produces closed outward solids without collapsed triangles or UVs',
    (detail) => {
      const geometries = [
        gpMainSpar(headFor('gpr1'), 1, detail),
        gpMainSpar(headFor('gpr2'), -1, detail),
        gpR2Tank(detail),
        gpR2SeatPad(detail),
      ];
      try {
        for (const geometry of geometries) {
          const p = geometry.getAttribute('position'),
            n = geometry.getAttribute('normal'),
            uv = geometry.getAttribute('uv'),
            index = geometry.index!,
            edges = new Map<string, number>(),
            a = new T.Vector3(),
            b = new T.Vector3(),
            c = new T.Vector3(),
            cross = new T.Vector3(),
            delta = new T.Vector3();
          let volume = 0;
          expect(index.count / 3).toBeLessThan(1800);
          for (let i = 0; i < p.count; i++) {
            expect(
              Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i) + uv.getX(i) + uv.getY(i)),
            ).toBe(true);
            expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
          }
          for (let i = 0; i < index.count; i += 3) {
            const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
            a.fromBufferAttribute(p, ids[0]);
            b.fromBufferAttribute(p, ids[1]);
            c.fromBufferAttribute(p, ids[2]);
            expect(cross.subVectors(b, a).cross(delta.subVectors(c, a)).lengthSq()).toBeGreaterThan(
              1e-18,
            );
            const du1 = uv.getX(ids[1]) - uv.getX(ids[0]),
              dv1 = uv.getY(ids[1]) - uv.getY(ids[0]),
              du2 = uv.getX(ids[2]) - uv.getX(ids[0]),
              dv2 = uv.getY(ids[2]) - uv.getY(ids[0]);
            expect(Math.abs(du1 * dv2 - du2 * dv1)).toBeGreaterThan(1e-8);
            volume += a.dot(cross.copy(b).cross(c)) / 6;
            const points = [a, b, c].map((point) =>
              point
                .toArray()
                .map((v) => v.toFixed(6))
                .join(','),
            );
            for (let j = 0; j < 3; j++) {
              const edge = [points[j], points[(j + 1) % 3]].sort().join('|');
              edges.set(edge, (edges.get(edge) ?? 0) + 1);
            }
          }
          expect(volume).toBeGreaterThan(0.0001);
          expect(new Set(edges.values())).toEqual(new Set([2]));
          expect(geometry.boundingSphere!.radius).toBeLessThan(0.6);
        }
      } finally {
        geometries.forEach((geometry) => geometry.dispose());
      }
    },
  );

  it('joins the narrow tank root to the saddle while preserving the rider contact height', () => {
    const material = new T.MeshBasicMaterial(),
      tank = new T.Mesh(gpR2Tank('high'), material),
      pad = new T.Mesh(gpR2SeatPad('high'), material),
      ray = new T.Raycaster(new T.Vector3(0, 1, -0.32), new T.Vector3(0, -1, 0));
    [tank, pad].forEach((mesh) => mesh.updateMatrixWorld(true));
    try {
      for (const z of [-0.38, -0.32, -0.26, -0.21]) {
        ray.ray.origin.z = z;
        expect(ray.intersectObject(pad)[0].point.y).toBeCloseTo(0.2445, 4);
      }
      let previous: number | undefined;
      // A centred descending ray must meet material continuously where the
      // pad tongue meets the tank, rather than showing the floor through it.
      for (let z = -0.22; z < -0.08; z += 0.004) {
        ray.ray.origin.z = z;
        const hit = ray.intersectObjects([tank, pad])[0];
        expect(hit).toBeDefined();
        if (previous !== undefined) expect(Math.abs(hit.point.y - previous)).toBeLessThan(0.009);
        previous = hit.point.y;
      }
      expect(tank.geometry.boundingBox!.min.z).toBeCloseTo(-0.185, 5);
      expect(tank.geometry.boundingBox!.max.z).toBeLessThan(0.39);
      expect(tank.geometry.boundingBox!.max.y).toBeLessThan(0.351);
      expect(tank.geometry.boundingBox!.max.x).toBeLessThan(0.171);
    } finally {
      tank.geometry.dispose();
      pad.geometry.dispose();
      material.dispose();
    }
  });

  it.each(['gpr1', 'gpr2'])(
    '%s keeps formed main spars clear of planted feet at suspension extremes',
    (id) => {
      const definition = VEHICLES[id],
        spec = definition.bike!,
        material = new BikeMaterials(0),
        bike = new BikeModel(definition, 0, 'high', material, true),
        frame = gpMainFrame(headFor(id), 'high', material),
        parts = meshes(frame);
      bike.sprung.add(frame);
      try {
        const feet = ['GP left foot', 'GP right foot'].map((name) =>
          meshes(bike.root.getObjectByName(name)!),
        );
        for (const fork of [0, spec.forkTravel])
          for (const shock of [0, spec.shockTravel])
            for (const lean of [-0.9, 0, 0.9]) {
              bike.pose(
                pose(id, { fork, shock, chassisLean: lean, riderOffset: Math.sign(lean) * 0.18 }),
              );
              bike.root.updateMatrixWorld(true);
              for (const foot of feet) {
                const overlap = meshColumnOverlap(foot, parts, meshColumnsFor(foot, 0.004));
                expect(overlap.firstColumns).toBeGreaterThan(0);
                expect(
                  overlap.maximumOverlap,
                  JSON.stringify({ id, fork, shock, lean, ...overlap }),
                ).toBeLessThan(0.001);
              }
            }
        // A planted boot may be completely lateral to the inboard frame, so
        // zero projected overlap is valid. Prove the same occupied-volume
        // test detects a collar deliberately pushed out into that foot.
        bike.pose(pose(id, { fork: 0, shock: 0, chassisLean: -0.9, riderOffset: -0.18 }));
        const obstruction = new T.Mesh(
          new T.TorusGeometry(0.028, 0.008, 6, 24),
          material.aluminium,
        );
        obstruction.rotation.y = Math.PI / 2;
        obstruction.position.set(0.145, -0.13, -0.2);
        bike.sprung.add(obstruction);
        bike.root.updateMatrixWorld(true);
        try {
          expect(
            meshColumnOverlap(feet[0], [obstruction], meshColumnsFor(feet[0], 0.004))
              .maximumOverlap,
          ).toBeGreaterThan(0.01);
        } finally {
          obstruction.removeFromParent();
          obstruction.geometry.dispose();
        }
      } finally {
        frame.removeFromParent();
        parts.forEach((mesh) => mesh.geometry.dispose());
        bike.dispose();
        material.dispose();
      }
    },
    30000,
  );

  it('GP-R2 tank clears moving steering and fork surfaces across their full travel', () => {
    const definition = VEHICLES.gpr2,
      spec = definition.bike!,
      material = new BikeMaterials(0),
      bike = new BikeModel(definition, 0, 'high', material, true),
      tank = new T.Mesh(gpR2Tank('high'), material.paint);
    bike.sprung.add(tank);
    let steering: T.Object3D | undefined;
    bike.root.traverse((object) => {
      if (!(object instanceof T.Mesh) || object.material !== material.forkUpper) return;
      let parent = object.parent!;
      while (parent.name === 'Batched rigid motorcycle detail') parent = parent.parent!;
      steering ??= parent;
    });
    try {
      expect(steering).toBeDefined();
      const moving = meshes(steering!);
      for (const fork of [0, spec.forkTravel / 2, spec.forkTravel])
        for (const steer of [-spec.maxSteer, 0, spec.maxSteer]) {
          bike.pose(pose('gpr2', { fork, steer, tuck: 1 }));
          bike.root.updateMatrixWorld(true);
          const overlap = meshSurfaceIntrusion([tank], moving, meshColumnsFor([tank], 0.004));
          expect(overlap.surfaceColumns).toBeGreaterThan(100);
          expect(overlap.maximumDepth, JSON.stringify({ fork, steer, ...overlap })).toBeLessThan(
            0.001,
          );
        }
    } finally {
      tank.removeFromParent();
      tank.geometry.dispose();
      bike.dispose();
      material.dispose();
    }
  }, 30000);
});
