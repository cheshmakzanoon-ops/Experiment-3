import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const AXLE_HEIGHT = 0.355;
export const MX_VAN_TYRE_SETTLE = 0.012;

/** The parked van sits on a short, flattened footprint. Its carcass swells
 * near the contact while the rim and the rest of the circumference stay round. */
export function mxServiceTyre() {
  const profile = [
    [.181, -.102], [.285, -.106], [.338, -.080], [.355, -.055],
    [.355, -.034], [.350, -.032], [.350, -.027], [.355, -.025],
    [.355, .025], [.350, .027], [.350, .032], [.355, .034],
    [.355, .055], [.338, .080], [.285, .106], [.181, .102], [.181, -.102],
  ].map(([r, width]) => new T.Vector2(r, width));
  const g = new T.LatheGeometry(profile, 28).rotateZ(Math.PI / 2);
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const point = new T.Vector3(), normal = new T.Vector3(), down = new T.Vector3(0, -1, 0);
  for (let i = 0; i < p.count; i++) {
    point.fromBufferAttribute(p, i);
    const h = AXLE_HEIGHT + point.y;
    if (h >= 0.14) continue;
    const shoulder = T.MathUtils.smoothstep(Math.abs(point.x), .055, .10);
    const loaded = 1 - T.MathUtils.smoothstep(h, .018, .14);
    point.x += Math.sign(point.x) * .006 * loaded * shoulder;
    if (h < MX_VAN_TYRE_SETTLE) {
      point.y = MX_VAN_TYRE_SETTLE - AXLE_HEIGHT;
      normal.fromBufferAttribute(n, i).lerp(down, 1 - shoulder).normalize();
      n.setXYZ(i, normal.x, normal.y, normal.z);
    }
    p.setXYZ(i, point.x, point.y, point.z);
  }
  return g;
}

/** A pressed utility-van wheel with six punched ventilation apertures.
 * The recessed brake drum is visible through the gauge-thick steel. */
export function mxServiceWheelDish(side: number) {
  const shape = new T.Shape();
  const ring = (path: T.Path, points: number, position: (angle: number) => [number, number]) => {
    for (let i = 0; i < points; i++) {
      const [x, y] = position(2 * Math.PI * i / points);
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
    path.closePath();
  };
  ring(shape, 28, a => [.156 * Math.cos(a), .156 * Math.sin(a)]);
  const centre = new T.Path();
  ring(centre, 28, a => [.090 * Math.cos(-a), .090 * Math.sin(-a)]);
  shape.holes.push(centre);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3, u = Math.cos(a), v = Math.sin(a);
    const hole = new T.Path();
    ring(hole, 10, t => {
      const r = .123 + .020 * Math.cos(-t), tangent = .033 * Math.sin(-t);
      return [r * u - tangent * v, r * v + tangent * u];
    });
    shape.holes.push(hole);
  }
  // The punched annulus is flat between two spun shoulders. A single warped
  // triangulation across six holes creates false facets in the specular lobe.
  const plate = new T.ExtrudeGeometry(shape, { depth: .005, bevelEnabled: false, steps: 1 })
    .translate(0, 0, .053).rotateY(side * Math.PI / 2);
  const band = (section: number[][]) => {
    const profile = section.map(([r,w]) => new T.Vector2(r,w)).reverse();
    const g = new T.LatheGeometry(profile, 28).rotateZ(-side * Math.PI / 2);
    const triangles = g.toNonIndexed();
    g.dispose();
    return triangles;
  };
  const inner = band([[.055,.083],[.070,.080],[.080,.076],[.088,.061],[.091,.058]]);
  const outer = band([[.155,.058],[.158,.060],[.163,.071],[.169,.078]]);
  const result = mergeGeometries([plate, inner, outer])!;
  plate.dispose(); inner.dispose(); outer.dispose();
  return result;
}

export function mxServiceWheelLip(side: number) {
  const profile = [[.159,.074],[.175,.087],[.186,.089],[.192,.081],[.187,.074],[.169,.065]]
    .map(([radius, width]) => new T.Vector2(radius, width));
  return new T.LatheGeometry(profile.reverse(), 28).rotateZ(-side * Math.PI / 2);
}
