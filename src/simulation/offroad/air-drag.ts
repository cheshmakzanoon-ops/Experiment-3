/** Exact forward motion under dv/dt = -k v², where k is drag / mass in
 * inverse metres. The direction and any independent lateral velocity stay
 * with the caller. Integrating distance as well as endpoint speed makes a
 * constant-coefficient flight independent of its timestep subdivision. */
export function quadraticAirDrag(speed: number, dragPerMass: number, dt: number) {
  if (
    ![speed, dragPerMass, dt].every(Number.isFinite) ||
    speed < 0 || dragPerMass < 0 || dt < 0
  )
    throw new RangeError('Invalid airborne drag step');
  const reduction = dragPerMass * speed * dt;
  // This also covers a vanishingly small k whose product underflows. log1p
  // retains the continuous zero-drag limit for every representable product.
  if (reduction === 0) return { speed, distance: speed * dt };
  return {
    speed: speed / (1 + reduction),
    distance: speed * dt * (Math.log1p(reduction) / reduction),
  };
}
