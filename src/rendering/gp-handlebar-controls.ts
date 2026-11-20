import * as T from 'three';
import type { RiderDetail } from './rider.ts';

/** Cylindrical axis is local Y, matching the bar. The inboard flange, twin
 * retaining grooves, fine diamonds and an off-centre mould mark share a draw. */
export function gpGripGeometry(side: number, detail: RiderDetail) {
  const count = detail === 'high' ? 24 : 16;
  const rows: [number, number][] = [
    [-0.06, 0.0105],
    [-0.06, 0.016],
    [-0.057, 0.018],
    [-0.054, 0.0165],
    [-0.052, 0.0158],
    [-0.05, 0.0168],
  ];
  const knurls = detail === 'high' ? 12 : 6;
  for (let i = 1; i <= knurls; i++) rows.push([-0.05 + (0.093 * i) / knurls, 0.0168]);
  rows.push(
    [0.046, 0.0158],
    [0.048, 0.0168],
    [0.053, 0.017],
    [0.054, 0.0215],
    [0.058, 0.022],
    [0.06, 0.02],
    [0.06, 0.0105],
  );
  const geom = new T.LatheGeometry(
    rows.map(([y, r]) => new T.Vector2(r, y)),
    count,
  );
  const pos = geom.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const row = i % rows.length,
      column = Math.floor(i / rows.length);
    const [y, radius] = rows[row];
    const knurled = row >= 6 && row < 6 + knurls && (row + column) % 2 === 0;
    const mark = side < 0 && y >= 0.053 && column === count / 2;
    const relief = (knurled ? 0.00072 : 0) + (mark ? 0.0013 : 0);
    const scale = 1 + relief / radius;
    pos.setXYZ(i, pos.getX(i) * scale, y, pos.getZ(i) * scale);
  }
  geom.computeVertexNormals();
  // Keep the axis/winding right handed when mirroring the inboard flange.
  if (side < 0) geom.rotateZ(Math.PI);
  return geom;
}

/** Fixed right-hand protector. Both ends clear the rotating grip and the
 * foremost brake-lever tip. Coordinates are in the steering-head frame. */
export function gpLeverGuard(detail: RiderDetail) {
  const path = new T.CatmullRomCurve3([
    new T.Vector3(-0.359, -0.07, -0.063),
    new T.Vector3(-0.378, -0.075, -0.057),
    new T.Vector3(-0.385, -0.072, -0.018),
    new T.Vector3(-0.381, -0.06, 0.034),
    new T.Vector3(-0.375, -0.049, 0.064),
    new T.Vector3(-0.356, -0.043, 0.075),
  ]);
  return new T.TubeGeometry(
    path,
    detail === 'high' ? 16 : 8,
    0.0055,
    detail === 'high' ? 8 : 5,
    false,
  );
}
