import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeModel, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import { gpRearSwingarm, gpUndertray } from '../src/rendering/gp-rear-chassis.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { measureChainEnvelope } from './gp-chain-envelope.ts';
import { meshColumnOverlap, meshColumnsFor } from './gp-mesh-clearance.ts';

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

function inventory(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  let triangles = 0,
    meshes = 0;
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    meshes++;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof T.Texture) textures.add(value);
    }
    triangles +=
      ((object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3) *
      (object instanceof T.InstancedMesh ? object.count : 1);
  });
  return { geometries, materials, textures, triangles, meshes };
}
function matrices(root: T.Object3D) {
  root.updateMatrixWorld(true);
  const result: number[][] = [];
  root.traverse((object) => result.push([...object.matrixWorld.elements]));
  return result;
}
function signedVolume(geometry: T.BufferGeometry) {
  const p = geometry.getAttribute('position'),
    index = geometry.index!,
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3();
  let sum = 0;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(p, index.getX(i));
    b.fromBufferAttribute(p, index.getX(i + 1));
    c.fromBufferAttribute(p, index.getX(i + 2));
    sum += a.dot(b.cross(c)) / 6;
  }
  return sum;
}
function pose(id: string, values: Partial<BikePoseValues> = {}): BikePoseValues {
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
    ...values,
  };
}

