import { expect, it } from 'vitest';
import * as T from 'three';
import { sleeveSection, tailoredSleeve, capSafetyTube } from '../src/rendering/driver-tailoring.ts';

it.each([true, false])(
  'keeps the %s sleeve seam periodic in position, tangent and normal',
  (upper) => {
    const g = tailoredSleeve(upper),
      p = g.getAttribute('position'),
      n = g.getAttribute('normal');
    for (let row = 0; row <= 28; row++) {
      const first = row * 25,
        last = first + 24,
        u = row / 28;
      expect([p.getX(first), p.getY(first), p.getZ(first)]).toEqual([
        p.getX(last),
        p.getY(last),
        p.getZ(last),
      ]);
      expect([n.getX(first), n.getY(first), n.getZ(first)]).toEqual([
        n.getX(last),
        n.getY(last),
        n.getZ(last),
      ]);
      expect(
        sleeveSection(upper, u, 0).distanceTo(sleeveSection(upper, u, Math.PI * 2)),
      ).toBeLessThan(1e-12);
      const e = 1e-5;
      const left = sleeveSection(upper, u, e)
        .sub(sleeveSection(upper, u, -e))
        .divideScalar(2 * e);
      const right = sleeveSection(upper, u, 2 * Math.PI + e)
        .sub(sleeveSection(upper, u, 2 * Math.PI - e))
        .divideScalar(2 * e);
      expect(left.distanceTo(right)).toBeLessThan(1e-10);
    }
    g.dispose();
  },
);
it('caps solid attachment ends once and preserves every analytic tube-side normal', () => {
  const curve = new T.CatmullRomCurve3([
    new T.Vector3(-0.3, 0, 0),
    new T.Vector3(0, 0.5, 0.3),
    new T.Vector3(0.3, 0, 0),
  ]);
  const g = new T.TubeGeometry(curve, 32, 0.033, 12, false);
  const before = Array.from(g.getAttribute('normal').array);
  capSafetyTube(g);
  expect(Array.from(g.getAttribute('normal').array).slice(0, before.length)).toEqual(before);
  const count = g.index!.count;
  expect(capSafetyTube(g)).toBe(g);
  expect(g.index!.count).toBe(count);
  const closed = new T.TubeGeometry(curve, 32, 0.033, 12, true);
  expect(() => capSafetyTube(closed)).toThrow('no attachment ends');
  g.dispose();
  closed.dispose();
});
