import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { gpTyreDeflection } from '../src/rendering/gp-tyre-carcass.ts';
import {
  RoadBikeContactPose,
  RoadBikeWheelPose,
  ROAD_SWINGARM_PIVOT,
} from '../src/rendering/road-bike-pose.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

describe('GP slick contact under load', () => {
  it('loads progressively, responds to inflation, and stays inside the tread depth budget', () => {
    for (const rear of [true, false]) {
      expect(gpTyreDeflection(0, 180, rear)).toBe(0);
      expect(gpTyreDeflection(NaN, 180, rear)).toBe(0);
      expect(gpTyreDeflection(1100, 250, rear)).toBeLessThan(gpTyreDeflection(1100, 160, rear));
      expect(gpTyreDeflection(1100, NaN, rear)).toBe(gpTyreDeflection(1100, 180, rear));
      expect(gpTyreDeflection(2200, 180, rear)).toBeCloseTo(2 * gpTyreDeflection(1100, 180, rear));
      expect(gpTyreDeflection(1e7, 40, rear)).toBeLessThanOrEqual(0.018);
    }
  });

  it.each(['gpr1', 'gpr2'])(
    '%s keeps both contact planes and the rigid swingarm at lean and steer',
    (id) => {
      const def = VEHICLES[id],
        b = def.bike!;
      const contact = new RoadBikeContactPose(),
        solver = new RoadBikeWheelPose();
      contact.valid = true;
      const n = new T.Vector3(0.06, 1, -0.025).normalize();
      contact.normals.forEach((normal) => normal.copy(n));
      contact.points[0].set(0, (-n.z * b.cgToFront) / n.y, b.cgToFront);
      contact.points[1].set(0, (n.z * b.cgToRear) / n.y, -b.cgToRear);
      contact.pressures[0] = 175;
      contact.pressures[1] = 207;
      contact.loads[0] = 1850;
      contact.loads[1] = 620;
      const q = new T.Quaternion(),
        centre = new T.Vector3(),
        plane = new T.Vector3();
      const pivot = new T.Vector3(...ROAD_SWINGARM_PIVOT),
        armLength = pivot.distanceTo(new T.Vector3(0, b.rearWheelRadius - b.cgHeight, -b.cgToRear));
      for (const tilt of [-0.82, 0, 0.75]) {
        q.setFromEuler(new T.Euler(0.036, 0.05, tilt, 'YXZ'));
        centre.set(0.03, b.cgHeight * Math.cos(tilt), 0);
        solver.solve(def, 0.075, centre, q, contact);
        for (let i = 0; i < 2; i++) {
          expect(plane.subVectors(solver.patches[i], contact.points[i]).dot(n)).toBeCloseTo(0, 9);
          expect(plane.subVectors(solver.hubs[i], solver.patches[i]).dot(n)).toBeCloseTo(
            solver.carcassPlanes[i].w,
            9,
          );
          expect(solver.carcassDeflection.getComponent(i)).toBe(
            gpTyreDeflection(contact.loads[i], contact.pressures[i], i === 1),
          );
        }
        const rearLocal = solver.hubs[1].clone().sub(centre).applyQuaternion(q.clone().invert());
        expect(rearLocal.distanceTo(pivot)).toBeCloseTo(armLength, 9);
      }
      contact.gaps[0] = 0.14;
      solver.solve(def, 0.075, centre, q, contact);
      expect(solver.carcassDeflection.x).toBe(0);
      expect(solver.carcassDeflection.y).toBeGreaterThan(0);
      expect(plane.subVectors(solver.patches[0], contact.points[0]).dot(n)).toBeCloseTo(
        0.14 * n.y,
        9,
      );
      solver.solve(VEHICLES['nr900'], 0, centre, q, contact);
      expect(solver.carcassDeflection.lengthSq()).toBe(0);
    },
  );
});
