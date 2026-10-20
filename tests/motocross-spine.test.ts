import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Rider, type RiderPose } from '../src/rendering/rider.ts';
import { motocrossGarmentGeometry } from '../src/rendering/offroad/motocross-gear.ts';
import { BikeMaterials, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
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

const colours = { primary: 0xc22c28, secondary: 0x202226, accent: 0xe5e1d6 };
const base: RiderPose = {
  lean: 0,
  offset: 0,
  tuck: 0,
  braking: 0,
  steer: 0,
  speed: 20,
  body: 0,
  standing: 1,
  compression: 0,
};

function surface(rider: Rider) {
  const values: number[] = [],
    point = new T.Vector3();
  rider.root.updateMatrixWorld(true);
  rider.root.traverse((object) => {
    values.push(...object.matrixWorld.elements);
    if (object instanceof T.SkinnedMesh)
      for (let i = 0; i < object.geometry.getAttribute('position').count; i += 19) {
        object.getVertexPosition(i, point);
        values.push(point.x, point.y, point.z);
      }
  });
  return values;
}

describe('motocross articulated torso and corner gaze', () => {
  it.each(['high', 'mid', 'far'] as const)(
    '%s rounds the jersey during absorption without moving its waistband or adding triangles',
    (detail) => {
      const rider = new Rider(colours, detail, 'motocross'),
        pelvis = rider.root.getObjectByName('Rider torso')!,
        chest = rider.root.getObjectByName('Motocross upper chest')!,
        jersey = rider.root.getObjectByName('Motocross sculpted textile torso') as T.SkinnedMesh,
        source = motocrossGarmentGeometry('jersey', detail),
        relative = new T.Quaternion(),
        point = new T.Vector3(),
        expected = new T.Vector3();
      rider.root.position.set(317, 4.2, -190);
      rider.root.rotation.set(0.27, 1.12, -0.56);
      const bend = () =>
        relative
          .copy(pelvis.quaternion)
          .invert()
          .multiply(chest.quaternion)
          .angleTo(new T.Quaternion());
      try {
        expect(jersey).toBeInstanceOf(T.SkinnedMesh);
        expect(jersey.geometry.index!.count).toBe(source.index!.count);
        expect(jersey.geometry.getAttribute('position').count).toBe(
          source.getAttribute('position').count,
        );
        rider.ride({ ...base, standing: 0 });
        const seated = bend();
        rider.ride(base);
        const standing = bend();
        rider.ride({ ...base, compression: 1, body: 0.8 });
        const compressed = bend();
        expect(standing).toBeGreaterThan(seated + 0.09);
        expect(compressed).toBeGreaterThan(standing + 0.06);
        expect(compressed).toBeLessThan(0.25);
        let waistMotion = 0;
        for (const lean of [-0.8, 0, 0.8])
          for (const standing of [0, 1])
            for (const compression of [0, 1]) {
              rider.ride({ ...base, lean, standing, compression, body: 0.6, steer: -lean * 0.2 });
              rider.root.updateMatrixWorld(true);
              const positions = jersey.geometry.getAttribute('position'),
                weights = jersey.geometry.getAttribute('skinWeight');
              for (let i = 0; i < positions.count; i++) {
                const y = positions.getY(i);
                expect(weights.getX(i) + weights.getY(i)).toBeCloseTo(1, 6);
                jersey.getVertexPosition(i, point);
                expect(jersey.boundingBox!.containsPoint(point)).toBe(true);
                expect(jersey.boundingSphere!.containsPoint(point)).toBe(true);
                point.applyMatrix4(jersey.matrixWorld);
                if (y <= 0.07 || y >= 0.39) {
                  const frame = y <= 0.07 ? pelvis : chest;
                  expected.fromBufferAttribute(positions, i).applyMatrix4(frame.matrixWorld);
                  expect(point.distanceTo(expected)).toBeLessThan(1e-7);
                } else if (y > 0.18 && y < 0.35) {
                  expected.fromBufferAttribute(positions, i).applyMatrix4(pelvis.matrixWorld);
                  waistMotion = Math.max(waistMotion, point.distanceTo(expected));
                }
              }
              expect(bend()).toBeLessThan(0.32);
            }
        // Measured deformation of the actual surface: a renamed rigid
        // cylinder cannot pass this check.
        expect(waistMotion).toBeGreaterThan(0.018);
      } finally {
        source.dispose();
        rider.dispose();
      }
    },
  );

  it('keeps the collar and neck liner seated on the upper jersey through compression and countersteering', () => {
    const rider = new Rider(colours, 'mid', 'motocross'),
      helmet = rider.root.getObjectByName('Rider head and helmet')!,
      chest = rider.root.getObjectByName('Motocross upper chest')!,
      neck = rider.root.getObjectByName(
        'Motocross neck liner above textile collar',
      ) as T.SkinnedMesh,
      collar = rider.root.getObjectByName('Motocross rib-knit jersey collar') as T.SkinnedMesh,
      orientation = new T.Quaternion(),
      forward = new T.Vector3(),
      point = new T.Vector3(),
      expected = new T.Vector3();
    const look = (pose: RiderPose) => {
      rider.ride(pose);
      rider.root.updateMatrixWorld(true);
      helmet.getWorldQuaternion(orientation);
      forward.set(0, 0, 1).applyQuaternion(orientation);
      return Math.atan2(forward.x, forward.z);
    };
    try {
      const right = { ...base, lean: -0.7, steer: 0.16 };
      const left = { ...base, lean: 0.7, steer: -0.16 };
      expect(look(left)).toBeCloseTo(0.35, 6);
      const steady = orientation.clone();
      expect(look({ ...left, compression: 1, body: 1 })).toBeCloseTo(0.35, 6);
      expect(orientation.angleTo(steady)).toBeLessThan(1e-7);
      expect(look(right)).toBeCloseTo(-0.35, 6);
      expect(look({ ...base, lean: 0, steer: 0.3, speed: 0 })).toBeCloseTo(0.255, 6);
      for (const pose of [
        base,
        { ...base, compression: 1, body: 1 },
        { ...left, compression: 1, body: 0.6 },
        { ...right, compression: 0.8, body: -0.4 },
      ]) {
        look(pose);
        // The actual collar surface must move with the neck opening. A rigid
        // pelvis collar sticks above the helmet during a compressed landing.
        for (const mesh of [neck, collar]) {
          expect(mesh).toBeInstanceOf(T.SkinnedMesh);
          const positions = mesh.geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) {
            mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
            expected.fromBufferAttribute(positions, i).applyMatrix4(chest.matrixWorld);
            expect(point.distanceTo(expected)).toBeLessThan(1e-9);
          }
        }
      }
      rider.setFirstPerson(true, true);
      const visible = new Set<T.Object3D>();
      rider.root.traverseVisible((object) => visible.add(object));
      expect(visible.has(collar)).toBe(false);
      expect(visible.has(neck)).toBe(false);
    } finally {
      rider.dispose();
    }
  });

  it('carries presented speed through the production bike to distinguish steering from countersteering', () => {
    const definition = VEHICLES.mx450,
      material = new BikeMaterials(0),
      model = new DirtBikeModel(definition, 0, 'mid', material, mudUniforms()),
      sag = staticSag(definition),
      helmet = model.rider.root.getObjectByName('Rider head and helmet')!,
      orientation = new T.Quaternion(),
      forward = new T.Vector3(),
      pose: BikePoseValues = {
        fork: sag.fork,
        shock: sag.shock,
        steer: -0.16,
        frontRotation: 0,
        rearRotation: 0,
        chassisLean: 0.6,
        riderOffset: 0,
        tuck: 0,
        brake: 0,
        rearBrake: 0,
        discTemp: 0,
        compoundColour: 0xffffff,
        riding: true,
      };
    const yaw = (speed: number) => {
      model.pose({ ...pose, speed });
      model.root.updateMatrixWorld(true);
      helmet.getWorldQuaternion(orientation);
      forward.set(0, 0, 1).applyQuaternion(orientation);
      return Math.atan2(forward.x, forward.z);
    };
    try {
      const slow = yaw(0),
        fast = yaw(20);
      expect(slow).toBeLessThan(-0.1);
      expect(fast).toBeGreaterThan(0.25);
      expect(yaw(0)).toBe(slow);
      expect(yaw(20)).toBe(fast);
    } finally {
      model.dispose();
      material.dispose();
    }
  });

  it('reconstructs held and rewound cloth through recovery and camera toggles without writing vertex buffers', () => {
    const rider = new Rider(colours, 'mid', 'motocross'),
      jersey = rider.root.getObjectByName('Motocross sculpted textile torso') as T.SkinnedMesh,
      attributes = new Map<T.BufferAttribute, number>(),
      pose = { ...base, lean: 0.7, offset: 0.06, steer: -0.12, compression: 0.8, body: -0.5 };
    rider.root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      for (const attribute of Object.values(object.geometry.attributes))
        if (attribute instanceof T.BufferAttribute) attributes.set(attribute, attribute.version);
    });
    let disposed = 0;
    jersey.skeleton.computeBoneTexture();
    jersey.skeleton.boneTexture!.addEventListener('dispose', () => disposed++);
    try {
      rider.ride(pose);
      const before = surface(rider);
      rider.ride(pose);
      expect(surface(rider)).toEqual(before);
      for (const phase of [0, 1, 2]) {
        rider.setFirstPerson(true, true);
        rider.ride({ ...base, lean: -0.8, standing: 0, compression: 0 });
        rider.separated(phase, 1.5, 0.43);
        rider.setFirstPerson(false, true);
        rider.ride(pose);
        expect(surface(rider)).toEqual(before);
      }
      for (const [attribute, version] of attributes) expect(attribute.version).toBe(version);
    } finally {
      rider.dispose();
    }
    expect(disposed).toBe(1);
  });
});
