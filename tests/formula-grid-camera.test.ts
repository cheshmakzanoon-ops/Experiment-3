import * as T from 'three';
import { describe, it, expect } from 'vitest';
import { AUREL, VELLAMAR } from '../src/simulation/circuits.ts';
import { F, H, carBase, CAR_STRIDE, HEADER } from '../src/simulation/protocol.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { FormulaGridCamera } from '../src/rendering/formula-grid-camera.ts';
import { FORMULA_TELEPHOTO, TracksideDirector } from '../src/rendering/trackside.ts';

describe('Formula finish camera', () => {
  for (const circuit of [AUREL, VELLAMAR]) {
    it('looks through the actual mounted lens on ' + circuit.id, () => {
      const track = new Track('clear', false, undefined, circuit);
      const rig = new FormulaGridCamera(track, new T.MeshStandardMaterial());
      const site = rig.site,
        direction = new T.Vector3();
      expect(Math.sign(site.lateral)).toBe(-track.pit.side);
      expect(Math.abs(site.lateral) - track.boundary(site.s, site.side)).toBeCloseTo(2.2, 4);
      expect(track.length - site.s).toBeGreaterThan(5);
      expect(site.eye.y - site.base.y).toBeCloseTo(6.25);
      expect(rig.head.getWorldPosition(new T.Vector3()).distanceTo(site.eye)).toBeLessThan(1e-8);
      const director = new TracksideDirector(track);
      director.update(
        site.s,
        site.target,
        new T.Vector3(),
        0,
        1.6,
        3.1,
        true,
        undefined,
        FORMULA_TELEPHOTO,
      );
      expect(director.position.distanceTo(site.eye)).toBeLessThan(1e-8);
      const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
      frame[H.CARS] = 2;
      const place = (id: number, s: number) => {
        const p = track.at(s, trackPoint()),
          o = carBase(id);
        frame[o + F.S] = s;
        frame[o + F.X] = p.x;
        frame[o + F.Y] = p.y + 0.5;
        frame[o + F.Z] = p.z;
        return new T.Vector3(frame[o + F.X], frame[o + F.Y] + 0.18, frame[o + F.Z])
          .sub(site.eye)
          .normalize();
      };
      const near = place(0, site.s - 10),
        focused = place(1, 2);
      rig.update(frame, 1);
      expect(rig.head.getWorldDirection(direction).dot(focused)).toBeCloseTo(1, 8);
      frame[carBase(1) + F.RETIRED] = 1;
      rig.update(frame, 1);
      expect(rig.head.getWorldDirection(direction).dot(near)).toBeCloseTo(1, 8);
      frame[carBase(1) + F.RETIRED] = 0;
      rig.update(frame, 1);
      expect(rig.head.getWorldDirection(direction).dot(focused)).toBeCloseTo(1, 8);
      frame[H.CARS] = 0;
      rig.update(frame, 0);
      expect(
        rig.head.getWorldDirection(direction).dot(site.target.clone().sub(site.eye).normalize()),
      ).toBeCloseTo(1, 8);
    });
  }
});
