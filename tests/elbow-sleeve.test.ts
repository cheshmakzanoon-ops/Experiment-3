import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { ElbowSleeve } from '../src/rendering/elbow-sleeve.ts';
import { DriverRig } from '../src/rendering/driver.ts';

describe('IK-driven elbow cloth', () => {
  it('keeps buffers, finite unit normals and welded seams across all steering positions', () => {
    const wheel = new T.Group();
    wheel.position.set(0, 0.115, 0.22);
    wheel.rotation.x = 0.12;
    const rig = new DriverRig(wheel);
    const bridges: T.Mesh<ElbowSleeve>[] = [];
    rig.root.traverse((o) => {
      if (o instanceof T.Mesh && o.geometry instanceof ElbowSleeve)
        bridges.push(o as T.Mesh<ElbowSleeve>);
    });
    expect(bridges).toHaveLength(2);
    const buffers = bridges.map((m) => m.geometry.getAttribute('position').array);
    for (let angle = -1.4; angle <= 1.4; angle += 0.08) {
      wheel.rotation.z = angle;
      rig.update(10 + angle, 4, 1);
      for (const [i, bridge] of bridges.entries()) {
        const p = bridge.geometry.getAttribute('position'),
          n = bridge.geometry.getAttribute('normal');
        expect(p.array).toBe(buffers[i]);
        for (let k = 0; k < p.count; k++) {
          expect(Math.hypot(p.getX(k), p.getY(k), p.getZ(k))).toBeLessThan(0.12);
          expect(Math.hypot(n.getX(k), n.getY(k), n.getZ(k))).toBeCloseTo(1, 5);
        }
        for (let row = 0; row <= 8; row++)
          for (const a of [p, n]) {
            const first = row * 17,
              last = first + 16;
            expect([a.getX(first), a.getY(first), a.getZ(first)]).toEqual([
              a.getX(last),
              a.getY(last),
              a.getZ(last),
            ]);
          }
        expect(bridge.position.toArray()).toEqual(rig.diagnostics()[i].elbow);
      }
      expect(rig.diagnostics().every((a) => a.reachable)).toBe(true);
    }
  });
  it('handles straight bones and rejects invalid joints without reallocating topology', () => {
    const g = new ElbowSleeve(),
      a = new T.Vector3(0, 0, -0.37),
      b = new T.Vector3(),
      c = new T.Vector3(0, 0, 0.36);
    g.pose(a, b, c);
    expect(Array.from(g.getAttribute('normal').array).every(Number.isFinite)).toBe(true);
    expect(g.index!.count / 3).toBe(256);
    expect(() => g.pose(a, b, new T.Vector3(NaN, 0, 0))).toThrow('Invalid sleeve joints');
    expect(() => g.pose(b, b, c)).toThrow('Invalid sleeve joints');
    g.dispose();
  });
});
