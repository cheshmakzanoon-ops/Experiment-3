import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { GpRoadAir, gpRoadAirStrength } from '../src/rendering/gp-road-air.ts';
import { HeatHaze } from '../src/rendering/heat-haze.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { trackPoint, Track } from '../src/simulation/track.ts';
import { H, HEADER } from '../src/simulation/protocol.ts';

const hot = () => {
  const f = new Float32Array(HEADER);
  f[H.AMBIENT] = 34;
  f[H.CLOUD] = 0.12;
  f[H.WIND_X] = 1.8;
  f[H.WIND_Z] = -0.7;
  return f;
};
describe('GP asphalt boundary-layer refraction', () => {
  it('uses dry, warm, sunlit air and releases for standing water, rainfall, fog and darkness', () => {
    const f = hot(),
      base = gpRoadAirStrength(f, true);
    expect(base).toBeGreaterThan(0.9);
    expect(gpRoadAirStrength(f, false)).toBe(0);
    for (const [field, value] of [
      [H.RAIN, 1],
      [H.CLOUD, 0.95],
      [H.EXTINCTION, 2],
      [H.WATER, 0.33],
      [H.AMBIENT, 14],
    ]) {
      const copy = f.slice();
      copy[field] = value;
      expect(gpRoadAirStrength(copy, true)).toBe(0);
    }
    const windy = f.slice();
    windy[H.WIND_X] = -18;
    expect(gpRoadAirStrength(windy, true)).toBeLessThan(base * 0.4);
  });
  it.each(['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const)(
    '%s fixes the air to the surveyed asphalt and restores it on seek',
    (id) => {
      const track = new Track('clear', false, undefined, CIRCUITS[id]);
      const p = track.at(0, trackPoint()),
        cam = new T.PerspectiveCamera(46, 16 / 9, 0.08, 1100);
      cam.position.set(p.x - 55 * p.tx, p.y + 2.4, p.z - 55 * p.tz);
      cam.lookAt(p.x, p.y + 0.75, p.z);
      cam.updateMatrixWorld();
      const frame = hot(),
        h = new HeatHaze(),
        u = h.uniforms;
      h.update(frame, cam, [], 0, 23, 1080, track, 0, true);
      const count = u.gpRoadAirCount.value;
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(7);
      expect(h.count).toBe(0);
      const actual = u.gpRoadAirCentre.value.slice(0, count).map((v) => v.toArray());
      for (let i = 0; i < count; i++) {
        const centre = u.gpRoadAirCentre.value[i],
          measured = track.at(centre.w, trackPoint());
        const n = new T.Vector3()
          .fromArray(u.gpRoadAirUp.value[i].toArray())
          .transformDirection(cam.matrixWorld);
        const world = new T.Vector3(centre.x, centre.y, centre.z).applyMatrix4(cam.matrixWorld);
        const expected = new T.Vector3(measured.x, measured.y, measured.z).addScaledVector(n, 0.44);
        expect(world.distanceTo(expected)).toBeLessThan(1e-7);
        expect(u.gpRoadAirFlow.value[i].x).toBeCloseTo(1 / (measured.width - 0.65), 8);
        const t = new T.Vector3()
          .fromArray(u.gpRoadAirAlong.value[i].toArray())
          .transformDirection(cam.matrixWorld);
        expect(Math.abs(t.dot(n))).toBeLessThan(0.00001);
      }
      const wind = u.gpRoadAirFlow.value[0].y;
      const opposite = frame.slice();
      opposite[H.WIND_X] *= -1;
      opposite[H.WIND_Z] *= -1;
      h.update(opposite, cam, [], 0, 23, 1080, track, 0, true);
      expect(u.gpRoadAirFlow.value[0].y).toBeCloseTo(-wind);
      h.update(frame, cam, [], 0, 40, 1080, track, 333, true);
      h.update(frame, cam, [], 0, 23, 1080, track, track.length, true);
      expect(u.gpRoadAirCentre.value.slice(0, count).map((v) => v.toArray())).toEqual(actual);
      const other = new GpRoadAir();
      other.update(new Track(), 0, frame, cam, true);
      expect(other.uniforms.gpRoadAirCount.value).toBe(0);
      h.clear();
      expect(u.gpRoadAirCount.value).toBe(0);
    },
  );
});
