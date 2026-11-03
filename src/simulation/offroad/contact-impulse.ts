/** Inelastic normal impulse for a bottomed suspension contact. The contact
 * Jacobian is [-grade, 1, lever] in horizontal/heave/pitch coordinates.
 * Positive mass and inertia are required. Separating contacts receive no
 * impulse. Coupling all three momenta prevents penetration recovery from
 * manufacturing vertical kinetic energy out of a prescribed road speed. */
export function hardStopImpulse(
  horizontal: number,
  vertical: number,
  pitchRate: number,
  grade: number,
  lever: number,
  mass: number,
  pitchInertia: number,
) {
  const closing = grade * horizontal - vertical - lever * pitchRate;
  return Math.max(0, closing) / ((1 + grade * grade) / mass + (lever * lever) / pitchInertia);
}
