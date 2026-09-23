import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { menuPreview } from '../src/rendering/menu-preview.ts';
import { PhotoStage } from '../src/rendering/photo-stage.ts';
import { TireCarcass } from '../src/rendering/tire-carcass.ts';
import { wheelTravel } from '../src/rendering/wheel-pose.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';

const track = new Track();
describe('actual static menu preview geometry', () => {
  it('uses the real nonzero longitudinal position instead of positioning the showroom at grid-start elevation', () => {
    const frame = menuPreview(track),
      o = carBase(0);
    const road = track.at(frame[o + F.S], trackPoint());
    expect(frame[o + F.S]).toBeCloseTo(track.length - 32, 3);
    expect(road.y).toBeLessThan(-0.2); // Regression: old studio was at y=0.
    expect(frame[o + F.X]).toBeCloseTo(road.x, 4);
    expect(frame[o + F.Z]).toBeCloseTo(road.z, 4);
    expect(frame[o + F.Y] - road.y).toBeCloseTo(0.535, 6);
    expect(Math.hypot(frame[o + F.QY], frame[o + F.QW])).toBeCloseTo(1, 6);
    expect(frame[H.TIME]).toBe(0);
    expect(frame[o + F.LAPS]).toBe(0);
  });
  it('places the real undeformed tire surfaces on the level podium without relocating the car', () => {
    const frame = menuPreview(track),
      o = carBase(0);
    const car = new T.Group();
    car.position.set(frame[o + F.X], frame[o + F.Y], frame[o + F.Z]);
    car.quaternion.set(0, frame[o + F.QY], 0, frame[o + F.QW]);
    const before = car.matrix.clone();
    const stage = new PhotoStage(),
      road = track.at(frame[o + F.S], trackPoint());
    stage.position(car, road.y);
    expect(car.matrix.toArray()).toEqual(before.toArray());
    const material = new T.MeshStandardMaterial(),
      point = new T.Vector3();
    for (let i = 0; i < 4; i++) {
      const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
      const pivot = new T.Group(),
        tire = new TireCarcass(i < 2 ? 0.155 : 0.205, material, material);
      pivot.position.set(
        i % 2 ? 0.83 : -0.83,
        0.05 - wheelTravel(frame, frame, w, 0),
        i < 2 ? 1.72 : -1.72,
      );
      car.add(pivot);
      pivot.add(tire.root);
      tire.update(0, frame[w + W.RADIUS], frame[w + W.LOAD], frame[w + W.PRESSURE]);
      car.updateMatrixWorld(true);
      let minimum = Infinity;
      tire.root.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        const positions = object.geometry.getAttribute('position');
        for (let vertex = 0; vertex < positions.count; vertex++) {
          point.fromBufferAttribute(positions, vertex).applyMatrix4(object.matrixWorld);
          minimum = Math.min(minimum, point.y);
        }
        object.geometry.dispose();
      });
      expect(minimum - stage.root.position.y).toBeCloseTo(0, 5);
      expect(frame[w + W.LOAD]).toBe(0);
    }
    stage.root.traverse((object) => {
      if (object instanceof T.Mesh) {
        object.geometry.dispose();
        for (const m of Array.isArray(object.material) ? object.material : [object.material])
          m.dispose();
      }
    });
    material.dispose();
  });
  it('returns independent finite frames without changing track geometry or inventing motion', () => {
    const original = JSON.stringify(track.points),
      a = menuPreview(track),
      b = menuPreview(track);
    expect(a).toEqual(b);
    a[carBase(0) + F.X] = 999;
    expect(a).not.toEqual(b);
    expect(Array.from(b).every(Number.isFinite)).toBe(true);
    expect(JSON.stringify(track.points)).toBe(original);
    expect(() => menuPreview(track, NaN)).toThrow('Invalid menu');
  });
});
