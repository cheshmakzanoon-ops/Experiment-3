import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { LaunchMooring, MooringHardware } from '../src/rendering/open-world/launch-moorings.ts';
import { harbourWaveHeight } from '../src/rendering/open-world/harbour-swell.ts';

describe('Port Ilse swing moorings', () => {
  it('holds both rope eyes through the swell, retains line length and reconstructs a sought pose', () => {
    const hull = new T.Group();
    hull.position.set(670, -0.03, -2808);
    const hardware = new MooringHardware(),
      mooring = new LaunchMooring(hull, Math.PI - 0.28, 0, hardware);
    const ring = (geometry: T.BufferGeometry, row: number) => {
      const position = geometry.getAttribute('position'),
        v = new T.Vector3(),
        sample = new T.Vector3();
      for (let side = 0; side < 6; side++)
        v.add(sample.fromBufferAttribute(position, row * 6 + side));
      return v.multiplyScalar(1 / 6);
    };
    const snapshot = () => {
      const positions = mooring.line.geometry.getAttribute('position').array;
      return [
        ...hull.position.toArray(),
        ...hull.quaternion.toArray(),
        ...mooring.float.position.toArray(),
        ...positions,
      ];
    };
    let minimum = Infinity,
      maximum = -Infinity,
      previous: T.Vector3 | undefined;
    for (let time = 0; time <= 180; time += 0.5) {
      mooring.update(time, 8, false);
      const g = mooring.line.geometry,
        a = ring(g, 0),
        b = ring(g, 18);
      const bow = new T.Vector3(0, 0.94, 4.69)
        .applyQuaternion(hull.quaternion)
        .add(hull.position)
        .sub(mooring.root.position);
      const top = new T.Vector3(0, 0.45, 0)
        .applyQuaternion(mooring.float.quaternion)
        .add(mooring.float.position);
      expect(a.distanceTo(bow)).toBeLessThan(0.000002);
      expect(b.distanceTo(top)).toBeLessThan(0.000002);
      let length = 0,
        last = a;
      for (let k = 1; k <= 18; k++) {
        const next = ring(g, k);
        length += next.distanceTo(last);
        last = next;
      }
      expect(length).toBeCloseTo(3.87, 2);
      const at = mooring.float.position,
        datum = mooring.root.position;
      expect(at.y).toBeCloseTo(harbourWaveHeight(at.x + datum.x, at.z + datum.z, time), 10);
      minimum = Math.min(minimum, hull.position.x);
      maximum = Math.max(maximum, hull.position.x);
      if (previous) expect(previous.distanceTo(hull.position)).toBeLessThan(0.31);
      previous = hull.position.clone();
    }
    expect(maximum - minimum).toBeGreaterThan(0.22);
    mooring.update(3.5, 8, false);
    const expected = snapshot();
    mooring.update(152, 250, true);
    expect(mooring.root.visible).toBe(false);
    mooring.update(3.5, 8, false);
    expect(snapshot()).toEqual(expected);
    const g = mooring.line.geometry,
      p = g.getAttribute('position'),
      n = g.getAttribute('normal'),
      idx = g.index!;
    const at = (i: number) => new T.Vector3().fromBufferAttribute(p, idx.getX(i));
    const face = at(1)
      .sub(at(0))
      .cross(at(2).sub(at(0)))
      .normalize();
    expect(face.dot(new T.Vector3().fromBufferAttribute(n, idx.getX(0)))).toBeGreaterThan(0.78);
    expect(hardware.float.getAttribute('color').count).toBe(
      hardware.float.getAttribute('position').count,
    );
    mooring.dispose();
    hardware.dispose();
  });
});
