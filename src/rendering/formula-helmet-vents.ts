import * as T from 'three';
import { helmetPoint } from './helmet-shell.ts';

/** Original chin intakes and brow scoops. Every perimeter station is projected
 * onto the shell. A raised lip, return wall, dark bed and two internal vanes
 * give the openings depth as the helmet turns through a highlight. */
export function helmetVentGeometry(chin: boolean, side: -1 | 1) {
  const halfAngle = chin ? 0.207 : 0.161,
    halfHeight = chin ? 0.0105 : 0.0066;
  const y = chin ? -0.076 : 0.077,
    centre = Math.PI / 2 + side * (chin ? 0.305 : 0.44);
  const n = 20;
  const lip: number[] = [],
    lipUv: number[] = [],
    lipIndex: number[] = [];
  const cavity: number[] = [],
    cavityUv: number[] = [],
    cavityIndex: number[] = [];
  const p = new T.Vector3();
  function surface(x: number, v: number, offset: number, pos: number[], uv: number[]) {
    const yy = y + halfHeight * (v + side * x * (chin ? 0.29 : 0.48));
    const phi = centre + halfAngle * x * (1 + v * 0.13);
    helmetPoint(yy, phi, offset, p);
    pos.push(p.x, p.y, p.z);
    uv.push(phi / (2 * Math.PI), (yy + 0.135) / 0.284);
  }
  for (const [scale, height] of [
    [1.14, 0.0007],
    [1.0, 0.0049],
    [0.79, 0.0059],
    [0.75, 0.0019],
  ]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2,
        c = Math.cos(a),
        s = Math.sin(a);
      const x = Math.sign(c) * Math.abs(c) ** 0.72,
        v = Math.sign(s) * Math.abs(s) ** 0.72;
      surface(x * scale, v * scale, height * (1 + 0.18 * v), lip, lipUv);
      if (scale === 0.75) surface(x * 0.76, v * 0.76, 0.0018, cavity, cavityUv);
    }
  }
  for (let r = 0; r < 3; r++)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n,
        a = r * n + i,
        b = r * n + j;
      lipIndex.push(a, b, a + n, b, b + n, a + n);
    }
  surface(0, 0, 0.0018, cavity, cavityUv);
  for (let i = 0; i < n; i++) cavityIndex.push(n, i, (i + 1) % n);
  for (const vane of [-0.285, 0.285]) {
    const a = lip.length / 3;
    for (const h of [-0.72, 0.72])
      for (const dx of [-0.042, 0.042]) surface(vane + dx, h, 0.0037 + 0.0008 * h, lip, lipUv);
    lipIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const build = (position: number[], uv: number[], index: number[]) => {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  };
  return { lip: build(lip, lipUv, lipIndex), bed: build(cavity, cavityUv, cavityIndex) };
}
