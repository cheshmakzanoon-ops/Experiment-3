import * as T from 'three';
import type { RiderDetail } from '../rider.ts';
import { mapMxKitPanel } from './motocross-graphics-kit.ts';

/** A wrapped crossbar foam with rolled end hems and an open bore. The MX250
 * carries rounder padding; the 450 has a deeper oval section. The artwork
 * follows the sleeve continuously around the back and over the crown. */
export function mxCrossbarPad(detail: RiderDetail, compact: boolean) {
  const sides = detail === 'high' ? 20 : detail === 'mid' ? 14 : 10;
  const half = compact ? 0.109 : 0.116;
  const ring = [
    [-1, 0.3],
    [-1, 0.84],
    [-0.97, 0.98],
    [-0.93, 1],
    [-0.87, 0.98],
    [-0.79, 1],
    [0.79, 1],
    [0.87, 0.98],
    [0.93, 1],
    [0.97, 0.98],
    [1, 0.84],
    [1, 0.3],
  ];
  const pos: number[] = [],
    uv: number[] = [],
    colours: number[] = [],
    index: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [station, radius] = ring[i];
    for (let j = 0; j <= sides; j++) {
      const u = j / sides;
      const angle = 0.75 * Math.PI - 2 * Math.PI * u;
      const c = Math.cos(angle),
        s = Math.sin(angle);
      const shape = compact ? 0.97 : 0.78;
      const y = Math.sign(c) * Math.abs(c) ** shape * radius * (compact ? 0.0295 : 0.0325);
      const z = Math.sign(s) * Math.abs(s) ** shape * radius * (compact ? 0.0305 : 0.0365);
      pos.push(station * half, y, z);
      const end = i < 2 || i >= ring.length - 2;
      // The end foam samples a clear strip on the same charcoal wrap.
      uv.push(end ? 0.06 + u * 0.065 : u, end ? 0.2 + 0.05 * radius : (1 - station) / 2);
      const value = end ? 0.52 : 0.98;
      colours.push(value, value, value);
      if (j === sides) continue;
      const a = i * (sides + 1) + j,
        b = ((i + 1) % ring.length) * (sides + 1) + j;
      index.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  // The longitudinal UV seam is on the underside of the wrap.
  const n = g.getAttribute('normal'),
    first = new T.Vector3(),
    last = new T.Vector3();
  for (let i = 0; i < ring.length; i++) {
    const a = i * (sides + 1),
      b = a + sides;
    first.fromBufferAttribute(n, a).add(last.fromBufferAttribute(n, b)).normalize();
    n.setXYZ(a, first.x, first.y, first.z);
    n.setXYZ(b, first.x, first.y, first.z);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return mapMxKitPanel(g, 'bar', () => true);
}
