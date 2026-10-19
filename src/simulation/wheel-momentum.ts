import { Vec3 } from '../core/math.ts';

/** Signed axle angular momentum in chassis coordinates, in N m s.
 * The wheel pose is Ry(steering) Rz(-camber); rolling forward is +X spin.
 * Airborne wheels contribute too. The caller owns and reuses the output. */
export function wheelAngularMomentum(
  tires: readonly { inertia: number; omega: number }[],
  steering: ArrayLike<number>,
  camber: ArrayLike<number>,
  out: Vec3,
) {
  out.set(0, 0, 0);
  for (let i = 0; i < tires.length; i++) {
    const h = tires[i].inertia * tires[i].omega,
      c = Math.cos(camber[i]);
    out.x += h * c * Math.cos(steering[i]);
    out.y -= h * Math.sin(camber[i]);
    out.z -= h * c * Math.sin(steering[i]);
  }
  return out;
}
