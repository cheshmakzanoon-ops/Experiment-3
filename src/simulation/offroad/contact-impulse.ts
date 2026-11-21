/** Inelastic normal impulse for a bottomed suspension contact. The contact
 * Jacobian is [-grade, -crossGrade, 1, lever, -yaw.arm] in the travel
 * frame. yaw.arm is the change in terrain height per radian of chassis yaw
 * at the particular tyre, signed separately for the front and rear axle.
 * Positive mass and inertia are required. Separating contacts receive no
 * impulse. Coupling translation and pitch prevents penetration recovery from
 * manufacturing vertical kinetic energy out of a prescribed road speed. */
export function hardStopImpulse(
  horizontal: number,
  vertical: number,
  pitchRate: number,
  grade: number,
  lever: number,
  mass: number,
  pitchInertia: number,
  lateral = 0,
  crossGrade = 0,
  yaw?: { arm: number; rate: number; inertia: number },
) {
  const closing =
    grade * horizontal +
    crossGrade * lateral -
    vertical -
    lever * pitchRate +
    (yaw ? yaw.arm * yaw.rate : 0);
  return (
    Math.max(0, closing) /
    ((1 + grade * grade + crossGrade * crossGrade) / mass +
      (lever * lever) / pitchInertia +
      (yaw ? (yaw.arm * yaw.arm) / yaw.inertia : 0))
  );
}

/** Closing speed along the unit terrain normal. Positive is into the soil.
 * Keeping the cross grade matters on an off-camber or sideways landing. */
export function landingNormalSpeed(
  forward: number,
  lateral: number,
  vertical: number,
  grade: number,
  crossGrade: number,
) {
  return (grade * forward + crossGrade * lateral - vertical) / Math.hypot(1, grade, crossGrade);
}
