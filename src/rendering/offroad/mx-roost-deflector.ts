import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RiderDetail } from '../rider.ts';
import { motocrossJerseyPoint, motocrossNeckBrace } from './motocross-gear.ts';

type PanelPoint = { angle: number; y: number; relief: number; colour?: T.Color };

/** Chest plates, kidney belt and pivot straps in metres in the jersey's bind
 * frame. Open ventilation slots expose the textile under the moulding; the
 * rear bib stays accessible to the timing camera. Colours are linear. */
export function motocrossRoostDeflector(detail: RiderDetail, accent: number, lightShell: boolean) {
  const positions: number[] = [],
    colours: number[] = [],
    indices: number[] = [];
  const shell = new T.Color(lightShell ? 0xc6ccca : 0x3e484d);
  const webbing = new T.Color(0x353a40),
    foam = new T.Color(0x25292a);
  const keeper = new T.Color(accent).lerp(new T.Color(0x848a83), 0.22);
  const insert = (p: T.Vector3, tone: T.Color) => {
    positions.push(p.x, p.y, p.z);
    colours.push(tone.r, tone.g, tone.b);
    return positions.length / 3 - 1;
  };
  function panel(
    cols: number,
    rows: number,
    side: number,
    tone: T.Color,
    thickness: number,
    sample: (u: number, v: number) => PanelPoint,
    slot?: (x: number, y: number) => boolean,
  ) {
    const start = positions.length / 3,
      stride = cols + 1,
      layer = stride * (rows + 1);
    for (let back = 0; back < (far ? 1 : 2); back++)
      for (let j = 0; j <= rows; j++)
        for (let i = 0; i <= cols; i++) {
          const { angle, y, relief, colour } = sample(i / cols, j / rows);
          insert(motocrossJerseyPoint(angle, y, relief - back * thickness), back ? foam : colour ?? tone);
        }
    const solid = (x: number, y: number) =>
      x >= 0 && x < cols && y >= 0 && y < rows && !slot?.(x, y);
    const quad = (a: number, b: number, c: number, d: number) => {
      if (side > 0) indices.push(a, b, c, a, c, d);
      else indices.push(a, d, c, a, c, b);
    };
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        if (!solid(i, j)) continue;
        const a = start + j * stride + i,
          b = a + 1,
          c = b + stride,
          d = a + stride;
        quad(a, b, c, d);
        if (far) continue;
        quad(d + layer, c + layer, b + layer, a + layer);
        if (!solid(i, j - 1)) quad(b, a, a + layer, b + layer);
        if (!solid(i + 1, j)) quad(c, b, b + layer, c + layer);
        if (!solid(i, j + 1)) quad(d, c, c + layer, d + layer);
        if (!solid(i - 1, j)) quad(a, d, d + layer, a + layer);
      }
  }
  const far = detail === 'far',
    cols = far ? 3 : 7,
    rows = far ? 3 : 7;
  for (const side of [-1, 1]) {
    // A raised central rib leads into upswept, outward-sloping vents. The
    // narrow sternum gap and the scalloped underarm let the two halves move.
    panel(
      cols,
      rows,
      side,
      shell,
      0.005,
      (u, v) => {
        const arc = 0.037 + u * (1.05 - 0.14 * (2 * v - 1) ** 2);
        return {
          angle: Math.PI / 2 - side * arc,
          y: 0.252 + 0.177 * v + 0.045 * u - 0.047 * u ** 3 - 0.008 * (1 - v) * (1 - u) ** 2,
          relief: 0.014 + 0.009 * Math.sin(Math.PI * u) + 0.004 * Math.sin(2 * Math.PI * v) ** 2,
        };
      },
      (x, y) => !far && (y === 2 || y === 4) && x >= 2 && x <= 5,
    );
    for (const back of [false, true]) {
      // Hardware terminates underneath the raised collar shelf at the top.
      const direction = back ? -side : side;
      const strap = (u: number, v: number) => ({
        angle: ((back ? -1 : 1) * Math.PI) / 2 - direction * (0.72 + 0.29 * u - 0.17 * v),
        y: (back ? 0.37 : 0.425) + (back ? 0.135 : 0.08) * v - 0.012 * u,
        relief: 0.011 + 0.003 * Math.sin(Math.PI * u),
      });
      panel(2, detail === 'high' ? 4 : 2, direction, webbing, 0.003, strap);
      if (!far)
        panel(
          2,
          3,
          direction,
          keeper,
          0.004,
          (u, v) => {
            const q = strap(1.2 * u - 0.1, 0.38 + 0.2 * v);
            q.relief += 0.004 + 0.0015 * Math.sin(Math.PI * v);
            return q;
          },
          (x, y) => y === 1 && x === 0,
        );
    }
  }
  // One elastic band wraps under the bib and broadens over the lower back.
  // Its join and ladder buckle sit on the front quarter, clear of the spine.
  const buckleAngle = Math.PI / 2 + 0.48;
  const belt = (angle: number, v: number) => {
    const lumbar = (1 - Math.sin(angle)) / 2;
    const sideRise = 0.017 * Math.cos(angle) ** 2;
    return {
      angle, y: 0.148 + sideRise - 0.013 * lumbar + v * (0.036 + 0.018 * lumbar),
      relief: 0.011 + 0.0025 * Math.sin(Math.PI * v),
      colour: v === 0 || v === 1 ? foam : webbing,
    };
  };
  panel(detail === 'high' ? 16 : far ? 10 : 14, 2, 1, webbing, 0.003,
    (u, v) => belt(buckleAngle - 2 * Math.PI * u, v));
  if (!far) {
    panel(3, 3, 1, shell, 0.004, (u, v) => {
      const point = belt(buckleAngle + (0.5 - u) * 0.20, 0.10 + v * 0.80);
      return { ...point, relief: point.relief + 0.005, colour: shell };
    }, (column, row) => column === 1 && row === 1);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function motocrossTorsoProtection(detail: RiderDetail, accent: number, lightShell: boolean) {
  const guard = motocrossRoostDeflector(detail, accent, lightShell);
  if (detail === 'far') return guard;
  const neck = motocrossNeckBrace(detail);
  const combined = mergeGeometries([neck, guard])!;
  neck.dispose();
  guard.dispose();
  return combined;
}
