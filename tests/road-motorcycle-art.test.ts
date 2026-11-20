import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeModel, staticSag } from '../src/rendering/bike.ts';
import { bikeEntrantScheme } from '../src/rendering/bike-sheet.ts';
import { motorcycleWheel } from '../src/rendering/gp-forged-wheel.ts';
import { gpFrontBrakeAngle } from '../src/rendering/gp-front-brake.ts';
import { gpThrottleAngle } from '../src/rendering/gp-rider-contact.ts';
import {
  ROAD_SWINGARM_PIVOT,
  RoadBikeContactPose,
  RoadBikeWheelPose,
} from '../src/rendering/road-bike-pose.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

const catalogue = [
  ['sbk1000', 'superbike'],
  ['ss600', 'supersport'],
  ['nr900', 'roadster'],
  ['cr750', 'wire'],
] as const;

beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'createLinearGradient' || key === 'createRadialGradient'
          ? () => ({ addColorStop() {} })
          : key === 'measureText'
            ? () => ({ width: 8 })
            : () => undefined,
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());

describe('road motorcycles in the GP selector', () => {
  it.each(['high', 'mid', 'far'] as const)(
    '%s preserves a hollow axle and four distinct pierced wheel silhouettes',
    (detail) => {
      const material = new T.MeshBasicMaterial({ side: T.DoubleSide });
      const patterns = new Set<string>();
      try {
        for (const [, design] of catalogue) {
          const geometry = motorcycleWheel(0.2159, 0.1, detail, design);
          try {
            const wheel = new T.Mesh(geometry, material),
              ray = new T.Raycaster();
            const hit = (radius: number, angle: number) => {
              ray.ray.origin.set(0.5, radius * Math.cos(angle), radius * Math.sin(angle));
              ray.ray.direction.set(-1, 0, 0);
              return ray.intersectObject(wheel).length > 0;
            };
            expect(hit(0, 0)).toBe(false);
            const samples = Array.from({ length: 240 }, (_, i) =>
              hit(0.15, (2 * Math.PI * (i + 0.2)) / 240),
            );
            expect(samples.filter(Boolean).length, design).toBeGreaterThan(8);
            expect(samples.filter(Boolean).length, design).toBeLessThan(180);
            for (let angle = 0; angle < 12; angle++)
              expect(hit(0.205, (angle / 12) * Math.PI * 2)).toBe(true);
            patterns.add(samples.map(Number).join(''));
            expect(geometry.groups).toHaveLength(0);
          } finally {
            geometry.dispose();
          }
        }
        expect(patterns.size).toBe(catalogue.length);
      } finally {
        material.dispose();
      }
    },
  );

  it.each(catalogue)(
    '%s restores its lever and throttle independently and preserves its rear arm length',
    (id) => {
      const def = VEHICLES[id],
        b = def.bike!,
        scheme = bikeEntrantScheme(id, 0);
      const materials = new BikeMaterials(scheme),
        model = new BikeModel(def, scheme, 'high', materials, true);
      const pose = {
        ...staticSag(def),
        steer: 0.14,
        frontRotation: 0,
        rearRotation: 0,
        chassisLean: 0.24,
        riderOffset: 0.05,
        tuck: 0.4,
        brake: 0,
        rearBrake: 0,
        discTemp: 220,
        compoundColour: 0xffffff,
        riding: true,
        speed: 30,
      };
      try {
        const lever = model.root.getObjectByName('Road front-brake lever pivot')!,
          sleeve = model.root.getObjectByName('Road right throttle sleeve')!;
        for (const [brake, throttle] of [
          [0, 0],
          [1, 0],
          [0.3, 0.75],
          [0.3, 0.75],
          [0, 0],
          [1, 0],
        ]) {
          model.pose({ ...pose, brake, throttle, rearBrake: 1 });
          expect(lever.rotation.y).toBeCloseTo(gpFrontBrakeAngle(brake), 12);
          expect(sleeve.rotation.y).toBeCloseTo(-gpThrottleAngle(throttle), 12);
        }
        const road = new RoadBikeContactPose(),
          wheels = new RoadBikeWheelPose(),
          pivot = new T.Vector3(...ROAD_SWINGARM_PIVOT);
        const length = new T.Vector3(0, b.rearWheelRadius - b.cgHeight, -b.cgToRear).distanceTo(
          pivot,
        );
        const attitude = new T.Quaternion().setFromEuler(new T.Euler(0.08, 0.09, -0.19));
        road.valid = true;
        road.normals.forEach((normal) => normal.set(0.03, 1, -0.04).normalize());
        for (const height of [-0.045, 0, 0.065, -0.045]) {
          const position = new T.Vector3(0, b.cgHeight + height, 0);
          wheels.solve(def, pose.steer, position, attitude, road);
          expect(Math.hypot(wheels.rearY - pivot.y, wheels.rearZ - pivot.z)).toBeCloseTo(
            length,
            10,
          );
          expect(road.normals[1].dot(wheels.patches[1])).toBeCloseTo(0, 9);
        }
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );
});
