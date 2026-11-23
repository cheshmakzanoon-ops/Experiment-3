import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { gpForgedWheel, gpTyreCompoundMarkings } from '../src/rendering/gp-forged-wheel.ts';
import { tyreGeometry } from '../src/rendering/bike.ts';

import { gpWheelHardware } from '../src/rendering/gp-wheel-hardware.ts';

describe('GP tyre fitting hardware', () => {
  it.each([true,false])('seats the valve and counterweights on opposite sides of the rotating barrel (front %s)', front => {
    const rim = .2159, half = front ? .06 : .1;
    const g=gpWheelHardware(rim,half,front), p=g.getAttribute('position');
    const angle=front ? .56 : -.68, barrel=rim-.026;
    let stemTip=0, valveFoot=0, weights=0;
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i), y=p.getY(i), z=p.getZ(i), r=Math.hypot(y,z);
      expect(r).toBeLessThan(rim-.024);
      expect(r).toBeGreaterThan(.165);
      expect(Math.abs(x)).toBeLessThan(half*.76);
      if(y*Math.cos(angle)+z*Math.sin(angle)>0) {
        if(r>=barrel) valveFoot++;
        if(x*(front?1:-1)>.022) stemTip++;
      } else if(r>=barrel-.0033) weights++;
    }
    expect(valveFoot).toBeGreaterThan(3);
    expect(stemTip).toBeGreaterThan(4);
    expect(weights).toBe((front ? 2 : 3)*12);
    expect(g.index!.count/3).toBeLessThan(170);
    g.dispose();
  });
});

describe('GP forged wheels and painted compound arcs', () => {
  it.each(['high', 'mid', 'far'] as const)(
    '%s keeps open spoke windows and axle bore inside the existing tyre bead',
    (detail) => {
      for (const halfWidth of [0.06, 0.1]) {
        const geometry = gpForgedWheel(0.2159, halfWidth, detail),
          material = new T.MeshBasicMaterial({ side: T.DoubleSide }),
          wheel = new T.Mesh(geometry, material),
          ray = new T.Raycaster();
        try {
          const p = geometry.getAttribute('position'),
            n = geometry.getAttribute('normal');
          for (let i = 0; i < p.count; i++) {
            expect(Math.abs(p.getX(i))).toBeLessThan(halfWidth * 0.77);
            expect(Math.hypot(p.getY(i), p.getZ(i))).toBeLessThan(0.2199);
            expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
          }
          const hit = (radius: number, angle: number) => {
            ray.set(
              new T.Vector3(-1, Math.cos(angle) * radius, Math.sin(angle) * radius),
              new T.Vector3(1, 0, 0),
            );
            return ray.intersectObject(wheel).length;
          };
          expect(hit(0, 0)).toBe(0);
          for (let i = 0; i < 5; i++) {
            // There is daylight between adjacent split spokes, not a hidden
            // disc. The continuous rim must close the same viewing angle.
            const angle = ((i + 0.5) / 5) * Math.PI * 2;
            expect(hit(0.14, angle)).toBe(0);
            expect(hit(0.205, angle)).toBeGreaterThan(0);
            expect(hit(0.035, angle)).toBeGreaterThan(0);
          }
          expect(geometry.index!.count / 3).toBeLessThan({ high: 3700, mid: 2400, far: 700 }[detail]);
          expect(geometry.groups).toHaveLength(0);
        } finally {
          geometry.dispose();
          material.dispose();
        }
      }
    },
  );

  it.each([
    [0.31, 0.06, 0.07, 40],
    [0.32, 0.1, 0.11, 40],
    [0.31, 0.06, 0.07, 20],
    [0.32, 0.1, 0.11, 20],
  ])(
    'fits paint to front/rear sidewall facets (%s/%s m, %s crown, %s segments)',
    (radius, halfWidth, crown, segments) => {
      const tyre = tyreGeometry(radius, halfWidth, crown, 0.2199, segments),
        paint = gpTyreCompoundMarkings(tyre),
        material = new T.MeshBasicMaterial({ side: T.DoubleSide }),
        mesh = new T.Mesh(tyre, material),
        ray = new T.Raycaster();
      try {
        const p = paint.getAttribute('position'),
          normals = paint.getAttribute('normal'),
          indices = paint.index!,
          a = new T.Vector3(),
          b = new T.Vector3(),
          c = new T.Vector3(),
          n = new T.Vector3();
        for (let i = 0; i < p.count; i++) {
          a.fromBufferAttribute(p, i);
          n.fromBufferAttribute(normals, i);
          ray.set(a, n.clone().negate());
          const hit = ray.intersectObject(mesh)[0];
          expect(hit).toBeDefined();
          expect(hit.distance).toBeGreaterThan(0.0002);
          expect(hit.distance).toBeLessThan(0.0006);
          expect(Math.abs(a.x)).toBeGreaterThan(halfWidth * 0.65);
        }
        for (let i = 0; i < indices.count; i += 3) {
          a.fromBufferAttribute(p, indices.getX(i));
          b.fromBufferAttribute(p, indices.getX(i + 1));
          c.fromBufferAttribute(p, indices.getX(i + 2));
          n.fromBufferAttribute(normals, indices.getX(i));
          // Outward paint faces remain visible with the single-sided shared
          // material, and none spans through the tyre to its opposite side.
          expect(b.sub(a).cross(c.sub(a)).normalize().dot(n)).toBeGreaterThan(0.8);
        }
        expect(indices.count / 3).toBeLessThan(120);
      } finally {
        tyre.dispose();
        paint.dispose();
        material.dispose();
      }
    },
  );
});
