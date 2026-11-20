import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { MotocrossDab } from '../src/rendering/offroad/motocross-dab.ts';
import {
  MX_BOOT_ANKLE,
  MX_BOOT_PEG,
  motocrossBootFrame,
  motocrossSoleContact,
} from '../src/rendering/offroad/motocross-rider-contact.ts';
import { motocrossBootSole } from '../src/rendering/offroad/motocross-rider-equipment.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { trackPoint } from '../src/simulation/track.ts';

describe('motocross boot on presented dirt', () => {
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    'returns the displayed triangle under the boot at %s',
    (circuit) => {
      const track = rigTrack(circuit),
        terrain = new TerrainView(track);
      const ray = new T.Raycaster(),
        plane = new T.Plane(),
        query = new T.Vector3(),
        down = new T.Vector3(0, -1, 0);
      try {
        terrain.group.updateMatrixWorld(true);
        for (const station of [0.24, 31.27, 92.73, track.length - 0.16]) {
          const p = track.at(station, trackPoint());
          const l = 0.72;
          query.set(p.x + p.nx * l, terrain.heightAt(station, l) + 1.5, p.z + p.nz * l);
          ray.set(query, down);
          const hit = ray.intersectObjects(terrain.group.children, true)[0];
          expect(hit).toBeDefined();
          expect(terrain.planeAtWorld(query, plane)).toBe(true);
          expect(Math.abs(plane.distanceToPoint(hit.point))).toBeLessThan(0.008);
          expect(plane.normal.y).toBeGreaterThan(0.65);
        }
      } finally {
        terrain.dispose();
      }
      expect(terrain.planeAtWorld(query, plane)).toBe(false);
    },
  );

  it.each([-1, 1])(
    'places the actual sole on a reachable side slope without sliding the other foot (side %s)',
    (side) => {
      const helper = new MotocrossDab(),
        root = new T.Group();
      root.position.set(-134, 5.4, 211);
      root.rotation.set(0.15, 1.25, -0.27);
      root.updateMatrixWorld();
      const peg = new T.Vector3(side * 0.17, -0.44, -0.1),
        hip = new T.Vector3(side * 0.1, 0.13, -0.05);
      const start = motocrossSoleContact(peg, side, side, new T.Vector3());
      const normal = new T.Vector3(-side * 0.19, 1, 0.11).normalize();
      const local = new T.Plane().setFromNormalAndCoplanarPoint(
        normal,
        start.clone().addScaledVector(normal, -0.13),
      );
      const world = local.clone().applyMatrix4(root.matrixWorld);
      const ground = {
        planeAtWorld: (_p: T.Vector3, dst: T.Plane) => {
          dst.copy(world);
          return true;
        },
      };
      const sole = motocrossBootSole('high', side);
      const bind = new T.Vector3().fromArray(MX_BOOT_PEG);
      const sample = () => {
        const target = start.clone(),
          q = motocrossBootFrame(new T.Quaternion(), 1);
        helper.place(ground, root, hip, 0.872, 1, target, q);
        const p = new T.Vector3(),
          a = sole.getAttribute('position');
        let clearance = Infinity;
        for (let i = 0; i < a.count; i++) {
          p.fromBufferAttribute(a, i)
            .sub(bind)
            .applyQuaternion(q)
            .add(target)
            .applyMatrix4(root.matrixWorld);
          clearance = Math.min(clearance, world.distanceToPoint(p));
        }
        const ankle = new T.Vector3()
          .fromArray(MX_BOOT_ANKLE)
          .sub(bind)
          .applyQuaternion(q)
          .add(target);
        return {
          pose: [...target.toArray(), ...q.toArray()],
          clearance,
          reach: ankle.distanceTo(hip),
        };
      };
      try {
        const first = sample();
        expect(first.clearance).toBeGreaterThan(-0.003);
        expect(first.clearance).toBeLessThan(0.014);
        expect(first.reach).toBeLessThanOrEqual(0.8721);
        const other = peg.clone(),
          q = motocrossBootFrame(new T.Quaternion());
        const before = [...other.toArray(), ...q.toArray()];
        helper.place(ground, root, hip, 0.872, 0, other, q);
        expect([...other.toArray(), ...q.toArray()]).toEqual(before);
        expect(sample()).toEqual(first);
        world.constant += 2;
        const overGap = sample();
        expect(overGap.pose.slice(0, 3)).toEqual(start.toArray());
      } finally {
        sole.dispose();
      }
    },
  );
});
