import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BikeMaterials,
  BikeModel,
  BikeShells,
  bikeOnboardFov,
  staticSag,
  type BikePoseValues,
} from '../src/rendering/bike.ts';
import { gpForkCrowns } from '../src/rendering/gp-fork-crown.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { inspectBikeCockpit } from '../e2e/fixtures/bike-cockpit-contract.ts';

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'createLinearGradient' || key === 'createRadialGradient'
          ? () => ({ addColorStop: () => undefined })
          : key === 'measureText'
            ? () => ({ width: 10 })
            : () => undefined,
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());

function pose(id: string, extra: Partial<BikePoseValues> = {}): BikePoseValues {
  const sag = staticSag(VEHICLES[id]);
  return {
    fork: sag.fork,
    shock: sag.shock,
    steer: 0,
    frontRotation: 0,
    rearRotation: 0,
    chassisLean: 0,
    riderOffset: 0,
    tuck: 0.75,
    brake: 0.05,
    rearBrake: 0,
    discTemp: 280,
    compoundColour: 0xffffff,
    riding: true,
    speed: 42,
    gear: 4,
    rpm: 12200,
    ...extra,
  };
}

function firstOpaqueHit(root: T.Object3D, origin: T.Vector3, target: T.Vector3) {
  const ray = new T.Raycaster(
    origin,
    target.clone().sub(origin).normalize(),
    0,
    origin.distanceTo(target) + 0.001,
  );
  return ray.intersectObject(root, true).find(({ object }) => {
    for (let ancestor: T.Object3D | null = object; ancestor; ancestor = ancestor.parent)
      if (!ancestor.visible) return false;
    const material = (object as T.Mesh).material as T.MeshPhysicalMaterial;
    return !Array.isArray(material) && !material.transparent && !(material.transmission > 0.5);
  });
}

function state(root: T.Object3D) {
  root.updateMatrixWorld(true);
  const objects: { id: string; geometry?: string; material?: string; matrix: number[] }[] = [];
  root.traverse((object) =>
    objects.push({
      id: object.uuid,
      geometry: object instanceof T.Mesh ? object.geometry.uuid : undefined,
      material: object instanceof T.Mesh ? object.material.uuid : undefined,
      matrix: object.matrixWorld.toArray(),
    }),
  );
  return objects;
}