describe('GP rear structure on the production motorcycle', () => {
  it.each(['high', 'mid', 'far'] as const)(
    '%s builds closed outward-facing surfaces around the actual chain envelope',
    (detail) => {
      const materials = new BikeMaterials(0),
        arm = gpRearSwingarm(0.575, detail, materials),
        tray = gpUndertray(detail);
      try {
        let skinVolume = 0;
        arm.traverse((object) => {
          if (!(object instanceof T.Mesh) || object.material !== materials.carbon) return;
          skinVolume += signedVolume(object.geometry);
        });
        expect(skinVolume).toBeGreaterThan(0.001);
        const chain = measureChainEnvelope(arm, 0.575);
        expect(chain.meshes).toBeGreaterThanOrEqual(2);
        expect(chain.samples).toBe(1600);
        expect(chain.intersections).toBe(0);
        expect(chain.insideSamples).toBe(0);
        if (detail === 'high') {
          // Positive control: a solid placed through the known upper chain
          // run must be rejected by the same occupied-space check.
          const intrusion = new T.Mesh(new T.BoxGeometry(0.04, 0.3, 0.04), materials.steel);
          intrusion.position.set(0.115, 0, -0.3);
          arm.add(intrusion);
          const blocked = measureChainEnvelope(arm, 0.575);
          expect(blocked.intersections + blocked.insideSamples).toBeGreaterThan(0);
          arm.remove(intrusion);
          intrusion.geometry.dispose();
        }
        expect(signedVolume(tray)).toBeGreaterThan(0.0001);
        expect(tray.boundingBox!.min.z).toBeCloseTo(-0.81, 6);
        expect(tray.boundingBox!.max.z).toBeCloseTo(-0.17, 6);
        for (const geometry of [...inventory(arm).geometries, tray]) {
          for (const attribute of Object.values(geometry.attributes))
            expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
          expect(geometry.boundingSphere?.radius).toBeLessThan(1);
        }
      } finally {
        for (const geometry of inventory(arm).geometries) geometry.dispose();
        tray.dispose();
        materials.dispose();
      }
    },
  );

  it.each(
    ['gpr1', 'gpr2'].flatMap((id) =>
      (['high', 'mid', 'far'] as const).map((detail) => ({ id, detail })),
    ),
  )(
    '$id $detail retains damper attachments, tyre clearance and resources over full suspension travel',
    ({ id, detail }) => {
      const def = VEHICLES[id],
        spec = def.bike!,
        materials = new BikeMaterials(0),
        bike = new BikeModel(def, 0, detail, materials, true),
        original = inventory(bike.root),
        armGroup = bike.root.getObjectByName('GP tapered carbon rear swingarm')!,
        upper = bike.root.getObjectByName('GP rear shock upper eye'),
        lower = bike.root.getObjectByName('GP rear shock lower eye'),
        tray = gpUndertray(detail),
        position = tray.getAttribute('position'),
        armLength = Math.hypot(spec.rearWheelRadius - spec.cgHeight + 0.13, spec.cgToRear - 0.2),
        point = new T.Vector3(),
        rearStructure = gpRearSwingarm(armLength, detail, materials),
        newParts: T.Mesh[] = [],
        feet = ['GP left foot', 'GP right foot'].map((name) => {
          const meshes: T.Mesh[] = [];
          bike.root.getObjectByName(name)!.traverse((object) => {
            if (object instanceof T.Mesh) meshes.push(object);
          });
          return meshes;
        });
      rearStructure.matrixAutoUpdate = false;
      rearStructure.traverse((object) => {
        if (object instanceof T.Mesh) newParts.push(object);
      });
      let minimumClearance = Infinity,
        bootColumns = 0;
      try {
        // Use each production bike's actual pivot-to-axle length as well as
        // the representative constructor case above.
        const actualChain = measureChainEnvelope(rearStructure, armLength);
        expect(actualChain.intersections).toBe(0);
        expect(actualChain.insideSamples).toBe(0);
        expect(Boolean(upper)).toBe(detail !== 'far');
        expect(Boolean(lower)).toBe(detail !== 'far');
        for (const fork of [0, spec.forkTravel / 2, spec.forkTravel])
          for (const shock of [0, spec.shockTravel / 2, spec.shockTravel]) {
            const snapshot = Object.freeze(
              pose(id, { fork, shock, steer: 0.24, chassisLean: 0.9, riderOffset: 0.18 }),
            );
            bike.pose(snapshot);
            bike.root.updateMatrixWorld(true);
            rearStructure.matrix.copy(armGroup.matrixWorld);
            rearStructure.updateMatrixWorld(true);
            // Test the real closed boot/cuff/sole volumes against every new
            // rear part. A toe can pass below a spar: overlap occupied
            // intervals rather than mistaking vertical ordering for contact.
            for (const [foot, meshes] of feet.entries()) {
              const overlap = meshColumnOverlap(meshes, newParts, meshColumnsFor(meshes, 0.004));
              expect(overlap.firstColumns).toBeGreaterThan(0);
              expect(
                overlap.maximumOverlap,
                JSON.stringify({ id, detail, fork, shock, foot, ...overlap }),
              ).toBeLessThan(0.001);
              bootColumns += overlap.comparedColumns;
            }
            if (
              detail === 'high' &&
              shock === spec.shockTravel &&
              fork === (id === 'gpr1' ? spec.forkTravel : 0)
            ) {
              // Both measured former >60 mm penetrations remain occupied
              // by the actual planted boot; the candidate structure clears.
              const observed = meshColumnOverlap(feet[0], newParts, {
                x: 0.16714183628559104,
                z: id === 'gpr1' ? -0.24225133144092154 : -0.23209111613492028,
                step: 1,
                columns: 1,
                rows: 1,
              });
              expect(observed.firstColumns).toBe(1);
              expect(observed.maximumOverlap).toBeLessThan(0.001);
            }
            if (upper && lower) {
              const upperTarget = bike.sprung.localToWorld(new T.Vector3(0, 0.095, -0.18)),
                lowerTarget = armGroup.localToWorld(new T.Vector3(0, -0.02, -armLength * 0.12));
              expect(upper.getWorldPosition(new T.Vector3()).distanceTo(upperTarget)).toBeLessThan(
                1e-8,
              );
              expect(lower.getWorldPosition(new T.Vector3()).distanceTo(lowerTarget)).toBeLessThan(
                1e-8,
              );
              // Retain space for the fixed shaft extent plus the opposite eye.
              expect(upperTarget.distanceTo(lowerTarget)).toBeGreaterThan(0.2);
              const spring = bike.root.getObjectByName('GP rear shock compression spring')!;
              expect(spring.scale.y).toBeGreaterThan(0.3);
            }
            // Conservative wheel + existing carbon-hugger circle in the actual
            // axle frame. Test all tray vertices after sprung compression/pitch.
            for (let i = 0; i < position.count; i++) {
              point.fromBufferAttribute(position, i).applyMatrix4(bike.sprung.matrix);
              const dz = point.z + spec.cgToRear,
                radius = spec.rearWheelRadius + 0.035;
              if (Math.abs(dz) >= radius) continue;
              const top =
                spec.rearWheelRadius - spec.cgHeight + Math.sqrt(radius * radius - dz * dz);
              minimumClearance = Math.min(minimumClearance, point.y - top);
            }
            expect(matrices(bike.root).flat().every(Number.isFinite)).toBe(true);
          }
        expect(minimumClearance).toBeGreaterThan(0.008);
        expect(bootColumns).toBeGreaterThan(20);
        const a = pose(id),
          b = pose(id, { fork: spec.forkTravel, shock: 0, brake: 1, steer: -0.24 });
        bike.pose(a);
        const first = matrices(bike.root);
        bike.pose(a);
        expect(matrices(bike.root)).toEqual(first);
        bike.pose(b);
        expect(matrices(bike.root)).not.toEqual(first);
        bike.pose(a);
        expect(matrices(bike.root)).toEqual(first);
        expect(inventory(bike.root)).toEqual(original);
        expect(original.triangles).toBeLessThan(110000);
        // A lower triangle count can still add rigid draws to the opaque and
        // windscreen transmission passes. Keep that observed regression out.
        if (detail === 'high') expect(original.meshes).toBeLessThan(110);
        // +1: satin carbon of the inner upper fairing (gp-race-bodywork.ts).
        // +1: the box wings' clear-coated body colour (gpWingPaint); the
        // wings were already their own mesh, so no draw is added.
        expect(original.materials.size).toBeLessThanOrEqual(36);
        // +2: the GP screen's printed-border alpha map (gp-appearance.ts) and
        // the livery's clear-coat orange-peel normal map (gp-race-bodywork.ts).
        expect(original.textures.size).toBeLessThanOrEqual(21);
      } finally {
        for (const geometry of inventory(rearStructure).geometries) geometry.dispose();
        tray.dispose();
        bike.dispose();
        materials.dispose();
      }
    },
  );

  it('keeps the other road-bike families on their original rear presentation', () => {
    for (const def of Object.values(VEHICLES).filter((v) =>
      ['superbike', 'supersport', 'classic-bike', 'road-bike'].includes(v.classId),
    )) {
      const materials = new BikeMaterials(0),
        bike = new BikeModel(def, 0, 'far', materials, true);
      try {
        bike.pose(pose(def.id));
        expect(bike.root.getObjectByName('GP tapered carbon rear swingarm')).toBeUndefined();
        expect(
          bike.root.getObjectByName('GP enclosed carbon undertail and shock clevis'),
        ).toBeUndefined();
        expect(matrices(bike.root).flat().every(Number.isFinite)).toBe(true);
      } finally {
        bike.dispose();
        materials.dispose();
      }
    }
  });
});
