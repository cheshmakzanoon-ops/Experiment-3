import * as T from 'three';
import type { RiderDetail } from '../rider.ts';

const REAR = -0.171,
  FRONT = 0.171;

/** The original MX250 has a rolled oval two-stroke can. The four-stroke
 * shell is pressed to a taller, flatter-sided section. Both are swaged to
 * round ends so the existing end cap and annular inlet seat on the metal. */
export function mxSilencerSleeve(
  detail: RiderDetail,
  twoStroke: boolean,
  band?: { centre: number; width: number },
) {
  const sides = detail === 'high' ? 24 : detail === 'mid' ? 16 : 12;
  const stations = band
    ? [-0.5, -0.34, 0.34, 0.5].map((t) => band.centre + t * band.width)
    : [REAR, -0.156, -0.126, -0.095, 0.088, 0.127, 0.158, FRONT];
  const section = (a: number, z: number, lift: number, target: T.Vector3) => {
    const belly =
      T.MathUtils.smoothstep(z, REAR, -0.092) * (1 - T.MathUtils.smoothstep(z, 0.089, FRONT));
    const radius = T.MathUtils.lerp(0.0442, 0.049, (z - REAR) / (FRONT - REAR));
    const exponent = twoStroke ? 1 : 1 - 0.19 * belly;
    const c = Math.cos(a),
      s = Math.sin(a);
    return target.set(
      Math.sign(c) *
        Math.abs(c) ** exponent *
        (radius + lift - belly * (twoStroke ? 0.004 : 0.002)),
      Math.sign(s) *
        Math.abs(s) ** exponent *
        (radius + lift + belly * (twoStroke ? 0.004 : 0.012)),
      z,
    );
  };
  const positions: number[] = [],
    normals: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const p = new T.Vector3(),
    tangent = new T.Vector3(),
    axial = new T.Vector3(),
    scratch = new T.Vector3();
  for (let j = 0; j < stations.length; j++) {
    const z = stations[j];
    // The thin folded edge of each retaining strap catches a separate highlight.
    const lift = band ? (j === 0 || j === stations.length - 1 ? 0.0008 : 0.0026) : 0;
    const foldSlope = band
      ? ((j < 2 ? 1 : -1) * (j === 1 || j === 2 ? 0.5 : 1) * (0.0026 - 0.0008)) /
        (0.16 * band.width)
      : 0;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      section(a, z, lift, p);
      section(a + 0.001, z, lift, tangent).sub(section(a - 0.001, z, lift, scratch));
      section(a, z + 0.0001, lift + 0.0001 * foldSlope, axial).sub(
        section(a, z - 0.0001, lift - 0.0001 * foldSlope, scratch),
      );
      tangent.cross(axial).normalize();
      positions.push(p.x, p.y, p.z);
      normals.push(tangent.x, tangent.y, tangent.z);
      uv.push(i / sides, (z - REAR) / (FRONT - REAR));
      if (j && i) {
        const d = j * (sides + 1) + i,
          b = d - sides - 1;
        indices.push(b - 1, b, d, b - 1, d, d - 1);
      }
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  return g;
}

/** A stamped tab climbs from the inner crown to the left seat rail. The
 * centre relief and rubber-bushed mount can be seen through the subframe. */
export function mxSilencerHanger() {
  const s = new T.Shape();
  s.moveTo(0.018, 0.031);
  s.lineTo(0.041, 0.018);
  s.lineTo(0.108, 0.043);
  s.quadraticCurveTo(0.124, 0.048, 0.115, 0.065);
  s.quadraticCurveTo(0.109, 0.074, 0.095, 0.068);
  s.lineTo(0.034, 0.049);
  s.closePath();
  const relief = new T.Path();
  relief.moveTo(0.049, 0.038);
  relief.lineTo(0.079, 0.049);
  relief.lineTo(0.057, 0.045);
  relief.closePath();
  const mount = new T.Path();
  mount.absarc(0.105, 0.055, 0.0065, 0, Math.PI * 2, true);
  s.holes.push(relief, mount);
  return new T.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: false, curveSegments: 6 });
}
