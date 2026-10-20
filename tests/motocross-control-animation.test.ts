import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

describe('motocross chassis-to-rider gaze integration', () => {
  it.each(['mx250', 'mx450'])(
    '%s reduces the actual helmet pitch excursion independently of track heading and suspension stroke',
    (id) => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0),
        model = new DirtBikeModel(definition, 0, 'mid', materials, mudUniforms()),
        sag = staticSag(definition),
        helmet = model.rider.root.getObjectByName('Rider head and helmet')!,
        frame = new T.Euler(),
        orientation = new T.Quaternion(),
        direction = new T.Vector3();
      const pose: BikePoseValues = {
        fork: sag.fork,
        shock: sag.shock,
        steer: 0,
        frontRotation: 0,
        rearRotation: 0,
        chassisLean: 0,
        riderOffset: 0,
        tuck: 0,
        brake: 0,
        rearBrake: 0,
        discTemp: 0,
        compoundColour: 0xffffff,
        riding: true,
        standing: 1,
      };
      const gaze = (pitch: number, yaw: number) => {
        // Match the production order: BikeShells assigns the chassis frame
        // before DirtBikeModel derives the rider pose from that quaternion.
        model.root.quaternion.setFromEuler(frame.set(pitch, yaw, 0, 'YXZ'));
        model.pose(pose);
        model.root.updateMatrixWorld(true);
        helmet.getWorldQuaternion(orientation);
        direction.set(0, 0, 1).applyQuaternion(orientation);
        return Math.atan2(-direction.y, Math.hypot(direction.x, direction.z));
      };
      try {
        model.root.position.set(140, 8, -230);
        const neutralGaze = gaze(0, 0);
        for (const [fork, shock] of [
          [0, 0],
          [0.08, 0.03],
        ]) {
          pose.fork = sag.fork + fork;
          pose.shock = sag.shock + shock;
          const level = gaze(0, 0);
          // Recorded stroke articulates the hubs and rider absorption while
          // the authoritative chassis frame determines the helmet's gaze.
          expect(level).toBeCloseTo(neutralGaze, 10);
          for (const pitch of [-0.5, 0.5]) {
            const excursion = gaze(pitch, 0) - level;
            // The head retains roughly 22% of the chassis pitch. Missing or
            // reversed quaternion-to-rider wiring would approach 100%/178%.
            expect(excursion / pitch).toBeGreaterThan(0.15);
            expect(excursion / pitch).toBeLessThan(0.3);
            for (const yaw of [1.1, -2.4, Math.PI]) {
              expect(gaze(0, yaw)).toBeCloseTo(level, 10);
              expect(gaze(pitch, yaw) - level).toBeCloseTo(excursion, 10);
            }
          }
        }
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );
});

describe('motocross front brake articulation', () => {
  it.each(['mx250', 'mx450'])(
    '%s pulls the real blade toward the grip, independently of the rear brake, and rewinds exactly',
    (id) => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0);
      const model = new DirtBikeModel(definition, 0, 'high', materials, mudUniforms());
      const sag = staticSag(definition);
      const pose: BikePoseValues = {
        fork: sag.fork,
        shock: sag.shock,
        steer: 0,
        frontRotation: 0,
        rearRotation: 0,
        chassisLean: 0,
        riderOffset: 0,
        tuck: 0,
        brake: 0,
        rearBrake: 0,
        discTemp: 0,
        compoundColour: 0xffffff,
        riding: true,
        standing: 1,
      };
      try {
        const lever = model.root.getObjectByName('Motocross front brake lever pivot')!;
        const steer = model.onboardControls.parent!;
        const inspect = () => {
          model.pose(pose);
          model.root.updateMatrixWorld(true);
          const inverse = steer.matrixWorld.clone().invert();
          const point = new T.Vector3(),
            matrix = new T.Matrix4();
          const positions: number[] = [];
          let minimumRubberClearance = Infinity;
          // Inspect actual batched blade/terminal vertices after articulation,
          // including steering and suspension, rather than a duplicate marker.
          lever.traverse((object) => {
            if (!(object instanceof T.Mesh)) return;
            const p = object.geometry.getAttribute('position');
            matrix.multiplyMatrices(inverse, object.matrixWorld);
            for (let i = 0; i < p.count; i++) {
              point.fromBufferAttribute(p, i).applyMatrix4(matrix);
              positions.push(...point.toArray());
              if (point.x >= -0.42 && point.x <= -0.3)
                minimumRubberClearance = Math.min(
                  minimumRubberClearance,
                  Math.hypot(point.y - 0.29, point.z + 0.06) - 0.018,
                );
            }
          });
          const tip = new T.Vector3(-0.14, 0, 0).applyMatrix4(lever.matrix);
          return { positions, tip, minimumRubberClearance, pivot: lever.position.toArray() };
        };
        const released = inspect();
        pose.rearBrake = 1;
        expect(inspect()).toEqual(released);
        pose.rearBrake = 0;
        pose.brake = 1;
        const pulled = inspect();
        expect(pulled.tip.z).toBeLessThan(released.tip.z - 0.02);
        expect(pulled.tip.z).toBeGreaterThan(released.tip.z - 0.04);
        expect(pulled.pivot).toEqual(released.pivot);
        expect(pulled.minimumRubberClearance).toBeGreaterThan(0.001);
        expect(inspect()).toEqual(pulled);
        pose.steer = -0.35;
        pose.fork += 0.12;
        const articulated = inspect();
        expect(articulated.minimumRubberClearance).toBeGreaterThan(0.001);
        articulated.positions.forEach((value, i) =>
          expect(value).toBeCloseTo(pulled.positions[i], 8),
        );
        pose.steer = 0;
        pose.fork = sag.fork;
        pose.brake = 0;
        expect(inspect()).toEqual(released);
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );
});