describe('GP fork crowns above the real opaque fork tubes', () => {
  it('has an open retaining bore and a physically recessed screw slot within the old envelope', () => {
    const materials = new BikeMaterials(0);
    for (const detail of ['high', 'mid'] as const) {
      const root = new T.Group();
      root.add(...gpForkCrowns(detail, materials, 0.03));
      try {
        root.updateMatrixWorld(true);
        const bounds = new T.Box3().setFromObject(root);
        expect(bounds.min.y).toBeGreaterThanOrEqual(0.05);
        expect(bounds.max.y).toBeLessThan(0.075);
        expect(bounds.min.x).toBeGreaterThan(-0.136001);
        expect(bounds.max.x).toBeLessThan(0.136001);
        for (const side of [-1, 1]) {
          const origin = new T.Vector3(side * 0.105, 0.12, 0.03),
            ring = root.getObjectByName(`GP ${side > 0 ? 'left' : 'right'} fork retaining ring`)!;
          // The ring has no centre face at any height.
          const axial = new T.Raycaster(origin, new T.Vector3(0, -1, 0));
          expect(axial.intersectObject(ring)).toHaveLength(0);
          const centre = axial.intersectObject(root, true)[0];
          expect(centre.point.y).toBeCloseTo(detail === 'high' ? 0.0665 : 0.064, 7);
          if (detail === 'high') {
            origin.z += 0.002;
            axial.set(origin, new T.Vector3(0, -1, 0));
            const head = axial.intersectObject(root, true)[0];
            expect(head.point.y - centre.point.y).toBeCloseTo(0.0015, 7);
          }
        }
      } finally {
        root.traverse((object) => {
          if (object instanceof T.Mesh) object.geometry.dispose();
        });
      }
    }
    materials.dispose();
  });

  it.each(
    ['gpr1', 'gpr2'].flatMap((id) => (['high', 'mid'] as const).map((detail) => ({ id, detail }))),
  )(
    '$id $detail exposes the actual crowns from the production onboard eye after steering and loading',
    ({ id, detail }) => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0),
        bike = new BikeModel(definition, 0, detail, materials, true),
        steering = (bike as unknown as { steer: T.Group }).steer,
        camera = new T.PerspectiveCamera(bikeOnboardFov(42, definition), 1280 / 800, 0.03, 80),
        direction = new T.Vector3();
      const values = [
        pose(id),
        pose(id, { fork: 0.09, shock: 0.025, steer: -0.18, tuck: 0, brake: 1 }),
        pose(id, { fork: 0.03, shock: 0.08, steer: 0.18, tuck: 1, brake: 0 }),
      ];
      try {
        bike.root.position.y = definition.bike!.cgHeight;
        bike.rider.setFirstPerson(true);
        let initial: ReturnType<typeof state> | undefined;
        for (const value of [...values, values[0], values[0]]) {
          const source = { ...value };
          bike.pose(value);
          bike.root.updateMatrixWorld(true);
          new BikeShells().onboard(bike.root, camera.position, direction, false, definition);
          camera.lookAt(camera.position.clone().add(direction));
          camera.updateMatrixWorld(true);
          for (const side of [-1, 1]) {
            const witnesses = [
              [-0.006, 0.0595, -0.025],
              [0.006, 0.0595, -0.025],
              [-0.011, 0.064, 0],
              [0.011, 0.064, 0],
              ...(detail === 'high'
                ? [
                    [-0.002, 0.068, 0.002],
                    [0.002, 0.068, 0.002],
                  ]
                : []),
            ];
            for (const [dx, y, dz] of witnesses) {
              const target = new T.Vector3(side * 0.105 + dx, y, 0.03 + dz).applyMatrix4(
                  steering.matrixWorld,
                ),
                hit = firstOpaqueHit(bike.root, camera.position, target);
              expect(hit, JSON.stringify({ id, detail, side, dx, y, dz, value })).toBeDefined();
              expect(hit!.point.distanceTo(target)).toBeLessThan(0.00001);
              const projected = target.clone().project(camera);
              expect(Math.abs(projected.x)).toBeLessThan(1);
              // The low rear lip can leave the frame as the fork compresses
              // and steers. The control faces stay visible in every pose;
              // the entire sampled crown is visible at its settled position.
              if (y >= 0.064 || value === values[0]) expect(Math.abs(projected.y)).toBeLessThan(1);
            }
          }
          if (detail === 'high')
            expect(inspectBikeCockpit(bike.root, camera).visibleSamples).toBe(9);
          expect(value).toEqual(source);
          const current = state(steering);
          if (!initial) initial = current;
          else if (value === values[0]) expect(current).toEqual(initial);
        }
        // The later carbon-rotor revision adds an aluminium carrier batch at
        // high LOD and aluminium plus steel at mid LOD; see
        // docs/production/motogp-brakes-gloves-and-racecraft/README.md.
        // Account for those exact rotating materials without increasing the
        // fixed hardware budget: the original 26/13 totals included 5/4 wheel
        // meshes, leaving 21/9 for the unchanged rest of this steering subtree.
        const meshes: T.Mesh[] = [];
        steering.traverse((object) => {
          if (object instanceof T.Mesh) meshes.push(object);
        });
        const spin = steering.getObjectByName('GP front wheel spin')!,
          wheelMeshes: T.Mesh[] = [];
        expect(spin).toBeDefined();
        spin.traverse((object) => {
          if (object instanceof T.Mesh) wheelMeshes.push(object);
        });
        expect(wheelMeshes).toHaveLength(6);
        for (const material of [
          materials.rubber,
          materials.band,
          materials.wheel,
          materials.disc,
          materials.aluminium,
          materials.steel,
        ])
          expect(wheelMeshes.filter((mesh) => mesh.material === material)).toHaveLength(1);
        // The connected-hydraulics revision adds one deforming paired hose at
        // both LODs and the previously High-only reservoir batch at Mid. Its
        // other rigid hardware joins existing material batches; see
        // docs/production/motogp-hydraulics-and-corner-feedback/README.md.
        // Identify only those additions before checking the historical budget.
        const hydraulics = steering.getObjectByName('GP connected front hydraulic lines')!,
          hoses = steering.getObjectByName('GP compliant paired brake hoses') as T.Mesh;
        expect(hydraulics.parent).toBe(steering);
        expect(hydraulics.children).toHaveLength(1);
        expect(hoses).toBeInstanceOf(T.Mesh);
        expect(hoses.parent).toBe(hydraulics);
        expect(hoses.material).toBe(materials.dark);
        expect(hoses.geometry.name).toBe('GP constant-length suspension brake hoses');
        const positions = hoses.geometry.getAttribute('position') as T.BufferAttribute,
          normals = hoses.geometry.getAttribute('normal') as T.BufferAttribute;
        expect(positions.count).toBe(detail === 'high' ? 350 : 182);
        expect(positions.usage).toBe(T.DynamicDrawUsage);
        expect(normals.usage).toBe(T.DynamicDrawUsage);
        const reservoirs = meshes.filter((mesh) => mesh.material === materials.reservoir);
        expect(reservoirs).toHaveLength(1);
        expect(reservoirs[0].parent?.name).toBe('Batched rigid motorcycle detail');
        expect(reservoirs[0].parent?.parent).toBe(steering);
        // High already included its fluid pot in the original 21; Mid's new
        // reservoir is the sole additional rigid-material batch.
        const hydraulicAddition = 1 + (detail === 'mid' ? reservoirs.length : 0);
        expect(meshes.length - wheelMeshes.length - hydraulicAddition).toBe(
          detail === 'high' ? 21 : 9,
        );
        if (id === 'gpr1' && detail === 'high') {
          // Reinstate the former opaque lid as an independent failing control.
          // A check for mesh existence alone would still pass this obstruction.
          const lid = new T.Mesh(new T.CylinderGeometry(0.031, 0.031, 0.03, 20), materials.dark);
          lid.position.set(-0.105, 0.06, 0.03);
          steering.add(lid);
          bike.root.updateMatrixWorld(true);
          const target = new T.Vector3(-0.103, 0.068, 0.032).applyMatrix4(steering.matrixWorld),
            hit = firstOpaqueHit(bike.root, camera.position, target);
          expect(hit!.object).toBe(lid);
          expect(hit!.point.distanceTo(target)).toBeGreaterThan(0.005);
          lid.removeFromParent();
          lid.geometry.dispose();
        }
      } finally {
        bike.dispose();
        materials.dispose();
      }
    },
  );
});
